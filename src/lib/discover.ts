/**
 * Phase 1.4 — discover: profile cards + reference catalogue + the model's own
 * knowledge → ranked climate fields and roles for this person.
 *
 * One structured `discover` call with no tools does the work (technical-plan.md
 * D44): the byte-stable {@link DISCOVER_SYSTEM_PROMPT} carries the policy, and
 * the user message carries everything per-call (active cards, stated
 * preferences, the compact reference catalogue, and any fields already in the
 * profile). There is no web search: a field outside the catalogue comes from
 * what the model knows, and carries no sources.
 *
 * Post-validation is strict and counted, never silent: a field whose fit does
 * not cite an active card, or a role whose `why` does not, is dropped and
 * reported in `dropped`. A source URL survives only if the catalogue lists
 * it, so a URL the model recalls from memory is never shown. Profile writes
 * go through `upsertField` / `upsertRole`; a re-run matches an existing field
 * by the reference id stored in `extra.Ref` (or its name) and updates it in
 * place, never renumbering and never downgrading a user-set status back to
 * `candidate`.
 */

import { z } from "zod";

import type { CallMetrics, Llm } from "./llm";
import {
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

/** The `extra` key that links a profile field or role to a reference id. */
export const REF_KEY = "Ref";

// ---------------------------------------------------------------------------
// Reference catalogue (injectable so tests need no Supabase)
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

export interface ReferenceReader {
  listFields(): Promise<CatalogueField[]>;
  listRoles(): Promise<CatalogueRole[]>;
}

async function defaultReference(): Promise<ReferenceReader> {
  const ref = await import("./reference");
  return { listFields: () => ref.listFields(), listRoles: () => ref.listRoles() };
}

// ---------------------------------------------------------------------------
// Model output schema
// ---------------------------------------------------------------------------

export const RoleDraftSchema = z.object({
  title: z.string(),
  /** Reference role id when the role is from the catalogue, else null. */
  ref: z.string().nullable(),
  companies: z.array(z.string()),
  /** Must name the card IDs (C1, C2, …) it draws on. */
  why: z.string(),
  sources: z.array(z.string()),
});
export type RoleDraft = z.infer<typeof RoleDraftSchema>;

export const FieldDraftSchema = z.object({
  /** Reference field id when the field is from the catalogue, else null. */
  ref: z.string().nullable(),
  name: z.string(),
  move: MoveTypeSchema,
  /** One line naming the sector the field sits in. */
  sector: z.string().describe('One line naming the sector this field sits in, e.g. "Utility-scale solar development".'),
  fitLevel: FitLevelSchema.describe(
    '"strong": employers hire for this function from this background today. "some": they hire for it, but expect a gap you name in the fit. "stretch": needs retraining or a rare path.',
  ),
  summary: z
    .string()
    .describe("Two sentences, second person, no hedging: what the work is and why this person fits it."),
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
  roles: z.array(RoleDraftSchema),
});
export type FieldDraft = z.infer<typeof FieldDraftSchema>;

export const DiscoverOutputSchema = z.object({
  /** Ranked best-fit first. */
  fields: z.array(FieldDraftSchema),
});
export type DiscoverOutput = z.infer<typeof DiscoverOutputSchema>;

// ---------------------------------------------------------------------------
// Prompts — byte-stable constants; everything per-call goes in the user message
// ---------------------------------------------------------------------------

export const DISCOVER_SYSTEM_PROMPT = `You help one career switcher find where their existing work fits in climate. You get their experience cards, their stated preferences, and a small reference catalogue of climate fields and example roles. You return 4-7 ranked fields, each with 2-4 roles, as JSON.

Rules that decide whether your answer is usable:

1. Be specific to THIS person. Every field's "fit" and every role's "why" must name the card IDs (C1, C2, ...) it draws on and say what in that card transfers. Never recommend a field that any climate-curious person would get; if you cannot tie a field to a concrete card, leave it out. Generic lists ("climate needs everyone", "software", "engineering", "sustainability") are worthless. A videographer should get fields where video and story work is a real, hired function (communications teams at developers and nonprofits, documentary and impact media, brand content), not "renewable energy" in general.

2. Ground in the catalogue, then in what you know. Prefer catalogue fields: set "ref" to the catalogue id when you use one (and "ref" to the catalogue role id for a catalogue role). When this person's cards point somewhere the catalogue does not cover, name a real field or role you know well and set "ref" to null. You have no web access. "sources" may hold only URLs listed in the catalogue, copied exactly; never write a URL from memory, however sure you are, because any other URL is removed. A field or role outside the catalogue gets an empty "sources" list.

3. Label the move honestly. "sector" = the same function they do today, moved into a climate employer. "adjacent" = a related function that reuses most of their skills but changes the job. "retraining" = needs new credentials or a substantially new skill set. Rank sector and adjacent moves above retraining unless the person's preferences say they want to retrain.

4. Name what you do not know. 1-3 short "uncertainties" per field: whether roles are in-house or freelance, how many employers exist in their location, whether a credential is expected, pay bands, and so on.

5. Respect preferences. Location, work mode, seniority, retraining appetite and climate interests are constraints when stated. Do not use excluded cards; they are not shown to you.

6. Roles: give 2-4 per field with a concrete title, 1-4 real example companies or organisation types, a "why" that cites cards, and the catalogue's sources when it is a catalogue role. Do not repeat the same role across fields.

7. Fill the card the person sees. Per field: "sector" is one line naming the sector it sits in. "fitLevel" is one of three labels, never a number: "strong" means employers hire for this function from this background today; "some" means they hire for it but expect a gap, and your "fit" names that gap; "stretch" means it needs retraining or a rare path. "summary" is two sentences in the second person ("You have...", "Your...") with no hedging, saying what the work is and why this person fits it. "chips" are 3-4 short transferable-skill phrases (two to four words) drawn from the cards. "evidence" has one entry per card the field draws on: the card ID and one sentence naming what in that card counts. "ask" is the one question whose answer would most change the fit, with "key" a short preference label the answer is filed under (such as "Content mix" or "Travel") and "placeholder" an example answer; it must not repeat a preference the person has already stated.

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

/** Stated (and inferred) preferences, one per line; deterministic order. */
export function renderPreferencesForDiscover(profile: Profile): string {
  const p = profile.preferences;
  const lines: string[] = [];
  const single = (label: string, v: { value: string; source: string } | undefined) => {
    if (v !== undefined && v.value.trim() !== "") lines.push(`- ${label}: ${v.value} (${v.source})`);
  };
  single("Location", p.location);
  single("Work mode", p.workMode);
  single("Seniority", p.seniority);
  single("Retraining appetite", p.retrainingAppetite);
  if (p.climateInterests !== undefined && p.climateInterests.values.length > 0) {
    lines.push(
      `- Climate interests: ${p.climateInterests.values.join(", ")} (${p.climateInterests.source})`,
    );
  }
  for (const o of p.other) lines.push(`- ${o.key}: ${o.value} (${o.source})`);
  const confirmed = profile.skills.confirmed;
  if (confirmed.length > 0) lines.push(`- Confirmed skills: ${confirmed.join(", ")}`);
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
                  `  - ${r.id}: ${r.title} [${r.function}]` +
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

function renderExistingFields(profile: Profile): string {
  if (profile.fields.length === 0) return "(none yet)";
  return profile.fields
    .map(
      (f) =>
        `- ${f.id} ${f.name} — status ${f.status}` +
        (f.extra[REF_KEY] === undefined ? "" : ` — ref ${f.extra[REF_KEY]}`),
    )
    .join("\n");
}

/** The user message: cards, preferences, catalogue, existing fields. Deterministic. */
export function buildDiscoverMessage(
  profile: Profile,
  fields: readonly CatalogueField[],
  roles: readonly CatalogueRole[],
): string {
  return (
    `# Experience cards\n\n${renderCardsForDiscover(profile)}\n\n` +
    `# Preferences\n\n${renderPreferencesForDiscover(profile)}\n\n` +
    `# Fields already in the profile\n\n${renderExistingFields(profile)}\n\n` +
    `(Recommend again from scratch; rejected fields must not come back. If you keep a field that is already listed, use the same ref so it is updated rather than duplicated.)\n\n` +
    `# Reference catalogue\n\n${renderCatalogue(fields, roles)}\n\n` +
    `Return 4-7 ranked fields for this person as JSON.`
  );
}

// ---------------------------------------------------------------------------
// Post-validation: nothing uncited, and no source the catalogue does not list
// ---------------------------------------------------------------------------

export interface DroppedCounts {
  /** Fields dropped for citing no active card. */
  fieldsUncited: number;
  rolesUncited: number;
  /** Source URLs removed: not listed in the catalogue, blocked, or malformed. */
  sourcesRemoved: number;
  /** Fields beyond {@link MAX_FIELDS} or duplicating an earlier field. */
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
    sourcesRemoved: 0,
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

/**
 * Drops (and counts) anything uncited; strips (and counts) every source the
 * catalogue does not list; caps sizes. A field or role left with no source is
 * kept — it is one the model named from its own knowledge.
 */
export function validateOutput(
  output: DiscoverOutput,
  profile: Profile,
  allowedSources: ReadonlySet<string>,
): ValidatedOutput {
  const dropped = zeroDropped();
  const fields: ValidatedField[] = [];
  const seen = new Set<string>();
  for (const draft of output.fields) {
    const keys = identityKeys(draft.ref, draft.name);
    if (fields.length >= MAX_FIELDS || keys.some((k) => seen.has(k))) {
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
    for (const r of draft.roles) {
      if (roles.length >= MAX_ROLES_PER_FIELD) break;
      const rKeys = identityKeys(r.ref, r.title);
      if (rKeys.some((k) => seenRoles.has(k))) continue;
      if (citedActiveCardIds(r.why, profile).length === 0) {
        dropped.rolesUncited += 1;
        continue;
      }
      const rs = cleanCatalogueSources(r.sources, allowedSources);
      dropped.sourcesRemoved += rs.removed;
      for (const k of rKeys) seenRoles.add(k);
      roles.push({
        ref: trimmedRef(r.ref),
        title: r.title.trim(),
        companies: r.companies.map((c) => c.trim()).filter((c) => c !== ""),
        why: r.why.trim(),
        sources: rs.kept,
      });
    }
    for (const k of keys) seen.add(k);
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
  const title = r.title.toLowerCase();
  return inField.find((x) => x.title.trim().toLowerCase() === title);
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
 * field by ref, then title.
 */
export function applyDiscovery(profile: Profile, fields: readonly ValidatedField[]): ApplyResult {
  let next = profile;
  const writtenFields: Field[] = [];
  const writtenRoles: Role[] = [];
  for (const f of fields) {
    const existing = findExistingField(next, f);
    const extra = { ...(existing?.extra ?? {}) };
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
  return { profile: next, fields: writtenFields, roles: writtenRoles };
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
  reference?: ReferenceReader;
}

export interface DiscoverResult extends ApplyResult {
  dropped: DroppedCounts;
  /** Metrics of the one model call. */
  call: CallMetrics;
}

/** Cards + catalogue → ranked fields and roles written into the profile. No web tools (D44). */
export async function discoverFields(
  { sessionId, profile }: DiscoverRequest,
  options: DiscoverOptions = {},
): Promise<DiscoverResult> {
  if (activeCards(profile).length === 0) {
    throw new DiscoverInputError("The profile has no active experience cards to discover from.");
  }
  const llmClient = options.llm ?? (await import("./llm")).llm();
  const reference = options.reference ?? (await defaultReference());
  const [catFields, catRoles] = await Promise.all([reference.listFields(), reference.listRoles()]);
  const result = await llmClient.structured({
    step: "discover",
    sessionId,
    system: DISCOVER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildDiscoverMessage(profile, catFields, catRoles) }],
    schema: DiscoverOutputSchema,
  });
  const { usage, costUsd, durationMs, continuations, stopReason } = result;

  const validated = validateOutput(result.value, profile, catalogueSourceUrls(catFields, catRoles));
  const applied = applyDiscovery(profile, validated.fields);
  return {
    ...applied,
    dropped: validated.dropped,
    call: { usage, costUsd, durationMs, continuations, stopReason },
  };
}

/** One line for logs and the CLI: counts only, never content. */
export function droppedSummary(d: DroppedCounts): string {
  const total = d.fieldsUncited + d.rolesUncited + d.fieldsSurplus;
  return (
    `${String(total)} dropped (fields: ${String(d.fieldsUncited)} uncited, ${String(d.fieldsSurplus)} surplus; ` +
    `roles: ${String(d.rolesUncited)} uncited; ${String(d.sourcesRemoved)} source URLs removed as not in the catalogue; ` +
    `${String(d.evidenceDropped)} evidence lines, ${String(d.asksDropped)} asks dropped)`
  );
}
