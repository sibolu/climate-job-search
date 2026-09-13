/**
 * `turn-stream.ts` — the wire format between the browser workspace and
 * `POST /api/turn` (the route handler itself arrives in step 2.5).
 *
 * The response is `application/x-ndjson`: one JSON object per line, each a
 * {@link TurnEvent}. `encodeTurnEvent` is the server half, `decodeTurnEvents`
 * the browser half. Both are pure — no DOM, no `fetch` — so they are unit
 * tested directly; `sendTurn` is the thin IO wrapper around them and takes an
 * injectable `fetch`.
 *
 * The decoder never throws on bad input. A malformed line (invalid JSON, an
 * event that fails the schema, or a truncated final line) is yielded as an
 * `error` event so the chat can show it and keep the user's text, which is
 * what the UI wants in every failure mode anyway.
 *
 * No user data is stored server-side (PRD): the request body is assembled by
 * `buildTurnRequest` in `session.ts` from browser state and nothing else
 * leaves the page.
 */

import { z } from "zod";

import type { TurnRequest } from "./session";
import { TurnResponseSchema } from "./session";

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const TurnEventSchema = z.discriminatedUnion("type", [
  /** A chunk of assistant text; append it to the streaming bubble. */
  z.object({ type: z.literal("delta"), text: z.string() }),
  /** End of turn: `response.message` replaces the streamed text. */
  z.object({ type: z.literal("final"), response: TurnResponseSchema }),
  /** Something went wrong; show it and keep the user's input. */
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type TurnEvent = z.infer<typeof TurnEventSchema>;

export const NDJSON_CONTENT_TYPE = "application/x-ndjson";

/** One NDJSON line, newline included. */
export function encodeTurnEvent(event: TurnEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function errorEvent(message: string): TurnEvent {
  return { type: "error", message };
}

/** Parses one NDJSON line; malformed lines become `error` events. */
export function decodeTurnEventLine(line: string): TurnEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return errorEvent("The server sent a malformed event.");
  }
  const parsed = TurnEventSchema.safeParse(raw);
  if (!parsed.success) return errorEvent("The server sent an unrecognized event.");
  return parsed.data;
}

/**
 * Decodes a byte stream of NDJSON into events. Chunk boundaries are
 * irrelevant: a line split across chunks is buffered until its newline
 * arrives, and a trailing line with no newline is decoded at the end (a
 * truncated one becomes an `error` event).
 */
export async function* decodeTurnEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<TurnEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line !== "") yield decodeTurnEventLine(line);
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    const rest = buffer.trim();
    if (rest !== "") yield decodeTurnEventLine(rest);
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export const TURN_ENDPOINT = "/api/turn";

export interface SendTurnOptions {
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  url?: string;
}

export type SendTurnResult =
  | { ok: true; events: AsyncIterable<TurnEvent> }
  /** The passcode session expired: the caller redirects to `/enter`. */
  | { ok: false; kind: "unauthorized" }
  | { ok: false; kind: "error"; message: string };

/**
 * POSTs one turn and returns its event stream. Accepts any `TurnRequest`, so
 * feedback turns (step 2.4) work the same way as message turns.
 */
export async function sendTurn(
  request: TurnRequest,
  { signal, fetchImpl, url = TURN_ENDPOINT }: SendTurnOptions = {},
): Promise<SendTurnResult> {
  const doFetch = fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    return { ok: false, kind: "error", message: "Could not reach the server. Check your connection and try again." };
  }

  if (response.status === 401) return { ok: false, kind: "unauthorized" };
  if (!response.ok) {
    return { ok: false, kind: "error", message: `The server returned an error (${response.status}).` };
  }
  if (response.body === null) {
    return { ok: false, kind: "error", message: "The server sent an empty response." };
  }
  return { ok: true, events: decodeTurnEvents(response.body) };
}
