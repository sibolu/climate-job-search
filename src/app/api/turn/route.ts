import { NextResponse } from "next/server";

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
 * `maxDuration` and the heartbeat that keeps the connection alive.
 */
// Segment config must be a literal Next can read at build time; the test pins
// it to `MAX_DURATION_SECONDS` in `llm.ts` (PLAN.md §6).
export const maxDuration = 800;

/** An empty delta every so often, so proxies never see an idle stream. */
const HEARTBEAT_MS = 15_000;

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
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: TurnEvent) => controller.enqueue(encoder.encode(encodeTurnEvent(event)));
      const heartbeat = setInterval(() => write({ type: "delta", text: "" }), HEARTBEAT_MS);
      try {
        const response = await runTurn(turn, undefined, (text) => write({ type: "delta", text: `${text}\n` }));
        write({ type: "final", response });
      } catch (error) {
        // Class name and step only: never the message, which could quote input.
        console.warn(`turn step=${turn.step} failed: ${error instanceof Error ? error.name : typeof error}`);
        write({ type: "error", message: turnErrorMessage(error) });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
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
