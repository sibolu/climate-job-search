/**
 * `pnpm smoke:llm` — the Phase 0.3 acceptance check: one live call through
 * `src/lib/llm.ts` writes one anonymous `llm_usage` row.
 *
 * It is deliberately tiny (a structured "say hello", no web tools, medium
 * effort) because what it proves is the wiring, not the model: the API key
 * works, `structured()` parses, and the publishable key can insert a usage row that
 * the service role can read back. It runs as a `queries`-step call, so it
 * also proves the per-step model (technical-plan.md D46, D52): the row's
 * `model` must be `MODEL_BY_STEP.queries` (`claude-opus-5-5`), or it exits
 * non-zero.
 *
 * The call is charged to `ACCESS_CODE` (technical-plan.md D71: no call is
 * unmetered), read through `scripts/script-access-code.ts`. The script reads
 * the code's running total before and after the call and exits non-zero
 * unless it rose. The code, its key, cap and total are never printed.
 *
 * Without `ANTHROPIC_API_KEY` it prints a skip message and exits 0, so it is
 * safe to run on a machine that has no key. The key is the only credential
 * production has, so keying off it here matches how the app runs.
 *
 * Needs the local Supabase stack (`pnpm db:start`) and `SUPABASE_SECRET_KEY`
 * for the read-back — the publishable key deliberately cannot read `llm_usage`.
 */

import process from "node:process";

import { z } from "zod";

import { supabaseBudgetLedger } from "../src/lib/budget";
import { MODEL_BY_STEP, createLlm, supabaseUsageSink } from "../src/lib/llm";
import { newSessionId } from "../src/lib/session";
import { serviceClient } from "../src/lib/supabase";

import { keyedLlm, scriptAccessCodeKey } from "./script-access-code";

/**
 * Wiring-check prompts, not product prompts. The product prompts live as
 * template strings in `src/lib/*.ts`, one module each (CLAUDE.md); these two
 * exist only to get a tiny, cheap, schema-shaped answer back.
 */
const SMOKE_SYSTEM_PROMPT = "You are a smoke test. Answer in as few tokens as possible.";
const SMOKE_USER_PROMPT = "Reply with a two-word greeting.";

/**
 * Adaptive thinking at medium effort spends output tokens before the JSON is
 * emitted; 1k was enough to hit `max_tokens` on a bad day, so give it room.
 */
const SMOKE_MAX_TOKENS = 4_096;

/** The same 32-hex id shape the browser mints; anything else is refused. */
const SESSION_ID = newSessionId();
const READBACK_ATTEMPTS = 10;
const READBACK_DELAY_MS = 500;
const SMOKE_STEP = "queries";
const EXPECTED_MODEL = MODEL_BY_STEP[SMOKE_STEP];

const GreetingSchema = z.object({
  greeting: z.string(),
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<number> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    console.log("ANTHROPIC_API_KEY not set; skipping live smoke call");
    return 0;
  }

  const codeKey = await scriptAccessCodeKey();
  const ledger = supabaseBudgetLedger();
  const before = await ledger.read(codeKey);
  if (before === null) {
    console.error("ACCESS_CODE is not a code on this database. Issue one with `pnpm codes:add --cap 5`.");
    return 1;
  }

  console.log(`Calling ${EXPECTED_MODEL} (step: ${SMOKE_STEP}, session: ${SESSION_ID})…`);
  const ledgerLlm = createLlm({ usageSink: supabaseUsageSink(), budget: ledger });
  const llm = keyedLlm(ledgerLlm, codeKey);
  const result = await llm.structured({
    step: SMOKE_STEP,
    sessionId: SESSION_ID,
    system: SMOKE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: SMOKE_USER_PROMPT }],
    schema: GreetingSchema,
    maxTokens: SMOKE_MAX_TOKENS,
  });

  console.log(
    `Call ok: in=${result.usage.input} out=${result.usage.output} ` +
      `cacheRead=${result.usage.cacheRead} cacheWrite=${result.usage.cacheWrite} ` +
      `cost=$${result.costUsd.toFixed(6)} duration=${result.durationMs}ms`,
  );

  // The charge is written fire-and-forget too; poll for it. Only whether the
  // total rose is printed, never the total itself.
  let rose = false;
  for (let attempt = 1; attempt <= READBACK_ATTEMPTS && !rose; attempt++) {
    const after = await ledger.read(codeKey);
    rose = after !== null && after.spentUsd > before.spentUsd;
    if (!rose) await sleep(READBACK_DELAY_MS);
  }
  if (!rose) {
    console.error("The access code's total did not rise after the call.");
    return 1;
  }
  console.log("Access code charged: its total rose.");

  // The row is written fire-and-forget, so poll for it rather than assuming.
  const db = serviceClient();
  for (let attempt = 1; attempt <= READBACK_ATTEMPTS; attempt++) {
    const { data, error } = await db
      .from("llm_usage")
      // One literal, so supabase-js can type the row (a `+` concatenation cannot be).
      .select(
        "step, model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, cost_usd, duration_ms",
      )
      .eq("session_id", SESSION_ID);
    if (error !== null) {
      console.error(`Reading llm_usage failed (${error.code}): ${error.message}`);
      return 1;
    }
    if (data.length > 0) {
      console.log(`llm_usage row(s) for this session: ${data.length}`);
      for (const row of data) console.log(JSON.stringify(row));
      if (data.length !== 1) return 1;
      if (data[0]?.model !== EXPECTED_MODEL) {
        console.error(`Expected model ${EXPECTED_MODEL}, row says ${String(data[0]?.model)}`);
        return 1;
      }
      return 0;
    }
    await sleep(READBACK_DELAY_MS);
  }

  console.error(
    `No llm_usage row appeared for ${SESSION_ID} within ` +
      `${(READBACK_ATTEMPTS * READBACK_DELAY_MS) / 1000}s. Is the local stack running ` +
      "(`pnpm db:start`) and are the Supabase env vars set?",
  );
  return 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Never print the request or the model's text — only what went wrong.
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    process.exitCode = 1;
  });
