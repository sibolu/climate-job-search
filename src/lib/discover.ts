/**
 * Phase 1.4, reworked in 2d.2 — discover: profile cards → ranked climate
 * fields and roles for this person.
 *
 * One structured `discover` call with no tools does the work (technical-plan.md
 * D44), in one of two modes (technical-plan.md D61):
 *
 * - **Memory mode** is what the app runs, and the baseline arm of the
 *   evaluation. The byte-stable {@link DISCOVER_SYSTEM_PROMPT_MEMORY} frames
 *   climate work in ten areas, and the model names fields, roles and example
 *   organisations from its own knowledge. The user message carries the active
 *   cards, the stated preferences, the skills and the fields already in the
 *   profile, nothing else. The output schema has no `ref` and no `sources`,
 *   so no `Ref` and no source URL is ever written, and a URL the model puts
 *   in its prose anyway is removed and counted.
 * - **Catalogue mode** runs only when the caller passes
 *   `DiscoverOptions.catalogue` (`pnpm try:discover --catalogue`; the
 *   evaluation's next arm). {@link DISCOVER_SYSTEM_PROMPT_CATALOGUE} and the
 *   user message add the compact reference catalogue. A source URL survives
 *   only if the catalogue lists it, so a URL recalled from memory is never
 *   shown in either mode.
 *
 * This module does not read the reference tables: a caller that wants the
 * catalogue arm builds the reader and hands it in.
 *
 * Post-validation is strict and counted, never silent, in both modes: a field
 * whose fit does not cite an active card, or a role whose `why` does not, is
 * dropped and reported in `dropped`. A role title is the plain occupation
 * (technical-plan.md D48): level modifiers are stripped, and a role titled by
 * rank alone is dropped and counted. Profile writes go through `upsertField`
 * / `upsertRole`; a re-run matches an existing field by its name (in
 * catalogue mode by the reference id stored in `extra.Ref` first) and updates
 * it in place, never renumbering and never downgrading a user-set status
 * back to `candidate`.
 */

import { z } from "zod";

import { isOpenToSuggestions } from "./elicit";
import type { CallMetrics, Llm } from "./llm";
import {
  DROPPED_KEY,
  type Ask,
  AskSchema,
  type Evidence,
  EvidenceSchema,
  type Field,
  type FitLevel,
  FitLevelSchema,
  type MoveType,
  MoveTypeSchema,
  type Profile,
  type Role,
  activeCards,
  citedCardIds,
  upsertField,
  upsertRole,
  activeSkills,
} from "./profile";
import { isBlockedSourceHost, sourceHost } from "./reference-schema";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const MIN_FIELDS = 4;
export const MAX_FIELDS = 7;
export const MAX_ROLES_PER_FIELD = 4;
export const MAX_SOURCES = 5;
export const MAX_UNCERTAINTIES = 3;
/** Transferable-skill chips per field on the collapsed card (technical-plan.md D39). */
export const MAX_CHIPS = 4;
/** Reference description shown in the catalogue, in characters. */
const DESCRIPTION_CHARS = 160;
/** Reference sources listed per field / role in the catalogue. */
const CATALOGUE_SOURCES = 2;

/** The `extra` key that links a profile field or role to a reference id. Written in catalogue mode only. */
export const REF_KEY = "Ref";

// ---------------------------------------------------------------------------
// Reference catalogue: catalogue mode only, read by the caller (technical-plan.md D61)
// ---------------------------------------------------------------------------

export interface CatalogueField {
  id: string;
  name: string;
  sector_group: string;
  description: string;
  transferable_functions: readonly string[] | null;
  sources: readonly string[] | null;
}

export interface CatalogueRole {
  id: string;
  field_id: string;
  title: string;
  function: string;
  example_companies: readonly string[] | null;
  sources: readonly string[] | null;
}

/**
 * How a catalogue-mode caller hands the reference tables in. Discovery has no
 * reader of its own: the script that runs the catalogue arm builds this from
 * `reference.ts`, and tests pass a fake.
 */
export interface ReferenceReader {
  listFields(): Promise<CatalogueField[]>;
  listRoles(): Promise<CatalogueRole[]>;
}

/** The catalogue as one catalogue-mode call reads it. */
export interface Catalogue {
  fields: readonly CatalogueField[];
  roles: readonly CatalogueRole[];
}

// ---------------------------------------------------------------------------
// Level words: a role title names the occupation, never a rung (technical-plan.md D48)
// ---------------------------------------------------------------------------

/** A level wherever it appears in a title. Always stripped. */
export const LEVEL_MODIFIERS: readonly string[] = [
  "senior",
  "senior-level",
  "sr",
  "junior",
  "junior-level",
  "jr",
  "mid-level",
  "midlevel",
  "mid-senior",
  "mid-career",
  "entry-level",
  "early-career",
];

/**
 * A level only in front of the occupation it modifies ("Lead Engineer",
 * "Staff Accountant", "Associate Product Manager"): stripped there. At the
 * end of a title the same word is the occupation's head noun ("Maintenance
 * Lead", "Research Associate", "Executive Assistant") and is left alone.
 */
export const LEADING_LEVEL_MODIFIERS: readonly string[] = [
  "lead",
  "principal",
  "staff",
  "associate",
  "assistant",
  "founding",
];

/**
 * A rank, not an occupation ("Director of X", "Head of X", "VP, X", "Chief X
 * Officer"). Stripping it leaves a department, not a job, so a title that
 * contains one cannot be repaired: {@link validateOutput} drops the role and
 * counts it. "Manager" is deliberately absent: "Product Manager" and "Project
 * Manager" are occupations.
 */
export const LEVEL_HEADS: readonly string[] = [
  "director",
  "head",
  "vp",
  "svp",
  "evp",
  "avp",
  "vice president",
  "president",
  "chief",
  "ceo",
  "cto",
  "cfo",
  "coo",
  "cmo",
  "cio",
  "cso",
  "cpo",
];

/** Occupations whose own name contains a level word. Matched first and never touched. */
export const LEVEL_WORD_OCCUPATIONS: readonly string[] = [
  "chief of staff",
  "crew chief",
  "principal investigator",
  "art director",
  "director of photography",
  "film director",
  "documentary director",
  "lead generation",
  "lead abatement",
  "lead-acid",
  "staff development",
  "senior living",
  "senior services",
];

/** Longest first, so "senior-level" wins over "senior"; a hyphen or space in an entry matches either. */
function alternation(words: readonly string[]): string {
  return [...words]
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-\s]+/g, "[-\\s]+"))
    .join("|");
}

/** Stands in for a protected occupation while the rest of the title is cleaned. */
const MASK = "\uE000";
const MASKED_RE = new RegExp(`${MASK}(\\d+)${MASK}`, "g");
const OCCUPATION_RE = new RegExp(`\\b(?:${alternation(LEVEL_WORD_OCCUPATIONS)})\\b`, "gi");
const MODIFIER_RE = new RegExp(`\\b(?:${alternation(LEVEL_MODIFIERS)})\\b\\.?`, "gi");
/** A leading modifier counts only when the occupation follows it directly, not after a separator ("Associate, Renewable Development"). */
const LEADING_RE = new RegExp(`^(?:${alternation(LEADING_LEVEL_MODIFIERS)})\\s+(?=[^\\s,/&|:()–—-])`, "i");
const HEAD_RE = new RegExp(`\\b(?:${alternation(LEVEL_HEADS)})\\b`, "i");
/** "Technician II", "Engineer I, Fuel Cells", "Operator I/II": a grade numeral closing the title or its head. Upper case only. */
const GRADE_RE = /\b(?:I{1,3}|IV|V)(?:\s*\/\s*(?:I{1,3}|IV|V))*\b(?=\s*(?:$|[,(])|\s+[–—-]\s)/g;
/** ...unless the numeral numbers something else: "Phase II", "Class I", "Scope III". */
const NUMBERED_NOUN_RE = /\b(?:phase|class|title|type|scope|tier|part|stage|zone|category)\s+$/i;
/** "Technician, Level 2". Only at the end: "Level 2 Charger Installer" names the charger. */
const TRAILING_LEVEL_RE = /[\s,–—-]*\b(?:level|lvl|grade)\s*(?:[1-9]|I{1,3}|IV|V)\s*$/i;

/** Collapses what a removed word leaves behind: empty brackets, doubled or dangling separators. */
function tidyTitle(title: string): string {
  return title
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,(?:\s*,)+/g, ",")
    .replace(/^[\s,/&|:–—-]+|[\s,/&|:–—-]+$/g, "");
}

function maskOccupations(title: string, held: string[]): string {
  return title.replace(OCCUPATION_RE, (match) => {
    held.push(match);
    return `${MASK}${String(held.length - 1)}${MASK}`;
  });
}

/**
 * The title with every level modifier removed: "Senior Data Scientist" →
 * "Data Scientist", "Wind Technician II" → "Wind Technician", "Lead Process
 * Engineer, Battery Recycling" → "Process Engineer, Battery Recycling". A
 * title with no level word comes back unchanged. A rank ({@link LEVEL_HEADS})
 * is not removed, because nothing sensible is left: check the result with
 * {@link hasLevelHead}.
 */
export function stripLevelWords(title: string): string {
  const held: string[] = [];
  let t = maskOccupations(title, held)
    .replace(MODIFIER_RE, " ")
    .replace(TRAILING_LEVEL_RE, "")
    .replace(GRADE_RE, (match: string, offset: number, whole: string) =>
      offset === 0 || NUMBERED_NOUN_RE.test(whole.slice(0, offset)) ? match : " ",
    );
  // "Senior / Staff Engineer": removing one level can expose another at the front.
  let before: string;
  do {
    before = t;
    t = tidyTitle(t).replace(LEADING_RE, "");
  } while (t !== before);
  const restored = t.replace(MASKED_RE, (_match, index: string) => held[Number(index)] ?? "");
  const first = title.trim().charAt(0);
  const wasCapitalised = first !== first.toLowerCase();
  return wasCapitalised ? restored.charAt(0).toUpperCase() + restored.slice(1) : restored;
}

/** True when the title is a rank rather than an occupation: "Director of Data Science", "Head of Partnerships". */
export function hasLevelHead(title: string): boolean {
  return HEAD_RE.test(maskOccupations(title, []));
}

/**
 * True when a role title carries seniority in any form: a modifier
 * {@link stripLevelWords} would remove, or a rank it cannot. Discovery output
 * never does (technical-plan.md D48); `pnpm try:discover` fails on one.
 */
export function hasLevelWord(title: string): boolean {
  return hasLevelHead(title) || stripLevelWords(title).toLowerCase() !== tidyTitle(title).toLowerCase();
}

// ---------------------------------------------------------------------------
// Model output schema
// ---------------------------------------------------------------------------

// The catalogue-mode schemas are the ones sent since D44 and are left as they
// were, so the catalogue arm's request does not change. The memory-mode
// schemas below are the same drafts without `ref` and `sources`.

export const RoleDraftSchemaCatalogue = z.object({
  title: z
    .string()
    .describe('The plain occupation with no level word: "Data Scientist", never "Senior Data Scientist" or "Director of Data Science".'),
  /** Reference role id when the role is from the catalogue, else null. */
  ref: z.string().nullable(),
  companies: z.array(z.string()),
  /** Must name the card IDs (C1, C2, …) it draws on. */
  why: z.string(),
  sources: z.array(z.string()),
});
export type RoleDraftCatalogue = z.infer<typeof RoleDraftSchemaCatalogue>;

export const FieldDraftSchemaCatalogue = z.object({
  /** Reference field id when the field is from the catalogue, else null. */
  ref: z.string().nullable(),
  name: z.string(),
  move: MoveTypeSchema,
  /** One line naming the sector the field sits in. */
  sector: z.string().describe('One line naming the sector this field sits in, e.g. "Utility-scale solar development".'),
  fitLevel: FitLevelSchema.describe(
    '"strong": companies hire for this function from this background today. "some": they hire for it, but expect a gap you name in the fit. "stretch": needs retraining or a rare path.',
  ),
  summary: z
    .string()
    .describe(
      "Two sentences, second person, no hedging: what the work is and why this person fits it. Shown directly under the field's name, so it says what the name does not and never repeats or paraphrases the name.",
    ),
  chips: z
    .array(z.string())
    .describe("Three to four short transferable-skill phrases from the cards, two to four words each."),
  /** Must name the card IDs (C1, C2, …) it draws on. */
  fit: z.string(),
  evidence: z
    .array(EvidenceSchema)
    .describe("One entry per card the field draws on: the card ID and one sentence naming what in that card counts."),
  uncertainties: z.array(z.string()),
  ask: AskSchema.describe(
    'The one question whose answer would most change the fit. "key" is a short preference label such as "Content mix"; "placeholder" an example answer.',
  ),
  sources: z.array(z.string()),
  roles: z.array(RoleDraftSchemaCatalogue),
});
export type FieldDraftCatalogue = z.infer<typeof FieldDraftSchemaCatalogue>;

export const DiscoverOutputSchemaCatalogue = z.object({
  /** Ranked best-fit first. */
  fields: z.array(FieldDraftSchemaCatalogue),
});
export type DiscoverOutputCatalogue = z.infer<typeof DiscoverOutputSchemaCatalogue>;

/**
 * Memory mode (technical-plan.md D61): the same role draft with no `ref`,
 * because there is no catalogue to point into, and no `sources`, because a
 * URL from memory is never shown (technical-plan.md D44). Leaving the keys
 * out, rather than asking for them empty, also means less output and a
 * faster turn.
 */
export const RoleDraftSchemaMemory = RoleDraftSchemaCatalogue.omit({ ref: true, sources: true });
export type RoleDraftMemory = z.infer<typeof RoleDraftSchemaMemory>;

export const FieldDraftSchemaMemory = FieldDraftSchemaCatalogue.omit({ ref: true, sources: true }).extend({
  roles: z.array(RoleDraftSchemaMemory),
});
export type FieldDraftMemory = z.infer<typeof FieldDraftSchemaMemory>;

export const DiscoverOutputSchemaMemory = z.object({
  /** Ranked best-fit first. */
  fields: z.array(FieldDraftSchemaMemory),
});
export type DiscoverOutputMemory = z.infer<typeof DiscoverOutputSchemaMemory>;

// ---------------------------------------------------------------------------
// Prompts — byte-stable constants; everything per-call goes in the user message
// ---------------------------------------------------------------------------

/**
 * The catalogue arm's prompt. Its text is frozen while it serves as an
 * evaluation arm (technical-plan.md D61): `discover.test.ts` pins its hash.
 */
export const DISCOVER_SYSTEM_PROMPT_CATALOGUE = `You help one career switcher find where their existing work fits in climate. You get their experience cards, their stated preferences, and a small reference catalogue of climate fields and example roles. You return 4-7 ranked fields, each with 2-4 roles, as JSON.

Rules that decide whether your answer is usable:

1. Be specific to THIS person. Every field's "fit" and every role's "why" must name the card IDs (C1, C2, ...) it draws on and say what in that card transfers. Never recommend a field that any climate-curious person would get; if you cannot tie a field to a concrete card, leave it out. Generic lists ("climate needs everyone", "software", "engineering", "sustainability") are worthless. A videographer should get fields where video and story work is a real, hired function (communications teams at developers and nonprofits, documentary and impact media, brand content), not "renewable energy" in general.

2. Ground in the catalogue, then in what you know. Prefer catalogue fields: set "ref" to the catalogue id when you use one (and "ref" to the catalogue role id for a catalogue role). When this person's cards point somewhere the catalogue does not cover, name a real field or role you know well and set "ref" to null. You have no web access. "sources" may hold only URLs listed in the catalogue, copied exactly; never write a URL from memory, however sure you are, because any other URL is removed. A field or role outside the catalogue gets an empty "sources" list.

3. Label the move honestly. "sector" = the same function they do today, moved into a climate company. "adjacent" = a related function that reuses most of their skills but changes the job. "retraining" = needs new credentials or a substantially new skill set. Rank sector and adjacent moves above retraining unless the person's preferences say they want to retrain.

4. Name what you do not know. 1-3 short "uncertainties" per field: whether roles are in-house or freelance, how many companies hire for it in their location, whether a credential is expected, pay bands, and so on.

5. Respect preferences. Location, work mode and retraining appetite are constraints when stated. Climate interests set the order, never the list: when the person names areas, rank fields in those areas first where the fit is comparable, and still include a strong fit outside them. Comparable means "strong" or "some": the person named those areas to see them first, so every field in a named area whose fit level is "strong" or "some" ranks above every field outside them, and only a "stretch" field in a named area gives way to a better fit outside. They did not ask to see nothing else, so a named area never removes a field you would otherwise list. The areas are unordered among themselves, and you judge which area a field belongs to from the work it does, not from the catalogue's sector-group headings, which are coarser. With no interests stated, rank on fit alone. Do not use excluded cards; they are not shown to you.

6. Roles: give 2-4 per field. Each has a title, 1-4 real example companies or organisation types, a "why" that cites cards, and the catalogue's sources when it is a catalogue role. Do not repeat the same role across fields.

The title is the plain occupation and carries no level: "Data Scientist", "Product Manager", "Policy Analyst", "Wind Turbine Technician". The person searches job boards with this title and decides for themselves which level to apply at. A level word narrows that search to one rung and makes a judgement that is not yours to make. This rules out level modifiers (Senior, Junior, Lead, Principal, Staff, Associate, Entry-level, Mid-level, a trailing I, II or III), and it rules out titles that are a rank rather than an occupation (Director of X, Head of X, VP of X, Chief X Officer). For a rank, name the occupation underneath it: "Director of Data Science" is "Data Scientist", "Head of Partnerships" is "Partnerships Manager", "Senior Product Manager" is "Product Manager". "Manager" is fine where it is the occupation's own name, as in "Product Manager" or "Project Manager". The catalogue's own titles sometimes carry a rank; when you use such a role, keep its "ref" and write the plain occupation as the title. Level modifiers are removed from your titles afterwards and a role whose title is still a rank is dropped, which can leave a field short of roles.

7. Fill the card the person sees. Per field: "sector" is one line naming the sector it sits in. "fitLevel" is one of three labels, never a number: "strong" means companies hire for this function from this background today; "some" means they hire for it but expect a gap, and your "fit" names that gap; "stretch" means it needs retraining or a rare path. "summary" is two sentences in the second person ("You have...", "Your...") with no hedging, saying what the work is and why this person fits it. It is shown directly under the field's name, so it says what the name does not and never repeats or paraphrases the name: open with the work itself, what the person would make, run or decide in a normal week, not with a sentence that announces the field. "chips" are 3-4 short transferable-skill phrases (two to four words) drawn from the cards. "evidence" has one entry per card the field draws on: the card ID and one sentence naming what in that card counts. "ask" is the one question whose answer would most change the fit, with "key" a short preference label the answer is filed under (such as "Content mix" or "Travel") and "placeholder" an example answer; it must not repeat a preference the person has already stated.

Answer with the JSON only.`;

/**
 * The prompt the app runs (technical-plan.md D61): no catalogue, so the ten
 * areas frame what counts as climate work and the model names fields, roles
 * and example organisations from what it knows. It carries no URL and asks
 * for none (technical-plan.md D44). Rules 1, 3, 4 and 7 are word for word the
 * catalogue prompt's; rules 5 and 6 are the same minus what they said about
 * the catalogue. `discover.test.ts` checks both claims.
 */
export const DISCOVER_SYSTEM_PROMPT_MEMORY = `You help one career switcher find where their existing work fits in climate. You get their experience cards, their stated preferences, and the fields already on their profile, if any. You have no web access: the fields, roles and example organisations you return come from what you know. You return 4-7 ranked fields, each with 2-4 roles, as JSON.

The ten areas below are the frame for what counts as climate work. They are listed so that your coverage does not depend on which areas the person happened to name:

- Circular Economy
- Built Environment
- Transportation
- Energy
- Food & Agriculture
- Carbon Removal
- Climate Finance (including climate risk, insurance and carbon markets)
- Industry & Materials (steel, cement, chemicals, hydrogen, industrial heat)
- Nature & Water (conservation, forestry, oceans, water systems)
- Corporate Sustainability & Climate Services (carbon accounting, disclosure, climate data and software, policy and advocacy)

The areas are a map, not a list to fill. A field is narrower than an area: one part of it where a recognisable set of organisations hires for a recognisable kind of work, at about the grain of "grid interconnection at utilities and developers", "carbon accounting software" or "building retrofit programmes". Those three only show the grain; they are not suggestions for this person. Look across all ten areas before you settle, then return only the fields this person's cards support. Several of your fields may sit in one area, and most areas will contribute none.

Rules that decide whether your answer is usable:

1. Be specific to THIS person. Every field's "fit" and every role's "why" must name the card IDs (C1, C2, ...) it draws on and say what in that card transfers. Never recommend a field that any climate-curious person would get; if you cannot tie a field to a concrete card, leave it out. Generic lists ("climate needs everyone", "software", "engineering", "sustainability") are worthless. A videographer should get fields where video and story work is a real, hired function (communications teams at developers and nonprofits, documentary and impact media, brand content), not "renewable energy" in general.

2. Name real fields and roles you know well. Everything in your answer comes from your own knowledge, so stay with parts of the climate economy you can describe concretely: what the organisations there do, which functions they hire for, and what those jobs are called on a job board. The person will search for the role titles you give, and a field or title that sounds plausible but is not hired for sends them looking for jobs that do not exist. Where you know a field well but are unsure of something about it, keep the field and put the doubt in its "uncertainties". Where you would be guessing that the field hires for this person's function at all, leave it out. Write no URL or web address anywhere in your answer: you cannot check a link from memory, a wrong or dead one costs the person's trust in the rest of the page, and any that you write is removed before the person sees it.

3. Label the move honestly. "sector" = the same function they do today, moved into a climate company. "adjacent" = a related function that reuses most of their skills but changes the job. "retraining" = needs new credentials or a substantially new skill set. Rank sector and adjacent moves above retraining unless the person's preferences say they want to retrain.

4. Name what you do not know. 1-3 short "uncertainties" per field: whether roles are in-house or freelance, how many companies hire for it in their location, whether a credential is expected, pay bands, and so on.

5. Respect preferences. Location, work mode and retraining appetite are constraints when stated. Climate interests set the order, never the list: when the person names areas, rank fields in those areas first where the fit is comparable, and still include a strong fit outside them. Comparable means "strong" or "some": the person named those areas to see them first, so every field in a named area whose fit level is "strong" or "some" ranks above every field outside them, and only a "stretch" field in a named area gives way to a better fit outside. They did not ask to see nothing else, so a named area never removes a field you would otherwise list. The areas are unordered among themselves, and you judge which area a field belongs to from the work it does. With no interests stated, rank on fit alone. Do not use excluded cards; they are not shown to you.

6. Roles: give 2-4 per field. Each has a title, 1-4 example companies, and a "why" that cites cards. Do not repeat the same role across fields.

The title is the plain occupation and carries no level: "Data Scientist", "Product Manager", "Policy Analyst", "Wind Turbine Technician". The person searches job boards with this title and decides for themselves which level to apply at. A level word narrows that search to one rung and makes a judgement that is not yours to make. This rules out level modifiers (Senior, Junior, Lead, Principal, Staff, Associate, Entry-level, Mid-level, a trailing I, II or III), and it rules out titles that are a rank rather than an occupation (Director of X, Head of X, VP of X, Chief X Officer). For a rank, name the occupation underneath it: "Director of Data Science" is "Data Scientist", "Head of Partnerships" is "Partnerships Manager", "Senior Product Manager" is "Product Manager". "Manager" is fine where it is the occupation's own name, as in "Product Manager" or "Project Manager". Level modifiers are removed from your titles afterwards and a role whose title is still a rank is dropped, which can leave a field short of roles.

"companies" are examples of who hires for the role, shown to the person as plain text. Name well-known organisations that you are sure exist and that do this work, in the United States or the European Union. Where you are not sure of a name, name the type of organisation instead ("a utility's grid-planning team", "a state energy office"): a type is honest and still tells the person where to look, while a guessed name sends them after an organisation that may not exist or does not do this work. Name organisations, never individual people.

7. Fill the card the person sees. Per field: "sector" is one line naming the sector it sits in. "fitLevel" is one of three labels, never a number: "strong" means companies hire for this function from this background today; "some" means they hire for it but expect a gap, and your "fit" names that gap; "stretch" means it needs retraining or a rare path. "summary" is two sentences in the second person ("You have...", "Your...") with no hedging, saying what the work is and why this person fits it. It is shown directly under the field's name, so it says what the name does not and never repeats or paraphrases the name: open with the work itself, what the person would make, run or decide in a normal week, not with a sentence that announces the field. "chips" are 3-4 short transferable-skill phrases (two to four words) drawn from the cards. "evidence" has one entry per card the field draws on: the card ID and one sentence naming what in that card counts. "ask" is the one question whose answer would most change the fit, with "key" a short preference label the answer is filed under (such as "Content mix" or "Travel") and "placeholder" an example answer; it must not repeat a preference the person has already stated.

Answer with the JSON only.`;

function truncate(text: string, chars: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= chars ? t : `${t.slice(0, chars - 1).trimEnd()}…`;
}

/** Active cards only, in profile order, in a fixed shape. */
export function renderCardsForDiscover(profile: Profile): string {
  const cards = activeCards(profile);
  if (cards.length === 0) return "(no experience cards)";
  return cards
    .map(
      (c) =>
        `### ${c.id}: ${c.title}\n` +
        `- Situation: ${c.situation}\n` +
        `- Actions: ${c.actions}\n` +
        `- Results: ${c.results}\n` +
        `- Skills: ${c.skills.join(", ")}`,
    )
    .join("\n\n");
}

/**
 * Stated (and inferred) preferences, one per line; deterministic order.
 * Seniority is left out on purpose: role titles carry no level, so discovery
 * has nothing to do with it (technical-plan.md D48). Climate interests are
 * sent as an unordered set of named areas that order the fields and never
 * filter them (technical-plan.md D54); "open to suggestions" names no area,
 * so it sends no line and the prompt's "no interests stated" case applies.
 */
export function renderPreferencesForDiscover(profile: Profile): string {
  const p = profile.preferences;
  const lines: string[] = [];
  const single = (label: string, v: { value: string; source: string } | undefined) => {
    if (v !== undefined && v.value.trim() !== "") lines.push(`- ${label}: ${v.value} (${v.source})`);
  };
  single("Location", p.location);
  single("Work mode", p.workMode);
  single("Retraining appetite", p.retrainingAppetite);
  const interests = p.climateInterests;
  if (interests !== undefined && interests.values.length > 0 && !isOpenToSuggestions(profile)) {
    lines.push(
      `- Climate interests (areas named, in no order of preference): ${interests.values.join("; ")} (${interests.source})`,
    );
  }
  for (const o of p.other) lines.push(`- ${o.key}: ${o.value} (${o.source})`);
  // Accepted unless removed (technical-plan.md D53): an inferred skill the
  // person never touched is sent, a removed one is not.
  const skills = activeSkills(profile);
  if (skills.length > 0) lines.push(`- Skills: ${skills.join(", ")}`);
  return lines.length === 0 ? "(none stated yet)" : lines.join("\n");
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The compact catalogue: grouped by sector, sorted, fixed shape. */
export function renderCatalogue(fields: readonly CatalogueField[], roles: readonly CatalogueRole[]): string {
  const rolesByField = new Map<string, CatalogueRole[]>();
  for (const r of [...roles].sort(byId)) {
    const list = rolesByField.get(r.field_id) ?? [];
    list.push(r);
    rolesByField.set(r.field_id, list);
  }
  const groups = new Map<string, CatalogueField[]>();
  for (const f of [...fields].sort(byId)) {
    const list = groups.get(f.sector_group) ?? [];
    list.push(f);
    groups.set(f.sector_group, list);
  }
  const out: string[] = [];
  for (const group of [...groups.keys()].sort()) {
    out.push(`## Sector group: ${group}`);
    for (const f of groups.get(group) ?? []) {
      out.push(
        `### ${f.id}: ${f.name}\n` +
          `- Description: ${truncate(f.description, DESCRIPTION_CHARS)}\n` +
          `- Transferable functions: ${(f.transferable_functions ?? []).join(", ")}\n` +
          `- Sources: ${(f.sources ?? []).slice(0, CATALOGUE_SOURCES).join(" ; ")}`,
      );
      const rs = rolesByField.get(f.id) ?? [];
      if (rs.length > 0) {
        out.push(
          "- Example roles:\n" +
            rs
              .map(
                (r) =>
                  `  - ${r.id}: ${stripLevelWords(r.title)} [${r.function}]` +
                  ` — ${(r.example_companies ?? []).slice(0, 3).join(", ")}` +
                  ` — ${(r.sources ?? []).slice(0, 1).join("")}`,
              )
              .join("\n"),
        );
      }
    }
  }
  return out.join("\n");
}

/** Fields on file, one per line. The ref is shown only where the model can use one: in catalogue mode. */
function renderExistingFields(profile: Profile, withRefs: boolean): string {
  if (profile.fields.length === 0) return "(none yet)";
  return profile.fields
    .map(
      (f) =>
        `- ${f.id} ${f.name} — status ${f.status}` +
        (!withRefs || f.extra[REF_KEY] === undefined ? "" : ` — ref ${f.extra[REF_KEY]}`),
    )
    .join("\n");
}

/**
 * The user message: cards, preferences, existing fields, and the catalogue
 * when there is one. Deterministic. With no catalogue (memory mode,
 * technical-plan.md D61) the `# Reference catalogue` block is left out and a
 * kept field is matched by its name, since there is no ref to match on.
 */
export function buildDiscoverMessage(profile: Profile, catalogue?: Catalogue): string {
  return (
    `# Experience cards\n\n${renderCardsForDiscover(profile)}\n\n` +
    `# Preferences\n\n${renderPreferencesForDiscover(profile)}\n\n` +
    `# Fields already in the profile\n\n${renderExistingFields(profile, catalogue !== undefined)}\n\n` +
    `(Recommend again from scratch; rejected fields must not come back. If you keep a field that is already listed, use the same ${catalogue === undefined ? "name" : "ref"} so it is updated rather than duplicated.)\n\n` +
    (catalogue === undefined ? "" : `# Reference catalogue\n\n${renderCatalogue(catalogue.fields, catalogue.roles)}\n\n`) +
    `Return 4-7 ranked fields for this person as JSON.`
  );
}

// ---------------------------------------------------------------------------
// Post-validation: nothing uncited, no source the catalogue does not list,
// and in memory mode no URL at all
// ---------------------------------------------------------------------------

export interface DroppedCounts {
  /** Fields dropped for citing no active card. */
  fieldsUncited: number;
  rolesUncited: number;
  /** Roles dropped because the title is a rank with no occupation left under it (technical-plan.md D48). */
  rolesLevelTitled: number;
  /** Catalogue mode: entries removed from `sources` as not listed in the catalogue, blocked, or malformed. */
  sourcesRemoved: number;
  /** Memory mode: URLs removed from the text of kept fields and roles, where nothing may carry one (technical-plan.md D44, D61). */
  textUrlsStripped: number;
  /** Fields beyond {@link MAX_FIELDS}, duplicating an earlier field, or with no name (memory mode: none left once URLs are removed). */
  fieldsSurplus: number;
  /** Evidence entries dropped for citing no active card, being blank, or repeating a card. */
  evidenceDropped: number;
  /** Fields whose ask came back without a question or key and so got none. */
  asksDropped: number;
}

function zeroDropped(): DroppedCounts {
  return {
    fieldsUncited: 0,
    rolesUncited: 0,
    rolesLevelTitled: 0,
    sourcesRemoved: 0,
    textUrlsStripped: 0,
    fieldsSurplus: 0,
    evidenceDropped: 0,
    asksDropped: 0,
  };
}

/** Every source URL the catalogue lists — the only URLs discovery may cite (technical-plan.md D44). */
export function catalogueSourceUrls(
  fields: readonly CatalogueField[],
  roles: readonly CatalogueRole[],
): Set<string> {
  return new Set([...fields, ...roles].flatMap((item) => (item.sources ?? []).map((u) => u.trim())));
}

/** Keeps well-formed, non-blocked URLs; dedups; caps at `limit`. */
export function cleanSources(sources: readonly string[], limit = MAX_SOURCES): { kept: string[]; removed: number } {
  const kept: string[] = [];
  let removed = 0;
  for (const raw of sources) {
    const s = raw.trim();
    if (s === "" || sourceHost(s) === null || isBlockedSourceHost(s) || !/^https?:\/\//i.test(s)) {
      removed += 1;
      continue;
    }
    if (!kept.includes(s)) kept.push(s);
  }
  return { kept: kept.slice(0, limit), removed: removed + Math.max(0, kept.length - limit) };
}

/** {@link cleanSources}, after removing (and counting) every URL the catalogue does not list. */
export function cleanCatalogueSources(
  sources: readonly string[],
  allowed: ReadonlySet<string>,
): { kept: string[]; removed: number } {
  const listed = sources.filter((s) => allowed.has(s.trim()));
  const clean = cleanSources(listed);
  return { kept: clean.kept, removed: sources.length - listed.length + clean.removed };
}

/**
 * A link: anything with a scheme or a leading "www.". A bare name such as
 * "350.org" is what an organisation is called, not a link, and is left alone.
 * A comma or semicolon ends the link when a space, the end, or a card ID
 * follows ("https://a.org,C1" keeps its citation), and a balanced "(…)" stays
 * inside it ("…/Grid_(power)"), unless it is a lone card ID.
 */
const URL_SOURCE =
  "(?:https?:\\/\\/|www\\.)" +
  "(?:[^\\s<>()\\[\\]\"',;]|[,;](?!\\s|$|C\\d)|\\((?!C\\d+\\))[^\\s<>()\\[\\]\"']*\\))+";
const URL_RE = new RegExp(URL_SOURCE, "i");
/** `[label](url)`: the label is the text, the URL goes. */
const MARKDOWN_LINK_RE = new RegExp(`\\[([^\\]]*)\\]\\(\\s*${URL_SOURCE}\\s*\\)`, "gi");
/**
 * A URL with the words that only introduced it, so no dangling lead-in is
 * left: "see", "visit", and the prepositions "via" and "at", whose object the
 * URL is. "Source" and "link" are ordinary words too ("open source"), so they
 * go only as a label with a colon ("Source: <url>").
 */
const LED_URL_RE = new RegExp(
  `(?:\\b(?:see(?:\\s+also)?|visit|via|at)\\b\\s*:?\\s*|\\b(?:sources?|links?)\\s*:\\s*)?${URL_SOURCE}`,
  "gi",
);
/** Marks where a URL was until the punctuation around it is tidied. */
const GAP = "";
/** "(<url>)", "(<url>, <url>)": a bracket that held nothing but links goes whole. */
const GAPS_ONLY_IN_BRACKETS_RE = new RegExp(
  `["'(\\[<]\\s*${GAP}(?:[\\s.,;:!?]*${GAP})*[.,;:!?]*\\s*["')\\]>]`,
  "g",
);
/** "(C1; <url>)" → "(C1)": links at the end of a bracket go with their separators. */
const GAPS_BEFORE_CLOSE_RE = new RegExp(`(?:\\s*[,;:]?\\s*${GAP}[.,;:!?]*)+\\s*(?=[)\\]>])`, "g");
/** "(<url>, C1)" → "(C1)": links at the start of a bracket go with their separators. */
const GAPS_AFTER_OPEN_RE = new RegExp(`(?<=[(\\[<])\\s*(?:${GAP}[.,;:!?]*\\s*)+`, "g");
/** A bracket left holding only punctuation. */
const EMPTY_BRACKETS_RE = /\s*[(\[<][\s.,;:!?]*[)\]>]/g;
/** "…as C1: <url>." — the clause opener goes with the URL it introduced. */
const GAP_AFTER_CLAUSE_OPENER_RE = new RegExp(`[,;:]\\s*${GAP}(?=[.!?])`, "g");
/** "…this work. <url>. Then…" — a URL that stood as its own sentence or clause. */
const GAP_AS_OWN_CLAUSE_RE = new RegExp(`([.!?,;:])\\s*${GAP}[.,;:!?]+`, "g");
const GAP_RE = new RegExp(`\\s*${GAP}`, "g");

/** True when the text carries a link {@link stripUrls} would remove. */
export function hasUrl(text: string): boolean {
  return URL_RE.test(text);
}

/**
 * The text with every URL removed and the sentence around it left readable:
 * a markdown link keeps its label, "(see https://…)" goes whole, and the
 * punctuation that closed a URL stays with the sentence. Text with no URL
 * comes back untouched. Memory-mode discovery runs all the model's prose
 * through this, because no URL from memory is ever shown (technical-plan.md
 * D44, D61).
 */
export function stripUrls(text: string): { text: string; removed: number } {
  let removed = 0;
  const gapped = text
    .replace(MARKDOWN_LINK_RE, (_match, label: string) => {
      removed += 1;
      return label;
    })
    .replace(LED_URL_RE, (match) => {
      removed += 1;
      return GAP + (/[.,;:!?]+$/.exec(match)?.[0] ?? "");
    });
  if (removed === 0) return { text, removed };
  return {
    text: gapped
      .replace(GAPS_ONLY_IN_BRACKETS_RE, "")
      .replace(GAPS_BEFORE_CLOSE_RE, "")
      .replace(GAPS_AFTER_OPEN_RE, "")
      .replace(EMPTY_BRACKETS_RE, "")
      .replace(GAP_AFTER_CLAUSE_OPENER_RE, "")
      .replace(GAP_AS_OWN_CLAUSE_RE, "$1")
      .replace(GAP_RE, "")
      .replace(/\s+/g, " ")
      .replace(/\s+([.,;:!?)\]])/g, "$1")
      .replace(/^[\s.,;:!?]+|[\s,;:]+$/g, ""),
    removed,
  };
}

/** Card IDs cited in `text` that are active in the profile. */
export function citedActiveCardIds(text: string, profile: Profile): string[] {
  const active = new Set(activeCards(profile).map((c) => c.id));
  return citedCardIds(text).filter((id) => active.has(id));
}

export interface ValidatedRole {
  ref: string | null;
  title: string;
  companies: string[];
  why: string;
  sources: string[];
}

export interface ValidatedField {
  ref: string | null;
  name: string;
  move: MoveType;
  sector: string;
  fitLevel: FitLevel;
  summary: string;
  chips: string[];
  fit: string;
  evidence: Evidence[];
  uncertain: string;
  ask?: Ask;
  sources: string[];
  roles: ValidatedRole[];
}

/** Trims, drops blanks, dedupes case-insensitively, caps at `limit`. */
function cleanPhrases(list: readonly string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const text = raw.replace(/\s+/g, " ").trim();
    const key = text.toLowerCase();
    if (text === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === limit) break;
  }
  return out;
}

/**
 * Evidence lines that resolve to an active card, one per card, in the
 * model's order. Anything else is counted and dropped, never rendered.
 */
function cleanEvidence(
  drafts: readonly Evidence[],
  profile: Profile,
): { kept: Evidence[]; removed: number } {
  const active = new Map(activeCards(profile).map((c) => [c.id.toUpperCase(), c.id]));
  const kept: Evidence[] = [];
  const seen = new Set<string>();
  let removed = 0;
  for (const e of drafts) {
    const cardId = active.get(e.cardId.trim().toUpperCase());
    const why = e.why.replace(/\s+/g, " ").trim();
    if (cardId === undefined || why === "" || seen.has(cardId)) {
      removed += 1;
      continue;
    }
    seen.add(cardId);
    kept.push({ cardId, why });
  }
  return { kept, removed };
}

/** The ask, trimmed; `undefined` when the model left the question or key blank. */
function cleanAsk(ask: Ask): Ask | undefined {
  const question = ask.question.replace(/\s+/g, " ").trim();
  const key = ask.key.replace(/\s+/g, " ").trim();
  if (question === "" || key === "") return undefined;
  return { question, key, placeholder: ask.placeholder.replace(/\s+/g, " ").trim() };
}

export interface ValidatedOutput {
  fields: ValidatedField[];
  dropped: DroppedCounts;
}

/** A ref, trimmed, or `null` when it is absent or blank. */
function trimmedRef(ref: string | null | undefined): string | null {
  const t = ref?.trim() ?? "";
  return t === "" ? null : t;
}

/**
 * The identity keys an item is matched on, in the ref-then-name order
 * {@link findExistingField} and {@link findExistingRole} use: a ref match wins,
 * a name match is the fallback. Validation dedupes on the *same* keys, so two
 * drafts that would collapse onto one profile row never both survive — the
 * dedupe key and the match key are one thing.
 */
function identityKeys(ref: string | null | undefined, name: string): string[] {
  const keys = [`name:${name.trim().toLowerCase()}`];
  const r = trimmedRef(ref);
  if (r !== null) keys.unshift(`ref:${r}`);
  return keys;
}

const NO_SOURCES: ReadonlySet<string> = new Set<string>();

/** A draft ready for validation, with the URLs stripped from it in memory mode (none in catalogue mode). */
interface MemoryDraft {
  draft: FieldDraftCatalogue;
  /** URLs stripped from the field's own text, counted only if the field is kept. */
  urlsStripped: number;
  /** URLs stripped from each role, by index, counted only if that role is kept. */
  roleUrlsStripped: number[];
}

/**
 * A memory-mode draft in the shape validation works on: no ref, no sources,
 * and every string the screens render, names and titles included, run
 * through {@link stripUrls} (technical-plan.md D44, D61). The counts are held
 * back so only what survives validation adds to `textUrlsStripped`.
 */
function memoryDraft(draft: FieldDraftMemory): MemoryDraft {
  let count = 0;
  const strip = (text: string): string => {
    const { text: clean, removed } = stripUrls(text);
    count += removed;
    return clean;
  };
  const roleUrlsStripped: number[] = [];
  const roles = draft.roles.map((r) => {
    count = 0;
    const role = {
      ...r,
      ref: null,
      title: strip(r.title),
      companies: r.companies.map(strip),
      why: strip(r.why),
      sources: [],
    };
    roleUrlsStripped.push(count);
    return role;
  });
  count = 0;
  const field: FieldDraftCatalogue = {
    ...draft,
    ref: null,
    name: strip(draft.name),
    sector: strip(draft.sector),
    summary: strip(draft.summary),
    chips: draft.chips.map(strip),
    fit: strip(draft.fit),
    evidence: draft.evidence.map((e) => ({ ...e, why: strip(e.why) })),
    uncertainties: draft.uncertainties.map(strip),
    ask: { ...draft.ask, question: strip(draft.ask.question), placeholder: strip(draft.ask.placeholder) },
    sources: [],
    roles,
  };
  return { draft: field, urlsStripped: count, roleUrlsStripped };
}

/**
 * Drops (and counts) anything uncited and caps sizes, in both modes.
 *
 * With `catalogueSources` (catalogue mode) it strips and counts every source
 * the catalogue does not list. A field or role left with no source is kept:
 * it is one the model named from its own knowledge.
 *
 * Without it (memory mode, technical-plan.md D61) there is no catalogue
 * filter: every field and role comes out with no ref and no sources, fields
 * are deduped by name, and every URL in what the model wrote (names and
 * titles included) is removed before citations are looked for, so a card ID
 * that appears only inside a URL is not a citation. `textUrlsStripped` counts
 * only the URLs of fields and roles that are kept; a field whose name was
 * nothing but a URL is dropped as surplus.
 *
 * Role titles lose their level modifiers before anything else looks at them
 * (technical-plan.md D48), so "Senior Data Scientist" and "Data Scientist" in
 * one field are one role and the first wins. A title that is a rank
 * ("Director of X") has no occupation to fall back to: the role is dropped
 * and counted in `rolesLevelTitled`.
 */
export function validateOutput(
  output: DiscoverOutputMemory | DiscoverOutputCatalogue,
  profile: Profile,
  catalogueSources?: ReadonlySet<string>,
): ValidatedOutput {
  const dropped = zeroDropped();
  const fields: ValidatedField[] = [];
  const seen = new Set<string>();
  const allowedSources = catalogueSources ?? NO_SOURCES;
  for (const raw of output.fields) {
    // A ref counts only in catalogue mode; in memory mode identity is the name,
    // once any URL is out of it.
    const catalogueDraft = catalogueSources !== undefined && "ref" in raw ? raw : undefined;
    const { draft, urlsStripped, roleUrlsStripped: roleUrls }: MemoryDraft =
      catalogueDraft === undefined ? memoryDraft(raw) : { draft: catalogueDraft, urlsStripped: 0, roleUrlsStripped: [] };
    const keys = identityKeys(draft.ref, draft.name);
    if (fields.length >= MAX_FIELDS || draft.name.trim() === "" || keys.some((k) => seen.has(k))) {
      dropped.fieldsSurplus += 1;
      continue;
    }
    const citedIds = citedActiveCardIds(draft.fit, profile);
    if (citedIds.length === 0) {
      dropped.fieldsUncited += 1;
      continue;
    }
    const { kept, removed } = cleanCatalogueSources(draft.sources, allowedSources);
    dropped.sourcesRemoved += removed;
    const roles: ValidatedRole[] = [];
    const seenRoles = new Set<string>();
    let roleUrlsStripped = 0;
    for (const [i, r] of draft.roles.entries()) {
      if (roles.length >= MAX_ROLES_PER_FIELD) break;
      const title = stripLevelWords(r.title);
      if (hasLevelHead(title) || (title === "" && r.title.trim() !== "")) {
        dropped.rolesLevelTitled += 1;
        continue;
      }
      // No title at all (in memory mode, possibly one that was only a URL).
      if (title === "") continue;
      const rKeys = identityKeys(r.ref, title);
      if (rKeys.some((k) => seenRoles.has(k))) continue;
      if (citedActiveCardIds(r.why, profile).length === 0) {
        dropped.rolesUncited += 1;
        continue;
      }
      const rs = cleanCatalogueSources(r.sources, allowedSources);
      dropped.sourcesRemoved += rs.removed;
      for (const k of rKeys) seenRoles.add(k);
      roleUrlsStripped += roleUrls[i] ?? 0;
      roles.push({
        ref: trimmedRef(r.ref),
        title,
        companies: r.companies.map((c) => c.trim()).filter((c) => c !== ""),
        why: r.why.trim(),
        sources: rs.kept,
      });
    }
    for (const k of keys) seen.add(k);
    dropped.textUrlsStripped += urlsStripped + roleUrlsStripped;
    let chips = cleanPhrases(draft.chips, MAX_CHIPS);
    if (chips.length === 0) {
      // No chips from the model: fall back to the skills of the cards the fit cites.
      const cited = new Set(citedIds);
      chips = cleanPhrases(
        activeCards(profile).filter((c) => cited.has(c.id)).flatMap((c) => c.skills),
        MAX_CHIPS,
      );
    }
    const evidence = cleanEvidence(draft.evidence, profile);
    dropped.evidenceDropped += evidence.removed;
    const ask = cleanAsk(draft.ask);
    if (ask === undefined) dropped.asksDropped += 1;
    fields.push({
      ref: trimmedRef(draft.ref),
      name: draft.name.trim(),
      move: draft.move,
      sector: draft.sector.replace(/\s+/g, " ").trim(),
      fitLevel: draft.fitLevel,
      summary: draft.summary.replace(/\s+/g, " ").trim(),
      chips,
      fit: draft.fit.trim(),
      evidence: evidence.kept,
      ...(ask === undefined ? {} : { ask }),
      uncertain: draft.uncertainties
        .map((u) => u.trim())
        .filter((u) => u !== "")
        .slice(0, MAX_UNCERTAINTIES)
        .map((u) => (/[.!?]$/.test(u) ? u : `${u}.`))
        .join(" "),
      sources: kept,
      roles,
    });
  }
  return { fields, dropped };
}

// ---------------------------------------------------------------------------
// Profile writes: stable IDs, in-place updates, user statuses preserved
// ---------------------------------------------------------------------------

function findExistingField(profile: Profile, f: ValidatedField): Field | undefined {
  if (f.ref !== null) {
    const byRef = profile.fields.find((x) => x.extra[REF_KEY]?.trim() === f.ref);
    if (byRef !== undefined) return byRef;
  }
  const name = f.name.toLowerCase();
  return profile.fields.find((x) => x.name.trim().toLowerCase() === name);
}

function findExistingRole(profile: Profile, fieldId: string, r: ValidatedRole): Role | undefined {
  const inField = profile.roles.filter((x) => x.fieldId === fieldId);
  if (r.ref !== null) {
    const byRef = inField.find((x) => x.extra[REF_KEY]?.trim() === r.ref);
    if (byRef !== undefined) return byRef;
  }
  // A role stored before titles lost their level ("Senior X") is the same role as "X".
  const title = r.title.toLowerCase();
  return inField.find((x) => stripLevelWords(x.title).toLowerCase() === title);
}

export interface ApplyResult {
  profile: Profile;
  /** Fields written this run (new or updated), in rank order. */
  fields: Field[];
  roles: Role[];
}

/**
 * Writes validated fields and roles into the profile. An existing field
 * (matched by `extra.Ref`, then by name) keeps its id, status and explored
 * flag; a new one is appended as `candidate`. Roles are matched within their
 * field by ref, then title. Fields and roles from earlier runs that this run
 * did not return are marked dropped (technical-plan.md D58).
 *
 * A memory-mode run (technical-plan.md D61) hands in fields with no ref and
 * no sources, so everything it writes is matched by name and comes out with
 * no `Ref` and an empty source list, including a field an earlier catalogue
 * run had given both.
 */
export function applyDiscovery(profile: Profile, fields: readonly ValidatedField[]): ApplyResult {
  let next = profile;
  const writtenFields: Field[] = [];
  const writtenRoles: Role[] = [];
  for (const f of fields) {
    const existing = findExistingField(next, f);
    const extra = { ...(existing?.extra ?? {}) };
    delete extra[DROPPED_KEY];
    if (f.ref !== null) extra[REF_KEY] = f.ref;
    else delete extra[REF_KEY];
    next = upsertField(next, {
      ...(existing === undefined ? {} : { id: existing.id }),
      name: f.name,
      status: existing?.status ?? "candidate",
      explored: existing?.explored ?? false,
      move: f.move,
      sector: f.sector,
      fitLevel: f.fitLevel,
      summary: f.summary,
      chips: f.chips,
      fit: f.fit,
      evidence: f.evidence,
      uncertain: f.uncertain,
      ...(f.ask === undefined ? {} : { ask: f.ask }),
      sources: f.sources,
      extra,
    });
    const field = existing === undefined ? next.fields.at(-1) : next.fields.find((x) => x.id === existing.id);
    if (field === undefined) continue; // unreachable: upsertField always writes
    writtenFields.push(field);
    for (const r of f.roles) {
      const existingRole = findExistingRole(next, field.id, r);
      const rExtra = { ...(existingRole?.extra ?? {}) };
      delete rExtra[DROPPED_KEY];
      if (r.ref !== null) rExtra[REF_KEY] = r.ref;
      else delete rExtra[REF_KEY];
      next = upsertRole(next, {
        ...(existingRole === undefined ? {} : { id: existingRole.id }),
        title: r.title,
        fieldId: field.id,
        companies: r.companies,
        why: r.why,
        selected: existingRole?.selected ?? false,
        sources: r.sources,
        extra: rExtra,
      });
      const role =
        existingRole === undefined ? next.roles.at(-1) : next.roles.find((x) => x.id === existingRole.id);
      if (role !== undefined) writtenRoles.push(role);
    }
  }
  return { profile: dropUnreturned(next, writtenFields, writtenRoles), fields: writtenFields, roles: writtenRoles };
}

/**
 * The latest run is the person's list (technical-plan.md D58): fields it
 * returned move into its rank order, and every field or role it did not
 * return is marked dropped and un-ticked, so no screen shows it and no
 * search is written for it. Ids are kept, never deleted. A run that wrote
 * nothing leaves the profile as it was.
 */
function dropUnreturned(profile: Profile, fields: readonly Field[], roles: readonly Role[]): Profile {
  if (fields.length === 0) return profile;
  const keptFieldIds = [...new Set(fields.map((f) => f.id))];
  const keptRoleIds = new Set(roles.map((r) => r.id));
  const byId = new Map(profile.fields.map((f) => [f.id, f] as const));
  const ranked = keptFieldIds.flatMap((id) => byId.get(id) ?? []);
  const rest = profile.fields
    .filter((f) => !keptFieldIds.includes(f.id))
    .map((f) => ({ ...f, extra: { ...f.extra, [DROPPED_KEY]: "yes" } }));
  return {
    ...profile,
    fields: [...ranked, ...rest],
    roles: profile.roles.map((r) =>
      keptRoleIds.has(r.id) ? r : { ...r, selected: false, extra: { ...r.extra, [DROPPED_KEY]: "yes" } },
    ),
  };
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export class DiscoverInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoverInputError";
  }
}

export interface DiscoverRequest {
  sessionId: string;
  profile: Profile;
}

export interface DiscoverOptions {
  llm?: Llm;
  /**
   * Present: the catalogue arm, reading the reference tables through this
   * reader. Absent: memory mode, which is what the app passes
   * (technical-plan.md D61).
   */
  catalogue?: ReferenceReader;
}

export interface DiscoverResult extends ApplyResult {
  dropped: DroppedCounts;
  /** Metrics of the one model call. */
  call: CallMetrics;
}

/**
 * Cards → ranked fields and roles written into the profile. No web tools
 * (D44). With no `options.catalogue` the model works from its own knowledge;
 * with one, from the reference catalogue the reader returns (D61).
 */
export async function discoverFields(
  { sessionId, profile }: DiscoverRequest,
  options: DiscoverOptions = {},
): Promise<DiscoverResult> {
  if (activeCards(profile).length === 0) {
    throw new DiscoverInputError("The profile has no active experience cards to discover from.");
  }
  const llmClient = options.llm ?? (await import("./llm")).llm();
  if (options.catalogue === undefined) {
    const result = await llmClient.structured({
      step: "discover",
      sessionId,
      system: DISCOVER_SYSTEM_PROMPT_MEMORY,
      messages: [{ role: "user", content: buildDiscoverMessage(profile) }],
      schema: DiscoverOutputSchemaMemory,
    });
    return writeResult(profile, validateOutput(result.value, profile), result);
  }
  const [fields, roles] = await Promise.all([options.catalogue.listFields(), options.catalogue.listRoles()]);
  const result = await llmClient.structured({
    step: "discover",
    sessionId,
    system: DISCOVER_SYSTEM_PROMPT_CATALOGUE,
    messages: [{ role: "user", content: buildDiscoverMessage(profile, { fields, roles }) }],
    schema: DiscoverOutputSchemaCatalogue,
  });
  return writeResult(profile, validateOutput(result.value, profile, catalogueSourceUrls(fields, roles)), result);
}

function writeResult(
  profile: Profile,
  validated: ValidatedOutput,
  { usage, costUsd, durationMs, continuations, stopReason }: CallMetrics,
): DiscoverResult {
  return {
    ...applyDiscovery(profile, validated.fields),
    dropped: validated.dropped,
    call: { usage, costUsd, durationMs, continuations, stopReason },
  };
}

/** One line for logs and the CLI: counts only, never content. */
export function droppedSummary(d: DroppedCounts): string {
  const total = d.fieldsUncited + d.rolesUncited + d.rolesLevelTitled + d.fieldsSurplus;
  return (
    `${String(total)} dropped (fields: ${String(d.fieldsUncited)} uncited, ${String(d.fieldsSurplus)} surplus; ` +
    `roles: ${String(d.rolesUncited)} uncited, ${String(d.rolesLevelTitled)} titled by rank; ${String(d.sourcesRemoved)} source URLs removed, ${String(d.textUrlsStripped)} URLs stripped from text; ` +
    `${String(d.evidenceDropped)} evidence lines, ${String(d.asksDropped)} asks dropped)`
  );
}
