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
import { pillsFor } from "./elicit";
import type { Board, Field, Profile, Query, Role } from "./profile";
import { activeCards, citedCardIds, isDropped, rolesForField } from "./profile";
import { liveQueryForRole, selectedRoles } from "./workspace";

// ---------------------------------------------------------------------------
// Screens and the header nav
// ---------------------------------------------------------------------------

/** Every main panel the beta shell can render. */
export type Screen = "resume" | "highlights" | "pending" | "roles" | "searches";

/** The four header steps, in flow order (technical-plan.md D55). */
export type NavStep = "resume" | "highlights" | "roles" | "searches";

/**
 * Which panel the person navigated to. The screen is otherwise derived, so
 * this is the only piece of navigation the shell keeps. There is no feedback
 * panel: query feedback has no UI path in the alpha (technical-plan.md D51).
 */
export type View = NavStep;

export const NAV_STEPS: readonly NavStep[] = ["resume", "highlights", "roles", "searches"];

export const NAV_LABELS: Record<NavStep, string> = {
  resume: "Resume",
  highlights: "Highlights",
  roles: "Roles",
  searches: "Searches",
};

export interface ScreenInput {
  /** Any card at all on the profile, excluded ones included. */
  hasCards: boolean;
  /** Any field on the profile: discovery has landed at least once. */
  hasFields: boolean;
  /** A turn is in flight. */
  busy: boolean;
  /** Some selected role has a live search (`hasLiveQueries`). */
  hasQueries?: boolean;
  /**
   * The panel the person navigated to. Unset, or a step not reached yet,
   * falls back to Highlights before discovery and Roles after.
   */
  view?: View;
}

/**
 * Which main panel renders. One turn is in flight at a time (D38), so a busy
 * shell always shows the pending screen — except before any card exists,
 * where there is nothing behind it yet and the Resume page keeps its own
 * spinner. Every reached step is a link back (technical-plan.md D55).
 */
export function currentScreen(input: ScreenInput): Screen {
  const { hasCards, hasFields, busy, view } = input;
  if (busy) return hasCards ? "pending" : "resume";
  if (!hasCards) return "resume";
  if (view !== undefined && navStepEnabled(view, input)) return view;
  return hasFields ? "roles" : "highlights";
}

/** The header step highlighted for a screen. */
export function navStepFor(screen: Screen): NavStep {
  return screen === "pending" ? "roles" : screen;
}

/**
 * Steps ahead of what the person has reached are disabled; the Resume page
 * is always reachable (technical-plan.md D55).
 */
export function navStepEnabled(step: NavStep, input: ScreenInput): boolean {
  if (step === "resume") return true;
  if (step === "highlights") return input.hasCards;
  if (step === "roles") return input.hasFields;
  return input.hasQueries === true;
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

/**
 * What the Resume page shows (technical-plan.md D55, D56). Before any card
 * exists it is the entry form, both boxes starting from what was typed last
 * (non-empty only when an earlier Start failed). Once the resume has been
 * read it shows the stored text read-only; a profile saved before inputs
 * were kept has no stored resume, and says so instead.
 */
export type ResumeView =
  | { kind: "entry"; resume: string; notes: string }
  | { kind: "stored"; resume: string; notes?: string }
  | { kind: "notStored" };

export function resumeView(p: Profile): ResumeView {
  const { resume, notes } = p.inputs;
  if (p.cards.length === 0) return { kind: "entry", resume, notes };
  if (resume.trim() === "") return { kind: "notStored" };
  return notes.trim() === "" ? { kind: "stored", resume } : { kind: "stored", resume, notes };
}

// ---------------------------------------------------------------------------
// The interest question (technical-plan.md D54)
// ---------------------------------------------------------------------------

/**
 * Plain-words names for the asked questions. `PREFERENCE_LABELS` in
 * `elicit.ts` are profile keys; these are what a person reads on screen. One
 * question is asked, optional and multi-select (D54).
 */
export const QUESTION_LABELS = {
  climateInterests: "Which area of climate work interests you most?",
} as const;

/** The line under the interest question: picks rank, never filter (D54). */
export const INTEREST_NOTE =
  "Pick as many as you like. Your picks decide which roles are listed first; roles in other areas still appear.";

export interface InterestPill extends AnswerPill {
  /** This area is one of the person's picks; drawn pressed. */
  pressed: boolean;
}

function sameAnswer(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The six climate areas in `CLIMATE_AREAS` order, each pressed when the
 * profile's `Climate interests` holds it. Tapping one toggles it through
 * `toggleClimateInterest`; picking none is a valid answer (D54).
 */
export function interestPills(p: Profile): InterestPill[] {
  const values = p.preferences.climateInterests?.values ?? [];
  return pillsFor("climateInterests").map((pill) => ({
    ...pill,
    pressed: values.some((value) => sameAnswer(value, pill.value)),
  }));
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
 * and the turn costs about $0.50. The interest question is optional, so only
 * an active highlight is required (D54). The note names only things visible
 * on the Highlights screen, never a panel that no longer exists (D49).
 */
export function findRolesGate(p: Profile): FindRolesGate {
  if (activeCards(p).length === 0) {
    return { enabled: false, note: "Include at least one highlight above first." };
  }
  if (p.fields.length > 0) {
    return { enabled: true, note: "Running this again updates your roles." };
  }
  return { enabled: true, note: "You can come back and change any of this." };
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

/** The id → title lookup `citationsToTitles` and the "Based on" lines use. */
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

/**
 * The Roles and Searches footer button label: "Write LinkedIn searches" with
 * nothing ticked, else "… for 1 role" / "… for 3 roles" (technical-plan.md D57).
 */
export function writeSearchesLabel(count: number): string {
  if (count === 0) return "Write LinkedIn searches";
  return `Write LinkedIn searches for ${count} role${count === 1 ? "" : "s"}`;
}

/** The note beside the footer button: only when nothing is ticked, empty otherwise (D57). */
export function selectedRolesNote(count: number): string {
  return count === 0 ? "Tick at least one role first." : "";
}

export interface RoleRow {
  role: Role;
  /** The one-line why, with card ids rendered as card titles. */
  why: string;
  /** "Example companies: …", or empty when the role names none. */
  companies: string;
}

/** One highlight a field is based on: its title and the field's evidence line for it. */
export interface BasedOnLine {
  title: string;
  /** The field's evidence sentence for this card, card ids rendered as titles; "" when it has none. */
  evidence: string;
}

export interface RoleGroupView {
  field: Field;
  fitLabel?: string;
  moveLabel?: string;
  /** The field's two-sentence summary, with card ids rendered as card titles. */
  summary: string;
  /** The highlights the field cites, in citation order, one per card (technical-plan.md D57). */
  basedOn: BasedOnLine[];
  /** The field's uncertainty, with card ids rendered as card titles. */
  uncertain: string;
  roles: RoleRow[];
}

/**
 * One group per field the latest discovery run returned, in its rank order;
 * fields and roles it did not return are left out (technical-plan.md D58).
 * A field's status is never read: every field is a heading with no marking
 * (technical-plan.md D50). The sector line and the field's ask are written
 * to the profile but not shown (D57).
 * Roles under no known field are left out, as `selectedRoles` leaves them out.
 */
export function roleGroups(p: Profile): RoleGroupView[] {
  const titles = cardTitles(p);
  return p.fields.filter((field) => !isDropped(field)).map((field) => {
    const cited = [
      ...field.evidence.map((line) => line.cardId),
      ...citedCardIds(field.fit),
    ];
    const evidenceByCard = new Map<string, string>();
    for (const line of field.evidence) {
      if (!evidenceByCard.has(line.cardId) && line.why.trim() !== "") {
        evidenceByCard.set(line.cardId, line.why.trim());
      }
    }
    const seen = new Set<string>();
    const basedOn: BasedOnLine[] = [];
    for (const id of cited) {
      const title = titles.get(id);
      if (title === undefined || seen.has(id)) continue;
      seen.add(id);
      basedOn.push({ title, evidence: citationsToTitles(p, evidenceByCard.get(id) ?? "") });
    }
    return {
      field,
      fitLabel: field.fitLevel === undefined ? undefined : FIT_LABELS[field.fitLevel],
      moveLabel: field.move === undefined ? undefined : MOVE_LABELS[field.move],
      summary: citationsToTitles(p, field.summary),
      basedOn,
      uncertain: citationsToTitles(p, field.uncertain),
      roles: rolesForField(p, field.id)
        .filter((role) => !isDropped(role))
        .map((role) => ({
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

/**
 * The ticked roles with no search yet, each with its field: the same
 * occupation can be ticked under two fields (D72), and "Data science, Data
 * science" would not say which is which.
 */
export function missingSearchesNote(missing: readonly SearchCardView[]): string {
  return missing
    .map(({ role, fieldName }) => (fieldName === "" ? role.title : `${role.title} · ${fieldName}`))
    .join(", ");
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

/**
 * What the "Copied" marker is keyed by: the query's id and its text. Writing
 * searches again rewrites a role's untried query in place under the same id
 * (technical-plan.md D47), so keying by id alone would mark text the person
 * never copied.
 */
export function copyKey(query: Query): string {
  return `${query.id}\n${query.query}`;
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
