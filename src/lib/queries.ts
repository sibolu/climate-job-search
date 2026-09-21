/**
 * Query generation and revision (Phase 2.3).
 *
 * `generateQueries` writes searches for ONE field from the roles the person
 * ticked on it (technical-plan.md D40): exactly three, one each for linkedin,
 * indeed and climatebase, every one serving that field only. The person can
 * paste them into a board's search box and follow the static per-board
 * instructions for saving each as an email alert ({@link ALERT_STEPS}). `reviseQueries`
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
 * - Generating for a field replaces its existing untried query on each board
 *   in place (same `Q` id, text swapped, status stays untried); judged
 *   (`good`/`bad`) queries are never touched, and a further untried query on
 *   the same field and board is retired as superseded. A draft whose
 *   `(board, normalized query)` key ({@link queryKey}) repeats a judged query
 *   or another field's untried query is dropped, and because every board must
 *   end up with one query the run then fails with {@link QueriesOutputError}
 *   rather than re-asking the model. Revision dedupes by the same key.
 *   Malformed drafts are never kept silently: every drop is a counter in
 *   {@link QueriesDropped}.
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
  type Role,
  rolesForField,
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
/** The boards a generation run writes exactly one query for each (technical-plan.md D40). */
export const QUERY_BOARDS = ["linkedin", "indeed", "climatebase"] as const;
export type QueryBoard = (typeof QUERY_BOARDS)[number];
/** Revision (D32) still caps additions per board so a run cannot flood the list. */
const MAX_REVISION_ADDS_PER_BOARD = 4;
const MAX_REVISION_ADDS_TOTAL = 12;
/** Fields a revision's added query may serve. */
const FIELDS_IN_PLAY: readonly FieldStatus[] = ["accepted", "unsure"];

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

/** One search for the field being written for; the board is the key it sits under. */
export const FieldQueryDraftSchema = z.object({
  query: z.string(),
  rationale: z.string(),
});
export type FieldQueryDraft = z.infer<typeof FieldQueryDraftSchema>;

/**
 * Exactly one draft per board, enforced by the schema itself: the model
 * cannot return two for one board or none for another (technical-plan.md D40).
 */
export const GenerateOutputSchema = z.object({
  linkedin: FieldQueryDraftSchema,
  indeed: FieldQueryDraftSchema,
  climatebase: FieldQueryDraftSchema,
});
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

const FIELD_QUERY_RULES = `Rules for every query:
- Build it from the ticked roles' titles and the field's domain terms as they appear in the roles, the fit reasoning and the summary; never a bare generic word such as "climate" or "sustainability". The three queries target the same roles and differ only in each board's syntax and how broad that board lets a query be.
- Respect the preferences: seniority words and anything the person has excluded. The person's answer to the field's question, when given, is a hard constraint.
- Never put location or remote/hybrid wording in a query string — no city, state, country or "remote"/"hybrid" terms. Every board filters on those itself, and the alert steps tell the person to set the board's own location and remote filters. Use the stated location and work mode only as context for which employers and role titles are realistic (offshore wind, utilities and manufacturing are regional).
- Learn from the field's existing searches: never repeat a listed query, keep what made a good one good, avoid what made a bad one bad, and improve on an untried one rather than restating it.
- rationale is one sentence naming the role ids and skills the query targets and why those terms were chosen.
- Use nothing about the person beyond what the profile states; invent no personal detail.`;

export const QUERIES_SYSTEM_PROMPT = `You write job-board search queries for one career switcher moving into climate work. You get their preferences, confirmed skills, ONE climate field they are considering (how they marked it, why it fits, what is uncertain), the example roles in that field they ticked, and every search already written for that field. Return JSON with exactly one query for each of linkedin, indeed and climatebase. All three serve this one field only — never a query that reaches across other fields, because a board ranks results against one coherent role profile.

${BOARD_SYNTAX}

${FIELD_QUERY_RULES}`;

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

function fieldsInPlay(p: Profile): Field[] {
  return p.fields.filter((f) => FIELDS_IN_PLAY.includes(f.status));
}

/** How the field's status reads on the card (technical-plan.md D40). */
const MARK_LABEL: Record<FieldStatus, string> = {
  accepted: "Interesting",
  unsure: "Unsure",
  candidate: "not marked yet",
  rejected: "Not for me",
};

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

function renderRole(r: Role, withWhy = false): string {
  const companies = r.companies.length === 0 ? "" : ` (${r.companies.join(", ")})`;
  const why = withWhy && r.why !== "" ? ` — ${r.why}` : "";
  return `  - ${r.id}: ${r.title}${companies}${why}`;
}

function renderFields(p: Profile): string {
  return fieldsInPlay(p)
    .map((f) => {
      const roles = rolesForField(p, f.id).map((r) => renderRole(r));
      return [
        `### ${f.id}: ${f.name} (${f.status})`,
        `- Fit: ${f.fit}`,
        `- Uncertain: ${f.uncertain}`,
        ...(roles.length === 0 ? [] : ["- Roles:", ...roles]),
      ].join("\n");
    })
    .join("\n\n");
}

function renderQueries(p: Profile, queries: readonly Query[] = p.queries): string {
  if (queries.length === 0) return "(none yet)";
  return queries
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

/** The one field, its mark, its ticked roles and its existing searches (technical-plan.md D40). */
function renderFieldForQueries(p: Profile, field: Field, roles: readonly Role[]): string {
  const ask = field.ask;
  const answer = ask === undefined ? undefined : p.preferences.other.find((o) => o.key === ask.key);
  const optional = (label: string, value: string | undefined) =>
    value === undefined || value === "" ? [] : [`- ${label}: ${value}`];
  return [
    `### ${field.id}: ${field.name}`,
    `- Mark: ${MARK_LABEL[field.status]}`,
    ...optional("Sector", field.sector),
    ...optional("Fit level", field.fitLevel),
    ...optional("Summary", field.summary),
    `- Fit: ${field.fit}`,
    `- Uncertain: ${field.uncertain}`,
    ...(ask === undefined || answer === undefined ? [] : [`- Asked "${ask.question}"; the person answered: ${answer.value}`]),
    "- Ticked roles (write for these):",
    ...roles.map((r) => renderRole(r, true)),
  ].join("\n");
}

export function buildGenerateMessage(p: Profile, field: Field, roles: readonly Role[]): string {
  return [
    "# Preferences",
    renderPreferences(p),
    "",
    "# Confirmed skills",
    p.skills.confirmed.length === 0 ? "(none confirmed)" : p.skills.confirmed.join(", "),
    "",
    "# The field to write searches for",
    renderFieldForQueries(p, field, roles),
    "",
    "# Searches already written for this field",
    renderQueries(p, p.queries.filter((q) => q.fieldIds.includes(field.id))),
    "",
    `Write the three searches for ${field.id}.`,
  ].join("\n");
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
  /** Revision drafts beyond the per-board or total cap. */
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

/** Drops malformed, unfielded, duplicate and surplus revision drafts, counting each. */
export function validateDrafts(
  drafts: readonly QueryDraft[],
  profile: Profile,
  dropped: QueriesDropped,
): ValidatedDraft[] {
  const eligible = new Set(fieldsInPlay(profile).map((f) => f.id));
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
    if (onBoard >= MAX_REVISION_ADDS_PER_BOARD || kept.length >= MAX_REVISION_ADDS_TOTAL) {
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

export interface ValidatedFieldDraft {
  board: QueryBoard;
  query: string;
  rationale: string;
}

/**
 * Thrown when the model's answer, once validated, leaves a board without a
 * query. The run fails rather than re-asking the model (one call per turn is
 * the contract; the person just presses the button again). Carries board
 * names and counters only, never model text.
 */
export class QueriesOutputError extends Error {
  constructor(
    readonly missingBoards: readonly QueryBoard[],
    readonly dropped: QueriesDropped,
  ) {
    super(`No usable query came back for ${missingBoards.join(", ")}.`);
    this.name = "QueriesOutputError";
  }
}

/**
 * One validated draft per board, in {@link QUERY_BOARDS} order. A draft is
 * dropped (and counted) when its text is empty or its key repeats a judged
 * query or another field's untried query; any drop is a missing board, so
 * this throws {@link QueriesOutputError}.
 */
export function validateFieldDrafts(
  output: GenerateOutput,
  profile: Profile,
  fieldId: string,
  dropped: QueriesDropped,
): ValidatedFieldDraft[] {
  const kept: ValidatedFieldDraft[] = [];
  const missing: QueryBoard[] = [];
  for (const board of QUERY_BOARDS) {
    const d = output[board];
    const query = normalizeQueryText(d.query);
    if (query === "") {
      dropped.emptyQuery += 1;
      missing.push(board);
      continue;
    }
    const key = queryKey(board, query);
    const clash = profile.queries.find((q) => queryKey(q.board, q.query) === key);
    if (clash !== undefined && clash.status !== "untried") {
      dropped.judgedQueries += 1;
      missing.push(board);
      continue;
    }
    if (clash !== undefined && !clash.fieldIds.includes(fieldId)) {
      dropped.duplicate += 1;
      missing.push(board);
      continue;
    }
    kept.push({ board, query, rationale: d.rationale.trim() });
  }
  if (missing.length > 0) throw new QueriesOutputError(missing, dropped);
  return kept;
}

export interface ApplyFieldDraftsResult extends ApplyDraftsResult {
  /** Further untried queries on the same field and board, retired as superseded. */
  superseded: string[];
}

/**
 * Writes one query per board for `fieldId`: the field's first untried,
 * unretired query on that board is replaced in place (id kept), any other
 * untried one on that board is retired as superseded, and a board with none
 * gets a new id. Judged queries are never touched.
 */
export function applyFieldDrafts(
  profile: Profile,
  fieldId: string,
  drafts: readonly ValidatedFieldDraft[],
): ApplyFieldDraftsResult {
  let next = profile;
  const added: Query[] = [];
  const updated: Query[] = [];
  const superseded: string[] = [];
  for (const d of drafts) {
    const untried = next.queries.filter(
      (q) => q.board === d.board && q.fieldIds.includes(fieldId) && q.status === "untried" && !isRetired(q),
    );
    const [existing, ...rest] = untried;
    const extra = { ...(existing?.extra ?? {}) };
    delete extra[RETIRED_KEY];
    delete extra[RETIRED_REASON_KEY];
    delete extra[BOARD_NAME_KEY];
    if (d.rationale === "") delete extra[WHY_KEY];
    else extra[WHY_KEY] = d.rationale;
    next = upsertQuery(next, {
      ...(existing === undefined ? {} : { id: existing.id }),
      board: d.board,
      query: d.query,
      fieldIds: [fieldId],
      status: "untried",
      reason: "",
      extra,
    });
    const written = existing === undefined ? next.queries.at(-1) : next.queries.find((q) => q.id === existing.id);
    if (written === undefined) continue; // unreachable: upsertQuery always writes
    (existing === undefined ? added : updated).push(written);
    for (const stale of rest) {
      next = upsertQuery(next, {
        ...stale,
        extra: { ...stale.extra, [RETIRED_KEY]: "yes", [RETIRED_REASON_KEY]: `Superseded by ${written.id}` },
      });
      superseded.push(stale.id);
    }
  }
  return { profile: next, added, updated, superseded };
}

/** Upserts revision drafts by `(board, normalized query)`; never touches a judged query. */
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
  /** The one field to write for; must be in play and have a ticked role. */
  fieldId: string;
}

export interface GenerateQueriesResult extends ApplyFieldDraftsResult {
  dropped: QueriesDropped;
  metrics: CallMetrics;
}

export interface ReviseQueriesRequest {
  sessionId: string;
  profile: Profile;
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

/** One field, its ticked roles, skills and preferences → one query per board in the profile (technical-plan.md D40). */
export async function generateQueries(
  { sessionId, profile, fieldId }: GenerateQueriesRequest,
  options: QueriesOptions = {},
): Promise<GenerateQueriesResult> {
  const field = profile.fields.find((f) => f.id === fieldId);
  if (field === undefined) throw new QueriesInputError(`No field with id ${fieldId} in the profile.`);
  if (field.status === "rejected") {
    throw new QueriesInputError(`${field.id} is marked "Not for me"; searches are written only for fields still in play.`);
  }
  const roles = rolesForField(profile, fieldId, true);
  if (roles.length === 0) {
    throw new QueriesInputError(`Tick at least one role under ${field.name} before writing searches for it.`);
  }
  const llmClient = await resolveLlm(options);
  const result = await llmClient.structured({
    step: "queries",
    sessionId,
    system: QUERIES_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildGenerateMessage(profile, field, roles) }],
    schema: GenerateOutputSchema,
  });
  const dropped = zeroDropped();
  const drafts = validateFieldDrafts(result.value, profile, fieldId, dropped);
  const applied = applyFieldDrafts(profile, fieldId, drafts);
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
