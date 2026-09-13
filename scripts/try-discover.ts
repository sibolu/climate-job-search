/**
 * `pnpm try:discover <profile.md> [profile.md-out]` — the Phase 1.4
 * acceptance check, and the Gate 1 script to run on a real profile.
 *
 * It reads a `profile.md`, runs `discoverFields` (one live `discover` call
 * through `src/lib/llm.ts` with web search, or two if the API refuses
 * structured output alongside server tools), prints the updated `profile.md`
 * to stdout and a usage/cost line to stderr, and exits non-zero if any field
 * or role written this run lacks a card citation or a source.
 *
 *   pnpm try:discover src/lib/__fixtures__/discover/videographer.md
 *   pnpm try:discover profile.md out/profile.md
 *
 * It never echoes the profile except as the output the app would store in
 * the browser. Needs `ANTHROPIC_API_KEY` and the local Supabase stack (the
 * reference catalogue is read from it).
 */

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import { DiscoverInputError, discoverFields, droppedSummary } from "../src/lib/discover";
import { citedActiveCardIds } from "../src/lib/discover";
import { parseProfile, serializeProfile } from "../src/lib/profile";
import { newSessionId } from "../src/lib/session";

const USAGE = "usage: pnpm try:discover <profile.md> [profile.md-out]";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
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
  for (const w of parsed.warnings) process.stderr.write(`warning: ${w}\n`);

  const started = Date.now();
  const result = await discoverFields({ sessionId: newSessionId(), profile: parsed.profile }).catch(
    (error: unknown) => {
      if (error instanceof DiscoverInputError) fail(error.message);
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

  const cost = result.calls.reduce((s, c) => s + c.costUsd, 0);
  const tok = result.calls.map(
    (c) =>
      `in ${String(c.usage.input)} (cache r${String(c.usage.cacheRead)}/w${String(c.usage.cacheWrite)}) out ${String(c.usage.output)}`,
  );
  process.stderr.write(
    `${result.strategy} | ${String(result.fields.length)} fields, ${String(result.roles.length)} roles | ` +
      `${droppedSummary(result.dropped)} | ${tok.join(" + ")} tok | $${cost.toFixed(4)} | ` +
      `${String(Math.round((Date.now() - started) / 100) / 10)}s\n`,
  );
  process.stderr.write(
    `fields: ${result.fields.map((f) => `${f.id} ${f.name} [${f.move ?? "?"}]`).join("; ")}\n`,
  );

  // The acceptance rule, checked here so the exit code carries it.
  const problems: string[] = [];
  if (result.fields.length < 4) problems.push(`expected >=4 fields, got ${String(result.fields.length)}`);
  for (const f of result.fields) {
    if (citedActiveCardIds(f.fit, result.profile).length === 0) problems.push(`${f.id} cites no card`);
    if (f.sources.length === 0) problems.push(`${f.id} has no source`);
    if (!result.roles.some((r) => r.fieldId === f.id)) problems.push(`${f.id} has no role`);
  }
  for (const r of result.roles) {
    if (citedActiveCardIds(r.why, result.profile).length === 0) problems.push(`${r.id} cites no card`);
    if (r.sources.length === 0) problems.push(`${r.id} has no source`);
  }
  if (problems.length > 0) fail(`FAILED: ${problems.join("; ")}`);
  process.stderr.write("PASS: every field and role cites a card and has a source\n");
}

main().catch((error: unknown) => {
  // Never print the request or the model's text — only what went wrong.
  process.stderr.write(
    `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`,
  );
  process.exitCode = 1;
});
