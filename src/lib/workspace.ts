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
import type { Card, Profile } from "./profile";
import {
  activeCards,
  missingPreferences,
  parseProfile,
  serializeProfile,
  setCardExcluded,
} from "./profile";
import type { AnswerPill, SessionState, StepName, TurnResponse } from "./session";
import { appendMessage } from "./session";

// ---------------------------------------------------------------------------
// Which step a turn belongs to
// ---------------------------------------------------------------------------

/** Where the user's text came from: the chat box, or the Profile tab's paste box. */
export type TurnSource = "chat" | "paste";

export interface NextStepInput {
  source: TurnSource;
}

/**
 * The client-side step policy (PLAN.md §3). Pasted text always means card
 * extraction; after that the profile decides: elicit preferences until none
 * are missing, then discover fields, then explore.
 */
export function nextStep(profile: Profile, input: NextStepInput): StepName {
  if (input.source === "paste") return "cards";
  if (activeCards(profile).length === 0) return "cards";
  if (missingPreferences(profile).length > 0) return "elicit";
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
