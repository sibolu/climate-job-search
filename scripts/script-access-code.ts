/**
 * The access code every script's model calls are charged to
 * (technical-plan.md D71). No call anywhere is unmetered: `llm.ts` refuses a
 * call without a code key, so `try:cards`, `try:discover`, `try:explore`,
 * `try:queries` and `smoke:llm` read `ACCESS_CODE` from the environment
 * (`.env.local`; server-only, scripts only) through this one helper.
 *
 * It normalises the code the way `/api/enter` does, checks its shape, derives
 * the key, and exits non-zero with a plain sentence when the variable is
 * missing or malformed. Whether the code is known, disabled or spent is the
 * budget read's job, on the first call (`LlmBudgetError`).
 *
 * The code, its key, its cap and its total are never printed.
 */

import process from "node:process";

import { accessCodeKey, isAccessCodeShape, normalizeAccessCode } from "../src/lib/access-code";
import type { Llm } from "../src/lib/llm";
import { withCallContext } from "../src/lib/turn";

const MISSING =
  "ACCESS_CODE is not set. Every model call needs an access code: issue one with `pnpm codes:add --cap 5` and put it in .env.local as ACCESS_CODE.";
const MALFORMED =
  "ACCESS_CODE is not an access code: it should be 16 characters, shown XXXX-XXXX-XXXX-XXXX. Check the value in .env.local.";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * The derived key of `ACCESS_CODE`. Exits the process with a plain sentence
 * when the variable is missing or is not code-shaped. Call it early, before
 * reading input files, so a script without a code stops at once.
 */
export async function scriptAccessCodeKey(): Promise<string> {
  const raw = process.env.ACCESS_CODE;
  if (raw === undefined || raw.trim() === "") fail(MISSING);
  const normalized = normalizeAccessCode(raw);
  if (!isAccessCodeShape(normalized)) fail(MALFORMED);
  return accessCodeKey(normalized);
}

/**
 * `llm` with the script's code key on every request, through the same
 * `withCallContext` the turn route uses, so the step modules stay unaware of it.
 */
export function keyedLlm(llm: Llm, codeKey: string): Llm {
  return withCallContext(llm, { codeKey });
}
