/**
 * `screens.ts` — the pure, React-free state logic behind the exploration-first
 * shell (technical-plan.md D37, D38). Everything here is a function of the
 * parsed profile plus a little turn state, so it is unit tested directly and
 * the components in `src/components/shell/` stay presentational.
 *
 * Browser-safe: it imports `profile.ts` and `elicit.ts` only (the latter for
 * its question/pill tables, which carry no model call).
 */

import type { AnswerPill } from "./session";
import {
  ELICIT_ORDER,
  PREFERENCE_LABELS,
  QUESTIONS,
  isOpenToSuggestions,
  pillsFor,
} from "./elicit";
import type { PreferenceKey, Profile } from "./profile";
import { activeCards } from "./profile";

// ---------------------------------------------------------------------------
// Screens and the header nav
// ---------------------------------------------------------------------------

/** The screens this step ships. The board/queries screens land in 2b.5. */
export type Screen = "firstRun" | "highlights" | "pending" | "board";

/** The three header steps. `searches` is not reachable yet (step 2b.5). */
export type NavStep = "highlights" | "fields" | "searches";

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
}

/**
 * Which main panel renders. One turn is in flight at a time (D38), so a busy
 * shell always shows the pending screen — except on the very first run, where
 * there is nothing behind it yet and the paste screen keeps its own spinner.
 */
export function currentScreen({ hasCards, hasFields, busy }: ScreenInput): Screen {
  if (busy) return hasCards ? "pending" : "firstRun";
  if (!hasCards) return "firstRun";
  return hasFields ? "board" : "highlights";
}

/** The header step highlighted for a screen. */
export function navStepFor(screen: Screen): NavStep {
  return screen === "board" || screen === "pending" ? "fields" : "highlights";
}

/** Steps ahead of what the person has reached are disabled. */
export function navStepEnabled(step: NavStep, input: ScreenInput): boolean {
  if (step === "highlights") return input.hasCards;
  if (step === "fields") return input.hasFields;
  return false; // Searches arrives with step 2b.5.
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
