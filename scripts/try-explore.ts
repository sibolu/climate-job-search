/**
 * `pnpm try:explore <profile.md> <fieldId> [profile.md-out]` — the Phase 2.2
 * acceptance check, and the Gate 2 script to run on a real profile.
 *
 * It reads a `profile.md`, runs `exploreField` on one field (one live
 * `explore` call through `src/lib/llm.ts` with web search, or two if the API
 * refuses structured output alongside server tools), prints the updated
 * `profile.md` to stdout, the assistant message and a usage/cost line to
 * stderr, and exits non-zero unless the output cites URLs and nothing the
 * model searched, fetched or cited had a blocked host.
 *
 *   pnpm try:explore profile.md F1
 *   pnpm try:explore profile.md F1 out/profile.md
 *
 * It never echoes the profile except as the output the app would store in
 * the browser (the profile and the chat message). Needs `ANTHROPIC_API_KEY`
 * and the local Supabase stack (the reference collection is read from it).
 */

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import { ExploreBlockedFetchError, ExploreInputError, exploreDroppedSummary, exploreField } from "../src/lib/explore";
import { assertToolsAllowed, webTools } from "../src/lib/llm";
import { parseProfile, serializeProfile } from "../src/lib/profile";
import { isBlockedSourceHost } from "../src/lib/reference-schema";
import { newSessionId } from "../src/lib/session";

const USAGE = "usage: pnpm try:explore <profile.md> <fieldId> [profile.md-out]";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [input, fieldId, output] = process.argv.slice(2);
  if (input === undefined || fieldId === undefined || input === "-h" || input === "--help") fail(USAGE);
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
  for (const w of parsed.warnings) process.stderr.write(`warning: ${w}\n`);

  // The tools the module uses must block every listed domain before any call.
  const tools = webTools({ searchMaxUses: 8, fetchMaxUses: 4 });
  assertToolsAllowed(tools);

  const started = Date.now();
  const result = await exploreField({ sessionId: newSessionId(), profile: parsed.profile, fieldId }, { tools }).catch(
    (error: unknown) => {
      if (error instanceof ExploreInputError) fail(error.message);
      if (error instanceof ExploreBlockedFetchError) fail(`FAILED: ${error.message}`);
      throw error;
    },
  );

  const out = serializeProfile(result.profile);
  if (output === undefined) {
    process.stdout.write(out);
  } else {
    writeFileSync(output, out, "utf8");
    process.stderr.write(`wrote ${output}\n`);
  }
  process.stderr.write(`\n--- assistant message ---\n${result.message}\n--- end ---\n\n`);

  const cost = result.calls.reduce((s, c) => s + c.costUsd, 0);
  const tok = result.calls.map(
    (c) =>
      `in ${String(c.usage.input)} (cache r${String(c.usage.cacheRead)}/w${String(c.usage.cacheWrite)}) out ${String(c.usage.output)}`,
  );
  const v = result.validated;
  process.stderr.write(
    `${result.strategy} | ${result.field.id} ${result.field.name} | ${String(v.posts.length)} posts, ` +
      `${String(result.roles.length)} roles, ${String(v.sources.length)} sources, ${String(v.keywords.length)} keywords | ` +
      `${String(result.fetchedUrls)} URLs seen in tool results/citations | ${exploreDroppedSummary(result.dropped)} | ` +
      `${tok.join(" + ")} tok | $${cost.toFixed(4)} | ${String(Math.round((Date.now() - started) / 100) / 10)}s\n`,
  );

  // The acceptance rule, checked here so the exit code carries it.
  const problems: string[] = [];
  const cited = [...v.sources, ...v.posts.map((p) => p.sourceUrl), ...result.roles.flatMap((r) => r.sources)];
  if (cited.length === 0) problems.push("output cites no URL");
  if (v.posts.length === 0) problems.push("no example post with a usable source");
  for (const u of cited) if (isBlockedSourceHost(u)) problems.push(`blocked host cited: ${u}`);
  for (const r of result.roles) if (r.sources.length === 0) problems.push(`${r.id} has no source`);
  if (!result.field.explored) problems.push(`${result.field.id} not marked explored`);
  if (problems.length > 0) fail(`FAILED: ${problems.join("; ")}`);
  process.stderr.write("PASS: output cites URLs; no blocked host was searched, fetched or cited\n");
}

main().catch((error: unknown) => {
  // Never print the request or the model's text — only what went wrong.
  process.stderr.write(`${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`);
  process.exitCode = 1;
});
