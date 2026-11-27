import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  BLOCKED_DOMAINS,
  BUDGET_READ_TIMEOUT_MS,
  EFFORT_BY_STEP,
  LlmBudgetError,
  LlmOutputError,
  LlmPauseLimitError,
  LlmRefusalError,
  LlmSessionIdError,
  LlmToolPolicyError,
  LlmTruncatedError,
  MAX_DURATION_SECONDS,
  MAX_RETRIES,
  CALL_TIMEOUT_MS,
  LlmCancelledError,
  LlmConfigError,
  LlmTimeoutError,
  MODEL_BY_STEP,
  PRICE_PER_MTOK,
  REQUEST_TIMEOUT_MS,
  USAGE_FLUSH_TIMEOUT_MS,
  USAGE_ROW_KEYS,
  assertToolsAllowed,
  costUsd,
  createLlm,
  memoryUsageSink,
  usageWritesSettled,
  webTools,
  type LlmClient,
  type LlmStream,
  type UsageRow,
  type UsageSink,
} from "./llm";
import { BudgetLedgerError, memoryBudgetLedger, type BudgetLedger, type BudgetState } from "./budget";
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
  /** Never finish: stream `message_start`, then wait until the signal aborts. */
  hang?: boolean;
}

function fakeMessage(turn: FakeTurn): Anthropic.Message {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: MODEL_BY_STEP.elicit,
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

function fakeStream(turn: FakeTurn, signal: AbortSignal, onDelta?: () => void): LlmStream {
  const message = fakeMessage(turn);
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<Anthropic.MessageStreamEvent> {
      if (turn.error !== undefined) throw turn.error;
      if (turn.hang === true) {
        yield { type: "message_start", message } as Anthropic.MessageStreamEvent;
        await new Promise<void>((_, reject) => {
          const fail = () => reject(Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" }));
          if (signal.aborted) fail();
          signal.addEventListener("abort", fail, { once: true });
        });
      }
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
      stream: (p, { signal }) => fakeStream(next(p), signal, () => (produced += 1)),
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

  it("is the one list owned by reference-schema.ts, not a copy (technical-plan.md D13)", () => {
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

describe("model and effort per step (technical-plan.md D44, D52, D62)", () => {
  const OPUS_PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
  const FABLE_PRICE = { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 };
  const EXPECTED = {
    cards: { model: "claude-opus-5-5", effort: "medium", price: OPUS_PRICE },
    elicit: { model: "claude-opus-5-5", effort: "medium", price: OPUS_PRICE },
    discover: { model: "claude-fable-5-2", effort: "medium", price: FABLE_PRICE },
    explore: { model: "claude-opus-5-5", effort: "high", price: OPUS_PRICE },
    queries: { model: "claude-opus-5-5", effort: "medium", price: OPUS_PRICE },
    revise: { model: "claude-opus-5-5", effort: "medium", price: OPUS_PRICE },
  } as const;

  it("covers every StepName, and prices every model it names", () => {
    expect(Object.keys(EFFORT_BY_STEP).sort()).toEqual([...StepNameSchema.options].sort());
    expect(Object.keys(MODEL_BY_STEP).sort()).toEqual([...StepNameSchema.options].sort());
    for (const model of Object.values(MODEL_BY_STEP)) expect(PRICE_PER_MTOK[model]).toBeDefined();
  });

  it.each(StepNameSchema.options)("%s: sends its model and effort, logs that model", async (step) => {
    const { client, params } = fakeClient([
      { text: "{}", stopReason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } },
    ]);
    const sink = memoryUsageSink();
    await createLlm({ client, usageSink: sink }).structured({ ...REQUEST, step, schema: z.object({}) });
    const sent = params[0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(sent.model).toBe(EXPECTED[step].model);
    expect(sent.output_config?.effort).toBe(EXPECTED[step].effort);
    expect(sent.thinking).toEqual({ type: "adaptive" });
    expect(sink.rows[0]?.model).toBe(EXPECTED[step].model);
    expect(sink.rows[0]?.cost_usd).toBe(costUsd(EXPECTED[step].model, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }));
  });

  it("runs discover on Fable 5.2 (D62) and every other step on Opus 5.5 (D52), at the listed effort and price", () => {
    for (const step of StepNameSchema.options) {
      expect(MODEL_BY_STEP[step]).toBe(EXPECTED[step].model);
      expect(EFFORT_BY_STEP[step]).toBe(EXPECTED[step].effort);
      expect(PRICE_PER_MTOK[MODEL_BY_STEP[step]]).toEqual(EXPECTED[step].price);
    }
  });

  it("prices a queries call by the rates of the model that ran", async () => {
    const { client, params } = fakeClient([
      {
        text: "{}",
        stopReason: "end_turn",
        usage: { input_tokens: 3_000, output_tokens: 700, cache_read_input_tokens: 12_000, cache_creation_input_tokens: 1_000 },
      },
    ]);
    const sink = memoryUsageSink();
    const result = await createLlm({ client, usageSink: sink }).structured({
      ...REQUEST,
      step: "queries",
      schema: z.object({}),
    });
    expect((params[0] as Anthropic.MessageCreateParamsNonStreaming).model).toBe("claude-opus-5-5");
    // Opus 5.5: (3000 × 4 + 700 × 20 + 12000 × 0.2 + 1000 × 5) / 1M
    expect(result.costUsd).toBeCloseTo(0.0334, 6);
    expect(sink.rows[0]?.model).toBe("claude-opus-5-5");
    expect(sink.rows[0]?.cost_usd).toBeCloseTo(0.0334, 6);
  });
});

describe("timeouts", () => {
  it("keeps every attempt of one logical call inside the Vercel maxDuration", () => {
    // The SDK retries a timed-out attempt, so the worst case is attempts × timeout.
    expect((MAX_RETRIES + 1) * REQUEST_TIMEOUT_MS).toBeLessThan(MAX_DURATION_SECONDS * 1000);
    // The per-call deadline is three minutes (technical-plan.md D45).
    expect(CALL_TIMEOUT_MS).toBe(3 * 60 * 1000);
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(CALL_TIMEOUT_MS);
    expect(CALL_TIMEOUT_MS).toBeLessThan(MAX_DURATION_SECONDS * 1000);
  });
});

describe("cost", () => {
  const MILLION = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 };
  const TURN = { input: 3_000, output: 700, cacheRead: 12_000, cacheWrite: 0 };

  it("prices Opus 5.5", () => {
    // 1M in + 1M out + 1M cache read + 1M cache write = 4 + 20 + 0.2 + 5
    expect(costUsd("claude-opus-5-5", MILLION)).toBeCloseTo(29.2, 6);
    // A realistic chat turn: 3k in, 700 out, 12k cache read.
    expect(costUsd("claude-opus-5-5", TURN)).toBeCloseTo(0.0284, 6);
    expect(costUsd("claude-opus-5-5", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(0);
  });

  it("prices Fable 5.2", () => {
    // 1M in + 1M out + 1M cache read + 1M cache write = 8 + 40 + 0.2 + 10
    expect(costUsd("claude-fable-5-2", MILLION)).toBeCloseTo(58.2, 6);
    // (3000 × 8 + 700 × 40 + 12000 × 0.2) / 1M = (24000 + 28000 + 2400) / 1M
    expect(costUsd("claude-fable-5-2", TURN)).toBeCloseTo(0.0544, 6);
  });

  it("prices Sonnet 5.5", () => {
    // 2 + 10 + 0.1 + 2.5
    expect(costUsd("claude-sonnet-5-5", MILLION)).toBeCloseTo(14.6, 6);
    expect(costUsd("claude-sonnet-5-5", TURN)).toBeCloseTo(0.0142, 6);
  });

  it("throws on an unpriced model rather than pricing it at zero", () => {
    expect(() => costUsd("claude-unknown" as never, TURN)).toThrow(LlmConfigError);
    expect(() => costUsd("toString" as never, TURN)).toThrow(LlmConfigError);
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
    expect(row.model).toBe("claude-opus-5-5");
    expect(row.input_tokens).toBe(100);
    expect(row.output_tokens).toBe(50);
    expect(row.cache_read_input_tokens).toBe(10);
    // Opus 5.5: (100 × 4 + 50 × 20 + 10 × 0.2) / 1M
    expect(row.cost_usd).toBeCloseTo(0.001402, 6);
    expect(row.duration_ms).toBe(250);
    // No content ever reaches the row.
    expect(JSON.stringify(row)).not.toContain("two words");

    const sent = params[0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(sent.model).toBe("claude-opus-5-5");
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
    expect(sink.rows[0]?.model).toBe("claude-fable-5-2");
    expect(params[0]?.model).toBe("claude-fable-5-2");
    expect(Object.keys(sink.rows[0] ?? {})).toEqual([...USAGE_ROW_KEYS]);
    expect(params[0]?.output_config?.effort).toBe("medium");
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
      stream: (p, options) => {
        const inner = client.stream(p, options);
        return {
          [Symbol.asyncIterator]: () => inner[Symbol.asyncIterator](),
          finalMessage: async () => ({
            ...(await inner.finalMessage()),
            content: [
              { type: "text", text: "Let me search.", citations: null },
              { type: "text", text: JSON.stringify({ greeting: "hi" }), citations: null },
            ],
          }),
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

// ---------------------------------------------------------------------------
// Deadline and cancellation (technical-plan.md D45)
// ---------------------------------------------------------------------------

describe("deadline and cancellation", () => {
  const schema = z.object({ greeting: z.string() });

  it("stops a call that runs past the deadline and logs the input it was billed", async () => {
    const { client } = fakeClient([{ stopReason: "end_turn", hang: true, usage: { input_tokens: 700 } }]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0, callTimeoutMs: 20 });
    const error = await llm.structured({ ...REQUEST, schema }).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(LlmTimeoutError);
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0]?.input_tokens).toBe(700);
  });

  it("stops a call when the caller's signal aborts", async () => {
    const { client } = fakeClient([{ stopReason: "end_turn", hang: true, usage: { input_tokens: 5 } }]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0 });
    const controller = new AbortController();
    const call = llm.streamText({ ...REQUEST, signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await expect(call.final).rejects.toBeInstanceOf(LlmCancelledError);
    expect(sink.rows).toHaveLength(1);
  });

  it("never starts a call whose signal already fired, and writes no row", async () => {
    const { client, params } = fakeClient([{ stopReason: "end_turn", text: "{}" }]);
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, now: () => 0 });
    const controller = new AbortController();
    controller.abort();
    await expect(llm.structured({ ...REQUEST, schema, signal: controller.signal })).rejects.toBeInstanceOf(
      LlmCancelledError,
    );
    expect(params).toHaveLength(0);
    expect(sink.rows).toHaveLength(0);
  });
});

describe("usageWritesSettled (technical-plan.md D64)", () => {
  /** A sink whose one write settles only when the test says so. */
  function heldSink(): { sink: UsageSink; resolve: () => void; reject: (e: unknown) => void } {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const pending = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { sink: { record: () => pending }, resolve, reject };
  }

  async function runOneCall(sink: UsageSink): Promise<void> {
    const { client } = fakeClient([{ text: "ok", stopReason: "end_turn" }]);
    const call = createLlm({ client, usageSink: sink, now: () => 0 }).streamText(REQUEST);
    await drain(call.textDeltas);
    await call.final;
  }

  it("has a 5s default timeout", () => {
    expect(USAGE_FLUSH_TIMEOUT_MS).toBe(5_000);
  });

  it("resolves immediately with nothing pending", async () => {
    await expect(usageWritesSettled()).resolves.toBeUndefined();
  });

  it("resolves only after a slow write resolves", async () => {
    const held = heldSink();
    await runOneCall(held.sink);
    let settled = false;
    const flushed = usageWritesSettled().then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    held.resolve();
    await flushed;
    expect(settled).toBe(true);
    await expect(usageWritesSettled()).resolves.toBeUndefined();
  });

  it("resolves, never rejects, when the write rejects", async () => {
    const held = heldSink();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await runOneCall(held.sink);
      const flushed = usageWritesSettled();
      held.reject(Object.assign(new Error("network"), { code: "ECONNRESET" }));
      await expect(flushed).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("with a signal, waits only for that signal's writes", async () => {
    const mine = heldSink();
    const other = heldSink();
    const signal = new AbortController().signal;
    const run = async (sink: UsageSink, s?: AbortSignal) => {
      const { client } = fakeClient([{ text: "ok", stopReason: "end_turn" }]);
      const call = createLlm({ client, usageSink: sink, now: () => 0 }).streamText({ ...REQUEST, signal: s });
      await drain(call.textDeltas);
      await call.final;
    };
    await run(mine.sink, signal);
    await run(other.sink);
    let settled = false;
    const flushed = usageWritesSettled(signal).then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    mine.resolve();
    await flushed;
    expect(settled).toBe(true);
    // The other turn's write is still pending, and an unscoped wait sees it.
    let all = false;
    const flushedAll = usageWritesSettled().then(() => {
      all = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(all).toBe(false);
    other.resolve();
    await flushedAll;
    await expect(usageWritesSettled(new AbortController().signal)).resolves.toBeUndefined();
  });

  it("resolves at the timeout when a write never settles", async () => {
    const held = heldSink();
    await runOneCall(held.sink);
    vi.useFakeTimers();
    try {
      let settled = false;
      const flushed = usageWritesSettled(undefined, 1_000).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await flushed;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
      // Let the hung write settle so it does not leak into later tests.
      held.resolve();
      await usageWritesSettled();
    }
  });
});

describe("access-code budget (technical-plan.md D69)", () => {
  const schema = z.object({ greeting: z.string() });
  const KEY = "fedcba9876543210fedcba9876543210";
  /** One elicit call at 1,000 input and 100 output tokens. */
  const USAGE = { input_tokens: 1_000, output_tokens: 100 };
  const COST = costUsd(MODEL_BY_STEP.elicit, { input: 1_000, output: 100, cacheRead: 0, cacheWrite: 0 });

  /** A memory ledger that also counts reads and charges. */
  function countingLedger(initial: Record<string, BudgetState> = {}) {
    const inner = memoryBudgetLedger(initial);
    const reads: string[] = [];
    const charges: number[] = [];
    const ledger: BudgetLedger = {
      read: (key) => {
        reads.push(key);
        return inner.read(key);
      },
      addSpend: (key, usd) => {
        charges.push(usd);
        return inner.addSpend(key, usd);
      },
    };
    return { ledger, inner, reads, charges };
  }

  const under = (): Record<string, BudgetState> => ({ [KEY]: { capUsd: 5, spentUsd: 1, disabled: false } });

  async function refusal(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(() => undefined, (e: unknown) => e);
  }

  it("has a 5s default read timeout", () => {
    expect(BUDGET_READ_TIMEOUT_MS).toBe(5_000);
  });

  it("runs a streamText call under the cap and adds its costUsd to the total", async () => {
    const { client, params } = fakeClient([{ text: "ok", stopReason: "end_turn", usage: USAGE }]);
    const { ledger, inner } = countingLedger(under());
    const llm = createLlm({ client, usageSink: memoryUsageSink(), budget: ledger, now: () => 0 });
    const call = llm.streamText({ ...REQUEST, codeKey: KEY });
    await drain(call.textDeltas);
    const result = await call.final;
    await usageWritesSettled();
    expect(params).toHaveLength(1);
    expect(result.costUsd).toBeCloseTo(COST, 10);
    expect(inner.snapshot(KEY)?.spentUsd).toBeCloseTo(1 + COST, 10);
  });

  it("meters a structured call the same way", async () => {
    const { client } = fakeClient([{ text: '{"greeting":"hi"}', stopReason: "end_turn", usage: USAGE }]);
    const { ledger, inner, reads } = countingLedger(under());
    const llm = createLlm({ client, usageSink: memoryUsageSink(), budget: ledger, now: () => 0 });
    const result = await llm.structured({ ...REQUEST, schema, codeKey: KEY });
    await usageWritesSettled();
    expect(result.value).toEqual({ greeting: "hi" });
    expect(reads).toEqual([KEY]);
    expect(inner.snapshot(KEY)?.spentUsd).toBeCloseTo(1 + result.costUsd, 10);
  });

  it("makes no API request, writes no row and charges nothing at the cap", async () => {
    for (const shape of ["streamText", "structured"] as const) {
      const { client, params } = fakeClient([{ text: "{}", stopReason: "end_turn", usage: USAGE }]);
      const { ledger, inner, charges } = countingLedger({ [KEY]: { capUsd: 5, spentUsd: 5, disabled: false } });
      const sink = memoryUsageSink();
      const llm = createLlm({ client, usageSink: sink, budget: ledger, now: () => 0 });
      const error = await refusal(
        shape === "streamText"
          ? llm.streamText({ ...REQUEST, codeKey: KEY }).final
          : llm.structured({ ...REQUEST, schema, codeKey: KEY }),
      );
      expect(error).toBeInstanceOf(LlmBudgetError);
      expect((error as LlmBudgetError).reason).toBe("exhausted");
      expect((error as LlmBudgetError).step).toBe("elicit");
      expect((error as Error).message).not.toContain(KEY);
      expect((error as Error).message).not.toMatch(/\d\.\d|\$/);
      expect(params).toHaveLength(0);
      expect(sink.rows).toHaveLength(0);
      expect(charges).toHaveLength(0);
      expect(inner.snapshot(KEY)?.spentUsd).toBe(5);
    }
  });

  it("refuses a disabled code and an unknown key as inactive, before any request", async () => {
    const cases: Record<string, BudgetState>[] = [
      { [KEY]: { capUsd: 5, spentUsd: 0, disabled: true } },
      {},
    ];
    for (const initial of cases) {
      const { client, params } = fakeClient([{ text: "ok", stopReason: "end_turn", usage: USAGE }]);
      const { ledger } = countingLedger(initial);
      const llm = createLlm({ client, usageSink: memoryUsageSink(), budget: ledger, now: () => 0 });
      const error = await refusal(llm.streamText({ ...REQUEST, codeKey: KEY }).final);
      expect(error).toBeInstanceOf(LlmBudgetError);
      expect((error as LlmBudgetError).reason).toBe("inactive");
      expect(params).toHaveLength(0);
    }
  });

  it("refuses a malformed key as inactive without reading the ledger", async () => {
    for (const bad of ["", "operator", KEY.toUpperCase(), `${KEY}0`, "someone@example.com"]) {
      const { client, params } = fakeClient([{ text: "ok", stopReason: "end_turn" }]);
      const { ledger, reads } = countingLedger({ [bad]: { capUsd: 5, spentUsd: 0, disabled: false } });
      const llm = createLlm({ client, usageSink: memoryUsageSink(), budget: ledger, now: () => 0 });
      const error = await refusal(llm.streamText({ ...REQUEST, codeKey: bad }).final);
      expect((error as LlmBudgetError).reason).toBe("inactive");
      if (bad !== "") expect((error as Error).message).not.toContain(bad);
      expect(reads).toHaveLength(0);
      expect(params).toHaveLength(0);
    }
  });

  it("refuses as unavailable when the ledger cannot be read, rejecting or throwing", async () => {
    const failing: BudgetLedger[] = [
      { read: () => Promise.reject(new BudgetLedgerError("read", "PGRST301")), addSpend: () => Promise.resolve() },
      {
        read: () => {
          throw new Error("boom");
        },
        addSpend: () => Promise.resolve(),
      },
    ];
    for (const ledger of failing) {
      const { client, params } = fakeClient([{ text: "ok", stopReason: "end_turn" }]);
      const sink = memoryUsageSink();
      const llm = createLlm({ client, usageSink: sink, budget: ledger, now: () => 0 });
      const error = await refusal(llm.structured({ ...REQUEST, schema, codeKey: KEY }));
      expect(error).toBeInstanceOf(LlmBudgetError);
      expect((error as LlmBudgetError).reason).toBe("unavailable");
      expect(params).toHaveLength(0);
      expect(sink.rows).toHaveLength(0);
    }
  });

  it("refuses as unavailable after the timeout when the read never settles", async () => {
    const { client, params } = fakeClient([{ text: "ok", stopReason: "end_turn" }]);
    const hung: BudgetLedger = { read: () => new Promise(() => {}), addSpend: () => Promise.resolve() };
    const llm = createLlm({ client, usageSink: memoryUsageSink(), budget: hung, budgetReadTimeoutMs: 20, now: () => 0 });
    const error = await refusal(llm.streamText({ ...REQUEST, codeKey: KEY }).final);
    expect((error as LlmBudgetError).reason).toBe("unavailable");
    expect(params).toHaveLength(0);
  });

  it("rejects with LlmCancelledError when the caller aborts during the budget read", async () => {
    const { client, params } = fakeClient([{ text: "ok", stopReason: "end_turn" }]);
    const hung: BudgetLedger = { read: () => new Promise(() => {}), addSpend: () => Promise.resolve() };
    const llm = createLlm({ client, usageSink: memoryUsageSink(), budget: hung, now: () => 0 });
    const controller = new AbortController();
    const call = llm.streamText({ ...REQUEST, codeKey: KEY, signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await expect(call.final).rejects.toBeInstanceOf(LlmCancelledError);
    expect(params).toHaveLength(0);
  });

  it("still charges an aborted call for the input it was billed (D45)", async () => {
    const { client } = fakeClient([{ stopReason: "end_turn", hang: true, usage: { input_tokens: 700 } }]);
    const { ledger, inner } = countingLedger(under());
    const llm = createLlm({ client, usageSink: memoryUsageSink(), budget: ledger, now: () => 0 });
    const controller = new AbortController();
    const call = llm.streamText({ ...REQUEST, codeKey: KEY, signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await expect(call.final).rejects.toBeInstanceOf(LlmCancelledError);
    await usageWritesSettled(controller.signal);
    const billed = costUsd(MODEL_BY_STEP.elicit, { input: 700, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(inner.snapshot(KEY)?.spentUsd).toBeCloseTo(1 + billed, 10);
  });

  it("lets a call that crosses the cap complete, then refuses the next one", async () => {
    const big = { input_tokens: 3_000, output_tokens: 0 };
    const { client, params } = fakeClient([
      { text: "ok", stopReason: "end_turn", usage: big },
      { text: "never", stopReason: "end_turn", usage: big },
    ]);
    const { ledger, inner } = countingLedger({ [KEY]: { capUsd: 0.01, spentUsd: 0, disabled: false } });
    const llm = createLlm({ client, usageSink: memoryUsageSink(), budget: ledger, now: () => 0 });
    await expect(llm.streamText({ ...REQUEST, codeKey: KEY }).final).resolves.toMatchObject({ text: "ok" });
    await usageWritesSettled();
    expect(inner.snapshot(KEY)?.spentUsd).toBeGreaterThan(0.01);
    const second = await refusal(llm.streamText({ ...REQUEST, codeKey: KEY }).final);
    expect((second as LlmBudgetError).reason).toBe("exhausted");
    expect(params).toHaveLength(1);
  });

  it("reads once and charges once, with the summed cost, across a pause_turn", async () => {
    const { client, params } = fakeClient([
      { text: "first", stopReason: "pause_turn", usage: { input_tokens: 100, output_tokens: 20 } },
      { text: "second", stopReason: "end_turn", usage: { input_tokens: 150, output_tokens: 30 } },
    ]);
    const { ledger, reads, charges } = countingLedger(under());
    const llm = createLlm({ client, usageSink: memoryUsageSink(), budget: ledger, now: () => 0 });
    const call = llm.streamText({ ...REQUEST, codeKey: KEY });
    await drain(call.textDeltas);
    const result = await call.final;
    await usageWritesSettled();
    expect(params).toHaveLength(2);
    expect(reads).toHaveLength(1);
    expect(charges).toHaveLength(1);
    expect(charges[0]).toBeCloseTo(
      costUsd(MODEL_BY_STEP.elicit, { input: 250, output: 50, cacheRead: 0, cacheWrite: 0 }),
      10,
    );
    expect(charges[0]).toBe(result.costUsd);
  });

  it("charges nothing for a call that cost nothing", async () => {
    const { client } = fakeClient([{ text: "ok", stopReason: "end_turn" }]);
    const { ledger, charges } = countingLedger(under());
    const call = createLlm({ client, usageSink: memoryUsageSink(), budget: ledger, now: () => 0 }).streamText({
      ...REQUEST,
      codeKey: KEY,
    });
    await call.final;
    await usageWritesSettled();
    expect(charges).toHaveLength(0);
  });

  it("survives a failed charge with one warning carrying the code, never the key or amount", async () => {
    const failures: BudgetLedger["addSpend"][] = [
      () => Promise.reject(new BudgetLedgerError("addSpend", "PGRST301")),
      () => {
        throw new BudgetLedgerError("addSpend", "PGRST301");
      },
    ];
    for (const addSpend of failures) {
      const { client } = fakeClient([{ text: "ok", stopReason: "end_turn", usage: USAGE }]);
      const inner = memoryBudgetLedger(under());
      const ledger: BudgetLedger = { read: (k) => inner.read(k), addSpend };
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const call = createLlm({ client, usageSink: memoryUsageSink(), budget: ledger, now: () => 0 }).streamText({
          ...REQUEST,
          codeKey: KEY,
        });
        await expect(call.final).resolves.toMatchObject({ text: "ok" });
        await usageWritesSettled();
        expect(warn).toHaveBeenCalledTimes(1);
        const warned = String(warn.mock.calls[0]?.[0]);
        expect(warned).toContain("PGRST301");
        expect(warned).not.toContain(KEY);
        expect(warned).not.toContain(String(COST));
      } finally {
        warn.mockRestore();
      }
    }
  });

  it("never touches the ledger for a keyless call", async () => {
    const { client } = fakeClient([{ text: "ok", stopReason: "end_turn", usage: USAGE }]);
    const read = vi.fn(() => Promise.reject(new Error("must not read")));
    const addSpend = vi.fn(() => Promise.reject(new Error("must not charge")));
    const sink = memoryUsageSink();
    const llm = createLlm({ client, usageSink: sink, budget: { read, addSpend }, now: () => 0 });
    const call = llm.streamText(REQUEST);
    await drain(call.textDeltas);
    await call.final;
    await usageWritesSettled();
    expect(read).not.toHaveBeenCalled();
    expect(addSpend).not.toHaveBeenCalled();
    expect(sink.rows).toHaveLength(1);
  });

  it("writes a usage row with exactly the fixed keys and no trace of the key", async () => {
    const { client } = fakeClient([{ text: "ok", stopReason: "end_turn", usage: USAGE }]);
    const sink = memoryUsageSink();
    const { ledger } = countingLedger(under());
    const call = createLlm({ client, usageSink: sink, budget: ledger, now: () => 0 }).streamText({
      ...REQUEST,
      codeKey: KEY,
    });
    await call.final;
    expect(sink.rows).toHaveLength(1);
    const row = sink.rows[0] as UsageRow;
    expect(Object.keys(row).sort()).toEqual([...USAGE_ROW_KEYS].sort());
    for (const value of Object.values(row)) expect(value).not.toBe(KEY);
  });

  describe("usageWritesSettled waits for the charge (D64, D65)", () => {
    function heldLedger() {
      const inner = memoryBudgetLedger(under());
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let charged = false;
      const ledger: BudgetLedger = {
        read: (k) => inner.read(k),
        addSpend: async (k, usd) => {
          await held;
          await inner.addSpend(k, usd);
          charged = true;
        },
      };
      return { ledger, release, charged: () => charged };
    }

    for (const scoped of [false, true]) {
      it(scoped ? "with the call's signal" : "unscoped", async () => {
        const { client } = fakeClient([{ text: "ok", stopReason: "end_turn", usage: USAGE }]);
        const { ledger, release, charged } = heldLedger();
        const signal = new AbortController().signal;
        const call = createLlm({ client, usageSink: memoryUsageSink(), budget: ledger, now: () => 0 }).streamText({
          ...REQUEST,
          codeKey: KEY,
          signal,
        });
        await call.final;
        const order: string[] = [];
        const flushed = usageWritesSettled(scoped ? signal : undefined).then(() => {
          order.push(charged() ? "settled after charge" : "settled before charge");
        });
        await new Promise((r) => setTimeout(r, 10));
        expect(order).toEqual([]);
        release();
        await flushed;
        expect(order).toEqual(["settled after charge"]);
      });
    }
  });
});
