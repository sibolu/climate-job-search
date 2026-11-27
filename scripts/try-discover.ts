/**
 * `pnpm try:discover <profile.md> [profile.md-out] [--catalogue] [--interest=<area>[,<area>...]]`
 * — discovery run live on a real profile, in either of its two modes
 * (technical-plan.md D61).
 *
 * It reads a `profile.md`, runs `discoverFields` (one live `discover` call
 * through `src/lib/llm.ts`, no web tools — technical-plan.md D44), and prints
 * the updated `profile.md` to stdout. On stderr it prints the mode, one line
 * with the counts and the call's tokens, cost and duration, and each field's
 * card (sector, fit level, summary, chips, evidence lines, ask, roles).
 *
 * **Memory mode is the default, as in the app.** The model names fields,
 * roles and example organisations from its own knowledge and nothing is read
 * from Supabase but the code's budget (technical-plan.md D71), which still
 * needs the local stack. The script exits non-zero if
 * any field or role written this run lacks a card citation, carries a `Ref`
 * or a source, or has a URL in its text (a field's fit, summary and
 * uncertainties; a role's why and companies); if any field lacks a role, a
 * fit level, a sector, a summary, chips or an ask (technical-plan.md D39);
 * or if a role title carries a level word (D48).
 *
 * **`--catalogue` runs the catalogue arm.** The reference tables are read
 * from Supabase (the local stack must be running) and handed to
 * `discoverFields`. Its checks are the ones this script made before memory
 * mode existed: the same as above, except that a `Ref` and sources are
 * expected, and every source must be a URL the catalogue lists. The text is
 * checked for URLs exactly as in memory mode (D66).
 *
 * In both modes a card the fit text cites with no evidence line of its own
 * is a warning, not a failure: `validateOutput` keeps such a field and no
 * screen renders evidence lines (D50), so failing on it would hold the
 * script to a rule the product does not have.
 *
 * `--interest` records the one answer the app collects before discovery
 * (technical-plan.md D54), the way the app does: a comma-separated list of
 * the six climate areas (`CLIMATE_AREAS`), each written with
 * `toggleClimateInterest`. The list replaces any interests already in the
 * profile, so a run is repeatable. An unknown area lists the six and exits
 * before any model call. It works with either mode.
 *
 *   pnpm try:discover src/lib/__fixtures__/discover/videographer.md
 *   pnpm try:discover profile.md out/profile.md --interest="Energy,Carbon Removal"
 *   pnpm try:discover profile.md out/profile.md --catalogue
 *
 * It never echoes the profile except as the output the app would store in
 * the browser. Needs `ANTHROPIC_API_KEY`, `ACCESS_CODE` (the call is charged
 * to that code, technical-plan.md D71) and the local Supabase stack, in both
 * modes.
 */

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import {
  DiscoverInputError,
  REF_KEY,
  type ReferenceReader,
  catalogueSourceUrls,
  citedActiveCardIds,
  discoverFields,
  droppedSummary,
  hasLevelWord,
  hasUrl,
} from "../src/lib/discover";
import { CLIMATE_AREAS, toggleClimateInterest } from "../src/lib/elicit";
import { llm } from "../src/lib/llm";
import { parseProfile, serializeProfile, setClimateInterests } from "../src/lib/profile";
import { newSessionId } from "../src/lib/session";

import { keyedLlm, scriptAccessCodeKey } from "./script-access-code";

const USAGE =
  "usage: pnpm try:discover <profile.md> [profile.md-out] [--catalogue] [--interest=<area>[,<area>...]]";

/** The one question the app asks before discovery (technical-plan.md D54). */
const INTEREST_FLAG = "--interest";
/** Runs the catalogue arm instead of the app's memory mode (technical-plan.md D61). */
const CATALOGUE_FLAG = "--catalogue";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * The reference tables, read once: the reader `discoverFields` is handed, and
 * the URLs its output may cite. `reference.ts` is imported here, not at the
 * top, so a memory-mode run never reads the reference tables.
 */
async function readCatalogue(): Promise<{ reader: ReferenceReader; sourceUrls: Set<string> }> {
  const { listFields, listRoles } = await import("../src/lib/reference");
  const [fields, roles] = await Promise.all([listFields(), listRoles()]);
  return {
    reader: { listFields: () => Promise.resolve(fields), listRoles: () => Promise.resolve(roles) },
    sourceUrls: catalogueSourceUrls(fields, roles),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith("-"));
  const [input, output] = args.filter((a) => !a.startsWith("-"));
  const interestFlags = flags.filter((f) => f.startsWith(`${INTEREST_FLAG}=`));
  const unknownFlags = flags.filter((f) => f !== CATALOGUE_FLAG && !f.startsWith(`${INTEREST_FLAG}=`));
  if (input === undefined || unknownFlags.length > 0 || interestFlags.length > 1) fail(USAGE);
  const interestFlag = interestFlags[0];
  const catalogueMode = flags.includes(CATALOGUE_FLAG);
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
  for (const w of parsed.warnings) process.stderr.write(`warning: ${w}\n`);

  let profile = parsed.profile;
  if (interestFlag !== undefined) {
    const areas = [...new Set(interestFlag.slice(INTEREST_FLAG.length + 1).split(",").map((a) => a.trim()))];
    if (areas.some((a) => !CLIMATE_AREAS.includes(a))) {
      fail(`${INTEREST_FLAG} takes a comma-separated list of: ${CLIMATE_AREAS.map((a) => `"${a}"`).join(", ")}`);
    }
    // The flag is the whole answer: start from no interests, then pick each area as a pill click would.
    profile = setClimateInterests(profile, []);
    for (const area of areas) profile = toggleClimateInterest(profile, area);
  }

  const catalogue = catalogueMode ? await readCatalogue() : undefined;
  const mode = catalogue === undefined ? "memory" : "catalogue";
  process.stderr.write(
    catalogue === undefined
      ? "mode: memory (the model's own knowledge; no reference tables read)\n"
      : "mode: catalogue (reference tables read from Supabase)\n",
  );

  const keyed = keyedLlm(llm(), codeKey);
  const result = await discoverFields(
    { sessionId: newSessionId(), profile },
    catalogue === undefined ? { llm: keyed } : { catalogue: catalogue.reader, llm: keyed },
  ).catch((error: unknown) => {
    if (error instanceof DiscoverInputError) fail(error.message);
    throw error;
  });

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
    `${mode} | ${String(result.fields.length)} fields, ${String(result.roles.length)} roles | ` +
      `${droppedSummary(result.dropped)} | ${tok} tok | $${c.costUsd.toFixed(4)} | ` +
      `${(c.durationMs / 1000).toFixed(1)}s\n`,
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
        // Memory mode writes no sources, so there is no line to print for them.
        ...(catalogue === undefined
          ? []
          : [`  sources: ${f.sources.join(" ") || "(none: named from the model's knowledge)"}`]),
      ].join("\n") + "\n",
    );
  }

  // The acceptance rule, checked here so the exit code carries it.
  const problems: string[] = [];
  const unevidenced: string[] = [];
  if (result.fields.length < 4) problems.push(`expected >=4 fields, got ${String(result.fields.length)}`);
  for (const f of result.fields) {
    if (citedActiveCardIds(f.fit, result.profile).length === 0) problems.push(`${f.id} cites no card`);
    // Every string the screens render, names included, in both modes (technical-plan.md D44, D61, D66).
    const shown = [
      f.name,
      f.sector,
      f.summary,
      f.fit,
      f.uncertain,
      ...f.chips,
      ...f.evidence.map((e) => e.why),
      ...(f.ask === undefined ? [] : [f.ask.question, f.ask.placeholder]),
    ];
    if (shown.some((text) => hasUrl(text))) problems.push(`${f.id} has a URL in its text`);
    if (catalogue === undefined) {
      if (f.extra[REF_KEY] !== undefined) problems.push(`${f.id} carries a Ref`);
      if (f.sources.length > 0) problems.push(`${f.id} has a source`);
    } else {
      for (const u of f.sources) if (!catalogue.sourceUrls.has(u)) problems.push(`${f.id} cites a non-catalogue URL`);
    }
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
    if ([r.title, r.why, ...r.companies].some((text) => hasUrl(text))) problems.push(`${r.id} has a URL in its text`);
    if (catalogue === undefined) {
      if (r.extra[REF_KEY] !== undefined) problems.push(`${r.id} carries a Ref`);
      if (r.sources.length > 0) problems.push(`${r.id} has a source`);
    } else {
      for (const u of r.sources) if (!catalogue.sourceUrls.has(u)) problems.push(`${r.id} cites a non-catalogue URL`);
    }
  }
  for (const w of unevidenced) process.stderr.write(`warning: ${w}\n`);
  if (problems.length > 0) fail(`FAILED (${mode} mode): ${problems.join("; ")}`);
  process.stderr.write(
    catalogue === undefined
      ? "PASS (memory mode): every field has a fit level, sector and an ask; every field and role cites a card; no Ref, no source and no URL written; no role title carries a level word\n"
      : "PASS (catalogue mode): every field has a fit level, sector and an ask; every field and role cites a card and only catalogue URLs, with no URL in its text; no role title carries a level word\n",
  );
}

main().catch((error: unknown) => {
  // Never print the request or the model's text — only what went wrong.
  process.stderr.write(
    `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`,
  );
  process.exitCode = 1;
});
