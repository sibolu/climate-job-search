import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  BLOCKED_DOMAINS,
  EFFORT_BY_STEP,
  LlmOutputError,
  LlmPauseLimitError,
  LlmRefusalError,
  LlmToolPolicyError,
  LlmTruncatedError,
  MODEL,
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
import { StepNameSchema } from "./session";

// ---------------------------------------------------------------------------
// Fake client
// ---------------------------------------------------------------------------

interface FakeTurn {
  text?: string;
  stopReason: Anthropic.StopReason;
  usage?: Partial<Anthropic.Usage>;
  parsedOutput?: unknown;
  category?: string;
}

function fakeMessage(turn: FakeTurn): Anthropic.Message & { parsed_output?: unknown } {
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
    parsed_output: turn.parsedOutput,
  } as Anthropic.Message & { parsed_output?: unknown };
}

function fakeStream(turn: FakeTurn): LlmStream {
  const message = fakeMessage(turn);
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<Anthropic.MessageStreamEvent> {
      if (turn.text !== undefined) {
        for (const chunk of turn.text.split(/(?= )/)) {
          yield {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: chunk },
          } as Anthropic.MessageStreamEvent;
        }
      }
    },
    finalMessage: () => Promise.resolve(message),
  };
}

interface Fake {
  client: LlmClient;
  params: Anthropic.MessageCreateParamsNonStreaming[];
}

/** Replays `turns` one per request, so a `pause_turn` test can script both. */
function fakeClient(turns: FakeTurn[]): Fake {
  const params: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const next = (p: Anthropic.MessageCreateParamsNonStreaming): FakeTurn => {
    params.push(p);
    const turn = turns[params.length - 1];
    if (turn === undefined) throw new Error(`fake client ran out of turns (${params.length})`);
    return turn;
  };
  return {
    params,
    client: {
      stream: (p) => fakeStream(next(p)),
      parse: (p) => Promise.resolve(fakeMessage(next(p))),
    },
  };
}

async function drain(deltas: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const delta of deltas) out.push(delta);
  return out;
}

const REQUEST = {
  step: "elicit",
  sessionId: "session-abcdef12",
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

  it("is the same list as reference-schema.ts (PLAN.md §7.13)", () => {
    expect([...BLOCKED_DOMAINS]).toEqual([...BLOCKED_SOURCE_DOMAINS]);
  });

  it("refuses a call whose tools break the policy", async () => {
    const { client } = fakeClient([{ text: "hi", stopReason: "end_turn" }]);
    const llm = createLlm({ client, usageSink: memoryUsageSink() });
    const bad = [
      { type: "web_search_20260209", name: "web_search", blocked_domains: [] },
    ] as unknown as ReturnType<typeof webTools>;

    await expect(llm.structured({ ...REQUEST, schema: z.object({}), tools: bad })).rejects.toThrow(
      LlmToolPolicyError,
    );
    const streamed = llm.streamText({ ...REQUEST, tools: bad });
    await expect(drain(streamed.textDeltas)).rejects.toThrow(LlmToolPolicyError);
    await expect(streamed.final).rejects.toThrow(LlmToolPolicyError);
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
  });

  it("gives up after too many pause_turns", async () => {
    const paused: FakeTurn = { text: "x", stopReason: "pause_turn" };
    const { client } = fakeClient(Array.from({ length: 10 }, () => paused));
    const llm = createLlm({ client, usageSink: memoryUsageSink(), now: () => 0 });
    const call = llm.streamText(REQUEST);
    await expect(drain(call.textDeltas)).rejects.toThrow(LlmPauseLimitError);
    await expect(call.final).rejects.toThrow(LlmPauseLimitError);
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
        parsedOutput: { greeting: "hello" },
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
  });

  it("rejects output that does not match the schema", async () => {
    const { client } = fakeClient([{ stopReason: "end_turn", parsedOutput: { greeting: 7 } }]);
    const llm = createLlm({ client, usageSink: memoryUsageSink(), now: () => 0 });
    await expect(llm.structured({ ...REQUEST, schema })).rejects.toThrow(LlmOutputError);
  });

  it("rejects a missing structured output without quoting the response", async () => {
    const { client } = fakeClient([{ stopReason: "end_turn" }]);
    const llm = createLlm({ client, usageSink: memoryUsageSink(), now: () => 0 });
    await expect(llm.structured({ ...REQUEST, schema })).rejects.toThrow(
      /carried no structured output/,
    );
  });

  it("resumes a pause_turn", async () => {
    const { client } = fakeClient([
      { stopReason: "pause_turn", usage: { input_tokens: 10 } },
      { stopReason: "end_turn", parsedOutput: { greeting: "hi" }, usage: { output_tokens: 4 } },
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
