/**
 * `pnpm smoke:llm` — the Phase 0.3 acceptance check: one live call through
 * `src/lib/llm.ts` writes one anonymous `llm_usage` row.
 *
 * It is deliberately tiny (a structured "say hello", no web tools, medium
 * effort) because what it proves is the wiring, not the model: the API key
 * works, `structured()` parses, and the anon key can insert a usage row that
 * the service role can read back.
 *
 * Without `ANTHROPIC_API_KEY` it prints a skip message and exits 0, so it is
 * safe to run on a machine that has no key. The key is the only credential
 * production has, so keying off it here matches how the app runs.
 *
 * Needs the local Supabase stack (`pnpm db:start`) and `SUPABASE_SERVICE_ROLE_KEY`
 * for the read-back — the anon key deliberately cannot read `llm_usage`.
 */

import process from "node:process";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { MODEL, createLlm, supabaseUsageSink } from "../src/lib/llm";
import { serviceClient } from "../src/lib/supabase";

const SESSION_ID = `smoke-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
const READBACK_ATTEMPTS = 10;
const READBACK_DELAY_MS = 500;

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

  console.log(`Calling ${MODEL} (step: elicit, session: ${SESSION_ID})…`);
  const llm = createLlm({ usageSink: supabaseUsageSink() });
  const result = await llm.structured({
    step: "elicit",
    sessionId: SESSION_ID,
    system: "You are a smoke test. Answer in as few tokens as possible.",
    messages: [{ role: "user", content: "Reply with a two-word greeting." }],
    schema: GreetingSchema,
    maxTokens: 1_024,
  });

  console.log(
    `Call ok: in=${result.usage.input} out=${result.usage.output} ` +
      `cacheRead=${result.usage.cacheRead} cacheWrite=${result.usage.cacheWrite} ` +
      `cost=$${result.costUsd.toFixed(6)} duration=${result.durationMs}ms`,
  );

  // The row is written fire-and-forget, so poll for it rather than assuming.
  const db = serviceClient();
  for (let attempt = 1; attempt <= READBACK_ATTEMPTS; attempt++) {
    const { data, error } = await db
      .from("llm_usage")
      .select(
        "step, model, input_tokens, output_tokens, cache_read_input_tokens, " +
          "cache_creation_input_tokens, cost_usd, duration_ms",
      )
      .eq("session_id", SESSION_ID);
    if (error !== null) {
      console.error(`Reading llm_usage failed (${error.code}): ${error.message}`);
      return 1;
    }
    if (data.length > 0) {
      console.log(`llm_usage row(s) for this session: ${data.length}`);
      for (const row of data) console.log(JSON.stringify(row));
      return data.length === 1 ? 0 : 1;
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
