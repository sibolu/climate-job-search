/**
 * `pnpm try:cards <path-to-resume.txt> [profile.md-out]` — the Phase 1.1
 * acceptance check, and the Gate 1 script to run on a real resume.
 *
 * It reads a plain-text resume, runs it through `extractCards` (one live
 * `cards` call through `src/lib/llm.ts`), prints the resulting `profile.md` to
 * stdout and a one-line usage/cost summary to stderr, and exits non-zero if
 * any card is missing Situation, Actions, Results or has no skills.
 *
 *   pnpm try:cards src/lib/__fixtures__/resumes/videographer.txt
 *   pnpm try:cards ~/resume.txt out/profile.md
 *
 * It prints no credentials and never echoes the pasted text back: the resume
 * appears only inside the request, and what comes out is the profile the app
 * would store in the browser. Needs `ANTHROPIC_API_KEY`; the anonymous
 * `llm_usage` row needs the local Supabase stack, and a failed insert is a
 * warning, not an error, so the script still works without it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import { CardsInputError, extractCards } from "../src/lib/cards";
import { llm } from "../src/lib/llm";
import { serializeProfile } from "../src/lib/profile";
import { newSessionId } from "../src/lib/session";

const USAGE = "usage: pnpm try:cards <path-to-resume.txt> [profile.md-out]";

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

  let text: string;
  try {
    text = readFileSync(input, "utf8");
  } catch {
    // The path is the user's own argument, so echoing it is not content.
    fail(`Could not read ${input}\n${USAGE}`);
  }

  const started = Date.now();
  const result = await extractCards(llm(), { sessionId: newSessionId(), text }).catch(
    (error: unknown) => {
      if (error instanceof CardsInputError) fail(error.message);
      throw error;
    },
  );

  const md = serializeProfile(result.profile);
  if (output === undefined) {
    process.stdout.write(md);
  } else {
    writeFileSync(output, md, "utf8");
    process.stderr.write(`wrote ${output}\n`);
  }

  const { usage, costUsd } = result.metrics;
  process.stderr.write(
    `${String(result.cards.length)} cards | ` +
      `${String(result.profile.skills.inferred.length)} inferred skills | ` +
      `in ${String(usage.input)} (cache r${String(usage.cacheRead)}/w${String(usage.cacheWrite)}) ` +
      `out ${String(usage.output)} tok | $${costUsd.toFixed(4)} | ` +
      `${String(Math.round((Date.now() - started) / 100) / 10)}s\n`,
  );

  // The acceptance rule, checked here so the exit code carries it.
  const problems: string[] = [];
  if (result.cards.length < 3 || result.cards.length > 6) {
    problems.push(`expected 3-6 cards, got ${String(result.cards.length)}`);
  }
  for (const card of result.cards) {
    const missing = (["situation", "actions", "results"] as const).filter(
      (k) => card[k].trim() === "",
    );
    if (missing.length > 0) problems.push(`${card.id} is missing ${missing.join(", ")}`);
    if (card.skills.length === 0) problems.push(`${card.id} has no skills`);
  }
  if (problems.length > 0) fail(`FAILED: ${problems.join("; ")}`);
  process.stderr.write("PASS: every card has situation, actions, results and >=1 skill\n");
}

main().catch((error: unknown) => {
  // Never print the request or the model's text — only what went wrong.
  process.stderr.write(
    `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`,
  );
  process.exitCode = 1;
});
