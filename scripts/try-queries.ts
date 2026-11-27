/**
 * `pnpm try:queries <profile.md> [profile.md-out] [--tick R1,R4] [--revise]`
 * — the 2b.8 acceptance check, live (technical-plan.md D47).
 *
 * It reads a `profile.md` and runs `generateQueries` once (one `queries` call
 * through `src/lib/llm.ts`, no web tools) for every role with
 * `Selected: yes` across all fields. The fixture has three selected roles in
 * two fields; `--tick` ticks more with `setRoleSelected` first, as the Roles
 * screen does, so discovery output can be fed in without editing it. It
 * prints one line per selected role to stderr with the role id, title, field
 * and LinkedIn query, and exits non-zero unless the number of live LinkedIn
 * queries carrying a `Role` equals the number of selected roles, one per
 * role. A query phrase carrying a level word is reported as a warning, not a
 * failure.
 *
 * With `--revise` it then runs `reviseQueries` with the scripted feedback
 * "bad fit: all roles need PE license" on the first query just written for a
 * field whose text mentions a license (else the first one written), prints
 * the summary and the explanation, and exits non-zero if the revision
 * neither retired, narrowed nor added a query, or gave no explanation.
 *
 * The final `profile.md` goes to stdout, or to the out file when given.
 *
 *   pnpm try:queries src/lib/__fixtures__/queries/engineer.md
 *   pnpm try:queries discovered.md out.md --tick R1,R4,R2
 *
 * It never echoes the profile except as the output the app would store in
 * the browser. Needs `ANTHROPIC_API_KEY`, `ACCESS_CODE` (every call is
 * charged to that code, technical-plan.md D71) and the local Supabase stack,
 * which holds the code's budget and the usage rows.
 */

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import { type Profile, parseProfile, serializeProfile, setRoleSelected } from "../src/lib/profile";
import {
  QueriesInputError,
  QueriesOutputError,
  RETIRED_KEY,
  droppedSummary,
  generateQueries,
  levelPhrasesIn,
  reviseQueries,
} from "../src/lib/queries";
import { llm } from "../src/lib/llm";
import { newSessionId } from "../src/lib/session";
import { liveQueryForRole, selectedRoles } from "../src/lib/workspace";

import { keyedLlm, scriptAccessCodeKey } from "./script-access-code";

const USAGE = "usage: pnpm try:queries <profile.md> [profile.md-out] [--tick R1,R4] [--revise]";
const REVISE_FLAG = "--revise";
const TICK_FLAG = "--tick";
const FEEDBACK_REASON = "bad fit: all roles need PE license";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function log(line: string): void {
  process.stderr.write(`${line}\n`);
}

function ids(list: readonly { id: string; roleId?: string }[]): string {
  return list.map((q) => (q.roleId === undefined || q.roleId === "" ? q.id : `${q.id}/${q.roleId}`)).join(", ") || "-";
}

/**
 * Prints one line per selected role and returns how many selected roles have
 * a live LinkedIn query that names them.
 */
function reportSelectedRoles(profile: Profile): { selected: number; live: number } {
  const roles = selectedRoles(profile);
  let live = 0;
  for (const role of roles) {
    const field = profile.fields.find((f) => f.id === role.fieldId);
    const query = liveQueryForRole(profile, role.id);
    if (query !== undefined) live += 1;
    log(`${role.id} | ${role.title} | ${role.fieldId}: ${field?.name ?? "(no field)"} | ${query?.query ?? "(no query)"}`);
    const levels = query === undefined ? [] : levelPhrasesIn(query.query);
    if (levels.length > 0) log(`warning: ${query?.id ?? ""} for ${role.id} carries a level word in: ${levels.join(", ")}`);
  }
  return { selected: roles.length, live };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  const tick: string[] = [];
  let revise = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (arg === REVISE_FLAG) revise = true;
    else if (arg === TICK_FLAG || arg.startsWith(`${TICK_FLAG}=`)) {
      // `--tick R1,R4` or `--tick=R1,R4`.
      const list = arg === TICK_FLAG ? (args[(i += 1)] ?? "") : arg.slice(TICK_FLAG.length + 1);
      tick.push(...list.split(",").map((id) => id.trim()).filter((id) => id !== ""));
      if (tick.length === 0) fail(USAGE);
    } else if (arg.startsWith("-")) fail(USAGE);
    else positional.push(arg);
  }
  const [input, output] = positional;
  if (input === undefined) fail(USAGE);
  const codeKey = await scriptAccessCodeKey();
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
  let start = parsed.profile;
  for (const id of tick) {
    if (!start.roles.some((r) => r.id === id)) fail(`${TICK_FLAG} names ${id}, which is not a role in this profile.`);
    start = setRoleSelected(start, id, true);
  }
  const sessionId = newSessionId();
  const keyed = keyedLlm(llm(), codeKey);
  const onInput = (error: unknown): never => {
    if (error instanceof QueriesInputError) fail(error.message);
    if (error instanceof QueriesOutputError) fail(`${error.message} dropped ${droppedSummary(error.dropped)}`);
    throw error;
  };

  const generated = await generateQueries({ sessionId, profile: start }, { llm: keyed }).catch(onInput);
  log(
    `generate: added ${ids(generated.added)}; updated ${ids(generated.updated)}; superseded ${generated.superseded.join(", ") || "-"}`,
  );
  log(`generate: dropped ${droppedSummary(generated.dropped)}`);
  log(
    `generate: ${JSON.stringify(generated.metrics.usage)} cost=$${generated.metrics.costUsd.toFixed(4)} ${generated.metrics.durationMs}ms`,
  );
  let profile = generated.profile;
  const { selected, live } = reportSelectedRoles(profile);
  const named = profile.queries.filter(
    (q) => q.board === "linkedin" && q.roleId !== "" && q.status === "untried" && q.extra[RETIRED_KEY] !== "yes",
  );
  const offBoard = generated.written.filter((q) => q.board !== "linkedin" || q.roleId === "");
  if (offBoard.length > 0) fail(`FAIL: ${ids(offBoard)} are not LinkedIn queries naming a role.`);
  if (generated.written.length !== selected || live !== selected) {
    fail(
      `FAIL: ${String(selected)} selected roles, ${String(generated.written.length)} queries written, ${String(live)} roles with a live LinkedIn query.`,
    );
  }
  const selectedIds = new Set(generated.roles.map((r) => r.id));
  const untriedForSelected = named.filter((q) => selectedIds.has(q.roleId));
  if (untriedForSelected.length !== selected) {
    fail(
      `FAIL: ${String(untriedForSelected.length)} untried LinkedIn queries name a selected role; expected ${String(selected)}, one each.`,
    );
  }
  log(`[DONE] ${String(selected)} LinkedIn queries, one per selected role, each naming its role id.`);

  if (revise) {
    const licensed = new Set(
      profile.fields
        .filter((f) => /\b(PE|license|licence|licensed)\b/i.test(`${f.name} ${f.fit} ${f.uncertain}`))
        .map((f) => f.id),
    );
    const target = generated.written.find((q) => q.fieldIds.some((id) => licensed.has(id))) ?? generated.written[0];
    if (target === undefined) fail("No query to give feedback on.");
    log(`revise: feedback bad on ${target.id} for ${target.roleId} fields ${target.fieldIds.join(", ")}: ${FEEDBACK_REASON}`);

    const revised = await reviseQueries({
      sessionId,
      profile,
      feedback: { queryId: target.id, verdict: "bad", reason: FEEDBACK_REASON },
    }, { llm: keyed }).catch(onInput);
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
    profile = revised.profile;
    reportSelectedRoles(profile);
    const changed = revised.retired.length + revised.narrowed.length + revised.added.length;
    if (revised.explanation === "") fail("FAIL: the revision returned no explanation.");
    if (changed === 0) fail("FAIL: the revision neither retired, narrowed nor added a query.");
    log(`[DONE] revision changed ${String(changed)} queries and explained why.`);
  }

  const out = serializeProfile(profile);
  if (output === undefined) process.stdout.write(out);
  else writeFileSync(output, out);
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : "Error";
  const status =
    typeof error === "object" && error !== null && "status" in error ? ` status=${String(error.status)}` : "";
  fail(`${name}${status}`);
});
