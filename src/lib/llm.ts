/**
 * The single door to the Claude API (PLAN.md §2 "LLM", §6, §7 decisions 2 and
 * 13). Every model call in this app goes through `createLlm()`; no other
 * module may construct an Anthropic client, build a web tool, or write an
 * `llm_usage` row.
 *
 * Why one module:
 *
 *   * **Terms-of-use compliance is code.** {@link BLOCKED_DOMAINS} is THE
 *     enforcement point for the PRD's "no scraping LinkedIn, Indeed or
 *     Climatebase". {@link webTools} is the only web-tool factory, and every
 *     call runs its tools through {@link assertToolsAllowed}, which throws on
 *     any web tool that does not block all three domains. A new fetch path
 *     that does not come through here is a bug, not a shortcut.
 *   * **No user data server-side.** The only server-side write in the product
 *     is an anonymous {@link UsageRow}: counters, a random session id and a
 *     step name. This module never logs, stores or forwards prompt or
 *     completion text — not in the usage row, not in an error message, not in
 *     a `console.warn`.
 *   * **Cost telemetry is comparable.** One row per logical call (a
 *     `pause_turn` continuation is part of the same logical call and its
 *     tokens are summed), priced from {@link PRICE_PER_MTOK}.
 *
 * Server-only: {@link createLlm} throws in a browser. The API key is a
 * server-only env var and route handlers are the only callers.
 *
 * SDK notes (checked against the `claude-api` skill on 2026-09-12,
 * `@anthropic-ai/sdk` 0.125.0):
 *   * Adaptive thinking (`thinking: {type: "adaptive"}`) on every call;
 *     `budget_tokens` is rejected by `claude-opus-5`.
 *   * Depth is `output_config.effort`, per step (see {@link EFFORT_BY_STEP}).
 *   * Structured outputs use `client.messages.create()` with
 *     `output_config.format = zodOutputFormat(schema)` — no beta header. The
 *     SDK's `messages.parse()` is deliberately NOT used: it JSON-parses every
 *     text block before we can look at `stop_reason` or `usage`, so a
 *     `max_tokens`-truncated answer threw a generic `AnthropicError` whose
 *     message quoted the model's text, and the usage row was never written.
 *     Parsing happens here instead, after the row is recorded and the stop
 *     reason is checked, and failures report zod issue paths/codes only.
 *   * Web search / web fetch are the `_20260209` dynamic-filtering variants,
 *     which `claude-opus-5` supports on the non-beta endpoint.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

import { BLOCKED_SOURCE_DOMAINS } from "./reference-schema";
import { isSessionId, type StepName } from "./session";
import { anonClient } from "./supabase";

// ---------------------------------------------------------------------------
// Model, effort and limits
// ---------------------------------------------------------------------------

/** One model everywhere (PLAN.md §7.2). Re-evaluate Sonnet 5 after Phase 3. */
export const MODEL = "claude-opus-5";

/** Effort levels this app uses. The SDK also accepts `xhigh`; we do not. */
export type Effort = "low" | "medium" | "high" | "max";

/**
 * Depth per call type (PLAN.md §2: chat `medium`, discovery `high`). Chat-like
 * steps answer from what the user just said; discovery steps reason over the
 * reference collection and the web and are worth the extra tokens.
 */
export const EFFORT_BY_STEP: Record<StepName, Effort> = {
  cards: "medium",
  elicit: "medium",
  discover: "high",
  explore: "high",
  queries: "high",
  revise: "high",
};

/**
 * `maxDuration` for the route handlers that call this module. Discovery and
 * exploration turns with web search run 1–3 minutes (PLAN.md §6).
 */
export const MAX_DURATION_SECONDS = 800;

/** How many `pause_turn` resumes one logical call may make before giving up. */
export const MAX_PAUSE_TURN_CONTINUATIONS = 5;

/** Streaming turns get room; the model stops when it is done, not at the cap. */
export const DEFAULT_MAX_TOKENS_STREAM = 32_000;

/** Structured calls are not streamed, so keep them under the HTTP timeout. */
export const DEFAULT_MAX_TOKENS_STRUCTURED = 16_000;

/**
 * Per-attempt HTTP timeout (TypeScript SDK timeouts are milliseconds). Sized
 * for a 1–3 minute discovery turn with headroom. The SDK retries a timed-out
 * attempt, so one logical call can take up to
 * `(MAX_RETRIES + 1) * REQUEST_TIMEOUT_MS`; `llm.test.ts` asserts that stays
 * under {@link MAX_DURATION_SECONDS}, otherwise Vercel would kill the function
 * mid-retry and the usage row would never be written.
 */
export const REQUEST_TIMEOUT_MS = 300_000;

/**
 * One retry (the SDK default is 2) so two timed-out attempts still fit in
 * `maxDuration`. Retries cover 408/409/429/5xx and connection errors.
 */
export const MAX_RETRIES = 1;

// ---------------------------------------------------------------------------
// Blocked domains — the enforcement point
// ---------------------------------------------------------------------------

/**
 * THE enforcement point for the PRD's "no scraping LinkedIn, Indeed or
 * Climatebase" (PLAN.md §6, §7.13). Passed as `blocked_domains` on every web
 * tool, so the server-side tools never search or fetch these hosts (or their
 * subdomains) at all.
 *
 * The list has one TypeScript owner, `BLOCKED_SOURCE_DOMAINS` in
 * `reference-schema.ts` (which also guards stored reference data); this is
 * the same array under the name web-tool callers use. The SQL twin is
 * `private.blocked_source_domains()` in `supabase/migrations/`, covered by
 * `pnpm db:check-rls`.
 */
export const BLOCKED_DOMAINS = BLOCKED_SOURCE_DOMAINS;

/** Server-tool type strings for `claude-opus-5` (dynamic filtering variants). */
export const WEB_SEARCH_TOOL_TYPE = "web_search_20260209";
export const WEB_FETCH_TOOL_TYPE = "web_fetch_20260209";

/** A tool definition this module will send. Only server tools are supported. */
export type LlmTool = Anthropic.Messages.ToolUnion;

export interface WebToolOptions {
  /** Searches per logical call. */
  searchMaxUses?: number;
  /** Page fetches per logical call. */
  fetchMaxUses?: number;
}

/**
 * The ONLY way to build a web tool in this app. Both tools carry
 * {@link BLOCKED_DOMAINS}; web fetch also turns citations on, because every
 * recommendation has to cite a real source (PLAN.md §3 steps 1.4 and 2.2).
 */
export function webTools({ searchMaxUses = 8, fetchMaxUses = 8 }: WebToolOptions = {}): LlmTool[] {
  return [
    {
      type: WEB_SEARCH_TOOL_TYPE,
      name: "web_search",
      max_uses: searchMaxUses,
      blocked_domains: [...BLOCKED_DOMAINS],
    },
    {
      type: WEB_FETCH_TOOL_TYPE,
      name: "web_fetch",
      max_uses: fetchMaxUses,
      blocked_domains: [...BLOCKED_DOMAINS],
      citations: { enabled: true },
    },
  ];
}

function isWebTool(tool: LlmTool): boolean {
  const type = (tool as { type?: unknown }).type;
  return typeof type === "string" && (type.startsWith("web_search") || type.startsWith("web_fetch"));
}

function blockedDomainsOf(tool: LlmTool): readonly string[] {
  const raw = (tool as { blocked_domains?: unknown }).blocked_domains;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase());
}

/**
 * Defense in depth: refuses any web tool that does not block all three
 * domains, whoever built it. {@link webTools} always passes; a hand-rolled
 * tool definition (or one that switched to `allowed_domains`) does not.
 */
export function assertToolsAllowed(tools: readonly LlmTool[]): void {
  for (const tool of tools) {
    if (!isWebTool(tool)) continue;
    const blocked = blockedDomainsOf(tool);
    const missing = BLOCKED_DOMAINS.filter((domain) => !blocked.includes(domain));
    if (missing.length > 0) {
      const name = String((tool as { type?: unknown }).type ?? "web tool");
      throw new LlmToolPolicyError(
        `${name} is missing blocked_domains ${missing.join(", ")}. Build web tools with ` +
          "webTools() — the PRD forbids scraping those sites and blocked_domains is where " +
          "that is enforced (PLAN.md §6).",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * USD per million tokens for `claude-opus-5`, from the `claude-api` skill's
 * model table and prompt-caching economics (checked 2026-09-12): input $5,
 * output $25, cache read 0.1× input, 5-minute cache write 1.25× input. Update
 * both this table and the date when the skill's numbers change.
 */
export const PRICE_PER_MTOK = {
  input: 5,
  output: 25,
  cacheRead: 0.5,
  cacheWrite: 6.25,
} as const;

/** Token counters, summed across the continuations of one logical call. */
export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function zeroTokenCounts(): TokenCounts {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

/** Adds one response's `usage` to a running total. Missing counters are 0. */
export function addUsage(counts: TokenCounts, usage: Anthropic.Usage | undefined): TokenCounts {
  return {
    input: counts.input + (usage?.input_tokens ?? 0),
    output: counts.output + (usage?.output_tokens ?? 0),
    cacheRead: counts.cacheRead + (usage?.cache_read_input_tokens ?? 0),
    cacheWrite: counts.cacheWrite + (usage?.cache_creation_input_tokens ?? 0),
  };
}

function hasAnyUsage(counts: TokenCounts): boolean {
  return counts.input + counts.output + counts.cacheRead + counts.cacheWrite > 0;
}

/** Cost of one logical call, rounded to the `numeric(10, 6)` column. */
export function costUsd(counts: TokenCounts): number {
  const dollars =
    (counts.input * PRICE_PER_MTOK.input +
      counts.output * PRICE_PER_MTOK.output +
      counts.cacheRead * PRICE_PER_MTOK.cacheRead +
      counts.cacheWrite * PRICE_PER_MTOK.cacheWrite) /
    1_000_000;
  return Math.round(dollars * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Base class for everything this module throws. SDK errors pass through. */
export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** `stop_reason: "refusal"`. Carries the category only — never the text. */
export class LlmRefusalError extends LlmError {
  readonly step: StepName;
  readonly category: string | null;

  constructor(step: StepName, category: string | null) {
    super(
      `Claude refused the ${step} request` +
        (category === null ? "." : ` (category: ${category}).`),
    );
    this.step = step;
    this.category = category;
  }
}

/** `stop_reason: "max_tokens"`: the answer is cut off, so it is not usable. */
export class LlmTruncatedError extends LlmError {
  readonly step: StepName;
  readonly maxTokens: number;

  constructor(step: StepName, maxTokens: number) {
    super(`The ${step} response hit max_tokens (${maxTokens}) and is incomplete.`);
    this.step = step;
    this.maxTokens = maxTokens;
  }
}

/** Server tools kept pausing past {@link MAX_PAUSE_TURN_CONTINUATIONS}. */
export class LlmPauseLimitError extends LlmError {
  readonly step: StepName;

  constructor(step: StepName, continuations: number) {
    super(
      `The ${step} turn still paused after ${continuations} continuations; giving up rather ` +
        "than looping. Narrow the prompt or lower max_uses on the web tools.",
    );
    this.step = step;
  }
}

/** A web tool that does not block all three domains was passed to a call. */
export class LlmToolPolicyError extends LlmError {}

/**
 * `sessionId` is not a 32-character lowercase hex id from `newSessionId()`.
 * Thrown before any request is made, so a tampered browser session can never
 * put arbitrary text (an email address, say) into `llm_usage.session_id`,
 * the only server-side table. The offending value is never quoted.
 */
export class LlmSessionIdError extends LlmError {
  readonly step: StepName;

  constructor(step: StepName) {
    super(
      `The ${step} request carried a malformed sessionId. Session ids come from ` +
        "newSessionId() in session.ts and are 32 lowercase hex characters.",
    );
    this.step = step;
  }
}

/** Structured output was missing or did not match the schema. */
export class LlmOutputError extends LlmError {
  readonly step: StepName;

  constructor(step: StepName, detail: string) {
    super(`The ${step} response did not match its schema: ${detail}`);
    this.step = step;
  }
}

/** Missing configuration, or a call from the browser. */
export class LlmConfigError extends LlmError {}

// ---------------------------------------------------------------------------
// Usage logging (PLAN.md §7.4)
// ---------------------------------------------------------------------------

/**
 * One row per logical call. THERE ARE NO CONTENT FIELDS AND NONE MAY BE ADDED:
 * no prompt, no completion, no profile or chat text, no identifiers. The
 * matching CHECK constraints and the table comment in
 * `supabase/migrations/*_llm_usage.sql` say the same thing in SQL.
 */
export interface UsageRow {
  /** Always 32 lowercase hex characters; the runner refuses anything else. */
  session_id: string;
  step: StepName;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
  duration_ms: number;
}

/** The row's keys, in insert order. `llm.test.ts` asserts a row matches this. */
export const USAGE_ROW_KEYS = [
  "session_id",
  "step",
  "model",
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
  "cost_usd",
  "duration_ms",
] as const;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertTrue<T extends true> = T;

/**
 * Compile-time guard: adding a field to {@link UsageRow} (a content field, say)
 * without adding it to {@link USAGE_ROW_KEYS} fails `pnpm typecheck`, and
 * adding it to both fails the row-shape test and the migration's column list.
 */
export type UsageRowKeysAreExactlyTheFixedList = AssertTrue<
  Equal<keyof UsageRow, (typeof USAGE_ROW_KEYS)[number]>
>;

/** Where usage rows go. Implementations must never receive anything else. */
export interface UsageSink {
  record(row: UsageRow): Promise<void>;
}

/** In-memory sink for tests and scripts. */
export function memoryUsageSink(): UsageSink & { rows: UsageRow[] } {
  const rows: UsageRow[] = [];
  return {
    rows,
    record(row: UsageRow): Promise<void> {
      rows.push(row);
      return Promise.resolve();
    },
  };
}

/**
 * The real sink: an anonymous insert through the anon key, which RLS allows to
 * INSERT `llm_usage` and nothing else.
 */
export function supabaseUsageSink(): UsageSink {
  return {
    async record(row: UsageRow): Promise<void> {
      const { error } = await anonClient().from("llm_usage").insert(row);
      if (error !== null) {
        throw new LlmError(`llm_usage insert failed (${error.code})`);
      }
    },
  };
}

/** An error's code — never its message, which could quote request content. */
function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code !== "") return code;
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return String(status);
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && name !== "") return name;
  }
  return "unknown";
}

/**
 * Fire and forget. Telemetry must never cost the user their turn, so a failure
 * is a `console.warn` with the error code only and nothing else.
 */
function recordUsage(sink: UsageSink, row: UsageRow): void {
  const warn = (error: unknown): void => {
    console.warn(`llm_usage row not written (${errorCode(error)}); the turn was unaffected`);
  };
  try {
    void Promise.resolve(sink.record(row)).catch(warn);
  } catch (error) {
    warn(error);
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** The streaming surface this module uses (`Anthropic.MessageStream` fits). */
export interface LlmStream extends AsyncIterable<Anthropic.MessageStreamEvent> {
  finalMessage(): Promise<Anthropic.Message>;
}

/**
 * The two SDK calls this module makes, as an interface so tests can pass a
 * fake. {@link anthropicClient} is the real implementation.
 */
export interface LlmClient {
  stream(params: Anthropic.MessageCreateParamsNonStreaming): LlmStream;
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

/**
 * Builds the SDK client. `ANTHROPIC_API_KEY` is server-only; it is read here
 * and nowhere else. (The SDK would also accept an `ant auth login` profile,
 * but production is Vercel, where the env var is the only credential, so we
 * require it explicitly and fail with a readable message.)
 */
function defaultAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new LlmConfigError(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add a key; it is " +
        "server-only and must never reach the client bundle.",
    );
  }
  return new Anthropic({ apiKey, maxRetries: MAX_RETRIES, timeout: REQUEST_TIMEOUT_MS });
}

/** Adapts the Anthropic SDK to {@link LlmClient}. */
export function anthropicClient(anthropic: Anthropic = defaultAnthropic()): LlmClient {
  return {
    stream: (params) => anthropic.messages.stream(params),
    create: (params) => anthropic.messages.create(params),
  };
}

// ---------------------------------------------------------------------------
// Requests and results
// ---------------------------------------------------------------------------

export interface CallRequest {
  /** Which lib module is calling; picks the effort level and labels the row. */
  step: StepName;
  /**
   * The browser's random, anonymous session id from `newSessionId()`. Groups
   * usage rows only. Anything but 32 lowercase hex characters is refused
   * with {@link LlmSessionIdError} before a request is made.
   */
  sessionId: string;
  /**
   * The system prompt. Keep it byte-stable across turns: it is sent as a
   * cached block, and any change (a timestamp, a re-ordered list) invalidates
   * the cache for the whole request (`claude-api` skill, prompt caching).
   */
  system: string;
  messages: readonly Anthropic.MessageParam[];
  /** Server tools, from {@link webTools}. Client-side tools are not supported. */
  tools?: readonly LlmTool[];
  maxTokens?: number;
}

export type StreamTextRequest = CallRequest;

export interface StructuredRequest<S extends z.ZodType> extends CallRequest {
  schema: S;
}

/** What every call reports back, whatever the shape of its output. */
export interface CallMetrics {
  usage: TokenCounts;
  costUsd: number;
  durationMs: number;
  /** How many `pause_turn` resumes this logical call needed. */
  continuations: number;
  stopReason: Anthropic.StopReason | null;
}

export interface StreamTextResult extends CallMetrics {
  /** The full assistant text, concatenated across continuations. */
  text: string;
  /** The last response, for callers that need blocks (citations, tool results). */
  message: Anthropic.Message;
  /**
   * Every response of this logical call in order, `pause_turn` continuations
   * included — {@link message} is the last of them. Callers that audit tool
   * use (blocked hosts, citations) must read this, not just the last message:
   * the tool-heavy segments are the paused ones.
   */
  messages: Anthropic.Message[];
}

export interface StructuredResult<T> extends CallMetrics {
  value: T;
  message: Anthropic.Message;
  /** Every response of this logical call; see {@link StreamTextResult.messages}. */
  messages: Anthropic.Message[];
}

export interface StreamText {
  /**
   * Text deltas as they arrive. Single consumer. Drain it, stop early
   * (`break` out of `for await`, or `ReadableStream.cancel`), or never touch
   * it — the API call runs to completion regardless and {@link final} settles
   * either way. Throws the call's error if the call fails while draining.
   */
  textDeltas: AsyncIterable<string>;
  /**
   * Settles once the API call ends: resolves with the full text and metrics,
   * rejects with the call's error. Independent of {@link textDeltas}.
   */
  final: Promise<StreamTextResult>;
}

export interface Llm {
  streamText(request: StreamTextRequest): StreamText;
  structured<S extends z.ZodType>(request: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>>;
}

export interface CreateLlmOptions {
  client?: LlmClient;
  usageSink?: UsageSink;
  /** Clock, injectable so tests can assert on `duration_ms`. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// The wrapper
// ---------------------------------------------------------------------------

function systemBlocks(system: string): Anthropic.TextBlockParam[] {
  // One cached block: the system prompt is the stable prefix of every turn.
  return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
}

function requestParams(
  request: CallRequest,
  messages: Anthropic.MessageParam[],
  maxTokens: number,
  format?: Anthropic.Messages.JSONOutputFormat,
): Anthropic.MessageCreateParamsNonStreaming {
  const tools = request.tools === undefined ? undefined : [...request.tools];
  return {
    model: MODEL,
    max_tokens: maxTokens,
    system: systemBlocks(request.system),
    messages,
    // Adaptive thinking on every call; `budget_tokens` is rejected by Opus 5.
    thinking: { type: "adaptive" },
    output_config: {
      effort: EFFORT_BY_STEP[request.step],
      ...(format === undefined ? {} : { format }),
    },
    ...(tools === undefined || tools.length === 0 ? {} : { tools }),
  };
}

function usageRow(
  request: CallRequest,
  counts: TokenCounts,
  durationMs: number,
): UsageRow {
  return {
    session_id: request.sessionId,
    step: request.step,
    model: MODEL,
    input_tokens: counts.input,
    output_tokens: counts.output,
    cache_read_input_tokens: counts.cacheRead,
    cache_creation_input_tokens: counts.cacheWrite,
    cost_usd: costUsd(counts),
    duration_ms: Math.max(0, Math.round(durationMs)),
  };
}

/**
 * Terminal stop reasons are checked after usage is logged, so a refused or
 * truncated turn still shows up in the cost telemetry.
 */
function assertTerminalStopReason(request: CallRequest, message: Anthropic.Message, maxTokens: number): void {
  if (message.stop_reason === "refusal") {
    throw new LlmRefusalError(request.step, message.stop_details?.category ?? null);
  }
  if (message.stop_reason === "max_tokens") {
    throw new LlmTruncatedError(request.step, maxTokens);
  }
  if (message.stop_reason === "tool_use") {
    throw new LlmToolPolicyError(
      `The ${request.step} turn asked to run a client-side tool. This wrapper sends server ` +
        "tools only (webTools()); nothing in this app executes tools locally.",
    );
  }
}

/**
 * A single-consumer async queue for streamed deltas. The producer `push`es as
 * events arrive and then `close`s or `fail`s it; the consumer may drain it,
 * stop early (`return()`, which `for await` calls on `break`), or never start.
 * Nothing the consumer does reaches the producer: once abandoned, further
 * pushes are dropped instead of buffered.
 */
class DeltaQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private done = false;
  private failure: { error: unknown } | undefined;
  private abandoned = false;
  private wake: (() => void) | undefined;

  push(value: T): void {
    if (this.done || this.abandoned) return;
    this.buffer.push(value);
    this.notify();
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    this.notify();
  }

  fail(error: unknown): void {
    if (this.done) return;
    this.failure = { error };
    this.done = true;
    this.notify();
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async (): Promise<IteratorResult<T>> => {
        for (;;) {
          if (this.abandoned) return { done: true, value: undefined };
          if (this.buffer.length > 0) return { done: false, value: this.buffer.shift() as T };
          if (this.done) {
            if (this.failure !== undefined) throw this.failure.error;
            return { done: true, value: undefined };
          }
          await new Promise<void>((resolve) => {
            this.wake = resolve;
          });
        }
      },
      return: (): Promise<IteratorResult<T>> => {
        this.abandoned = true;
        this.buffer = [];
        return Promise.resolve({ done: true, value: undefined });
      },
    };
  }
}

/** Performs one HTTP request and returns its final message. */
type Turn = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

interface RunOutcome {
  message: Anthropic.Message;
  /** Every response of the call, in order; `message` is the last. */
  messages: Anthropic.Message[];
  metrics: CallMetrics;
}

/**
 * Sanitized zod issue list: paths and codes only. Path segments are model
 * output when the schema is a `z.record` (the keys), so they are clipped to a
 * short identifier shape; the values themselves are never included.
 */
function describeIssues(error: z.ZodError): string {
  const segment = (part: PropertyKey): string => {
    const text = String(part);
    return /^[A-Za-z0-9_]{1,40}$/.test(text) ? text : "?";
  };
  return error.issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.length === 0 ? "(root)" : issue.path.map(segment).join(".");
      return `${path}: ${issue.code}`;
    })
    .join("; ");
}

/**
 * Builds the wrapper. Inject `client`/`usageSink`/`now` in tests; the defaults
 * are the real SDK client and the anonymous Supabase sink.
 */
export function createLlm(options: CreateLlmOptions = {}): Llm {
  if (typeof window !== "undefined") {
    throw new LlmConfigError(
      "createLlm() was called in a browser. Model calls happen in route handlers only — the " +
        "API key is server-only and the browser must never hold it.",
    );
  }

  const now = options.now ?? (() => Date.now());
  const usageSink = options.usageSink ?? supabaseUsageSink();
  let cachedClient = options.client;
  const client = (): LlmClient => {
    cachedClient ??= anthropicClient();
    return cachedClient;
  };

  /**
   * The one runner behind both call shapes. Owns, in order: the session-id
   * and tool-policy checks (before any request), the `pause_turn`
   * continuation loop, token accumulation, duration, the single
   * `recordUsage` per logical call, and the terminal stop-reason check.
   * `turn` is the only thing that differs between streaming and structured.
   */
  async function runCall(
    request: CallRequest,
    maxTokens: number,
    turn: Turn,
    format?: Anthropic.Messages.JSONOutputFormat,
  ): Promise<RunOutcome> {
    if (!isSessionId(request.sessionId)) throw new LlmSessionIdError(request.step);
    if (request.tools !== undefined) assertToolsAllowed(request.tools);

    const startedAt = now();
    const messages = [...request.messages];
    /** Every response this call produced, continuations included. */
    const responses: Anthropic.Message[] = [];
    let counts = zeroTokenCounts();
    let continuations = 0;
    let recorded = false;
    const recordOnce = (durationMs: number): void => {
      if (recorded) return;
      recorded = true;
      recordUsage(usageSink, usageRow(request, counts, durationMs));
    };

    try {
      for (;;) {
        const message = await turn(requestParams(request, messages, maxTokens, format));
        counts = addUsage(counts, message.usage);
        responses.push(message);

        if (message.stop_reason === "pause_turn") {
          // A server tool hit its per-request loop limit. Re-send the paused
          // assistant turn and the server resumes where it left off; do not
          // add a "continue" message.
          if (continuations >= MAX_PAUSE_TURN_CONTINUATIONS) {
            recordOnce(now() - startedAt);
            throw new LlmPauseLimitError(request.step, continuations);
          }
          continuations += 1;
          messages.push({ role: "assistant", content: message.content });
          continue;
        }

        const durationMs = now() - startedAt;
        recordOnce(durationMs);
        assertTerminalStopReason(request, message, maxTokens);
        return {
          message,
          messages: responses,
          metrics: {
            usage: counts,
            costUsd: costUsd(counts),
            durationMs,
            continuations,
            stopReason: message.stop_reason,
          },
        };
      }
    } catch (error) {
      // An SDK error after a completed continuation still cost tokens; keep
      // the telemetry complete. Nothing is written if no response arrived.
      if (hasAnyUsage(counts)) recordOnce(now() - startedAt);
      throw error;
    }
  }

  function streamText(request: StreamTextRequest): StreamText {
    const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS_STREAM;
    const deltas = new DeltaQueue<string>();
    let text = "";

    const turn: Turn = async (params) => {
      const stream = client().stream(params);
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          text += event.delta.text;
          deltas.push(event.delta.text);
        }
      }
      return stream.finalMessage();
    };

    // The request starts now, not when `textDeltas` is first pulled, and it
    // runs to completion even if the consumer stops listening. Design choice:
    // COMPLETE rather than abort on early consumer exit. The API reports
    // output tokens only in the final `message_delta`, so aborting would lose
    // the cost of everything generated so far and turn "one row per logical
    // call" into a special case; completing keeps the row exact and lets
    // `final` still resolve with the full text. The price is at most one
    // response's worth of tokens after a disconnect.
    const final = runCall(request, maxTokens, turn).then(
      ({ message, messages, metrics }) => {
        deltas.close();
        return { ...metrics, text, message, messages };
      },
      (error: unknown) => {
        deltas.fail(error);
        throw error;
      },
    );
    // A caller may consume only `textDeltas` (which throws the same error);
    // keep the twin rejection from surfacing as an unhandled rejection.
    final.catch(() => {});

    return { textDeltas: deltas, final };
  }

  /**
   * Parses the structured answer ourselves, after the runner has recorded
   * usage and checked the stop reason. The last text block is the answer (an
   * earlier one can precede server-tool use). Error messages carry only
   * "invalid JSON" or zod paths/codes — never the model's text.
   */
  function parseStructuredOutput<S extends z.ZodType>(
    request: StructuredRequest<S>,
    message: Anthropic.Message,
  ): z.infer<S> {
    const block = message.content.filter((b) => b.type === "text").at(-1);
    if (block === undefined) {
      throw new LlmOutputError(request.step, "the response carried no structured output");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(block.text);
    } catch {
      throw new LlmOutputError(request.step, "invalid JSON");
    }
    const parsed = request.schema.safeParse(raw);
    if (!parsed.success) {
      throw new LlmOutputError(request.step, `invalid at ${describeIssues(parsed.error)}`);
    }
    return parsed.data as z.infer<S>;
  }

  async function structured<S extends z.ZodType>(
    request: StructuredRequest<S>,
  ): Promise<StructuredResult<z.infer<S>>> {
    const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS_STRUCTURED;
    // `zodOutputFormat` is used for its JSON schema only; the parser it
    // attaches is what `messages.parse()` would run, and we do not call that.
    const format = zodOutputFormat(request.schema);
    const { message, messages, metrics } = await runCall(
      request,
      maxTokens,
      (params) => client().create(params),
      format,
    );
    return { ...metrics, value: parseStructuredOutput(request, message), message, messages };
  }

  return { streamText, structured };
}

let cachedLlm: Llm | undefined;

/** The process-wide wrapper for route handlers. Tests use {@link createLlm}. */
export function llm(): Llm {
  cachedLlm ??= createLlm();
  return cachedLlm;
}
