/**
 * Browser-side session state and the per-turn payload (PLAN.md §2 "Session
 * state", §7 decisions 3 and 4).
 *
 * Everything about the user lives in the browser: the `profile.md` text (the
 * source of truth — see `profile.ts`), the chat messages, and a random
 * `sessionId` used only to group anonymous `llm_usage` rows. The route
 * handlers are stateless; the browser resends `TurnRequest` every turn and
 * persists nothing server-side. No field here carries identity (name, email);
 * the profile text is user-controlled content the server never stores.
 *
 * Pure module: no React, no Node-only imports. `localStorage` is reached only
 * through the tiny injectable `SessionStore` so tests run in node and SSR
 * never touches `window`.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Limits (generous; route handlers reject bodies beyond these)
// ---------------------------------------------------------------------------

export const MAX_PROFILE_MD_CHARS = 200_000;
export const MAX_MESSAGE_CHARS = 50_000;
export const MAX_MESSAGES_PER_TURN = 200;
export const MAX_FEEDBACK_REASON_CHARS = 5_000;

// ---------------------------------------------------------------------------
// Schemas and types
// ---------------------------------------------------------------------------

/** Bump when `SessionState` changes shape; `importSession` migrates or refuses. */
export const SESSION_VERSION = 1;

/** Which lib module handles the turn; also the `step` column in `llm_usage`. */
export const StepNameSchema = z.enum(["cards", "elicit", "discover", "explore", "queries", "revise"]);
export type StepName = z.infer<typeof StepNameSchema>;

/** A clickable answer the assistant offered; clicking sends `value` as the user message. */
export const AnswerPillSchema = z.object({
  label: z.string().min(1).max(200),
  value: z.string().min(1).max(2_000),
});
export type AnswerPill = z.infer<typeof AnswerPillSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(MAX_MESSAGE_CHARS),
  /** Pills the assistant offered with this message, if any. */
  pills: z.array(AnswerPillSchema).max(20).optional(),
  /** ISO 8601 timestamp, set in the browser. */
  createdAt: z.string().max(40),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** What `localStorage` holds. */
export const SessionStateSchema = z.object({
  version: z.literal(SESSION_VERSION),
  /** Random, anonymous; only ever sent as the `llm_usage` session id. */
  sessionId: z.string().min(8).max(64),
  /** The `profile.md` text; parse with `profile.ts` when structure is needed. */
  profileMd: z.string().max(MAX_PROFILE_MD_CHARS),
  messages: z.array(ChatMessageSchema),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

/** "Tried it" feedback on one query, from the Queries tab. */
export const QueryFeedbackSchema = z.object({
  queryId: z.string().regex(/^Q\d+$/),
  verdict: z.enum(["good", "bad"]),
  reason: z.string().max(MAX_FEEDBACK_REASON_CHARS),
});
export type QueryFeedback = z.infer<typeof QueryFeedbackSchema>;

/** The new thing the user did this turn: typed a message, or filed feedback. */
export const TurnInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), content: z.string().min(1).max(MAX_MESSAGE_CHARS) }),
  z.object({ kind: z.literal("feedback"), feedback: QueryFeedbackSchema }),
]);
export type TurnInput = z.infer<typeof TurnInputSchema>;

/** What the browser POSTs each turn. Route handlers validate with `parseTurnRequest`. */
export const TurnRequestSchema = z.object({
  sessionId: z.string().min(8).max(64),
  step: StepNameSchema,
  profileMd: z.string().max(MAX_PROFILE_MD_CHARS),
  /** Already trimmed by the browser (see `trimMessages`). */
  messages: z.array(ChatMessageSchema).max(MAX_MESSAGES_PER_TURN),
  input: TurnInputSchema,
});
export type TurnRequest = z.infer<typeof TurnRequestSchema>;

/** What a turn returns once streaming completes. */
export const TurnResponseSchema = z.object({
  message: z.string(),
  /** Full replacement for the profile text when the assistant revised it. */
  profileMd: z.string().max(MAX_PROFILE_MD_CHARS).optional(),
  pills: z.array(AnswerPillSchema).max(20).optional(),
});
export type TurnResponse = z.infer<typeof TurnResponseSchema>;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

/** Random 32-hex-char id. Uses Web Crypto where available; never identifying. */
export function newSessionId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().replace(/-/g, "");
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newSessionState(): SessionState {
  return { version: SESSION_VERSION, sessionId: newSessionId(), profileMd: "", messages: [] };
}

/** A fresh session: empty profile, no messages, new anonymous id. */
export function startOver(): SessionState {
  return newSessionState();
}

export function appendMessage(
  state: SessionState,
  message: Omit<ChatMessage, "createdAt"> & { createdAt?: string },
): SessionState {
  const full: ChatMessage = { ...message, createdAt: message.createdAt ?? new Date().toISOString() };
  return { ...state, messages: [...state.messages, full] };
}

/**
 * Keeps only the last `keepLastN` messages (PLAN.md §6 "Per-turn payload
 * grows"). The profile is the compressed memory, so older chat is safe to drop.
 */
export function trimMessages(state: SessionState, keepLastN: number): SessionState {
  const n = Math.max(0, Math.floor(keepLastN));
  if (state.messages.length <= n) return state;
  return { ...state, messages: state.messages.slice(state.messages.length - n) };
}

/** The JSON the "Export" button downloads. */
export function exportSession(state: SessionState): string {
  return JSON.stringify(state, null, 2);
}

/** Validates an exported file. Never throws; unknown versions are refused. */
export function importSession(json: string): Result<SessionState> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "Not a valid JSON file." };
  }
  return validateSession(raw);
}

/** Validates an already-parsed value (from `JSON.parse` or storage). */
export function validateSession(raw: unknown): Result<SessionState> {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Not a session export." };
  }
  const version = (raw as { version?: unknown }).version;
  if (version !== SESSION_VERSION) {
    return {
      ok: false,
      error: `Unsupported session version ${String(version)} (expected ${SESSION_VERSION}).`,
    };
  }
  const parsed = SessionStateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: `Session is malformed: ${firstIssue(parsed.error)}` };
  return { ok: true, value: parsed.data };
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "unknown error";
  const path = issue.path.length > 0 ? `${issue.path.map(String).join(".")}: ` : "";
  return `${path}${issue.message}`;
}

// ---------------------------------------------------------------------------
// Per-turn payload
// ---------------------------------------------------------------------------

export interface BuildTurnRequestOptions {
  /** Messages to send; defaults to `DEFAULT_KEEP_LAST_N`. */
  keepLastN?: number;
}

export const DEFAULT_KEEP_LAST_N = 20;

/** Assembles the POST body for one turn from browser state. */
export function buildTurnRequest(
  state: SessionState,
  step: StepName,
  input: TurnInput,
  { keepLastN = DEFAULT_KEEP_LAST_N }: BuildTurnRequestOptions = {},
): TurnRequest {
  return {
    sessionId: state.sessionId,
    step,
    profileMd: state.profileMd,
    messages: trimMessages(state, keepLastN).messages,
    input,
  };
}

/** Route-handler side: validates an untrusted request body. Never throws. */
export function parseTurnRequest(raw: unknown): Result<TurnRequest> {
  const parsed = TurnRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: `Invalid turn request: ${firstIssue(parsed.error)}` };
  return { ok: true, value: parsed.data };
}

// ---------------------------------------------------------------------------
// Storage adapter
// ---------------------------------------------------------------------------

export const SESSION_STORAGE_KEY = "cjs.session";

/** The subset of the Storage interface this module needs. */
export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory store for tests and SSR. */
export function memoryStore(initial: Record<string, string> = {}): SessionStore {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/**
 * `localStorage` behind try/catch. When it is unavailable (SSR, disabled
 * storage, private mode quirks) every operation is a safe no-op.
 */
export function browserStore(): SessionStore {
  const get = (): Storage | null => {
    try {
      const ls = globalThis.localStorage;
      return ls ?? null;
    } catch {
      return null;
    }
  };
  return {
    getItem: (k) => {
      try {
        return get()?.getItem(k) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        get()?.setItem(k, v);
      } catch {
        /* quota or disabled storage: state stays in memory for this page load */
      }
    },
    removeItem: (k) => {
      try {
        get()?.removeItem(k);
      } catch {
        /* nothing to remove */
      }
    },
  };
}

/** Loads the saved session, or a fresh one when nothing valid is stored. */
export function loadSession(store: SessionStore = browserStore()): SessionState {
  const raw = store.getItem(SESSION_STORAGE_KEY);
  if (raw === null) return newSessionState();
  const result = importSession(raw);
  return result.ok ? result.value : newSessionState();
}

export function saveSession(state: SessionState, store: SessionStore = browserStore()): void {
  store.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
}

export function clearSession(store: SessionStore = browserStore()): void {
  store.removeItem(SESSION_STORAGE_KEY);
}
