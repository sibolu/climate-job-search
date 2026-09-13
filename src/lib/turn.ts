/**
 * The turn dispatcher: one `TurnRequest` in, one `TurnResponse` out (Phase 2.5).
 *
 * This is the only place a route handler decides which lib module runs. The
 * browser picks the `step` (`workspace.ts`, `nextStep`) and sends the whole
 * profile every turn; this module parses it, runs the step, and hands back
 * the assistant's message, the pills to offer, and the full replacement
 * `profile.md`. It holds no state and logs nothing.
 *
 * Steps:
 * - `cards`    pasted text → cards, then preferences inferred from them, then
 *              the first elicitation question.
 * - `elicit`   one answer (a pill click needs no model call) → the next
 *              question, or the done summary with a "go" pill.
 * - `discover` ranked fields and roles from cards + reference data + web.
 * - `explore`  `Explore F3: …` → the drill-down on that field. A message
 *              with no field id is answered with a list of fields to pick;
 *              the "generate queries" pill text is routed to `queries`.
 * - `queries`  search queries per board for accepted / unsure fields.
 * - `revise`   one piece of "Tried it" feedback → revised queries and an
 *              explanation.
 *
 * Every model call happens inside the step modules, which all go through
 * `llm.ts`. Errors are mapped to user-facing sentences by {@link turnErrorMessage},
 * which never includes model text or the request.
 */

import { cardsSummary, extractCards } from "./cards";
import { discoverFields, type DiscoverResult } from "./discover";
import {
  applyPillAnswer,
  type ElicitContext,
  type ElicitDecision,
  inferPreferences,
  interpretAnswer,
  nextMissingPreference,
  nextQuestion,
  pillsFor,
} from "./elicit";
import { exploreField } from "./explore";
import type { Llm } from "./llm";
import { activeCards, type Field, type MoveType, parseProfile, type Profile, serializeProfile } from "./profile";
import { generateQueries, type GenerateQueriesResult, reviseQueries, type ReviseQueriesResult } from "./queries";
import type { AnswerPill, TurnRequest, TurnResponse } from "./session";
import { canGenerateQueries, exploreChatText, GENERATE_QUERIES_TEXT } from "./workspace";

// ---------------------------------------------------------------------------
// Dependencies (injectable for tests; the defaults are the real modules)
// ---------------------------------------------------------------------------

export interface TurnDeps {
  llm: () => Llm;
  /** Distinct `climate_fields.sector_group` values for the interest chips; empty when unavailable. */
  sectorGroups: () => Promise<string[]>;
  extractCards: typeof extractCards;
  inferPreferences: typeof inferPreferences;
  interpretAnswer: typeof interpretAnswer;
  discoverFields: typeof discoverFields;
  exploreField: typeof exploreField;
  generateQueries: typeof generateQueries;
  reviseQueries: typeof reviseQueries;
}

/** `llm.ts` and `reference.ts` are loaded lazily so tests never touch env or Supabase. */
export async function defaultDeps(): Promise<TurnDeps> {
  const [{ llm }, reference] = await Promise.all([import("./llm"), import("./reference")]);
  return {
    llm,
    sectorGroups: async () => {
      try {
        return await reference.listSectorGroups();
      } catch (error) {
        if (error instanceof reference.ReferenceReadError) return [];
        throw error;
      }
    },
    extractCards,
    inferPreferences,
    interpretAnswer,
    discoverFields,
    exploreField,
    generateQueries,
    reviseQueries,
  };
}

/** A short status line streamed to the chat while a slow step runs. */
export type Progress = (text: string) => void;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** The user typed something the step cannot use (never a model or server fault). */
export class TurnInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnInputError";
  }
}

/** Offered when elicitation is complete; the browser routes "go" to `discover`. */
export const GO_PILL: AnswerPill = { label: "Find climate fields for me", value: "go" };

/** Offered after explore and discover when the profile has fields to search on. */
export const GENERATE_QUERIES_PILL: AnswerPill = { label: "Write search queries", value: GENERATE_QUERIES_TEXT };

export const FIELD_ID_PATTERN = /\bF\d+\b/;

/** The first field id (`F3`) in a message, or undefined. */
export function fieldIdIn(text: string): string | undefined {
  return FIELD_ID_PATTERN.exec(text)?.[0];
}

/** The most pills the assistant offers at once. */
export const MAX_PILLS = 8;

/** Fields worth offering an Explore pill for: not rejected, unexplored first. */
export function explorePills(profile: Profile, limit = MAX_PILLS): AnswerPill[] {
  const open = profile.fields.filter((f) => f.status !== "rejected");
  const ordered = [...open.filter((f) => !f.explored), ...open.filter((f) => f.explored)];
  return ordered.slice(0, limit).map((f) => ({ label: `Explore ${f.id}: ${f.name}`, value: exploreChatText(f) }));
}

const MOVE_LABEL: Record<MoveType, string> = {
  sector: "sector move",
  adjacent: "adjacent move",
  retraining: "needs retraining",
};

function fieldBlock(profile: Profile, field: Field): string {
  const roles = profile.roles.filter((r) => r.fieldId === field.id);
  const lines = [
    `**${field.id}: ${field.name}**${field.move === undefined ? "" : ` — ${MOVE_LABEL[field.move]}`}`,
    `- Fit: ${field.fit}`,
  ];
  if (field.uncertain.trim() !== "") lines.push(`- Unsure: ${field.uncertain}`);
  if (roles.length > 0) {
    lines.push(
      `- Roles: ${roles.map((r) => `${r.id} ${r.title}${r.companies.length > 0 ? ` (${r.companies.slice(0, 3).join(", ")})` : ""}`).join("; ")}`,
    );
  }
  if (field.sources.length > 0) lines.push(`- Sources: ${field.sources.join(", ")}`);
  return lines.join("\n");
}

/** The chat message after discovery: the fields written this run, in rank order. */
export function discoverMessage(result: DiscoverResult): string {
  const { profile, fields, dropped } = result;
  if (fields.length === 0) {
    return [
      "I could not find climate fields I can back up with sources for these cards.",
      "Add a card or two with more detail about what you actually did, or tell me a climate area you care about, and I will try again.",
    ].join("\n\n");
  }
  const n = fields.length;
  const parts = [
    `Here ${n === 1 ? "is" : "are"} ${String(n)} climate field${n === 1 ? "" : "s"} where your experience could land, ranked.`,
    ...fields.map((f) => fieldBlock(profile, f)),
  ];
  const left =
    dropped.fieldsUncited + dropped.fieldsUnsourced + dropped.rolesUncited + dropped.rolesUnsourced + dropped.fieldsSurplus;
  if (left > 0) {
    parts.push(
      `I left out ${String(left)} suggestion${left === 1 ? "" : "s"} that had no source or did not connect to your experience cards.`,
    );
  }
  parts.push(
    "Open the Fields tab to accept, reject or mark each one unsure, or pick one below to see titles, employers and example posts.",
  );
  return parts.join("\n\n");
}

/** The chat message after query generation. */
export function queriesMessage(result: GenerateQueriesResult): string {
  const { added, updated } = result;
  if (added.length === 0 && updated.length === 0) {
    return "I did not come up with any new queries this time. Accept a field or two on the Fields tab and try again.";
  }
  const lines = [
    `I wrote ${String(added.length)} new search quer${added.length === 1 ? "y" : "ies"}${updated.length > 0 ? ` and refreshed ${String(updated.length)}` : ""}.`,
    ...[...added, ...updated].map((q) => `- **${q.id}** (${q.board}): ${q.query}`),
    "Open the Queries tab to copy each one, set an email alert, and tell me how it went with \"Tried it\" — that feedback is what improves the next round.",
  ];
  return lines.join("\n");
}

/** The chat message after a revision: the model's paragraph, then what changed. */
export function reviseMessage(result: ReviseQueriesResult): string {
  const changes: string[] = [];
  if (result.retired.length > 0) changes.push(`Retired: ${result.retired.join(", ")}`);
  if (result.narrowed.length > 0) changes.push(`Narrowed: ${result.narrowed.join(", ")}`);
  if (result.added.length > 0) changes.push(`Added: ${result.added.map((q) => `${q.id} (${q.board})`).join(", ")}`);
  if (result.fieldChanges.length > 0) {
    changes.push(`Fields: ${result.fieldChanges.map((c) => `${c.id} ${c.from} → ${c.to}`).join(", ")}`);
  }
  const parts = [result.explanation.trim()];
  if (changes.length > 0) parts.push(changes.map((c) => `- ${c}`).join("\n"));
  else parts.push("No queries changed.");
  return parts.join("\n\n");
}

function decisionText(decision: ElicitDecision): string {
  return decision.kind === "ask" ? decision.question : decision.summary;
}

function decisionPills(decision: ElicitDecision): AnswerPill[] {
  return decision.kind === "ask" ? decision.pills : [GO_PILL];
}

function warningsNote(warnings: readonly string[]): string[] {
  if (warnings.length === 0) return [];
  const shown = warnings.slice(0, 3).join("; ");
  return [`(Note: ${String(warnings.length)} line${warnings.length === 1 ? "" : "s"} in your profile could not be read: ${shown})`];
}

function respond(profile: Profile, parts: readonly string[], pills: readonly AnswerPill[] = []): TurnResponse {
  const response: TurnResponse = { message: parts.filter((p) => p !== "").join("\n\n"), profileMd: serializeProfile(profile) };
  if (pills.length > 0) response.pills = pills.slice(0, MAX_PILLS);
  return response;
}

function messageContent(request: TurnRequest): string {
  if (request.input.kind !== "message") {
    throw new TurnInputError(`The ${request.step} step needs a message, not query feedback.`);
  }
  return request.input.content;
}

// ---------------------------------------------------------------------------
// The dispatcher
// ---------------------------------------------------------------------------

export async function runTurn(
  request: TurnRequest,
  deps?: TurnDeps,
  onProgress: Progress = () => undefined,
): Promise<TurnResponse> {
  const d = deps ?? (await defaultDeps());
  const { sessionId } = request;
  const { profile, warnings } = parseProfile(request.profileMd);
  const note = warningsNote(warnings);

  switch (request.step) {
    case "cards": {
      const text = messageContent(request);
      onProgress("Reading what you pasted…");
      const extracted = await d.extractCards(d.llm(), { sessionId, text, profile });
      if (activeCards(extracted.profile).length === 0) {
        return respond(extracted.profile, [cardsSummary(extracted.profile), ...note]);
      }
      onProgress("Checking what your experience already says about your preferences…");
      const inferred = await d.inferPreferences(d.llm(), { sessionId, profile: extracted.profile });
      const ctx: ElicitContext = { sectorGroups: await d.sectorGroups() };
      const decision = nextQuestion(inferred.profile, ctx);
      return respond(inferred.profile, [cardsSummary(inferred.profile), decisionText(decision), ...note], decisionPills(decision));
    }

    case "elicit": {
      const answer = messageContent(request);
      const ctx: ElicitContext = { sectorGroups: await d.sectorGroups() };
      const key = nextMissingPreference(profile);
      if (key === undefined) {
        const done = nextQuestion(profile, ctx);
        return respond(profile, [decisionText(done), ...note], decisionPills(done));
      }
      const pill = pillsFor(key, ctx).find((p) => p.value === answer.trim());
      let next: Profile;
      let answered = true;
      if (pill !== undefined) {
        next = applyPillAnswer(profile, key, pill);
      } else {
        onProgress("Noting that…");
        const result = await d.interpretAnswer(d.llm(), { sessionId, profile, key, answer });
        next = result.profile;
        answered = result.answered;
      }
      const decision = nextQuestion(next, ctx);
      const prefix = answered ? [] : ["I did not catch an answer to that one, so here it is again — a rough answer is fine, or pick \"Not sure\"."];
      return respond(next, [...prefix, decisionText(decision), ...note], decisionPills(decision));
    }

    case "discover": {
      messageContent(request);
      onProgress("Matching your experience against climate fields and checking sources — this can take a few minutes…");
      const result = await d.discoverFields({ sessionId, profile });
      const pills = [...explorePills(result.profile)];
      if (canGenerateQueries(result.profile)) pills.push(GENERATE_QUERIES_PILL);
      return respond(result.profile, [discoverMessage(result), ...note], pills);
    }

    case "explore": {
      const text = messageContent(request);
      if (text.trim() === GENERATE_QUERIES_TEXT) return runTurn({ ...request, step: "queries" }, d, onProgress);
      const fieldId = fieldIdIn(text);
      const field = fieldId === undefined ? undefined : profile.fields.find((f) => f.id === fieldId);
      if (field === undefined) {
        const pills = explorePills(profile);
        if (canGenerateQueries(profile)) pills.push(GENERATE_QUERIES_PILL);
        const ask =
          profile.fields.length === 0
            ? "There are no fields on file yet. Say \"go\" and I will look for climate fields that fit your experience."
            : "Which field should I look into? Pick one below, or use the Fields tab.";
        return respond(profile, [ask, ...note], profile.fields.length === 0 ? [GO_PILL] : pills);
      }
      onProgress(`Looking into ${field.name}: titles, employers, example posts…`);
      const result = await d.exploreField({ sessionId, profile, fieldId: field.id });
      const pills = explorePills(result.profile).filter((p) => p.value !== exploreChatText(field));
      if (canGenerateQueries(result.profile)) pills.unshift(GENERATE_QUERIES_PILL);
      return respond(result.profile, [result.message, ...note], pills);
    }

    case "queries": {
      messageContent(request);
      onProgress("Writing search queries for your accepted fields…");
      const result = await d.generateQueries({ sessionId, profile });
      return respond(result.profile, [queriesMessage(result), ...note]);
    }

    case "revise": {
      if (request.input.kind !== "feedback") {
        throw new TurnInputError("The revise step needs \"Tried it\" feedback on a query.");
      }
      onProgress("Revising your queries from that feedback…");
      const result = await d.reviseQueries({ sessionId, profile, feedback: request.input.feedback });
      return respond(result.profile, [reviseMessage(result), ...note]);
    }
  }
}

// ---------------------------------------------------------------------------
// Errors → user-facing text (never model text, never the request)
// ---------------------------------------------------------------------------

const INPUT_ERROR_NAMES = new Set([
  "TurnInputError",
  "CardsInputError",
  "DiscoverInputError",
  "ExploreInputError",
  "QueriesInputError",
]);

/**
 * Our own input errors carry messages written by us, so they are shown as is.
 * Everything else maps by class or HTTP status to a fixed sentence.
 */
export function turnErrorMessage(error: unknown): string {
  if (error instanceof Error && INPUT_ERROR_NAMES.has(error.name)) return error.message;
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "LlmRefusalError":
      return "The model declined to work on that. Try rephrasing, or remove anything that is not about your work.";
    case "LlmTruncatedError":
      return "The answer was cut off before it finished. Try again.";
    case "LlmPauseLimitError":
      return "That search ran too long. Try again; it usually completes on a second attempt.";
    case "LlmOutputError":
      return "The model returned something I could not read. Try again.";
    case "LlmConfigError":
    case "LlmToolPolicyError":
    case "LlmSessionIdError":
      return "The server is misconfigured for model calls. Tell the person running this pilot.";
    case "ReferenceReadError":
      return "The reference collection is unavailable right now. Try again in a minute.";
    case "APIConnectionError":
    case "APIConnectionTimeoutError":
      return "I could not reach the model service. Check your connection and try again.";
    default:
      break;
  }
  const status = typeof error === "object" && error !== null && "status" in error ? (error as { status: unknown }).status : undefined;
  if (status === 429 || status === 529) return "The model service is busy. Wait a minute and try again.";
  if (status === 401 || status === 403) return "The server's model credentials were rejected. Tell the person running this pilot.";
  if (typeof status === "number" && status >= 500) return "The model service had a problem. Try again in a minute.";
  return "Something went wrong on the server. Your message is still here; try again.";
}
