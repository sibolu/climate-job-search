/**
 * `screens.ts` — the pure, React-free state logic behind the exploration-first
 * shell (technical-plan.md D37, D38). Everything here is a function of the
 * parsed profile plus a little turn state, so it is unit tested directly and
 * the components in `src/components/shell/` stay presentational.
 *
 * Browser-safe: it imports `profile.ts`, `elicit.ts`, `boards.ts` and
 * `workspace.ts` only — tables and pure helpers, no model call.
 */

import type { AnswerPill } from "./session";
import {
  ELICIT_ORDER,
  PREFERENCE_LABELS,
  QUESTIONS,
  isOpenToSuggestions,
  pillsFor,
} from "./elicit";
import type { Board, Field, PreferenceKey, Profile, Query, Role } from "./profile";
import { activeCards, rolesForField } from "./profile";
import { isRetiredQuery } from "./boards";
import { MAX_FEEDBACK_REASON } from "./workspace";

// ---------------------------------------------------------------------------
// Screens and the header nav
// ---------------------------------------------------------------------------

/** Every main panel the beta shell can render. */
export type Screen = "firstRun" | "highlights" | "pending" | "board" | "searches" | "feedback";

/** The three header steps. */
export type NavStep = "highlights" | "fields" | "searches";

/**
 * Which of the post-discovery panels the person navigated to. The screen is
 * otherwise derived, so this is the only piece of navigation the shell keeps.
 */
export type View = "board" | "searches" | "feedback";

export const NAV_STEPS: readonly NavStep[] = ["highlights", "fields", "searches"];

export const NAV_LABELS: Record<NavStep, string> = {
  highlights: "1 Highlights",
  fields: "2 Fields",
  searches: "3 Searches",
};

export interface ScreenInput {
  /** Any card at all on the profile, excluded ones included. */
  hasCards: boolean;
  /** Any field on the profile: discovery has landed at least once. */
  hasFields: boolean;
  /** A turn is in flight. */
  busy: boolean;
  /** Any query at all on the profile, retired ones included. */
  hasQueries?: boolean;
  /** The panel the person navigated to; `board` when they have not moved. */
  view?: View;
}

/**
 * Which main panel renders. One turn is in flight at a time (D38), so a busy
 * shell always shows the pending screen — except on the very first run, where
 * there is nothing behind it yet and the paste screen keeps its own spinner.
 */
export function currentScreen({ hasCards, hasFields, busy, view }: ScreenInput): Screen {
  if (busy) return hasCards ? "pending" : "firstRun";
  if (!hasCards) return "firstRun";
  if (!hasFields) return "highlights";
  return view ?? "board";
}

/** The header step highlighted for a screen. */
export function navStepFor(screen: Screen): NavStep {
  if (screen === "searches" || screen === "feedback") return "searches";
  return screen === "board" || screen === "pending" ? "fields" : "highlights";
}

/** Steps ahead of what the person has reached are disabled. */
export function navStepEnabled(step: NavStep, input: ScreenInput): boolean {
  if (step === "highlights") return input.hasCards;
  if (step === "fields") return input.hasFields;
  return input.hasQueries === true;
}

/** The nav is hidden entirely on first run (handoff, Shell). */
export function showNav(screen: Screen): boolean {
  return screen !== "firstRun";
}

/** The rail is absent on first run and present everywhere else (D42). */
export function showRail(screen: Screen): boolean {
  return screen !== "firstRun";
}

// ---------------------------------------------------------------------------
// The first-run text (D39)
// ---------------------------------------------------------------------------

export const NOTES_LABEL = "Notes:";

/**
 * The cards turn's input. The optional notes box is appended under a `Notes:`
 * label so the cards step can read constraints from it; an empty notes box
 * omits the whole block (technical-plan.md D39).
 */
export function composeStartText(pasted: string, notes: string): string {
  const body = pasted.trim();
  const extra = notes.trim();
  if (extra === "") return body;
  return `${body}\n\n${NOTES_LABEL}\n${extra}`;
}

// ---------------------------------------------------------------------------
// The three preference questions (D38)
// ---------------------------------------------------------------------------

/** True when this preference already has a value on the profile. */
export function hasPreference(p: Profile, key: PreferenceKey): boolean {
  if (key === "climateInterests") {
    return (p.preferences.climateInterests?.values.length ?? 0) > 0;
  }
  return (p.preferences[key]?.value.trim() ?? "") !== "";
}

/** The `ELICIT_ORDER` keys still unanswered, in order. */
export function remainingQuestions(p: Profile): PreferenceKey[] {
  return ELICIT_ORDER.filter((key) => !hasPreference(p, key));
}

export interface QuestionView {
  key: PreferenceKey;
  label: string;
  question: string;
  pills: AnswerPill[];
}

export interface QuestionContext {
  /** Sector groups from the server's own pills, when the cards turn sent any. */
  sectorGroups?: readonly string[];
  /** A key the person re-opened through "Change an answer". */
  override?: PreferenceKey;
}

/**
 * The question the rail shows: the overridden one when the person picked a
 * row from "Change an answer", else the first unanswered key. `undefined`
 * once all three are answered and nothing is being changed.
 */
export function activeQuestion(p: Profile, ctx: QuestionContext = {}): QuestionView | undefined {
  const key = ctx.override ?? remainingQuestions(p)[0];
  if (key === undefined) return undefined;
  return {
    key,
    label: PREFERENCE_LABELS[key],
    question: QUESTIONS[key],
    pills: pillsFor(key, { sectorGroups: ctx.sectorGroups ?? [] }),
  };
}

export interface AnswerRow {
  key: PreferenceKey;
  label: string;
  /** Empty string when the preference is not answered yet. */
  value: string;
}

/** The "Change an answer" rows: all three keys with their current values. */
export function answerRows(p: Profile): AnswerRow[] {
  return ELICIT_ORDER.map((key) => ({
    key,
    label: PREFERENCE_LABELS[key],
    value: preferenceText(p, key),
  }));
}

/** One preference rendered for display; empty when unset. */
export function preferenceText(p: Profile, key: PreferenceKey): string {
  if (key === "climateInterests") {
    const values = p.preferences.climateInterests?.values ?? [];
    if (values.length === 0) return "";
    return isOpenToSuggestions(p) ? "open to suggestions" : values.join(", ");
  }
  return p.preferences[key]?.value.trim() ?? "";
}

// ---------------------------------------------------------------------------
// "Match fields"
// ---------------------------------------------------------------------------

export interface MatchGate {
  enabled: boolean;
  /** One line saying why not, or why it is safe to run. */
  note: string;
}

/**
 * Discovery never auto-starts (D38): the person excludes highlights first,
 * and the turn costs about $0.50.
 */
export function matchFieldsGate(p: Profile): MatchGate {
  if (activeCards(p).length === 0) {
    return { enabled: false, note: "Include at least one highlight to match on." };
  }
  const remaining = remainingQuestions(p);
  if (remaining.length > 0) {
    const labels = remaining.map((key) => PREFERENCE_LABELS[key].toLowerCase()).join(", ");
    return { enabled: false, note: `Answer ${labels} in the assistant rail first.` };
  }
  return { enabled: true, note: "About a minute. Nothing else to do while it runs." };
}

// ---------------------------------------------------------------------------
// The pending log
// ---------------------------------------------------------------------------

export interface LogLine {
  /** Elapsed time when the line arrived, `m:ss`. */
  time: string;
  text: string;
}

/** How many log lines the rail keeps; older ones fall off the top. */
export const MAX_LOG_LINES = 60;

/** `134_000` → `2:14`. Negative and non-finite input clamp to `0:00`. */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Folds one server `delta` into the log. Deltas arrive as chunks, so text is
 * split on newlines and blank chunks are dropped; a chunk identical to the
 * last line is ignored rather than repeated.
 */
export function appendLogLines(lines: readonly LogLine[], text: string, elapsedMs: number): LogLine[] {
  const time = formatElapsed(elapsedMs);
  const next = [...lines];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (next.length > 0 && next[next.length - 1].text === line) continue;
    next.push({ time, text: line });
  }
  return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
}

// ---------------------------------------------------------------------------
// Pre-turn snapshot (accept / keep the old one)
// ---------------------------------------------------------------------------

export interface TurnSnapshot {
  /** The profile text as it stood before the turn was sent. */
  profileMd: string;
  /** Wall-clock start, for the elapsed counter. */
  startedAt: number;
}

/** Taken before a turn goes out so "Keep the old one" can restore it (D38). */
export function takeSnapshot(profileMd: string, now: number): TurnSnapshot {
  return { profileMd, startedAt: now };
}

/** Restores a snapshot: the profile text that was in place before the turn. */
export function restoreSnapshot(snapshot: TurnSnapshot): string {
  return snapshot.profileMd;
}

// ---------------------------------------------------------------------------
// Ordering: the board snapshot and the search groups (D39, D40)
// ---------------------------------------------------------------------------

/**
 * Interesting first, then Unsure, then unmarked, then Not for me. The board
 * resolves this **on arrival only** (D39) so cards never jump out from under
 * a cursor that is mid-mark; the Searches screen uses the same weights.
 */
const STATUS_WEIGHT: Record<string, number> = {
  accepted: 0,
  unsure: 1,
  candidate: 2,
  rejected: 3,
};

function statusWeight(field: Field): number {
  return STATUS_WEIGHT[field.status] ?? 2;
}

/**
 * The field ids in board order. Discovery writes the fields already ranked,
 * so the sort is stable within a status band and never renumbers anything.
 */
export function boardOrder(p: Profile): string[] {
  return p.fields
    .map((field, index) => ({ field, index }))
    .sort((a, b) => statusWeight(a.field) - statusWeight(b.field) || a.index - b.index)
    .map(({ field }) => field.id);
}

/** Re-applies a stored order, appending any field the snapshot has not seen. */
export function orderFields(p: Profile, order: readonly string[]): Field[] {
  const seen = new Set(order);
  const byId = new Map(p.fields.map((field) => [field.id, field] as const));
  const known = order.map((id) => byId.get(id)).filter((f): f is Field => f !== undefined);
  return [...known, ...p.fields.filter((field) => !seen.has(field.id))];
}

export interface FieldGroup {
  field: Field;
  /** The roles this person ticked, in profile order. */
  roles: Role[];
  /** Live (non-retired) queries serving this field. */
  queries: Query[];
}

/**
 * The Searches screen's groups: one per field that has ticked roles or live
 * queries, Interesting first (D40). A field with ticked roles but no queries
 * yet still gets a group, so its CTA has somewhere to live.
 */
export function orderedFieldGroups(p: Profile): FieldGroup[] {
  return p.fields
    .map((field, index) => ({
      field,
      index,
      roles: rolesForField(p, field.id, true),
      queries: p.queries.filter(
        (query) => !isRetiredQuery(query) && query.fieldIds.includes(field.id),
      ),
    }))
    .filter((group) => group.roles.length > 0 || group.queries.length > 0)
    .sort((a, b) => statusWeight(a.field) - statusWeight(b.field) || a.index - b.index)
    .map(({ field, roles, queries }) => ({ field, roles, queries }));
}

/** True once any live query exists, which is what unlocks the Searches step. */
export function hasLiveQueries(p: Profile): boolean {
  return p.queries.some((query) => !isRetiredQuery(query));
}

// ---------------------------------------------------------------------------
// Board links (never fetched — the person opens them in their own tab)
// ---------------------------------------------------------------------------

const BOARD_SEARCH_URLS: Record<Board, string> = {
  linkedin: "https://www.linkedin.com/jobs/search/?keywords=",
  indeed: "https://www.indeed.com/jobs?q=",
  climatebase: "https://climatebase.org/jobs?q=",
  other: "",
};

/**
 * A link to the board's own public search page with the query filled in.
 * Opening it in a new tab is the person's own browsing; nothing here fetches
 * a job board (PRD: no scraping). `other` has no known URL, so it has no link.
 */
export function boardSearchUrl(board: Board, query: string): string | undefined {
  const base = BOARD_SEARCH_URLS[board];
  if (base === "") return undefined;
  return `${base}${encodeURIComponent(query)}`;
}

// ---------------------------------------------------------------------------
// Feedback (D41)
// ---------------------------------------------------------------------------

/** The four verdicts the feedback screen offers. */
export type Verdict = "good" | "partly" | "wrong" | "none";

export const VERDICTS: readonly Verdict[] = ["good", "partly", "wrong", "none"];

export const VERDICT_LABELS: Record<Verdict, string> = {
  good: "Good fit",
  partly: "Partly right",
  wrong: "Wrong roles",
  none: "No results",
};

/** The "What was off?" chips offered per verdict. */
export const VERDICT_CHIPS: Record<Verdict, readonly string[]> = {
  good: ["A bit broad", "A bit narrow", "Mostly one employer"],
  partly: ["Too senior", "Too junior", "Wrong discipline", "Wrong location", "Too few postings"],
  wrong: ["Too senior", "Too junior", "Wrong discipline", "Needs a licence", "Wrong location"],
  none: ["Too narrow", "Wrong wording", "Too few postings"],
};

/**
 * The four verdicts collapse onto the two the server contract knows (D41):
 * only "Good fit" is `good`, so `QueryFeedbackSchema` and the revise prompt
 * stay unchanged.
 */
export function verdictToServer(verdict: Verdict): "good" | "bad" {
  return verdict === "good" ? "good" : "bad";
}

/**
 * The `reason` string sent with the feedback: the verdict label and the
 * ticked chips are prefixed onto the free text (D41), e.g.
 * `Wrong roles; too senior; agency jobs — mostly PE-licence postings`.
 */
export function feedbackReason(
  verdict: Verdict,
  chips: readonly string[],
  text: string,
): string {
  const parts = [VERDICT_LABELS[verdict], ...chips.map((chip) => chip.trim()).filter((c) => c !== "")];
  const head = parts.join("; ");
  const tail = text.trim();
  const full = tail === "" ? head : `${head} — ${tail}`;
  return full.slice(0, MAX_FEEDBACK_REASON);
}

export interface RevisedQuery {
  /** The query as it stands after the revise turn. */
  query: Query;
  /** Its text before the turn, for "Keep the old one". */
  previousText: string;
  /** False when the revision left the text alone. */
  changed: boolean;
}

/**
 * The query to show in the revised card: the same id when the revision edited
 * it in place, else the live query the revision wrote for the same field and
 * board. `undefined` when neither exists.
 */
export function revisedQueryFor(
  before: Profile,
  after: Profile,
  queryId: string,
): RevisedQuery | undefined {
  const old = before.queries.find((query) => query.id === queryId);
  if (old === undefined) return undefined;
  const live = after.queries.filter((query) => !isRetiredQuery(query));
  const replacement =
    live.find((query) => query.id === queryId) ??
    live.find(
      (query) =>
        query.board === old.board && query.fieldIds.some((id) => old.fieldIds.includes(id)),
    );
  if (replacement === undefined) return undefined;
  return {
    query: replacement,
    previousText: old.query,
    changed: replacement.query !== old.query,
  };
}

/** The three states the revised card can be in (handoff, section 7). */
export type RevisionState = "proposed" | "edited" | "accepted";

export const REVISION_NOTES: Record<RevisionState, string> = {
  proposed: "Proposed from your feedback. Edit it before accepting.",
  edited: "Edited by you. Not applied yet.",
  accepted: "",
};
