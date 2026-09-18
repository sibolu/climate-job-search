/**
 * Query generation and revision (Phase 2.3).
 *
 * `generateQueries` turns the profile's accepted and unsure fields, the roles
 * in them, the confirmed skills and the preferences into searches the user
 * can paste into a board's search box, plus static per-board instructions for
 * saving each search as an email alert ({@link ALERT_STEPS}). `reviseQueries`
 * takes one piece of "Tried it" feedback and returns updated queries, field
 * status changes, profile edits and a one-paragraph explanation for the chat.
 *
 * Rules this module enforces:
 * - Every model call goes through `src/lib/llm.ts` (`structured`, no web
 *   tools). This module fetches nothing; the boards are never contacted, and
 *   telling the user where to search is not scraping.
 * - IDs are stable: a query is never deleted or renumbered. A revision may
 *   retire only an `untried` query, by setting `extra["Retired"] = "yes"` and
 *   `extra["Retired reason"]`; it never rewrites a `good`/`bad` status, which
 *   is the user speaking. A `narrow` rewrites an untried, unretired query in
 *   place; a narrow aimed at a judged query becomes an `add` on the same
 *   board and fields under a new id, so the judged query keeps its record.
 * - Dedupe key is `(board, normalized query)` ({@link queryKey}). Generating
 *   again upserts onto an existing untried query with that key (and clears its
 *   retired mark) instead of duplicating; a key matching a judged query is
 *   dropped and counted. Malformed drafts are never kept silently: every drop
 *   is a counter in {@link QueriesDropped}.
 * - Field statuses: the model may move `candidate`/`unsure` freely; it may
 *   move `accepted` only to `unsure`, and only for a field the feedback's
 *   query serves; `rejected` is never touched. The model's reason lands in
 *   the field's `extra["Status note"]`.
 * - The user's verdict is applied first ({@link applyFeedback}), before the
 *   model runs, so it lands even if the call fails; the UI can call it too.
 */

import { z } from "zod";

import type { CallMetrics, Llm } from "./llm";
import {
  type Board,
  BoardSchema,
  type Field,
  type FieldStatus,
  FieldStatusSchema,
  type Profile,
  type Query,
  setFieldStatus,
  setPreference,
  setQueryStatus,
  setSessionNotes,
  upsertField,
  upsertQuery,
} from "./profile";
import type { QueryFeedback } from "./session";
import { ALERT_STEPS, BOARD_NAME_KEY, RETIRED_KEY, RETIRED_REASON_KEY } from "./boards";

/** Re-exported for callers of this module; `boards.ts` is the client-safe owner. */
export { ALERT_STEPS, BOARD_NAME_KEY, RETIRED_KEY, RETIRED_REASON_KEY };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BOARDS: readonly Board[] = BoardSchema.options;
export const MIN_QUERIES_PER_BOARD = 2;
export const MAX_QUERIES_PER_BOARD = 4;
export const MAX_QUERIES_TOTAL = 12;
/** Fields a query may serve. */
export const ELIGIBLE_FIELD_STATUSES: readonly FieldStatus[] = ["accepted", "unsure"];

/** `extra` keys this module writes on queries and fields. */
export const WHY_KEY = "Rationale";
export const STATUS_NOTE_KEY = "Status note";

// ---------------------------------------------------------------------------
// Output schemas (passed to `structured`)
// ---------------------------------------------------------------------------

export const QueryDraftSchema = z.object({
  board: BoardSchema,
  query: z.string(),
  fieldIds: z.array(z.string()),
  /** Required when `board` is "other"; null otherwise. */
  boardName: z.string().nullable(),
  rationale: z.string(),
});
export type QueryDraft = z.infer<typeof QueryDraftSchema>;

export const GenerateOutputSchema = z.object({ queries: z.array(QueryDraftSchema) });
export type GenerateOutput = z.infer<typeof GenerateOutputSchema>;

export const PreferenceEditKeySchema = z.enum(["location", "workMode", "seniority", "retrainingAppetite"]);

export const ReviseOutputSchema = z.object({
  explanation: z.string(),
  retire: z.array(z.object({ id: z.string(), reason: z.string() })),
  add: z.array(QueryDraftSchema),
  narrow: z.array(z.object({ id: z.string(), query: z.string() })),
  fieldStatus: z.array(z.object({ id: z.string(), status: FieldStatusSchema, reason: z.string() })),
  notes: z.string().nullable(),
  preferenceEdits: z.array(z.object({ key: PreferenceEditKeySchema, value: z.string() })),
});
export type ReviseOutput = z.infer<typeof ReviseOutputSchema>;

// ---------------------------------------------------------------------------
// Prompts (byte-stable: sent as cached blocks)
// ---------------------------------------------------------------------------

const BOARD_SYNTAX = `Boards and their syntax. Every query must paste straight into that board's search box:
- linkedin: LinkedIn Jobs search supports AND, OR, NOT, parentheses and double quotes for exact phrases. Use them; stay under about 200 characters.
- indeed: Indeed supports double quotes for phrases, a leading - to exclude a word, and lowercase "or" between alternatives; adjacent terms are ANDed and there is no AND keyword. Keep parentheses to one level.
- climatebase: keyword-only; no boolean operators or quotes. Give 2-4 plain keywords and let the site's filters narrow.
- other: a named board or careers page (a company or association careers page, Google Jobs, a niche board). Put the board's name in boardName and write the query in that site's syntax, plain keywords unless you know its operators.`;

const QUERY_RULES = `Rules for every query:
- fieldIds lists only ids from the Fields section, and every query serves at least one. Prefer role titles and domain terms that appear in the roles and fit reasoning; never a bare generic word such as "climate" or "sustainability".
- Respect the preferences: seniority words and anything the person has excluded.
- Never put location or remote/hybrid wording in a query string — no city, state, country or "remote"/"hybrid" terms. Every board filters on those itself, and the alert steps tell the person to set the board's own location and remote filters. Use the stated location and work mode only as context for which fields, employers and role titles are realistic (offshore wind, utilities and manufacturing are regional).
- Learn from tried queries: never repeat a listed query, keep what made a good query good, avoid what made a bad one bad.
- rationale is one sentence naming the field ids and skills the query targets and why those terms were chosen.
- Use nothing about the person beyond what the profile states; invent no personal detail.`;

export const QUERIES_SYSTEM_PROMPT = `You write job-board search queries for one career switcher moving into climate work. You get their preferences, confirmed skills, the climate fields they have accepted or are unsure about, the example roles in those fields, and any queries already tried. You return JSON with 2-4 queries for each board you use and at most 12 in total; use linkedin, indeed and climatebase, and add "other" boards only when a specific careers page or niche board clearly fits.

${BOARD_SYNTAX}

${QUERY_RULES}`;

export const REVISE_SYSTEM_PROMPT = `You revise job-board search queries for one career switcher moving into climate work. You get their preferences, confirmed skills, the fields they have accepted or are unsure about, the example roles, every query with its status, and one piece of feedback the person just gave on one query: a verdict (good or bad) and a reason in their own words. The verdict is already recorded on that query; never change that query and never rewrite any query the person has judged. Return JSON:
- explanation: one paragraph for the chat. Quote or closely paraphrase the person's reason, name exactly which query ids you retired or narrowed and why, describe each added query by its board and terms (added queries get their ids later; never invent ids), and mention any field status change or note.
- retire: untried query ids the reason also invalidates (same field, same problem), each with a reason.
- narrow: untried query ids rewritten in place to sidestep the problem, with the full new query text in that board's syntax.
- add: replacement or sibling queries, same draft shape as generation.
- fieldStatus: only when the reason is about a field itself, such as a hard requirement (license, degree, clearance) the person lacks or will not pursue. You may move candidate or unsure fields, and move an accepted field the query serves to unsure. Never reject an accepted field; the person decides that.
- notes: one short line for the session notes, or null.
- preferenceEdits: only when the reason states a preference about location, work mode, seniority or retraining appetite.
For a good verdict retire nothing and, at most, add one or two sibling queries on other boards for the same fields.

${BOARD_SYNTAX}

${QUERY_RULES}`;

// ---------------------------------------------------------------------------
// Rendering the profile for the model
// ---------------------------------------------------------------------------

export function eligibleFields(p: Profile): Field[] {
  return p.fields.filter((f) => ELIGIBLE_FIELD_STATUSES.includes(f.status));
}

function renderPreferences(p: Profile): string {
  const pr = p.preferences;
  const text = (v: { value: string } | undefined) => v?.value ?? "(not stated)";
  return [
    `- Location (context for what is realistic; never a query term): ${text(pr.location)}`,
    `- Work mode (context for what is realistic; never a query term): ${text(pr.workMode)}`,
    `- Seniority: ${text(pr.seniority)}`,
    `- Retraining appetite: ${text(pr.retrainingAppetite)}`,
    `- Climate interests: ${pr.climateInterests?.values.join(", ") ?? "(not stated)"}`,
    ...pr.other.map((o) => `- ${o.key}: ${o.value}`),
  ].join("\n");
}

function renderFields(p: Profile): string {
  return eligibleFields(p)
    .map((f) => {
      const roles = p.roles
        .filter((r) => r.fieldId === f.id)
        .map((r) => `  - ${r.id}: ${r.title}${r.companies.length === 0 ? "" : ` (${r.companies.join(", ")})`}`);
      return [
        `### ${f.id}: ${f.name} (${f.status})`,
        `- Fit: ${f.fit}`,
        `- Uncertain: ${f.uncertain}`,
        ...(roles.length === 0 ? [] : ["- Roles:", ...roles]),
      ].join("\n");
    })
    .join("\n\n");
}

function renderQueries(p: Profile): string {
  if (p.queries.length === 0) return "(none yet)";
  return p.queries
    .map((q) => {
      const name = q.extra[BOARD_NAME_KEY] === undefined ? q.board : `${q.board}: ${q.extra[BOARD_NAME_KEY]}`;
      const retired = q.extra[RETIRED_KEY] === "yes" ? `; retired: ${q.extra[RETIRED_REASON_KEY] ?? ""}` : "";
      const reason = q.reason === "" ? "" : `; reason: ${q.reason}`;
      return `- ${q.id} [${name}] fields ${q.fieldIds.join(", ")}; status ${q.status}${reason}${retired}\n  ${q.query}`;
    })
    .join("\n");
}

function renderProfileContext(p: Profile): string {
  return [
    "# Preferences",
    renderPreferences(p),
    "",
    "# Confirmed skills",
    p.skills.confirmed.length === 0 ? "(none confirmed)" : p.skills.confirmed.join(", "),
    "",
    "# Fields (accepted or unsure) and their roles",
    renderFields(p),
    "",
    "# Queries so far",
    renderQueries(p),
  ].join("\n");
}

export function buildGenerateMessage(p: Profile): string {
  return `${renderProfileContext(p)}\n\nWrite the queries.`;
}

export function buildReviseMessage(p: Profile, feedback: QueryFeedback): string {
  const q = p.queries.find((x) => x.id === feedback.queryId);
  const about = q === undefined ? feedback.queryId : `${q.id} [${q.board}] fields ${q.fieldIds.join(", ")}\n  ${q.query}`;
  return [
    renderProfileContext(p),
    "",
    "# Feedback just given",
    `- Query: ${about}`,
    `- Verdict: ${feedback.verdict}`,
    `- Reason (the person's own words): ${feedback.reason}`,
    "",
    "Revise the queries.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Validation and apply-back
// ---------------------------------------------------------------------------

export interface QueriesDropped {
  /** Drafts with an empty query text. */
  emptyQuery: number;
  /** Drafts whose fieldIds named no accepted/unsure field. */
  unfielded: number;
  /** "other" drafts without a board name. */
  unnamedBoard: number;
  /** Drafts repeating an earlier draft's `(board, normalized query)` key. */
  duplicate: number;
  /** Drafts beyond the per-board or total cap. */
  surplus: number;
  /** Drafts or edits aimed at a query the user has already judged good/bad. */
  judgedQueries: number;
  /** Retire/narrow entries naming a query id not in the profile. */
  unknownQueryIds: number;
  /** Field ids not in the profile (in drafts, counted per id; in fieldStatus, per entry). */
  unknownFieldIds: number;
  /** fieldStatus entries refused by the status rule in the module header. */
  fieldsProtected: number;
}

export function zeroDropped(): QueriesDropped {
  return {
    emptyQuery: 0,
    unfielded: 0,
    unnamedBoard: 0,
    duplicate: 0,
    surplus: 0,
    judgedQueries: 0,
    unknownQueryIds: 0,
    unknownFieldIds: 0,
    fieldsProtected: 0,
  };
}

/** One line for logs and the CLI: counts only, never content. */
export function droppedSummary(d: QueriesDropped): string {
  return Object.entries(d)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

export function normalizeQueryText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Dedupe key: board plus case- and whitespace-insensitive query text. */
export function queryKey(board: Board, query: string): string {
  return `${board} ${normalizeQueryText(query).toLowerCase()}`;
}

export interface ValidatedDraft {
  board: Board;
  query: string;
  fieldIds: string[];
  boardName: string | null;
  rationale: string;
}

/** Drops malformed, unfielded, duplicate and surplus drafts, counting each. */
export function validateDrafts(
  drafts: readonly QueryDraft[],
  profile: Profile,
  dropped: QueriesDropped,
): ValidatedDraft[] {
  const eligible = new Set(eligibleFields(profile).map((f) => f.id));
  const inProfile = new Set(profile.fields.map((f) => f.id));
  const seen = new Set<string>();
  const perBoard = new Map<Board, number>();
  const kept: ValidatedDraft[] = [];
  for (const d of drafts) {
    const query = normalizeQueryText(d.query);
    if (query === "") {
      dropped.emptyQuery += 1;
      continue;
    }
    const fieldIds = [...new Set(d.fieldIds.map((id) => id.trim()))];
    // Ids of ineligible (candidate/rejected) fields are filtered silently; unknown ids are counted.
    const known = fieldIds.filter((id) => eligible.has(id));
    dropped.unknownFieldIds += fieldIds.filter((id) => !inProfile.has(id)).length;
    if (known.length === 0) {
      dropped.unfielded += 1;
      continue;
    }
    const boardName = d.boardName?.trim() ?? "";
    if (d.board === "other" && boardName === "") {
      dropped.unnamedBoard += 1;
      continue;
    }
    const key = queryKey(d.board, query);
    if (seen.has(key)) {
      dropped.duplicate += 1;
      continue;
    }
    const onBoard = perBoard.get(d.board) ?? 0;
    if (onBoard >= MAX_QUERIES_PER_BOARD || kept.length >= MAX_QUERIES_TOTAL) {
      dropped.surplus += 1;
      continue;
    }
    seen.add(key);
    perBoard.set(d.board, onBoard + 1);
    kept.push({
      board: d.board,
      query,
      fieldIds: known,
      boardName: d.board === "other" ? boardName : null,
      rationale: d.rationale.trim(),
    });
  }
  return kept;
}

export interface ApplyDraftsResult {
  profile: Profile;
  /** Queries created this run, in draft order. */
  added: Query[];
  /** Existing untried queries refreshed by key match, in draft order. */
  updated: Query[];
}

/** Upserts drafts by `(board, normalized query)`; never touches a judged query. */
export function applyDrafts(
  profile: Profile,
  drafts: readonly ValidatedDraft[],
  dropped: QueriesDropped,
): ApplyDraftsResult {
  let next = profile;
  const added: Query[] = [];
  const updated: Query[] = [];
  for (const d of drafts) {
    const key = queryKey(d.board, d.query);
    const existing = next.queries.find((q) => queryKey(q.board, q.query) === key);
    if (existing !== undefined && existing.status !== "untried") {
      dropped.judgedQueries += 1;
      continue;
    }
    const extra = { ...(existing?.extra ?? {}) };
    delete extra[RETIRED_KEY];
    delete extra[RETIRED_REASON_KEY];
    if (d.rationale === "") delete extra[WHY_KEY];
    else extra[WHY_KEY] = d.rationale;
    if (d.boardName === null) delete extra[BOARD_NAME_KEY];
    else extra[BOARD_NAME_KEY] = d.boardName;
    next = upsertQuery(next, {
      ...(existing === undefined ? {} : { id: existing.id }),
      board: d.board,
      query: d.query,
      fieldIds: d.fieldIds,
      status: "untried",
      reason: "",
      extra,
    });
    const written = existing === undefined ? next.queries.at(-1) : next.queries.find((q) => q.id === existing.id);
    if (written === undefined) continue; // unreachable: upsertQuery always writes
    (existing === undefined ? added : updated).push(written);
  }
  return { profile: next, added, updated };
}

export interface FieldChange {
  id: string;
  from: FieldStatus;
  to: FieldStatus;
}

function isRetired(q: Query): boolean {
  return q.extra[RETIRED_KEY] === "yes";
}

/** Applies the model's field status changes under the rule in the module header. */
function applyFieldChanges(
  profile: Profile,
  changes: ReviseOutput["fieldStatus"],
  servedByFeedback: ReadonlySet<string>,
  dropped: QueriesDropped,
): { profile: Profile; fieldChanges: FieldChange[] } {
  let next = profile;
  const fieldChanges: FieldChange[] = [];
  for (const c of changes) {
    const field = next.fields.find((f) => f.id === c.id.trim());
    if (field === undefined) {
      dropped.unknownFieldIds += 1;
      continue;
    }
    if (field.status === c.status) continue;
    const allowed =
      field.status === "candidate" ||
      field.status === "unsure" ||
      (field.status === "accepted" && c.status === "unsure" && servedByFeedback.has(field.id));
    if (!allowed) {
      dropped.fieldsProtected += 1;
      continue;
    }
    next = setFieldStatus(next, field.id, c.status);
    const reason = c.reason.trim();
    if (reason !== "") {
      const current = next.fields.find((f) => f.id === field.id) ?? field;
      next = upsertField(next, { ...current, extra: { ...current.extra, [STATUS_NOTE_KEY]: reason } });
    }
    fieldChanges.push({ id: field.id, from: field.status, to: c.status });
  }
  return { profile: next, fieldChanges };
}

export interface ApplyRevisionResult {
  profile: Profile;
  explanation: string;
  /** Untried query ids marked retired this run. */
  retired: string[];
  added: Query[];
  /** Untried query ids rewritten in place. */
  narrowed: string[];
  fieldChanges: FieldChange[];
  dropped: QueriesDropped;
}

/**
 * Applies a revision to a profile on which {@link applyFeedback} has already
 * run. Order: retire, narrow, add, field statuses, notes, preferences.
 */
export function applyRevision(
  profile: Profile,
  output: ReviseOutput,
  feedback: QueryFeedback,
  dropped: QueriesDropped = zeroDropped(),
): ApplyRevisionResult {
  let next = profile;
  const retired: string[] = [];
  const narrowed: string[] = [];
  const extraDrafts: QueryDraft[] = [];

  for (const r of output.retire) {
    const q = next.queries.find((x) => x.id === r.id.trim());
    if (q === undefined) {
      dropped.unknownQueryIds += 1;
      continue;
    }
    if (q.id === feedback.queryId) continue; // the verdict already covers it
    if (q.status !== "untried") {
      dropped.judgedQueries += 1;
      continue;
    }
    if (isRetired(q)) continue;
    next = upsertQuery(next, {
      ...q,
      extra: { ...q.extra, [RETIRED_KEY]: "yes", [RETIRED_REASON_KEY]: r.reason.trim() },
    });
    retired.push(q.id);
  }

  for (const n of output.narrow) {
    const q = next.queries.find((x) => x.id === n.id.trim());
    if (q === undefined) {
      dropped.unknownQueryIds += 1;
      continue;
    }
    const query = normalizeQueryText(n.query);
    if (query === "") {
      dropped.emptyQuery += 1;
      continue;
    }
    if (q.status !== "untried" || isRetired(q)) {
      // A judged (or retired) query keeps its record; the rewrite becomes an add.
      extraDrafts.push({
        board: q.board,
        query,
        fieldIds: q.fieldIds,
        boardName: q.extra[BOARD_NAME_KEY] ?? null,
        rationale: `Narrowed from ${q.id}`,
      });
      continue;
    }
    const key = queryKey(q.board, query);
    if (next.queries.some((x) => x.id !== q.id && queryKey(x.board, x.query) === key)) {
      dropped.duplicate += 1;
      continue;
    }
    next = upsertQuery(next, { ...q, query });
    narrowed.push(q.id);
  }

  const drafts = validateDrafts([...extraDrafts, ...output.add], next, dropped);
  const applied = applyDrafts(next, drafts, dropped);
  next = applied.profile;

  const feedbackQuery = next.queries.find((q) => q.id === feedback.queryId);
  const served = new Set(feedbackQuery?.fieldIds ?? []);
  const fields = applyFieldChanges(next, output.fieldStatus, served, dropped);
  next = fields.profile;

  const notes = output.notes?.trim() ?? "";
  if (notes !== "") {
    const current = next.sessionNotes.trim();
    next = setSessionNotes(next, current === "" ? notes : `${current}\n\n${notes}`);
  }
  for (const e of output.preferenceEdits) {
    if (e.value.trim() === "") continue;
    next = setPreference(next, e.key, e.value, "inferred");
  }

  return {
    profile: next,
    explanation: output.explanation.trim(),
    retired,
    added: applied.added,
    narrowed,
    fieldChanges: fields.fieldChanges,
    dropped,
  };
}

// ---------------------------------------------------------------------------
// The calls
// ---------------------------------------------------------------------------

export class QueriesInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueriesInputError";
  }
}

export interface QueriesOptions {
  llm?: Llm;
  /** ISO date stamped on the feedback's query; defaults to today. */
  changedAt?: string;
}

export interface GenerateQueriesRequest {
  sessionId: string;
  profile: Profile;
}

export interface GenerateQueriesResult extends ApplyDraftsResult {
  dropped: QueriesDropped;
  metrics: CallMetrics;
}

export interface ReviseQueriesRequest extends GenerateQueriesRequest {
  feedback: QueryFeedback;
}

export interface ReviseQueriesResult extends ApplyRevisionResult {
  metrics: CallMetrics;
}

function metricsOf({ usage, costUsd, durationMs, continuations, stopReason }: CallMetrics): CallMetrics {
  return { usage, costUsd, durationMs, continuations, stopReason };
}

async function resolveLlm(options: QueriesOptions): Promise<Llm> {
  return options.llm ?? (await import("./llm")).llm();
}

/** Accepted/unsure fields, roles, skills and preferences → per-board queries in the profile. */
export async function generateQueries(
  { sessionId, profile }: GenerateQueriesRequest,
  options: QueriesOptions = {},
): Promise<GenerateQueriesResult> {
  if (eligibleFields(profile).length === 0) {
    throw new QueriesInputError("The profile has no accepted or unsure fields to write queries for.");
  }
  const llmClient = await resolveLlm(options);
  const result = await llmClient.structured({
    step: "queries",
    sessionId,
    system: QUERIES_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildGenerateMessage(profile) }],
    schema: GenerateOutputSchema,
  });
  const dropped = zeroDropped();
  const drafts = validateDrafts(result.value.queries, profile, dropped);
  const applied = applyDrafts(profile, drafts, dropped);
  return { ...applied, dropped, metrics: metricsOf(result) };
}

/**
 * Records the user's verdict on a query. Pure; the UI may call it directly
 * and persist the result before (or without) `reviseQueries`.
 */
export function applyFeedback(profile: Profile, feedback: QueryFeedback, changedAt?: string): Profile {
  if (!profile.queries.some((q) => q.id === feedback.queryId)) {
    throw new QueriesInputError(`No query with id ${feedback.queryId} in the profile.`);
  }
  return setQueryStatus(profile, feedback.queryId, feedback.verdict, feedback.reason, changedAt);
}

/** One piece of feedback → verdict recorded, then the model's revision applied. */
export async function reviseQueries(
  { sessionId, profile, feedback }: ReviseQueriesRequest,
  options: QueriesOptions = {},
): Promise<ReviseQueriesResult> {
  const withFeedback = applyFeedback(profile, feedback, options.changedAt);
  const llmClient = await resolveLlm(options);
  const result = await llmClient.structured({
    step: "revise",
    sessionId,
    system: REVISE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildReviseMessage(withFeedback, feedback) }],
    schema: ReviseOutputSchema,
  });
  const applied = applyRevision(withFeedback, result.value, feedback);
  return { ...applied, metrics: metricsOf(result) };
}
