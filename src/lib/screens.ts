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
  QUESTIONS,
  isOpenToSuggestions,
  pillsFor,
} from "./elicit";
import type { Ask, Board, Field, PreferenceKey, Profile, Query, Role } from "./profile";
import { activeCards, citedCardIds, rolesForField } from "./profile";
import { liveQueryForRole, selectedRoles } from "./workspace";

// ---------------------------------------------------------------------------
// Screens and the header nav
// ---------------------------------------------------------------------------

/** Every main panel the beta shell can render. */
export type Screen = "firstRun" | "highlights" | "pending" | "roles" | "searches";

/** The three header steps. */
export type NavStep = "highlights" | "roles" | "searches";

/**
 * Which of the post-discovery panels the person navigated to. The screen is
 * otherwise derived, so this is the only piece of navigation the shell keeps.
 * There is no feedback panel: query feedback has no UI path in the alpha
 * (technical-plan.md D51).
 */
export type View = "roles" | "searches";

export const NAV_STEPS: readonly NavStep[] = ["highlights", "roles", "searches"];

export const NAV_LABELS: Record<NavStep, string> = {
  highlights: "1 Highlights",
  roles: "2 Roles",
  searches: "3 Searches",
};

/** The header's "Start over" confirm text; everything lives in this browser only. */
export const START_OVER_CONFIRM =
  "Start over? This removes your highlights, answers, roles and searches from this browser. " +
  "Save a copy from Your profile first if you want to keep them.";

export interface ScreenInput {
  /** Any card at all on the profile, excluded ones included. */
  hasCards: boolean;
  /** Any field on the profile: discovery has landed at least once. */
  hasFields: boolean;
  /** A turn is in flight. */
  busy: boolean;
  /** Some selected role has a live search (`hasLiveQueries`). */
  hasQueries?: boolean;
  /** The panel the person navigated to; `roles` when they have not moved. */
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
  return view ?? "roles";
}

/** The header step highlighted for a screen. */
export function navStepFor(screen: Screen): NavStep {
  if (screen === "searches") return "searches";
  return screen === "roles" || screen === "pending" ? "roles" : "highlights";
}

/** Steps ahead of what the person has reached are disabled. */
export function navStepEnabled(step: NavStep, input: ScreenInput): boolean {
  if (step === "highlights") return input.hasCards;
  if (step === "roles") return input.hasFields;
  return input.hasQueries === true;
}

/**
 * The nav, "Your profile" and "Start over" are hidden entirely on first run
 * (handoff, Shell). There is no rail: the flow is one centred column
 * (technical-plan.md D49).
 */
export function showNav(screen: Screen): boolean {
  return screen !== "firstRun";
}

// ---------------------------------------------------------------------------
// Info tips: what each input changes (step 2b.11)
// ---------------------------------------------------------------------------

export const INFO_TIPS = {
  excludeCard: "Excluded highlights are not used to match roles.",
  answer: "Your answer is used to rank roles.",
  writeSearches: "Each ticked role becomes one LinkedIn search.",
  fieldAsk: "Your answer is saved to your profile. It does not change the order of these roles.",
} as const;

/** "3 of 4 highlights used to match roles." */
export function highlightsCountNote(p: Profile): string {
  const total = p.cards.length;
  const used = activeCards(p).length;
  return `${used} of ${total} highlight${total === 1 ? "" : "s"} used to match roles.`;
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
// The two preference questions (D38, D48: seniority is no longer asked)
// ---------------------------------------------------------------------------

/**
 * Plain-words names for the asked questions. `PREFERENCE_LABELS` in
 * `elicit.ts` are profile keys ("Retraining appetite"); these are what a
 * person reads on screen.
 */
export const QUESTION_LABELS: Record<PreferenceKey, string> = {
  climateInterests: "What draws you to climate work",
  retrainingAppetite: "How much retraining you're open to",
  location: "Where you want to be based",
  workMode: "How you want to work",
  seniority: "Your level",
};

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

export interface QuestionPill extends AnswerPill {
  /** This pill is the recorded answer; drawn pressed. */
  selected: boolean;
}

export interface QuestionView {
  key: PreferenceKey;
  label: string;
  question: string;
  pills: QuestionPill[];
  /** The recorded answer in plain words; empty while unanswered. */
  answer: string;
}

export interface QuestionContext {
  /** Sector groups from the server's own pills, when the cards turn sent any. */
  sectorGroups?: readonly string[];
}

function sameAnswer(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** True when `pill` is the answer recorded for `key`. */
export function pillSelected(p: Profile, key: PreferenceKey, pill: AnswerPill): boolean {
  if (key === "climateInterests") {
    const values = p.preferences.climateInterests?.values ?? [];
    return values.some((value) => sameAnswer(value, pill.value));
  }
  const value = p.preferences[key]?.value ?? "";
  return value.trim() !== "" && sameAnswer(value, pill.value);
}

/**
 * Both asked questions, in `ELICIT_ORDER`, shown at once on the Highlights
 * screen. An answered one keeps its pills so tapping another changes the
 * answer (this replaced the rail's "Change an answer", technical-plan.md D49).
 */
export function questionViews(p: Profile, ctx: QuestionContext = {}): QuestionView[] {
  return ELICIT_ORDER.map((key) => ({
    key,
    label: QUESTION_LABELS[key],
    question: QUESTIONS[key],
    pills: pillsFor(key, { sectorGroups: ctx.sectorGroups ?? [] }).map((pill) => ({
      ...pill,
      selected: pillSelected(p, key, pill),
    })),
    answer: preferenceText(p, key),
  }));
}

export interface AnswerRow {
  key: PreferenceKey;
  label: string;
  /** Empty string when the preference is not answered yet. */
  value: string;
}

/** Both asked keys with their current values, in plain words. */
export function answerRows(p: Profile): AnswerRow[] {
  return ELICIT_ORDER.map((key) => ({
    key,
    label: QUESTION_LABELS[key],
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
// "Find climate roles"
// ---------------------------------------------------------------------------

/**
 * The button that starts discovery, and the pill the server offers for it.
 * The one source of truth for the label: `turn.ts` re-exports it as
 * `GO_PILL`, and the browser routes `value` "go" to `discover`.
 */
export const FIND_ROLES_PILL: AnswerPill = { label: "Find climate roles", value: "go" };

export interface FindRolesGate {
  enabled: boolean;
  /** One line naming what is missing on this screen, or what happens next. */
  note: string;
}

/**
 * Discovery never auto-starts (D38): the person excludes highlights first,
 * and the turn costs about $0.50. The note names only things visible on the
 * Highlights screen, never a panel that no longer exists (D49).
 */
export function findRolesGate(p: Profile): FindRolesGate {
  if (activeCards(p).length === 0) {
    return { enabled: false, note: "Include at least one highlight above first." };
  }
  const remaining = remainingQuestions(p);
  if (remaining.length === ELICIT_ORDER.length) {
    return { enabled: false, note: "Answer the two questions above first." };
  }
  if (remaining.length > 0) {
    return { enabled: false, note: `Answer “${QUESTION_LABELS[remaining[0]]}” above first.` };
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

/** How many log lines the pending screen keeps; older ones fall off the top. */
export const MAX_LOG_LINES = 60;

/** The pending screen's status line: the latest progress line, or a default. */
export function pendingStatusLine(log: readonly LogLine[]): string {
  return log.length > 0 ? log[log.length - 1].text : "Getting started…";
}

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
// The Roles screen: fields are headings, roles are what you tick
// (technical-plan.md D50)
// ---------------------------------------------------------------------------

/** The three fit levels in plain words; never a percentage (technical-plan.md D39). */
export const FIT_LABELS: Record<string, string> = {
  strong: "Strong overlap",
  some: "Some overlap",
  stretch: "Stretch",
};

/** The kind of move a field asks of the person, in plain words. */
export const MOVE_LABELS: Record<string, string> = {
  sector: "Same work, new sector",
  adjacent: "A step sideways",
  retraining: "Needs retraining",
};

/** The id → title lookup `citationsToTitles` and the "Draws on" line use. */
function cardTitles(p: Profile): Map<string, string> {
  return new Map(p.cards.map((card) => [card.id, card.title.trim() || "one of your highlights"]));
}

/**
 * Renders card ids in model text as the cards' titles, so the person never
 * sees a raw `C3`: "C1's ranking work and C3" becomes "Grid analyst's ranking
 * work and Ops lead". An id with no card reads "one of your highlights".
 */
export function citationsToTitles(p: Profile, text: string): string {
  const titles = cardTitles(p);
  return text.replace(/\bC(\d+)\b/g, (_match, digits: string) => {
    return titles.get(`C${Number(digits)}`) ?? "one of your highlights";
  });
}

/** The Roles and Searches footer button label:"Write LinkedIn searches for 1 role" / "… for 3 roles". */
export function writeSearchesLabel(count: number): string {
  return `Write LinkedIn searches for ${count} role${count === 1 ? "" : "s"}`;
}

/** The note under the footer button. */
export function selectedRolesNote(count: number): string {
  return count === 0 ? "Tick at least one role first." : `${count} role${count === 1 ? "" : "s"} ticked.`;
}

export interface RoleRow {
  role: Role;
  /** The one-line why, with card ids rendered as card titles. */
  why: string;
  /** "Example companies: …", or empty when the role names none. */
  companies: string;
}

export interface RoleGroupView {
  field: Field;
  fitLabel?: string;
  moveLabel?: string;
  /** The field's one-line summary, with card ids rendered as card titles. */
  summary: string;
  /** Titles of the cards the field draws on, in citation order, deduplicated. */
  drawsOn: string[];
  /** The field's uncertainty, with card ids rendered as card titles. */
  uncertain: string;
  ask?: Ask;
  /** The answer already saved under the ask's key, if any. */
  askAnswer?: string;
  roles: RoleRow[];
}

function normKey(key: string): string {
  return key.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The value saved under a field ask's key (`addOtherPreference`), if any. */
export function askAnswer(p: Profile, ask: Ask): string | undefined {
  const key = normKey(ask.key);
  return p.preferences.other.find((entry) => normKey(entry.key) === key)?.value;
}

/**
 * One group per discovered field, in the rank order discovery wrote them.
 * A field's status is never read: every field is a heading with no marking
 * (technical-plan.md D50), and an answered ask does not re-rank (D43).
 * Roles under no known field are left out, as `selectedRoles` leaves them out.
 */
export function roleGroups(p: Profile): RoleGroupView[] {
  const titles = cardTitles(p);
  return p.fields.map((field) => {
    const cited = [
      ...field.evidence.map((line) => line.cardId),
      ...citedCardIds(field.fit),
    ];
    const drawsOn = [
      ...new Set(cited.map((id) => titles.get(id)).filter((t): t is string => t !== undefined)),
    ];
    return {
      field,
      fitLabel: field.fitLevel === undefined ? undefined : FIT_LABELS[field.fitLevel],
      moveLabel: field.move === undefined ? undefined : MOVE_LABELS[field.move],
      summary: citationsToTitles(p, field.summary),
      drawsOn,
      uncertain: citationsToTitles(p, field.uncertain),
      ask: field.ask,
      askAnswer: field.ask === undefined ? undefined : askAnswer(p, field.ask),
      roles: rolesForField(p, field.id).map((role) => ({
        role,
        why: citationsToTitles(p, role.why),
        companies: role.companies.length > 0 ? `Example companies: ${role.companies.join(", ")}` : "",
      })),
    };
  });
}

/** A source link's visible text: its host without `www.`, or the raw text when it is not a URL. */
export function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// The Searches screen: one card per ticked role (technical-plan.md D47)
// ---------------------------------------------------------------------------

export interface SearchCardView {
  role: Role;
  fieldName: string;
  /** The role's live LinkedIn search; undefined when it was ticked after the last write. */
  query?: Query;
}

/** One entry per selected role, in `selectedRoles` order. */
export function searchCards(p: Profile): SearchCardView[] {
  const names = new Map(p.fields.map((field) => [field.id, field.name] as const));
  return selectedRoles(p).map((role) => ({
    role,
    fieldName: names.get(role.fieldId) ?? "",
    query: liveQueryForRole(p, role.id),
  }));
}

/** True once some selected role has a live search: that unlocks the Searches step. */
export function hasLiveQueries(p: Profile): boolean {
  return selectedRoles(p).some((role) => liveQueryForRole(p, role.id) !== undefined);
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
