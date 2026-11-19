/**
 * `pnpm try:discover <profile.md> [profile.md-out] [--interest=<pill value>]
 * [--retraining=<pill value>]` — the Phase 1.4 acceptance check, and the
 * Gate 1 script to run on a real profile.
 *
 * It reads a `profile.md`, runs `discoverFields` (one live `discover` call
 * through `src/lib/llm.ts`, no web tools — technical-plan.md D44), prints the
 * updated `profile.md` to stdout, a usage/cost line and each field's
 * exploration-first card (sector, fit level, summary, chips, evidence lines,
 * ask, sources) to stderr, and exits non-zero if any field or role written
 * this run lacks a card citation or cites a URL the catalogue does not list,
 * any field lacks a fit level, a sector or an ask (technical-plan.md D39), or
 * a role title carries a level word (D48). A card the fit text cites with no
 * evidence line of its own is a warning, not a failure: `validateOutput`
 * keeps such a field and no screen renders evidence lines (D50), so failing
 * on it would hold the script to a rule the product does not have.
 *
 * `--interest` and `--retraining` record the two pill-only answers the app
 * collects before discovery (D48), the way the app does: the value must be
 * one of the pills `pillsFor` offers and is written with `applyPillAnswer`.
 * An unknown value lists the pills and exits before any model call.
 *
 *   pnpm try:discover src/lib/__fixtures__/discover/videographer.md
 *   pnpm try:discover profile.md out/profile.md --interest="open to suggestions" --retraining="none, use existing skills"
 *
 * It never echoes the profile except as the output the app would store in
 * the browser. Needs `ANTHROPIC_API_KEY` and the local Supabase stack (the
 * reference catalogue is read from it).
 */

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import { DiscoverInputError, discoverFields, droppedSummary } from "../src/lib/discover";
import { catalogueSourceUrls, citedActiveCardIds, hasLevelWord } from "../src/lib/discover";
import { applyPillAnswer, pillsFor } from "../src/lib/elicit";
import { listFields, listRoles, listSectorGroups } from "../src/lib/reference";
import { type PreferenceKey, parseProfile, serializeProfile } from "../src/lib/profile";
import { newSessionId } from "../src/lib/session";

const USAGE =
  "usage: pnpm try:discover <profile.md> [profile.md-out] [--interest=<pill value>] [--retraining=<pill value>]";

/** The two questions the app asks before discovery (technical-plan.md D48), by flag. */
const ANSWER_FLAGS: Readonly<Record<string, PreferenceKey>> = {
  "--interest": "climateInterests",
  "--retraining": "retrainingAppetite",
};

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith("-"));
  const [input, output] = args.filter((a) => !a.startsWith("-"));
  if (input === undefined || flags.some((f) => ANSWER_FLAGS[f.split("=")[0] ?? ""] === undefined)) fail(USAGE);
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

  let profile = parsed.profile;
  if (flags.length > 0) {
    const ctx = { sectorGroups: await listSectorGroups() };
    for (const flag of flags) {
      const [name = "", ...rest] = flag.split("=");
      const key = ANSWER_FLAGS[name];
      if (key === undefined) fail(USAGE);
      const pills = pillsFor(key, ctx);
      const pill = pills.find((p) => p.value === rest.join("="));
      if (pill === undefined) fail(`${name} takes one of: ${pills.map((p) => `"${p.value}"`).join(", ")}`);
      profile = applyPillAnswer(profile, key, pill);
    }
  }

  const started = Date.now();
  const result = await discoverFields({ sessionId: newSessionId(), profile }).catch(
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

  const c = result.call;
  const tok = `in ${String(c.usage.input)} (cache r${String(c.usage.cacheRead)}/w${String(c.usage.cacheWrite)}) out ${String(c.usage.output)}`;
  process.stderr.write(
    `${String(result.fields.length)} fields, ${String(result.roles.length)} roles | ` +
      `${droppedSummary(result.dropped)} | ${tok} tok | $${c.costUsd.toFixed(4)} | ` +
      `${String(Math.round((Date.now() - started) / 100) / 10)}s\n`,
  );
  for (const f of result.fields) {
    const roles = result.roles.filter((r) => r.fieldId === f.id).map((r) => r.title);
    process.stderr.write(
      [
        `\n${f.id} ${f.name} [${f.move ?? "?"}] fit=${f.fitLevel ?? "?"} sector=${f.sector || "?"}`,
        `  summary: ${f.summary || "?"}`,
        `  chips: ${f.chips.join(" | ") || "?"}`,
        ...f.evidence.map((e) => `  evidence ${e.cardId}: ${e.why}`),
        `  ask: ${f.ask === undefined ? "?" : `${f.ask.question} [${f.ask.key}; e.g. ${f.ask.placeholder}]`}`,
        `  roles: ${roles.join("; ") || "?"}`,
        `  sources: ${f.sources.join(" ") || "(none: named from the model's knowledge)"}`,
      ].join("\n") + "\n",
    );
  }

  // The acceptance rule, checked here so the exit code carries it.
  const [catFields, catRoles] = await Promise.all([listFields(), listRoles()]);
  const catalogue = catalogueSourceUrls(catFields, catRoles);
  const problems: string[] = [];
  const unevidenced: string[] = [];
  if (result.fields.length < 4) problems.push(`expected >=4 fields, got ${String(result.fields.length)}`);
  for (const f of result.fields) {
    if (citedActiveCardIds(f.fit, result.profile).length === 0) problems.push(`${f.id} cites no card`);
    for (const u of f.sources) if (!catalogue.has(u)) problems.push(`${f.id} cites a non-catalogue URL`);
    if (!result.roles.some((r) => r.fieldId === f.id)) problems.push(`${f.id} has no role`);
    if (f.fitLevel === undefined) problems.push(`${f.id} has no fit level`);
    if (f.sector.trim() === "") problems.push(`${f.id} has no sector`);
    if (f.summary.trim() === "") problems.push(`${f.id} has no summary`);
    if (f.chips.length === 0) problems.push(`${f.id} has no chips`);
    const evidenced = new Set(f.evidence.map((e) => e.cardId));
    for (const id of citedActiveCardIds(f.fit, result.profile)) {
      if (!evidenced.has(id)) unevidenced.push(`${f.id} cites ${id} without an evidence line`);
    }
    if (f.ask === undefined) problems.push(`${f.id} has no ask`);
  }
  for (const r of result.roles) {
    if (citedActiveCardIds(r.why, result.profile).length === 0) problems.push(`${r.id} cites no card`);
    // A title names the occupation, never a level (technical-plan.md D48).
    if (hasLevelWord(r.title)) problems.push(`${r.id} has a level word in its title`);
    for (const u of r.sources) if (!catalogue.has(u)) problems.push(`${r.id} cites a non-catalogue URL`);
  }
  for (const w of unevidenced) process.stderr.write(`warning: ${w}\n`);
  if (problems.length > 0) fail(`FAILED: ${problems.join("; ")}`);
  process.stderr.write(
    "PASS: every field has a fit level, sector and an ask; every field and role cites a card and only catalogue URLs; no role title carries a level word\n",
  );
}

main().catch((error: unknown) => {
  // Never print the request or the model's text — only what went wrong.
  process.stderr.write(
    `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`,
  );
  process.exitCode = 1;
});
