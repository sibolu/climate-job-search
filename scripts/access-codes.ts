/**
 * `pnpm codes:add | codes:list | codes:set` — issue, list and change access
 * codes in `public.access_codes` (technical-plan.md D67).
 *
 *   pnpm codes:add --cap <usd> [--count <n>]
 *   pnpm codes:list
 *   pnpm codes:set <key-prefix> [--cap <usd>] [--disable|--enable]
 *
 * This script is the only writer of codes. It stores the derived key
 * (`accessCodeKey`, first 32 hex of SHA-256), a cap, and nothing else: no
 * label, no name, no note. Who holds which code is kept by the operator,
 * outside the repo and the database. A code is printed exactly once, by
 * `add`, and can never be recovered; the script never accepts a code as
 * input and never logs or stores one.
 *
 * `--cap` is required on `add`: there is no default cap anywhere in code.
 *
 * Uses the secret key, which bypasses RLS. Run it from a laptop, never from
 * the app. It prints the database host first so local and production cannot
 * be confused.
 */

import process from "node:process";
import { parseArgs } from "node:util";

import { accessCodeKey, generateAccessCode } from "../src/lib/access-code";
import type { Database } from "../src/lib/database.types";
import { SupabaseConfigError, serviceClient } from "../src/lib/supabase";

type AccessCodeRow = Database["public"]["Tables"]["access_codes"]["Row"];

const PREFIX_LENGTH = 8;
const MAX_CAP_USD = 10000; // cap_usd is numeric(10, 6)
const MAX_COUNT = 100;

const USAGE = `Usage:
  pnpm codes:add --cap <usd> [--count <n>]     issue n codes (default 1) with this dollar cap
  pnpm codes:list                              list every code's key prefix, cap, total and state
  pnpm codes:set <key-prefix> [--cap <usd>] [--disable|--enable]
                                               change one code, matched by its key prefix

--cap: a number >= 0 and below ${MAX_CAP_USD}, at most 6 decimals.
--count: an integer from 1 to ${MAX_COUNT}.
<key-prefix>: at least 4 lower-case hex characters of the key, as codes:list shows it.`;

class UsageError extends Error {}

function parseCap(raw: string | undefined): number {
  if (raw === undefined) throw new UsageError("--cap is required.");
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) {
    throw new UsageError(`--cap must be a plain number >= 0 with at most 6 decimals (got "${raw}").`);
  }
  const cap = Number(raw);
  if (!Number.isFinite(cap) || cap < 0 || cap >= MAX_CAP_USD) {
    throw new UsageError(`--cap must be >= 0 and below ${MAX_CAP_USD} (got "${raw}").`);
  }
  return cap;
}

function parseCount(raw: string | undefined): number {
  if (raw === undefined) return 1;
  if (!/^\d+$/.test(raw)) throw new UsageError(`--count must be an integer (got "${raw}").`);
  const count = Number(raw);
  if (count < 1 || count > MAX_COUNT) throw new UsageError(`--count must be from 1 to ${MAX_COUNT} (got "${raw}").`);
  return count;
}

/** Host and port only, never a key or a path. */
function databaseHost(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (url === undefined || url === "") return "(NEXT_PUBLIC_SUPABASE_URL is not set)";
  try {
    return new URL(url).host;
  } catch {
    return "(NEXT_PUBLIC_SUPABASE_URL is not a URL)";
  }
}

function formatRow(row: AccessCodeRow): string {
  return [
    row.code_key.slice(0, PREFIX_LENGTH).padEnd(PREFIX_LENGTH + 2),
    `$${Number(row.cap_usd)}`.padStart(10),
    `$${Number(row.spent_usd).toFixed(6)}`.padStart(14),
    (row.disabled ? "disabled" : "enabled").padEnd(10),
    row.created_at,
  ].join("  ");
}

const HEADER = ["key".padEnd(PREFIX_LENGTH + 2), "cap".padStart(10), "total".padStart(14), "state".padEnd(10), "created"].join("  ");

async function add(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: { cap: { type: "string" }, count: { type: "string" } },
    allowPositionals: true,
  });
  if (positionals.length > 0) throw new UsageError(`Unexpected argument: ${positionals[0]}`);
  const cap = parseCap(values.cap);
  const count = parseCount(values.count);

  const issued: { code: string; key: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    const code = generateAccessCode();
    issued.push({ code, key: await accessCodeKey(code) });
  }

  const { error } = await serviceClient()
    .from("access_codes")
    .insert(issued.map(({ key }) => ({ code_key: key, cap_usd: cap })));
  if (error) throw new Error(`Insert failed (${error.code}); no codes were issued.`);

  console.log(`Issued ${count} code(s) with a $${cap} cap:\n`);
  for (const { code, key } of issued) console.log(`  ${code}    key ${key.slice(0, PREFIX_LENGTH)}`);
  console.log(
    "\nThese codes are shown once and cannot be recovered: only their keys are stored." +
      "\nKeep the record of who holds which code outside this repo and outside the database.",
  );
}

async function list(args: string[]): Promise<void> {
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true });
  if (positionals.length > 0) throw new UsageError(`Unexpected argument: ${positionals[0]}`);
  const { data, error } = await serviceClient()
    .from("access_codes")
    .select("*")
    .order("created_at", { ascending: true })
    .order("code_key", { ascending: true }); // codes issued together share created_at
  if (error) throw new Error(`Read failed (${error.code}).`);
  if (data.length === 0) {
    console.log("No access codes.");
    return;
  }
  console.log(HEADER);
  for (const row of data) console.log(formatRow(row));
  console.log(`\n${data.length} code(s).`);
}

async function set(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: { cap: { type: "string" }, disable: { type: "boolean" }, enable: { type: "boolean" } },
    allowPositionals: true,
  });
  if (positionals.length !== 1) throw new UsageError("codes:set takes exactly one key prefix.");
  const prefix = positionals[0];
  if (!/^[0-9a-f]{4,32}$/.test(prefix)) {
    throw new UsageError(`The key prefix must be 4 to 32 lower-case hex characters (got "${prefix}").`);
  }
  if (values.disable && values.enable) throw new UsageError("--disable and --enable cannot be used together.");
  if (values.cap === undefined && !values.disable && !values.enable) {
    throw new UsageError("codes:set needs at least one of --cap, --disable or --enable.");
  }

  const change: Database["public"]["Tables"]["access_codes"]["Update"] = {};
  if (values.cap !== undefined) change.cap_usd = parseCap(values.cap);
  if (values.disable) change.disabled = true;
  if (values.enable) change.disabled = false;

  const client = serviceClient();
  // The prefix is validated as hex, so it carries no LIKE wildcards.
  const { data: matches, error: readError } = await client
    .from("access_codes")
    .select("code_key")
    .like("code_key", `${prefix}%`);
  if (readError) throw new Error(`Read failed (${readError.code}).`);
  if (matches.length !== 1) {
    throw new UsageError(
      `The prefix "${prefix}" matched ${matches.length} code(s); it must match exactly one. Nothing was changed.`,
    );
  }

  const { data: updated, error: updateError } = await client
    .from("access_codes")
    .update(change)
    .eq("code_key", matches[0].code_key)
    .select("*")
    .single();
  if (updateError) throw new Error(`Update failed (${updateError.code}).`);
  console.log(HEADER);
  console.log(formatRow(updated));
}

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = { add, list, set };

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const run = command === undefined ? undefined : COMMANDS[command];
  if (run === undefined) {
    console.error(command === undefined ? "No command given.\n" : `Unknown command: ${command}\n`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  try {
    console.log(`Database: ${databaseHost()}\n`);
    await run(rest);
  } catch (error) {
    if (error instanceof UsageError || (error instanceof TypeError && "code" in error)) {
      // TypeError with a code is parseArgs rejecting an unknown or malformed option.
      console.error(`${error.message}\n`);
      console.error(USAGE);
    } else if (error instanceof SupabaseConfigError) {
      console.error(`Aborted — ${error.message}`);
    } else {
      console.error(error instanceof Error ? error.message : "Failed.");
    }
    process.exitCode = 1;
  }
}

void main();
