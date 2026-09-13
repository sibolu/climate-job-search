import { describe, expect, it } from "vitest";

import type { TurnRequest } from "./session";
import { newSessionState, buildTurnRequest } from "./session";
import {
  decodeTurnEventLine,
  decodeTurnEvents,
  encodeTurnEvent,
  sendTurn,
  TurnEventSchema,
  type TurnEvent,
} from "./turn-stream";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of decodeTurnEvents(stream)) events.push(event);
  return events;
}

const FINAL: TurnEvent = {
  type: "final",
  response: { message: "All done.", profileMd: "# profile.md\n", pills: [{ label: "Yes", value: "yes" }] },
};

describe("encodeTurnEvent", () => {
  it("writes one newline-terminated JSON object", () => {
    const line = encodeTurnEvent({ type: "delta", text: "hi" });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line.trim())).toEqual({ type: "delta", text: "hi" });
  });

  it("round-trips every event kind", async () => {
    const events: TurnEvent[] = [
      { type: "delta", text: "a" },
      { type: "error", message: "boom" },
      FINAL,
    ];
    expect(await collect(streamOf(events.map(encodeTurnEvent)))).toEqual(events);
  });
});

describe("decodeTurnEvents", () => {
  it("reassembles lines split across chunks", async () => {
    const wire = [encodeTurnEvent({ type: "delta", text: "hello " }), encodeTurnEvent(FINAL)].join("");
    const chunks = [wire.slice(0, 7), wire.slice(7, 25), wire.slice(25, 60), wire.slice(60)];
    expect(await collect(streamOf(chunks))).toEqual([{ type: "delta", text: "hello " }, FINAL]);
  });

  it("splits a multibyte character across chunks without corrupting it", async () => {
    const bytes = new TextEncoder().encode(encodeTurnEvent({ type: "delta", text: "café ☕" }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 20));
        controller.enqueue(bytes.slice(20));
        controller.close();
      },
    });
    expect(await collect(stream)).toEqual([{ type: "delta", text: "café ☕" }]);
  });

  it("decodes a trailing line that has no newline", async () => {
    const wire = encodeTurnEvent({ type: "delta", text: "a" }) + JSON.stringify(FINAL);
    expect(await collect(streamOf([wire]))).toEqual([{ type: "delta", text: "a" }, FINAL]);
  });

  it("reports a truncated trailing line as an error event instead of throwing", async () => {
    const events = await collect(streamOf([`{"type":"delta","text":"a"}\n{"type":"fin`]));
    expect(events[0]).toEqual({ type: "delta", text: "a" });
    expect(events[1]?.type).toBe("error");
  });

  it("ignores blank lines and rejects unknown event shapes", async () => {
    const events = await collect(streamOf(['\n\n{"type":"nope"}\n', encodeTurnEvent({ type: "delta", text: "z" })]));
    expect(events.map((e) => e.type)).toEqual(["error", "delta"]);
  });

  it("never surfaces model text from a malformed line", () => {
    const event = decodeTurnEventLine('{"type":"delta"');
    expect(event).toEqual({ type: "error", message: "The server sent a malformed event." });
  });

  it("rejects a final event whose response is not a TurnResponse", () => {
    expect(TurnEventSchema.safeParse({ type: "final", response: { message: 3 } }).success).toBe(false);
  });
});

describe("sendTurn", () => {
  const request: TurnRequest = buildTurnRequest(newSessionState(), "cards", {
    kind: "message",
    content: "some pasted text",
  });

  it("posts the request and streams its events", async () => {
    let seen: { url: string; body: unknown } | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(streamOf([encodeTurnEvent(FINAL)]), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await sendTurn(request, { fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const events: TurnEvent[] = [];
    for await (const event of result.events) events.push(event);
    expect(events).toEqual([FINAL]);
    expect(seen!.url).toBe("/api/turn");
    expect(seen!.body).toEqual(request);
  });

  it("accepts a feedback turn", async () => {
    const feedbackRequest = buildTurnRequest(newSessionState(), "revise", {
      kind: "feedback",
      feedback: { queryId: "Q1", verdict: "bad", reason: "all senior roles" },
    });
    const fetchImpl = (async () =>
      new Response(streamOf([encodeTurnEvent(FINAL)]), { status: 200 })) as unknown as typeof fetch;
    const result = await sendTurn(feedbackRequest, { fetchImpl });
    expect(result.ok).toBe(true);
  });

  it("flags a 401 so the caller can redirect to /enter", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const result = await sendTurn(request, { fetchImpl });
    expect(result).toEqual({ ok: false, kind: "unauthorized" });
  });

  it("reports other failures without throwing", async () => {
    const failing = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const offline = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await sendTurn(request, { fetchImpl: failing })).toMatchObject({ ok: false, kind: "error" });
    expect(await sendTurn(request, { fetchImpl: offline })).toMatchObject({ ok: false, kind: "error" });
  });
});
