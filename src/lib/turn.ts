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
 * - `discover` ranked fields and roles from the cards and the model's own
 *              knowledge: no reference catalogue, no web (D44, D61).
 * - `explore`  `Explore F3: …` → the drill-down on that field. A message
 *              with no field id is answered with a list of fields to pick.
 *              The browser never sends it (only scripts do, D39), and it is
 *              the one step that still reads the Supabase reference tables.
 * - `queries`  one LinkedIn search per selected role, for every role with
 *              `Selected: yes`; a `selectedRoles` input (technical-plan.md D47).
 * - `revise`   one piece of "Tried it" feedback → revised queries and an
 *              explanation.
 *
 * Every model call happens inside the step modules, which all go through
 * `llm.ts`, and every one carries the turn's {@link CallContext}: the abort
 * signal, so a browser that goes away stops the call in flight
 * (technical-plan.md D45), and the access code's key from the signed session
 * cookie, so the call is metered against that code's budget (D68, D69). The
 * route is the only source of either; `TurnRequest` carries neither. Errors
 * are mapped to user-facing sentences by {@link turnErrorMessage}, which
 * never includes model text or the request.
 */

import { cardsSummary, extractCards } from "./cards";
import { FIND_ROLES_PILL } from "./screens";
import { discoverFields, type DiscoverResult } from "./discover";
import {
  applyPillAnswer,
  type ElicitDecision,
  inferPreferences,
  interpretAnswer,
  nextMissingPreference,
  nextQuestion,
  pillsFor,
} from "./elicit";
import { exploreField } from "./explore";
import type { Llm, StructuredRequest, StreamTextRequest } from "./llm";
import { activeCards, type Field, isDropped, type MoveType, parseProfile, type Profile, type Query, serializeProfile } from "./profile";
import { generateQueries, type GenerateQueriesResult, reviseQueries, type ReviseQueriesResult } from "./queries";
import type { AnswerPill, TurnRequest, TurnResponse } from "./session";
import { exploreChatText } from "./workspace";

// ---------------------------------------------------------------------------
// Dependencies (injectable for tests; the defaults are the real modules)
// ---------------------------------------------------------------------------

export interface TurnDeps {
  llm: () => Llm;
  extractCards: typeof extractCards;
  inferPreferences: typeof inferPreferences;
  interpretAnswer: typeof interpretAnswer;
  discoverFields: typeof discoverFields;
  exploreField: typeof exploreField;
  generateQueries: typeof generateQueries;
  reviseQueries: typeof reviseQueries;
}

/** `llm.ts` is loaded lazily so tests never touch env. */
export async function defaultDeps(): Promise<TurnDeps> {
  const { llm } = await import("./llm");
  return {
    llm,
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

/**
 * Offered when elicitation is complete; the browser routes "go" to `discover`.
 * The label is the Highlights button's ("Find climate roles"), owned by the
 * browser-safe `screens.ts` so client and server share one source.
 */
export const GO_PILL: AnswerPill = FIND_ROLES_PILL;

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
  // A role this run dropped (D58) is not listed beside the one that replaced it.
  const roles = profile.roles.filter((r) => r.fieldId === field.id && !isDropped(r));
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
      "I could not find climate fields I can tie to these cards.",
      "More detail on the experience cards about what the work involved gives discovery more to match against.",
    ].join("\n\n");
  }
  const n = fields.length;
  const parts = [
    `Here ${n === 1 ? "is" : "are"} ${String(n)} climate field${n === 1 ? "" : "s"} where your experience could land, ranked.`,
    ...fields.map((f) => fieldBlock(profile, f)),
  ];
  // Every kind of drop is counted under its own reason (technical-plan.md D48 for titles).
  const count = (k: number, noun: string) => `${String(k)} ${noun}${k === 1 ? "" : "s"}`;
  const uncited = dropped.fieldsUncited + dropped.rolesUncited;
  const leftOut = [
    uncited > 0 ? `${count(uncited, "suggestion")} that cited none of your experience cards` : "",
    dropped.rolesLevelTitled > 0 ? `${count(dropped.rolesLevelTitled, "role")} titled by rank rather than occupation` : "",
    dropped.rolesSurplus > 0 ? `${count(dropped.rolesSurplus, "role")} beyond the number shown per field` : "",
    dropped.fieldsSurplus > 0 ? `${count(dropped.fieldsSurplus, "field")} beyond the number shown` : "",
  ].filter((reason) => reason !== "");
  if (leftOut.length > 0) parts.push(`Left out: ${leftOut.join("; ")}.`);
  parts.push("On the Roles screen, tick the roles you want a LinkedIn search for.");
  return parts.join("\n\n");
}

/** The chat message after query generation: one LinkedIn search per selected role (technical-plan.md D47). */
export function queriesMessage(result: GenerateQueriesResult): string {
  const { written } = result;
  if (written.length === 0) return "I could not write any searches this time. Try again.";
  const title = (q: Query) => result.roles.find((r) => r.id === q.roleId)?.title ?? q.roleId;
  const intro =
    written.length === 1
      ? "Here is a LinkedIn search for the role you selected"
      : `Here are ${String(written.length)} LinkedIn searches, one for each role you selected`;
  const refreshed = result.updated.length === 0 ? "" : ` (${String(result.updated.length)} replaced an earlier untried search)`;
  const lines = [
    `${intro}${refreshed}:`,
    ...written.map((q) => `- **${title(q)}** (${q.id}): ${q.query}`),
    "The Searches screen lists each one to copy into LinkedIn, with the steps to set an email alert.",
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
    throw new TurnInputError(`The ${request.step} step needs a message.`);
  }
  return request.input.content;
}

// ---------------------------------------------------------------------------
// The dispatcher
// ---------------------------------------------------------------------------

/**
 * What every model call in a turn carries besides its own request, set by the
 * route and never by the browser's body: the abort signal (technical-plan.md
 * D45) and the access code's key from the signed session cookie (D68). The
 * key is required: every call is metered, and `llm.ts` refuses one without a
 * key (D71). The `try:*` scripts set it from `ACCESS_CODE`.
 */
export interface CallContext {
  signal?: AbortSignal;
  codeKey: string;
}

/**
 * The same `Llm` with the turn's context on every request, so each step
 * module's calls stop when the turn is abandoned and are charged to the
 * access code without the modules knowing about either. The signal is set
 * only when defined; the key always is.
 */
export function withCallContext(llm: Llm, context: CallContext): Llm {
  const extra: CallContext = { codeKey: context.codeKey };
  if (context.signal !== undefined) extra.signal = context.signal;
  return {
    streamText: (request: StreamTextRequest) => llm.streamText({ ...request, ...extra }),
    structured: (request) => llm.structured({ ...request, ...extra } as StructuredRequest<typeof request.schema>),
  };
}

export async function runTurn(
  request: TurnRequest,
  deps: TurnDeps | undefined,
  onProgress: Progress = () => undefined,
  context: CallContext,
): Promise<TurnResponse> {
  const base = deps ?? (await defaultDeps());
  const d: TurnDeps = { ...base, llm: () => withCallContext(base.llm(), context) };
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
      const decision = nextQuestion(inferred.profile);
      return respond(inferred.profile, [cardsSummary(inferred.profile), decisionText(decision), ...note], decisionPills(decision));
    }

    case "elicit": {
      const answer = messageContent(request);
      const key = nextMissingPreference(profile);
      if (key === undefined) {
        const done = nextQuestion(profile);
        return respond(profile, [decisionText(done), ...note], decisionPills(done));
      }
      const pill = pillsFor(key).find((p) => p.value === answer.trim());
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
      const decision = nextQuestion(next);
      const prefix = answered ? [] : ["I did not catch an answer to that one, so here it is again."];
      return respond(next, [...prefix, decisionText(decision), ...note], decisionPills(decision));
    }

    case "discover": {
      messageContent(request);
      onProgress("Matching your experience against climate fields — this can take a minute or two…");
      // No `catalogue` option: memory mode, so nothing here reads the reference tables (technical-plan.md D61).
      const result = await d.discoverFields({ sessionId, profile }, { llm: d.llm() });
      return respond(result.profile, [discoverMessage(result), ...note], explorePills(result.profile));
    }

    case "explore": {
      const text = messageContent(request);
      const fieldId = fieldIdIn(text);
      const field = fieldId === undefined ? undefined : profile.fields.find((f) => f.id === fieldId);
      if (field === undefined) {
        const pills = explorePills(profile);
        const ask =
          profile.fields.length === 0
            ? "There are no fields on the profile yet; discovery has to run first."
            : "Which field should be explored? Name it by id, such as F1.";
        return respond(profile, [ask, ...note], profile.fields.length === 0 ? [GO_PILL] : pills);
      }
      onProgress(`Looking into ${field.name}: titles, employers, example posts…`);
      const result = await d.exploreField({ sessionId, profile, fieldId: field.id }, { llm: d.llm() });
      const pills = explorePills(result.profile).filter((p) => p.value !== exploreChatText(field));
      return respond(result.profile, [result.message, ...note], pills);
    }

    case "queries": {
      if (request.input.kind !== "selectedRoles") {
        throw new TurnInputError("The queries step writes searches for the selected roles; it takes no message.");
      }
      onProgress("Writing a LinkedIn search for each role you selected…");
      const result = await d.generateQueries({ sessionId, profile }, { llm: d.llm() });
      return respond(result.profile, [queriesMessage(result), ...note]);
    }

    case "revise": {
      if (request.input.kind !== "feedback") {
        throw new TurnInputError("The revise step needs \"Tried it\" feedback on a query.");
      }
      onProgress("Revising your queries from that feedback…");
      const result = await d.reviseQueries({ sessionId, profile, feedback: request.input.feedback }, { llm: d.llm() });
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
    case "LlmTimeoutError":
      return "That took more than three minutes, so I stopped it. Try again; if it keeps happening, exclude a highlight or two.";
    case "LlmCancelledError":
      return "That request was stopped before it finished. Try again.";
    case "LlmPauseLimitError":
      return "That search ran too long. Try again; it usually completes on a second attempt.";
    case "LlmOutputError":
      return "The model returned something I could not read. Try again.";
    case "QueriesOutputError":
      return "The searches did not come back complete for every selected role. Try again.";
    case "LlmConfigError":
    case "LlmToolPolicyError":
    case "LlmSessionIdError":
      return "The server is misconfigured for model calls. Tell the person running this pilot.";
    // Discovery reads no catalogue (D61), but `explore`, which only scripts
    // send, still reads the reference tables through the same route.
    case "ReferenceReadError":
      return "The reference collection is unavailable right now. Try again in a minute.";
    case "LlmBudgetError":
      return budgetMessage(error);
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

/** What the person still has, said in every budget sentence: the code ran out, their work did not. */
const STILL_HERE = "Everything you have so far is still in this browser, and you can save a copy from Your profile.";

/**
 * One sentence per `LlmBudgetError` reason (technical-plan.md D69). Read
 * defensively, since `turnErrorMessage` takes `unknown`: an unrecognised
 * reason gets the `unavailable` sentence, which asks only for a retry.
 */
function budgetMessage(error: unknown): string {
  const reason = typeof error === "object" && error !== null && "reason" in error ? (error as { reason: unknown }).reason : undefined;
  switch (reason) {
    case "exhausted":
      return `This access code has used up its budget, so I can't run that. ${STILL_HERE}`;
    case "inactive":
      return `This access code is no longer active, so I can't run that. ${STILL_HERE} Ask the person who invited you for a new code.`;
    default:
      return `I couldn't check this access code's budget just now, so nothing was run. ${STILL_HERE} Try again in a minute.`;
  }
}
