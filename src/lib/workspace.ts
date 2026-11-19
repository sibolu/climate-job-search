/**
 * `workspace.ts` — the pure browser-side logic behind the single-page
 * workspace (PLAN.md Phase 2). Everything here is a plain function over
 * `SessionState` / `Profile`, so the React components in `src/components/`
 * hold no rules of their own and the rules are unit tested without a DOM.
 *
 * State lives in `localStorage` through `session.ts` and is resent each turn
 * (PRD: no user data server-side). Profile text is only ever read and written
 * through `parseProfile` / `serializeProfile`; nothing here string-edits
 * markdown.
 */

import { confirmSkill, rejectSkill } from "./cards";
import { isRetiredQuery } from "./boards";
import { isElicitationComplete } from "./elicit";
import type { Card, Field, FieldStatus, Profile, Query, Role } from "./profile";
import {
  activeCards,
  parseProfile,
  rolesForField as profileRolesForField,
  selectedRoles as profileSelectedRoles,
  serializeProfile,
  setCardExcluded,
  setFieldStatus,
  setQueryStatus,
} from "./profile";
import type {
  AnswerPill,
  QueryFeedback,
  SessionState,
  StepName,
  TurnInput,
  TurnResponse,
} from "./session";
import { appendMessage } from "./session";

// ---------------------------------------------------------------------------
// Which step a turn belongs to
// ---------------------------------------------------------------------------

/**
 * What triggered the turn: the chat box, the Profile tab's paste box, or one
 * of the buttons on the Fields / Queries tabs.
 */
export type TurnSource = "chat" | "paste" | "explore" | "queries" | "feedback";

export interface NextStepInput {
  source: TurnSource;
}

/**
 * The client-side step policy (technical-plan.md D31). A button that names its own step
 * wins; pasted text always means card extraction; otherwise the profile
 * decides: elicit preferences until every asked one is known, then discover fields,
 * then explore.
 */
export function nextStep(profile: Profile, input: NextStepInput): StepName {
  if (input.source === "paste") return "cards";
  if (input.source === "explore") return "explore";
  if (input.source === "queries") return "queries";
  if (input.source === "feedback") return "revise";
  if (activeCards(profile).length === 0) return "cards";
  if (!isElicitationComplete(profile)) return "elicit";
  if (profile.fields.length === 0) return "discover";
  return "explore";
}

// ---------------------------------------------------------------------------
// Reading the profile out of session state
// ---------------------------------------------------------------------------

export interface ProfileView {
  profile: Profile;
  /** Parser warnings; always shown to the user rather than discarded. */
  warnings: string[];
}

export function profileView(state: SessionState): ProfileView {
  const { profile, warnings } = parseProfile(state.profileMd);
  return { profile, warnings };
}

/** Applies a pure profile edit and writes the markdown back into the session. */
export function updateProfile(
  state: SessionState,
  edit: (profile: Profile) => Profile,
): SessionState {
  const { profile } = parseProfile(state.profileMd);
  return { ...state, profileMd: serializeProfile(edit(profile)) };
}

export function toggleCardExcluded(state: SessionState, cardId: string, excluded: boolean): SessionState {
  return updateProfile(state, (p) => setCardExcluded(p, cardId, excluded));
}

export function confirmProfileSkill(state: SessionState, skill: string): SessionState {
  return updateProfile(state, (p) => confirmSkill(p, skill));
}

export function rejectProfileSkill(state: SessionState, skill: string): SessionState {
  return updateProfile(state, (p) => rejectSkill(p, skill));
}

/** Cards in file order, excluded ones included — the Profile tab lists them all. */
export function allCards(profile: Profile): Card[] {
  return profile.cards;
}

// ---------------------------------------------------------------------------
// Turn bookkeeping
// ---------------------------------------------------------------------------

export function appendUserMessage(state: SessionState, content: string): SessionState {
  return appendMessage(state, { role: "user", content });
}

export function appendAssistantMessage(
  state: SessionState,
  content: string,
  pills?: AnswerPill[],
): SessionState {
  return appendMessage(state, {
    role: "assistant",
    content,
    ...(pills !== undefined && pills.length > 0 ? { pills } : {}),
  });
}

/**
 * Folds a completed turn into state: the assistant message (with its pills)
 * is appended and a returned `profileMd` replaces the stored profile text
 * wholesale — the server sends the whole file, never a patch.
 */
export function applyTurnResponse(state: SessionState, response: TurnResponse): SessionState {
  const withMessage = appendAssistantMessage(state, response.message, response.pills);
  if (response.profileMd === undefined) return withMessage;
  return { ...withMessage, profileMd: response.profileMd };
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

/** The name the Export button gives the downloaded file. */
export const EXPORT_FILENAME = "profile-session.json";

// ---------------------------------------------------------------------------
// Fields tab
// ---------------------------------------------------------------------------

/** Sets a field's status from the Fields tab. A local edit — no server call. */
export function setProfileFieldStatus(
  state: SessionState,
  fieldId: string,
  status: FieldStatus,
): SessionState {
  return updateProfile(state, (p) => setFieldStatus(p, fieldId, status));
}

/**
 * The user message an Explore button posts. The server (step 2.5) pulls the
 * `F\d+` back out of this text, so the shape is part of the protocol.
 */
export function exploreChatText(field: Field): string {
  return `Explore ${field.id}: ${field.name}`;
}

/** The roles from the Role Shortlist that belong to a field, in file order; `profile.ts` owns the rule. */
export function rolesForField(profile: Profile, fieldId: string, selectedOnly = false): Role[] {
  return profileRolesForField(profile, fieldId, selectedOnly);
}

/** Roles whose `fieldId` names no field in the profile; shown ungrouped. */
export function unassignedRoles(profile: Profile): Role[] {
  const known = new Set(profile.fields.map((f) => f.id));
  return profile.roles.filter((r) => !known.has(r.fieldId));
}

// ---------------------------------------------------------------------------
// Queries tab
// ---------------------------------------------------------------------------

/**
 * The turn input the "write searches" button sends: one `queries` turn for
 * every selected role (technical-plan.md D47). It carries no payload; the
 * server reads `Selected: yes` from the profile sent with the turn.
 */
export function buildSelectedRolesTurnInput(): TurnInput {
  return { kind: "selectedRoles" };
}

/**
 * Every ticked role, in field order and then role order: the roles a
 * `queries` turn writes for. `profile.ts` owns the rule (a field's status is
 * not consulted; a ticked role under no field is left out).
 */
export function selectedRoles(profile: Profile): Role[] {
  return profileSelectedRoles(profile);
}

/** Searches can be written once at least one role is selected; `generateQueries` enforces the same. */
export function canWriteQueries(profile: Profile): boolean {
  return selectedRoles(profile).length > 0;
}

/**
 * The one search to show for a role: its newest (last in file order)
 * LinkedIn query that is not retired, whether still untried or already
 * judged. Undefined when none has been written for the role yet.
 */
export function liveQueryForRole(profile: Profile, roleId: string): Query | undefined {
  if (roleId === "") return undefined;
  return profile.queries
    .filter((q) => q.roleId === roleId && q.board === "linkedin" && !isRetiredQuery(q))
    .at(-1);
}

/** The longest "why" the feedback box keeps (`QueryFeedbackSchema`'s cap). */
export const MAX_FEEDBACK_REASON = 5000;

/** Trims the user's "why" and caps it at what the request schema accepts. */
export function normalizeFeedbackReason(reason: string): string {
  return reason.trim().slice(0, MAX_FEEDBACK_REASON);
}

/**
 * "Tried it" feedback, applied locally first: the Queries section of the
 * profile text carries the new status and the user's own words before the
 * revision turn is sent, so the edit survives a failed request.
 */
export function applyQueryFeedback(state: SessionState, feedback: QueryFeedback): SessionState {
  return updateProfile(state, (p) =>
    setQueryStatus(p, feedback.queryId, feedback.verdict, normalizeFeedbackReason(feedback.reason)),
  );
}

/** The chat bubble shown for a "Tried it" turn; `board` is the display label. */
export function feedbackChatText(feedback: QueryFeedback, board: string): string {
  const verdict = feedback.verdict === "good" ? "good fit" : "bad fit";
  const reason = normalizeFeedbackReason(feedback.reason);
  const tail = reason === "" ? "" : ` — ${reason}`;
  return `Tried ${feedback.queryId} on ${board}: ${verdict}${tail}`;
}
