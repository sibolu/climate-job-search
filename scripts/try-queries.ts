/**
 * `pnpm try:queries <profile.md> [profile.md-out]` — the Phase 2.3
 * acceptance check, live.
 *
 * It reads a `profile.md`, runs `generateQueries` (one `queries` call through
 * `src/lib/llm.ts`, no web tools), then runs `reviseQueries` with the scripted
 * feedback "bad fit: all roles need PE license" on the first untried query
 * tied to a field whose text mentions a license (else the first query),
 * prints both summaries and the explanation to stderr, writes the final
 * `profile.md` to stdout (or the out file), and exits non-zero if the
 * revision neither retired, narrowed nor added a query, or gave no
 * explanation.
 *
 *   pnpm try:queries src/lib/__fixtures__/queries/engineer.md
 *
 * It never echoes the profile except as the output the app would store in
 * the browser. Needs `ANTHROPIC_API_KEY`; the usage row insert needs the
 * local Supabase stack and is fire-and-forget.
 */

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import { parseProfile, serializeProfile } from "../src/lib/profile";
import { QueriesInputError, RETIRED_KEY, droppedSummary, generateQueries, reviseQueries } from "../src/lib/queries";
import { newSessionId } from "../src/lib/session";

const USAGE = "usage: pnpm try:queries <profile.md> [profile.md-out]";
const FEEDBACK_REASON = "bad fit: all roles need PE license";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function log(line: string): void {
  process.stderr.write(`${line}\n`);
}

function ids(list: readonly { id: string; board?: string }[]): string {
  return list.map((q) => (q.board === undefined ? q.id : `${q.id}/${q.board}`)).join(", ") || "-";
}

async function main(): Promise<void> {
  const [input, output] = process.argv.slice(2);
  if (input === undefined || input === "-h" || input === "--help") fail(USAGE);
  if (process.env.ANTHROPIC_API_KEY === undefined || process.env.ANTHROPIC_API_KEY === "") {
    fail("ANTHROPIC_API_KEY is not set. Put it in .env.local and try again.");
  }

  let md: string;
  try {
    md = readFileSync(input, "utf8");
  } catch {
    fail(`Could not read ${input}\n${USAGE}`);
  }
  const parsed = parseProfile(md);
  for (const w of parsed.warnings) log(`warning: ${w}`);
  const sessionId = newSessionId();
  const onInput = (error: unknown): never => {
    if (error instanceof QueriesInputError) fail(error.message);
    throw error;
  };

  const generated = await generateQueries({ sessionId, profile: parsed.profile }).catch(onInput);
  log(`generate: added ${ids(generated.added)}; updated ${ids(generated.updated)}`);
  log(`generate: dropped ${droppedSummary(generated.dropped)}`);
  log(
    `generate: ${JSON.stringify(generated.metrics.usage)} cost=$${generated.metrics.costUsd.toFixed(4)} ${generated.metrics.durationMs}ms`,
  );

  const profile = generated.profile;
  const licensed = new Set(
    profile.fields
      .filter((f) => /\b(PE|license|licence|licensed)\b/i.test(`${f.name} ${f.fit} ${f.uncertain}`))
      .map((f) => f.id),
  );
  const target =
    profile.queries.find((q) => q.status === "untried" && q.fieldIds.some((id) => licensed.has(id))) ??
    profile.queries[0];
  if (target === undefined) fail("No query to give feedback on.");
  log(`revise: feedback bad on ${target.id} [${target.board}] fields ${target.fieldIds.join(", ")}: ${FEEDBACK_REASON}`);

  const revised = await reviseQueries({
    sessionId,
    profile,
    feedback: { queryId: target.id, verdict: "bad", reason: FEEDBACK_REASON },
  }).catch(onInput);
  log(`revise: retired ${revised.retired.join(", ") || "-"}; narrowed ${revised.narrowed.join(", ") || "-"}; added ${ids(revised.added)}`);
  log(`revise: fields ${revised.fieldChanges.map((c) => `${c.id} ${c.from}->${c.to}`).join(", ") || "-"}`);
  log(`revise: dropped ${droppedSummary(revised.dropped)}`);
  log(
    `revise: ${JSON.stringify(revised.metrics.usage)} cost=$${revised.metrics.costUsd.toFixed(4)} ${revised.metrics.durationMs}ms`,
  );
  log(`revise: explanation:\n${revised.explanation}`);
  log(
    `queries: ${revised.profile.queries.map((q) => `${q.id}:${q.status}${q.extra[RETIRED_KEY] === "yes" ? "(retired)" : ""}`).join(" ")}`,
  );

  const out = serializeProfile(revised.profile);
  if (output === undefined) process.stdout.write(out);
  else writeFileSync(output, out);

  const changed = revised.retired.length + revised.narrowed.length + revised.added.length;
  if (revised.explanation === "") fail("FAIL: the revision returned no explanation.");
  if (changed === 0) fail("FAIL: the revision neither retired, narrowed nor added a query.");
  log(`[DONE] revision changed ${changed} queries and explained why.`);
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : "Error";
  const status =
    typeof error === "object" && error !== null && "status" in error ? ` status=${String(error.status)}` : "";
  fail(`${name}${status}`);
});
