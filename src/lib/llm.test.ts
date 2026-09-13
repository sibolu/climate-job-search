import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  BLOCKED_DOMAINS,
  EFFORT_BY_STEP,
  LlmOutputError,
  LlmPauseLimitError,
  LlmRefusalError,
  LlmSessionIdError,
  LlmToolPolicyError,
  LlmTruncatedError,
  MAX_DURATION_SECONDS,
  MAX_RETRIES,
  MODEL,
  REQUEST_TIMEOUT_MS,
  USAGE_ROW_KEYS,
  assertToolsAllowed,
  costUsd,
  createLlm,
  memoryUsageSink,
  webTools,
  type LlmClient,
  type LlmStream,
  type UsageRow,
  type UsageSink,
} from "./llm";
import { BLOCKED_SOURCE_DOMAINS } from "./reference-schema";
import { StepNameSchema, newSessionId } from "./session";

// ---------------------------------------------------------------------------
// Fake client
// ---------------------------------------------------------------------------

interface FakeTurn {
  text?: string;
  stopReason: Anthropic.StopReason;
  usage?: Partial<Anthropic.Usage>;
  category?: string;
  /** Reject the request with this error instead of answering. */
  error?: Error;
}

function fakeMessage(turn: FakeTurn): Anthropic.Message {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: MODEL,
    content: turn.text === undefined ? [] : [{ type: "text", text: turn.text, citations: null }],
    stop_reason: turn.stopReason,
    stop_sequence: null,
    stop_details:
      turn.stopReason === "refusal"
        ? { type: "refusal", category: turn.category ?? "cyber", explanation: "not logged" }
        : null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      output_tokens_details: null,
      ...turn.usage,
    } as Anthropic.Usage,
  } as Anthropic.Message;
}

/** Splits at word boundaries so a multi-word answer streams as several deltas. */
function chunks(text: string): string[] {
  return text.split(/(?= )/);
}

function fakeStream(turn: FakeTurn, onDelta?: () => void): LlmStream {
  const message = fakeMessage(turn);
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<Anthropic.MessageStreamEvent> {
      if (turn.error !== undefined) throw turn.error;
      if (turn.text !== undefined) {
        for (const chunk of chunks(turn.text)) {
          onDelta?.();
          yield {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: chunk },
          } as Anthropic.MessageStreamEvent;
          // Yield to the event loop between deltas, like a real socket would.
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    },
    finalMessage: () => Promise.resolve(message),
  };
}

interface Fake {
  client: LlmClient;
  params: Anthropic.MessageCreateParamsNonStreaming[];
  /** How many deltas the fake stream has produced so far, across requests. */
  deltasProduced: () => number;
}

/** Replays `turns` one per request, so a `pause_turn` test can script both. */
function fakeClient(turns: FakeTurn[]): Fake {
  const params: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let produced = 0;
  const next = (p: Anthropic.MessageCreateParamsNonStreaming): FakeTurn => {
    params.push(p);
    const turn = turns[params.length - 1];
    if (turn === undefined) throw new Error(`fake client ran out of turns (${params.length})`);
    return turn;
  };
  return {
    params,
    deltasProduced: () => produced,
    client: {
      stream: (p) => fakeStream(next(p), () => (produced += 1)),
      create: (p) => {
        const turn = next(p);
        return turn.error === undefined ? Promise.resolve(fakeMessage(turn)) : Promise.reject(turn.error);
      },
    },
  };
}

async function drain(deltas: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const delta of deltas) out.push(delta);
  return out;
}

const SESSION_ID = "0123456789abcdef0123456789abcdef";

const REQUEST = {
  step: "elicit",
  sessionId: SESSION_ID,
  system: "You are a careers assistant.",
  messages: [{ role: "user", content: "hello" }],
} as const;

// ---------------------------------------------------------------------------
// Blocked domains
// ---------------------------------------------------------------------------

describe("blocked domains", () => {
  it("puts all three domains on both web tools", () => {
    const tools = webTools();
    expect(tools).toHaveLength(2);
    for (const tool of tools) {
      expect((tool as { blocked_domains?: string[] }).blocked_domains).toEqual([
        ...BLOCKED_DOMAINS,
      ]);
    }
    expect(tools.map((tool) => (tool as { type: string }).type)).toEqual([
      "web_search_20260209",
      "web_fetch_20260209",
    ]);
    expect(tools.every((tool) => ((tool as { max_uses?: number }).max_uses ?? 0) > 0)).toBe(true);
  });

  it("refuses a web tool that is missing a blocked domain", () => {
    const sloppy = [
      {
        type: "web_search_20260209",
        name: "web_search",
        blocked_domains: ["linkedin.com", "indeed.com"],
      },
    ] as unknown as Parameters<typeof assertToolsAllowed>[0];
    expect(() => assertToolsAllowed(sloppy)).toThrow(LlmToolPolicyError);
    expect(() => assertToolsAllowed(sloppy)).toThrow(/climatebase\.org/);
  });

  it("refuses a web tool that blocks nothing, and accepts webTools()", () => {
    const bare = [{ type: "web_fetch_20260209", name: "web_fetch" }] as unknown as Parameters<
      typeof assertToolsAllowed
    >[0];
    expect(() => assertToolsAllowed(bare)).toThrow(LlmToolPolicyError);
    expect(() => assertToolsAllowed(webTools())).not.toThrow();
  });

  it("is the one list owned by reference-schema.ts, not a copy (PLAN.md §7.13)", () => {
    expect(BLOCKED_DOMAINS).toBe(BLOCKED_SOURCE_DOMAINS);
    expect(BLOCKED_DOMAINS).toEqual(["linkedin.com", "indeed.com", "climatebase.org"]);
  });

  it("refuses a call whose tools break the policy, before any request", async () => {
    const { client, params } = fakeClient([{ text: "hi", stopReason: "end_turn" }]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink });
    const bad = [
      { type: "web_search_20260209", name: "web_search", blocked_domains: [] },
    ] as unknown as ReturnType<typeof webTools>;

    await expect(llm.structured({ ...REQUEST, schema: z.object({}), tools: bad })).rejects.toThrow(
      LlmToolPolicyError,
    );
    const streamed = llm.streamText({ ...REQUEST, tools: bad });
    await expect(drain(streamed.textDeltas)).rejects.toThrow(LlmToolPolicyError);
    await expect(streamed.final).rejects.toThrow(LlmToolPolicyError);
    expect(params).toHaveLength(0);
    expect(sink.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("effort", () => {
  it("covers every StepName", () => {
    expect(Object.keys(EFFORT_BY_STEP).sort()).toEqual([...StepNameSchema.options].sort());
    expect(EFFORT_BY_STEP.elicit).toBe("medium");
    expect(EFFORT_BY_STEP.cards).toBe("medium");
    expect(EFFORT_BY_STEP.discover).toBe("high");
  });
});

describe("timeouts", () => {
  it("keeps every attempt of one logical call inside the Vercel maxDuration", () => {
    // The SDK retries a timed-out attempt, so the worst case is attempts × timeout.
    expect((MAX_RETRIES + 1) * REQUEST_TIMEOUT_MS).toBeLessThan(MAX_DURATION_SECONDS * 1000);
    // Discovery turns with web search legitimately run 1–3 minutes (PLAN.md §6).
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(3 * 60 * 1000);
  });
});

describe("cost", () => {
  it("prices a known usage object", () => {
    // 1M in + 1M out + 1M cache read + 1M cache write = 5 + 25 + 0.5 + 6.25
    expect(
      costUsd({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }),
    ).toBeCloseTo(36.75, 6);
    // A realistic chat turn: 3k in, 700 out, 12k cache read.
    expect(costUsd({ input: 3_000, output: 700, cacheRead: 12_000, cacheWrite: 0 })).toBeCloseTo(
      0.038500,
      6,
    );
    expect(costUsd({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Session id
// ---------------------------------------------------------------------------

describe("session id", () => {
  const badIds = ["session-abcdef12", "someone@example.com", "0123456789ABCDEF0123456789ABCDEF", "", "x".repeat(32)];

  it("refuses anything but 32 lowercase hex before any request, and writes no row", async () => {
    for (const sessionId of badIds) {
      const { client, params } = fakeClient([{ text: "{}", stopReason: "end_turn" }]);
      const sink = memoryUsageSink();
      const llm = createLlm({ client, usageSink: sink });

      const error = await llm
        .structured({ ...REQUEST, sessionId, schema: z.object({}) })
        .then(() => undefined, (e: unknown) => e);
      expect(error).toBeInstanceOf(LlmSessionIdError);
      // The offending value is never quoted.
      if (sessionId !== "") expect((error as Error).message).not.toContain(sessionId);

      const streamed = llm.streamText({ ...REQUEST, sessionId });
      await expect(streamed.final).rejects.toThrow(LlmSessionIdError);
      await expect(drain(streamed.textDeltas)).rejects.toThrow(LlmSessionIdError);

      expect(params).toHaveLength(0);
      expect(sink.rows).toHaveLength(0);
    }
  });

  it("accepts what newSessionId() mints", async () => {
    const { client } = fakeClient([{ text: "{}", stopReason: "end_turn" }]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink });
    const sessionId = newSessionId();
    await llm.structured({ ...REQUEST, sessionId, schema: z.object({}) });
    expect(sink.rows[0]?.session_id).toBe(sessionId);
  });
});

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

describe("streamText", () => {
  it("streams deltas and logs exactly one anonymous usage row", async () => {
    const { client, params } = fakeClient([
      {
        text: "two words",
        stopReason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
      },
    ]);
    const sink = memoryUsageSink();
    let clock = 1_000;
    const llm = createLlm({ client, usageSink: sink, now: () => (clock += 250) });

    const call = llm.streamText(REQUEST);
    expect(await drain(call.textDeltas)).toEqual(["two", " words"]);
    const result = await call.final;

    expect(result.text).toBe("two words");
    expect(result.continuations).toBe(0);
    expect(sink.rows).toHaveLength(1);
    const row = sink.rows[0] as UsageRow;
    expect(Object.keys(row)).toEqual([...USAGE_ROW_KEYS]);
    expect(row.session_id).toBe(REQUEST.sessionId);
    expect(row.step).toBe("elicit");
    expect(row.model).toBe(MODEL);
    expect(row.input_tokens).toBe(100);
    expect(row.output_tokens).toBe(50);
    expect(row.cache_read_input_tokens).toBe(10);
    expect(row.cost_usd).toBeCloseTo(costUsd({ input: 100, output: 50, cacheRead: 10, cacheWrite: 0 }), 6);
    expect(row.duration_ms).toBe(250);
    // No content ever reaches the row.
    expect(JSON.stringify(row)).not.toContain("two words");

    const sent = params[0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(sent.model).toBe(MODEL);
    expect(sent.thinking).toEqual({ type: "adaptive" });
    expect(sent.output_config?.effort).toBe("medium");
    expect(sent.system).toEqual([
      { type: "text", text: REQUEST.system, cache_control: { type: "ephemeral" } },
    ]);
  });

  it("starts the request eagerly: final resolves without textDeltas ever being read", async () => {
    const { client, params } = fakeClient([
      { text: "never read", stopReason: "end_turn", usage: { input_tokens: 7, output_tokens: 3 } },
    ]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0 });

    const call = llm.streamText(REQUEST);
    expect(params).toHaveLength(1); // the request was made synchronously
    const result = await call.final;

    expect(result.text).toBe("never read");
    expect(result.usage).toEqual({ input: 7, output: 3, cacheRead: 0, cacheWrite: 0 });
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0]?.output_tokens).toBe(3);
    // The deltas are still there for a late reader.
    expect(await drain(call.textDeltas)).toEqual(["never", " read"]);
  });

  it("keeps going when the consumer breaks after the first delta; final settles and one row lands", async () => {
    const { client, deltasProduced } = fakeClient([
      {
        text: "one two three four",
        stopReason: "end_turn",
        usage: { input_tokens: 20, output_tokens: 12 },
      },
    ]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0 });

    const call = llm.streamText(REQUEST);
    const seen: string[] = [];
    for await (const delta of call.textDeltas) {
      seen.push(delta);
      break; // e.g. ReadableStream.cancel() → iterator.return()
    }
    expect(seen).toEqual(["one"]);

    const result = await call.final;
    // The call ran to completion (design choice: complete, do not abort).
    expect(deltasProduced()).toBe(4);
    expect(result.text).toBe("one two three four");
    expect(result.stopReason).toBe("end_turn");
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0]?.output_tokens).toBe(12);
    // An abandoned iterable stays finished; it neither replays nor throws.
    expect(await drain(call.textDeltas)).toEqual([]);
  });

  it("settles final and one row when the consumer bails out of a pause_turn continuation", async () => {
    const { client } = fakeClient([
      { text: "first half", stopReason: "pause_turn", usage: { input_tokens: 10, output_tokens: 5 } },
      { text: "second half", stopReason: "end_turn", usage: { input_tokens: 15, output_tokens: 6 } },
    ]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0 });

    const call = llm.streamText(REQUEST);
    // What ReadableStream.cancel() does to the iterator: one pull, then return().
    const iterator = call.textDeltas[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();

    const result = await call.final;
    expect(result.text).toBe("first halfsecond half");
    expect(result.continuations).toBe(1);
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0]?.input_tokens).toBe(25);
    expect(sink.rows[0]?.output_tokens).toBe(11);
  });

  it("rejects final even when nobody reads textDeltas, without an unhandled rejection", async () => {
    const { client } = fakeClient([{ stopReason: "refusal", category: "cyber" }]);
    const llm = createLlm({ client, usageSink: memoryUsageSink(), now: () => 0 });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const call = llm.streamText(REQUEST);
      await expect(call.final).rejects.toThrow(LlmRefusalError);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("propagates an SDK error to both textDeltas and final, and logs nothing without usage", async () => {
    const { client } = fakeClient([{ stopReason: "end_turn", error: new Error("socket hang up") }]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0 });
    const call = llm.streamText(REQUEST);
    await expect(drain(call.textDeltas)).rejects.toThrow("socket hang up");
    await expect(call.final).rejects.toThrow("socket hang up");
    expect(sink.rows).toHaveLength(0);
  });

  it("still records the tokens of a completed continuation when the next request fails", async () => {
    const { client } = fakeClient([
      { text: "first", stopReason: "pause_turn", usage: { input_tokens: 10, output_tokens: 5 } },
      { stopReason: "end_turn", error: new Error("socket hang up") },
    ]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0 });
    const call = llm.streamText(REQUEST);
    await expect(call.final).rejects.toThrow("socket hang up");
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0]?.input_tokens).toBe(10);
    expect(sink.rows[0]?.output_tokens).toBe(5);
  });

  it("resumes a pause_turn and logs one row with summed tokens", async () => {
    const { client, params } = fakeClient([
      {
        text: "first half",
        stopReason: "pause_turn",
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      {
        text: "second half",
        stopReason: "end_turn",
        usage: { input_tokens: 150, output_tokens: 30, cache_creation_input_tokens: 5 },
      },
    ]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0 });

    const call = llm.streamText(REQUEST);
    await drain(call.textDeltas);
    const result = await call.final;

    expect(result.text).toBe("first halfsecond half");
    expect(result.continuations).toBe(1);
    expect(result.stopReason).toBe("end_turn");
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0]?.input_tokens).toBe(250);
    expect(sink.rows[0]?.output_tokens).toBe(50);
    expect(sink.rows[0]?.cache_creation_input_tokens).toBe(5);
    // The paused assistant turn is re-sent, with no "continue" message added.
    expect(params[1]?.messages).toHaveLength(2);
    expect(params[1]?.messages[1]?.role).toBe("assistant");
    // Every segment is reported, not just the last: callers auditing tool use
    // (explore's blocked-host check) need the paused ones, where the tools ran.
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toBe(result.message);
  });

  it("gives up after too many pause_turns and logs one row", async () => {
    const paused: FakeTurn = { text: "x", stopReason: "pause_turn", usage: { input_tokens: 1 } };
    const { client } = fakeClient(Array.from({ length: 10 }, () => paused));
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0 });
    const call = llm.streamText(REQUEST);
    await expect(drain(call.textDeltas)).rejects.toThrow(LlmPauseLimitError);
    await expect(call.final).rejects.toThrow(LlmPauseLimitError);
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0]?.input_tokens).toBe(6);
  });

  it("maps a refusal to LlmRefusalError and still logs the row", async () => {
    const { client } = fakeClient([
      { stopReason: "refusal", category: "cyber", usage: { input_tokens: 10, output_tokens: 1 } },
    ]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0 });

    const call = llm.streamText(REQUEST);
    await expect(drain(call.textDeltas)).rejects.toThrow(LlmRefusalError);
    await expect(call.final).rejects.toMatchObject({ category: "cyber", step: "elicit" });
    expect(sink.rows).toHaveLength(1);
  });

  it("maps max_tokens to LlmTruncatedError", async () => {
    const { client } = fakeClient([{ text: "cut", stopReason: "max_tokens" }]);
    const llm = createLlm({ client, usageSink: memoryUsageSink(), now: () => 0 });
    const call = llm.streamText({ ...REQUEST, maxTokens: 64 });
    await expect(drain(call.textDeltas)).rejects.toThrow(LlmTruncatedError);
    await expect(call.final).rejects.toThrow(/max_tokens \(64\)/);
  });

  it("survives a usage sink that throws", async () => {
    const { client } = fakeClient([{ text: "ok", stopReason: "end_turn" }]);
    const throwingSink: UsageSink = {
      record: () => Promise.reject(Object.assign(new Error("network"), { code: "ECONNRESET" })),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const llm = createLlm({ client, usageSink: throwingSink, now: () => 0 });
      const call = llm.streamText(REQUEST);
      expect(await drain(call.textDeltas)).toEqual(["ok"]);
      await expect(call.final).resolves.toMatchObject({ text: "ok" });
      await Promise.resolve();
      expect(warn).toHaveBeenCalledTimes(1);
      const warned = String(warn.mock.calls[0]?.[0]);
      expect(warned).toContain("ECONNRESET");
      expect(warned).not.toContain("network");
    } finally {
      warn.mockRestore();
    }
  });

  it("survives a usage sink that throws synchronously", async () => {
    const { client } = fakeClient([{ text: "ok", stopReason: "end_turn" }]);
    const badSink = {
      record: () => {
        throw new Error("boom");
      },
    } as unknown as UsageSink;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const llm = createLlm({ client, usageSink: badSink, now: () => 0 });
      const call = llm.streamText(REQUEST);
      await drain(call.textDeltas);
      await expect(call.final).resolves.toMatchObject({ text: "ok" });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("structured", () => {
  const schema = z.object({ greeting: z.string() });

  it("returns the parsed value and logs one row", async () => {
    const { client, params } = fakeClient([
      {
        stopReason: "end_turn",
        text: JSON.stringify({ greeting: "hello" }),
        usage: { input_tokens: 40, output_tokens: 8 },
      },
    ]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0 });

    const result = await llm.structured({ ...REQUEST, step: "discover", schema });

    expect(result.value.greeting).toBe("hello");
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0]?.step).toBe("discover");
    expect(Object.keys(sink.rows[0] ?? {})).toEqual([...USAGE_ROW_KEYS]);
    expect(params[0]?.output_config?.effort).toBe("high");
    expect(params[0]?.output_config?.format?.type).toBe("json_schema");
    expect(params[0]?.output_config?.format?.schema).toMatchObject({ type: "object" });
  });

  it("maps JSON truncated at max_tokens to LlmTruncatedError and still logs the row", async () => {
    const { client } = fakeClient([
      {
        stopReason: "max_tokens",
        text: '{"greeting": "hel',
        usage: { input_tokens: 40, output_tokens: 64 },
      },
    ]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0 });

    const error = await llm
      .structured({ ...REQUEST, schema, maxTokens: 64 })
      .then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(LlmTruncatedError);
    expect((error as Error).message).toMatch(/max_tokens \(64\)/);
    expect((error as Error).message).not.toContain("greeting");
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0]?.output_tokens).toBe(64);
  });

  it("maps malformed JSON at end_turn to LlmOutputError without quoting the model text", async () => {
    const modelText = "Sure! Here is the greeting: {greeting: hello@example.com}";
    const { client } = fakeClient([{ stopReason: "end_turn", text: modelText }]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0 });

    const error = await llm.structured({ ...REQUEST, schema }).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(LlmOutputError);
    const message = (error as Error).message;
    expect(message).toContain("invalid JSON");
    expect(message).not.toContain("Sure");
    expect(message).not.toContain("hello@example.com");
    expect(message).not.toContain("{");
    expect(sink.rows).toHaveLength(1);
  });

  it("rejects output that does not match the schema, naming the path and code only", async () => {
    const { client } = fakeClient([
      { stopReason: "end_turn", text: JSON.stringify({ greeting: "secret text 42" , extra: 7 }) },
    ]);
    const llm = createLlm({ client, usageSink: memoryUsageSink(), now: () => 0 });
    const strict = z.object({ greeting: z.number(), name: z.string() });

    const error = await llm.structured({ ...REQUEST, schema: strict }).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(LlmOutputError);
    const message = (error as Error).message;
    expect(message).toMatch(/greeting: invalid_type/);
    expect(message).toMatch(/name: invalid_type/);
    expect(message).not.toContain("secret");
    expect(message).not.toContain("42");
  });

  it("does not echo record keys from the model into the error message", async () => {
    const { client } = fakeClient([
      { stopReason: "end_turn", text: JSON.stringify({ "jane@example.com": "x" }) },
    ]);
    const llm = createLlm({ client, usageSink: memoryUsageSink(), now: () => 0 });
    const error = await llm
      .structured({ ...REQUEST, schema: z.record(z.string(), z.number()) })
      .then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(LlmOutputError);
    expect((error as Error).message).not.toContain("jane");
    expect((error as Error).message).toMatch(/\?: invalid_type/);
  });

  it("parses the last text block when an earlier one precedes tool use", async () => {
    const { client } = fakeClient([{ stopReason: "end_turn", text: "ignored" }]);
    // Hand-build a two-block message: prose first, then the JSON answer.
    const twoBlocks: LlmClient = {
      stream: client.stream,
      create: async (p) => {
        const message = await client.create(p);
        return {
          ...message,
          content: [
            { type: "text", text: "Let me search.", citations: null },
            { type: "text", text: JSON.stringify({ greeting: "hi" }), citations: null },
          ],
        };
      },
    };
    const llm = createLlm({ client: twoBlocks, usageSink: memoryUsageSink(), now: () => 0 });
    const result = await llm.structured({ ...REQUEST, schema });
    expect(result.value.greeting).toBe("hi");
  });

  it("rejects a missing structured output without quoting the response", async () => {
    const { client } = fakeClient([{ stopReason: "end_turn" }]);
    const llm = createLlm({ client, usageSink: memoryUsageSink(), now: () => 0 });
    await expect(llm.structured({ ...REQUEST, schema })).rejects.toThrow(
      /carried no structured output/,
    );
  });

  it("maps a refusal to LlmRefusalError before trying to parse", async () => {
    const { client } = fakeClient([{ stopReason: "refusal", category: "bio", text: "" }]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0 });
    await expect(llm.structured({ ...REQUEST, schema })).rejects.toMatchObject({ category: "bio" });
    expect(sink.rows).toHaveLength(1);
  });

  it("resumes a pause_turn", async () => {
    const { client } = fakeClient([
      { stopReason: "pause_turn", usage: { input_tokens: 10 } },
      { stopReason: "end_turn", text: JSON.stringify({ greeting: "hi" }), usage: { output_tokens: 4 } },
    ]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0 });
    const result = await llm.structured({ ...REQUEST, schema });
    expect(result.value.greeting).toBe("hi");
    expect(result.continuations).toBe(1);
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0]?.input_tokens).toBe(10);
    expect(sink.rows[0]?.output_tokens).toBe(4);
  });
});
