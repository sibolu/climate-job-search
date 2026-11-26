import { after, NextResponse } from "next/server";

import { usageWritesSettled } from "@/lib/llm";
import { parseTurnRequest } from "@/lib/session";
import { runTurn, turnErrorMessage } from "@/lib/turn";
import { encodeTurnEvent, NDJSON_CONTENT_TYPE, type TurnEvent } from "@/lib/turn-stream";

/**
 * The one turn endpoint (Phase 2.5). The browser POSTs a `TurnRequest`
 * (profile + trimmed chat + the new input); the response is NDJSON — progress
 * `delta`s while a slow step runs, then one `final` with the assistant message
 * and the full replacement `profile.md`, or one `error`.
 *
 * Stateless: nothing is stored or logged except the anonymous usage row that
 * `llm.ts` writes. Discovery and exploration can run for minutes, hence
 * `maxDuration` and the heartbeat that keeps the connection alive. `after()`
 * keeps the function alive past the response until the turn's usage rows have
 * been written, bounded by `USAGE_FLUSH_TIMEOUT_MS` (technical-plan.md D64).
 */
// Segment config must be a literal Next can read at build time; the test pins
// it to `MAX_DURATION_SECONDS` in `llm.ts` (technical-plan.md §4).
export const maxDuration = 800;

/** An empty delta every so often, so proxies never see an idle stream. */
const HEARTBEAT_MS = 15_000;

/**
 * Thrown out of the progress callback once the client is gone, so a multi-call
 * step stops before it starts the next model call. A model call already in
 * flight is stopped by the abort signal `runTurn` passes to `llm.ts`
 * (technical-plan.md D45).
 */
class TurnDisconnectedError extends Error {
  constructor() {
    super("The client disconnected.");
    this.name = "TurnDisconnectedError";
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be JSON." }, { status: 400 });
  }
  const parsed = parseTurnRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const turn = parsed.value;

  const encoder = new TextEncoder();
  // Set by `cancel` (the client went away) and by the `finally` below. Every
  // write checks it: enqueueing on a closed controller throws, and the
  // heartbeat's throw would land in a timer callback with nobody to catch it.
  let closed = false;
  // Fires when the browser goes away, by either route Next reports it: the
  // response stream is cancelled, or the request's own signal aborts.
  const abort = new AbortController();
  const disconnect = () => {
    closed = true;
    abort.abort();
  };
  request.signal.addEventListener("abort", disconnect, { once: true });
  // Resolved in the `finally` below, on every path: success, error, and a
  // disconnect, where the aborted call still writes its row (D45).
  let turnFinished!: () => void;
  const turnDone = new Promise<void>((resolve) => {
    turnFinished = resolve;
  });
  // Runs once the response has closed. On Vercel the function would otherwise
  // be suspended before the last call's usage insert lands (likely cause of
  // the missing rows, technical-plan.md D64). The response is never delayed:
  // this only extends the invocation, and `usageWritesSettled` never rejects.
  after(async () => {
    await turnDone;
    await usageWritesSettled();
  });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: TurnEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeTurnEvent(event)));
      };
      const heartbeat = setInterval(() => write({ type: "delta", text: "" }), HEARTBEAT_MS);
      try {
        const response = await runTurn(
          turn,
          undefined,
          (text) => {
            if (closed) throw new TurnDisconnectedError();
            write({ type: "delta", text: `${text}\n` });
          },
          abort.signal,
        );
        write({ type: "final", response });
      } catch (error) {
        // Nobody is listening once the client is gone; the aborted call's
        // usage row is already written.
        if (!(error instanceof TurnDisconnectedError) && !abort.signal.aborted) {
          // Class name and step only: never the message, which could quote input.
          console.warn(`turn step=${turn.step} failed: ${error instanceof Error ? error.name : typeof error}`);
          write({ type: "error", message: turnErrorMessage(error) });
        }
      } finally {
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", disconnect);
        if (!closed) {
          closed = true;
          controller.close();
        }
        turnFinished();
      }
    },
    cancel() {
      disconnect();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": NDJSON_CONTENT_TYPE,
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
