/**
 * Phase 1.4 — discover: profile cards + reference catalogue + web search →
 * ranked climate fields and roles for this person.
 *
 * One structured `discover` call with server web tools does the work: the
 * byte-stable {@link DISCOVER_SYSTEM_PROMPT} carries the policy, and the user
 * message carries everything per-call (active cards, stated preferences, the
 * compact reference catalogue, and any fields already in the profile). If the
 * API refuses to combine structured output with server tools, the module
 * falls back to a two-call design (research with `streamText` + web tools,
 * then shape with `structured`) — both calls stay in this module.
 *
 * Post-validation is strict and counted, never silent: a field whose fit does
 * not cite an active card, or a role whose `why` does not, or either without a
 * non-blocked source URL, is dropped and reported in `dropped`. Profile writes
 * go through `upsertField` / `upsertRole`; a re-run matches an existing field
 * by the reference id stored in `extra.Ref` (or its name) and updates it in
 * place, never renumbering and never downgrading a user-set status back to
 * `candidate`.
 */

import { z } from "zod";

import type { CallMetrics, Llm, LlmTool } from "./llm";
import {
  type Field,
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
  /** Must name the card IDs (C1, C2, …) it draws on. */
  fit: z.string(),
  uncertainties: z.array(z.string()),
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

2. Ground and cite. Prefer catalogue fields: set "ref" to the catalogue id when you use one (and "ref" to the catalogue role id for a catalogue role). When this person's cards point somewhere the catalogue does not cover, use web search to find a real field and set "ref" to null. Every field needs 2-5 source URLs and every role at least 1: employer career or about pages, industry associations, program pages, published job descriptions, or reputable explainers. Sources must be real URLs you saw in the catalogue or in search results — never invent one. Never cite linkedin.com, indeed.com or climatebase.org; they are blocked.

3. Label the move honestly. "sector" = the same function they do today, moved into a climate employer. "adjacent" = a related function that reuses most of their skills but changes the job. "retraining" = needs new credentials or a substantially new skill set. Rank sector and adjacent moves above retraining unless the person's preferences say they want to retrain.

4. Name what you do not know. 1-3 short "uncertainties" per field: whether roles are in-house or freelance, how many employers exist in their location, whether a credential is expected, pay bands, and so on.

5. Respect preferences. Location, work mode, seniority, retraining appetite and climate interests are constraints when stated. Do not use excluded cards; they are not shown to you.

6. Roles: give 2-4 per field with a concrete title, 1-4 real example companies or organisation types, a "why" that cites cards, and sources. Do not repeat the same role across fields.

Use web search sparingly (a few targeted searches) to confirm employers, find sources for fields outside the catalogue, and check that the roles you name are real. Then answer with the JSON only.`;

export const DISCOVER_RESEARCH_SYSTEM_PROMPT = `You research where one career switcher's existing work fits in climate. You get their experience cards, their preferences, and a small reference catalogue of climate fields and roles. Use web search to confirm which fields hire for the functions in their cards, which employers do that hiring, and to find source URLs (employer career or about pages, associations, program pages, published job descriptions). Never search or cite linkedin.com, indeed.com or climatebase.org. Write concise research notes: candidate fields (catalogue id or "new"), why they fit which card IDs, the move type (sector, adjacent, retraining), open questions, example roles and employers, and the exact source URLs you saw. Notes only — no JSON.`;

export const DISCOVER_SHAPE_SYSTEM_PROMPT = `${DISCOVER_SYSTEM_PROMPT}

You have no web tools in this call. Research notes from an earlier call are included in the message; use only the source URLs they contain or the catalogue lists.`;

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
// Post-validation: nothing uncited, unsourced or blocked gets through
// ---------------------------------------------------------------------------

export interface DroppedCounts {
  /** Fields dropped for citing no active card. */
  fieldsUncited: number;
  /** Fields dropped for having no usable (non-blocked, well-formed) source. */
  fieldsUnsourced: number;
  rolesUncited: number;
  rolesUnsourced: number;
  /** Individual source URLs removed because their host is blocked or malformed. */
  sourcesRemoved: number;
  /** Fields beyond {@link MAX_FIELDS} or duplicating an earlier field. */
  fieldsSurplus: number;
}

function zeroDropped(): DroppedCounts {
  return {
    fieldsUncited: 0,
    fieldsUnsourced: 0,
    rolesUncited: 0,
    rolesUnsourced: 0,
    sourcesRemoved: 0,
    fieldsSurplus: 0,
  };
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
  fit: string;
  uncertain: string;
  sources: string[];
  roles: ValidatedRole[];
}

export interface ValidatedOutput {
  fields: ValidatedField[];
  dropped: DroppedCounts;
}

function fieldKey(ref: string | null, name: string): string {
  return ref !== null && ref.trim() !== "" ? `ref:${ref.trim()}` : `name:${name.trim().toLowerCase()}`;
}

/** Drops (and counts) anything uncited, unsourced or blocked; caps sizes. */
export function validateOutput(output: DiscoverOutput, profile: Profile): ValidatedOutput {
  const dropped = zeroDropped();
  const fields: ValidatedField[] = [];
  const seen = new Set<string>();
  for (const draft of output.fields) {
    if (fields.length >= MAX_FIELDS || seen.has(fieldKey(draft.ref, draft.name))) {
      dropped.fieldsSurplus += 1;
      continue;
    }
    if (citedActiveCardIds(draft.fit, profile).length === 0) {
      dropped.fieldsUncited += 1;
      continue;
    }
    const { kept, removed } = cleanSources(draft.sources);
    dropped.sourcesRemoved += removed;
    if (kept.length === 0) {
      dropped.fieldsUnsourced += 1;
      continue;
    }
    const roles: ValidatedRole[] = [];
    for (const r of draft.roles) {
      if (roles.length >= MAX_ROLES_PER_FIELD) break;
      if (citedActiveCardIds(r.why, profile).length === 0) {
        dropped.rolesUncited += 1;
        continue;
      }
      const rs = cleanSources(r.sources);
      dropped.sourcesRemoved += rs.removed;
      if (rs.kept.length === 0) {
        dropped.rolesUnsourced += 1;
        continue;
      }
      roles.push({
        ref: r.ref?.trim() === "" ? null : r.ref,
        title: r.title.trim(),
        companies: r.companies.map((c) => c.trim()).filter((c) => c !== ""),
        why: r.why.trim(),
        sources: rs.kept,
      });
    }
    seen.add(fieldKey(draft.ref, draft.name));
    fields.push({
      ref: draft.ref?.trim() === "" ? null : draft.ref,
      name: draft.name.trim(),
      move: draft.move,
      fit: draft.fit.trim(),
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
    const byRef = profile.fields.find((x) => x.extra[REF_KEY] === f.ref);
    if (byRef !== undefined) return byRef;
  }
  const name = f.name.toLowerCase();
  return profile.fields.find((x) => x.name.trim().toLowerCase() === name);
}

function findExistingRole(profile: Profile, fieldId: string, r: ValidatedRole): Role | undefined {
  const inField = profile.roles.filter((x) => x.fieldId === fieldId);
  if (r.ref !== null) {
    const byRef = inField.find((x) => x.extra[REF_KEY] === r.ref);
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
      fit: f.fit,
      uncertain: f.uncertain,
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
  /** Web tools from `webTools()`; pass `[]` to run without search (tests). */
  tools?: readonly LlmTool[];
  /** "single" tries structured + tools in one call and falls back on a 400. */
  strategy?: "single" | "two-call";
}

export interface DiscoverResult extends ApplyResult {
  dropped: DroppedCounts;
  /** Per-call metrics, one entry per model call made (1 or 2). */
  calls: CallMetrics[];
  strategy: "single" | "two-call";
}

/** An API 400 means the request shape was refused (e.g. tools + format). */
function isBadRequest(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 400;
}

async function loadTools(): Promise<readonly LlmTool[]> {
  const { webTools } = await import("./llm");
  return webTools({ searchMaxUses: 8, fetchMaxUses: 4 });
}

/** Cards + catalogue + web → ranked fields and roles written into the profile. */
export async function discoverFields(
  { sessionId, profile }: DiscoverRequest,
  options: DiscoverOptions = {},
): Promise<DiscoverResult> {
  if (activeCards(profile).length === 0) {
    throw new DiscoverInputError("The profile has no active experience cards to discover from.");
  }
  const llmClient = options.llm ?? (await import("./llm")).llm();
  const reference = options.reference ?? (await defaultReference());
  const tools = options.tools ?? (await loadTools());
  const [catFields, catRoles] = await Promise.all([reference.listFields(), reference.listRoles()]);
  const message = buildDiscoverMessage(profile, catFields, catRoles);
  const calls: CallMetrics[] = [];
  const metricsOf = ({ usage, costUsd, durationMs, continuations, stopReason }: CallMetrics) => ({
    usage,
    costUsd,
    durationMs,
    continuations,
    stopReason,
  });

  let strategy = options.strategy ?? "single";
  let value: DiscoverOutput | undefined;
  if (strategy === "single") {
    try {
      const result = await llmClient.structured({
        step: "discover",
        sessionId,
        system: DISCOVER_SYSTEM_PROMPT,
        messages: [{ role: "user", content: message }],
        schema: DiscoverOutputSchema,
        ...(tools.length === 0 ? {} : { tools }),
      });
      calls.push(metricsOf(result));
      value = result.value;
    } catch (error: unknown) {
      if (tools.length === 0 || !isBadRequest(error)) throw error;
      strategy = "two-call";
    }
  }
  if (value === undefined) {
    const research = await llmClient.streamText({
      step: "discover",
      sessionId,
      system: DISCOVER_RESEARCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: message }],
      ...(tools.length === 0 ? {} : { tools }),
    }).final;
    calls.push(metricsOf(research));
    const shaped = await llmClient.structured({
      step: "discover",
      sessionId,
      system: DISCOVER_SHAPE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `${message}\n\n# Research notes\n\n${research.text}` }],
      schema: DiscoverOutputSchema,
    });
    calls.push(metricsOf(shaped));
    value = shaped.value;
  }

  const validated = validateOutput(value, profile);
  const applied = applyDiscovery(profile, validated.fields);
  return { ...applied, dropped: validated.dropped, calls, strategy };
}

/** One line for logs and the CLI: counts only, never content. */
export function droppedSummary(d: DroppedCounts): string {
  const total = d.fieldsUncited + d.fieldsUnsourced + d.rolesUncited + d.rolesUnsourced + d.fieldsSurplus;
  return (
    `${String(total)} dropped (fields: ${String(d.fieldsUncited)} uncited, ${String(d.fieldsUnsourced)} unsourced, ` +
    `${String(d.fieldsSurplus)} surplus; roles: ${String(d.rolesUncited)} uncited, ${String(d.rolesUnsourced)} unsourced; ` +
    `${String(d.sourcesRemoved)} source URLs removed)`
  );
}
