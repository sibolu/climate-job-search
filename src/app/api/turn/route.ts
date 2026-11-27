import { after, type NextRequest, NextResponse } from "next/server";

import { usageWritesSettled } from "@/lib/llm";
import { readSession, SESSION_COOKIE_NAME } from "@/lib/passcode";
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
 * keeps the function alive past the response until this turn's usage rows have
 * been written (not other turns' in the same instance, technical-plan.md D65), bounded by `USAGE_FLUSH_TIMEOUT_MS` (technical-plan.md D64).
 *
 * The signed session cookie is read again here, after the proxy (defence in
 * depth), and is the only source of the access code's key: it goes to
 * `runTurn` with the abort signal, so every model call is metered against
 * that code (technical-plan.md D68, D69). Nothing in the body can set it.
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

export async function POST(request: NextRequest): Promise<Response> {
  // Before the body is read: no valid session, no work (the proxy's wording).
  const session = await readSession(request.cookies.get(SESSION_COOKIE_NAME)?.value, process.env.PASSCODE_COOKIE_SECRET);
  if (session === null) return NextResponse.json({ error: "Access code required." }, { status: 401 });
  // Null is the operator passcode: not metered.
  const codeKey = session.codeKey ?? undefined;

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
    // Only this turn's rows and charges: every call `runTurn` makes carries `abort.signal`.
    await usageWritesSettled(abort.signal);
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
          { signal: abort.signal, codeKey },
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
        // First, so nothing below that throws can leave `after()` waiting
        // until `maxDuration`.
        turnFinished();
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", disconnect);
        if (!closed) {
          closed = true;
          controller.close();
        }
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
