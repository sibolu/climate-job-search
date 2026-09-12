/**
 * `pnpm db:check-rls` — prove the database really is shaped the way the PRD
 * requires, against a live stack.
 *
 * The two promises this checks are product promises, not implementation
 * details, so they get an executable test rather than a code comment:
 *
 *   * The browser can READ the reference collection and can never WRITE it.
 *     Reference data changes only through `data/*.yaml` and `pnpm seed`.
 *   * The browser can ADD an anonymous `llm_usage` row and can never READ one
 *     back. That table is the single server-side write in the product, and it
 *     must not be usable to fetch anything about anyone.
 *
 * It also checks that the blocked-domain CHECK constraint rejects a LinkedIn
 * source even for the service role, which bypasses RLS.
 *
 * Run it after every migration:
 *
 *   pnpm db:start && pnpm db:reset && pnpm db:check-rls
 *
 * Exits non-zero if any check fails. Writes only to `llm_usage`, and cleans up
 * the rows it wrote.
 */

import process from "node:process";
import { randomUUID } from "node:crypto";

import type { PostgrestError } from "@supabase/supabase-js";

import { SupabaseConfigError, anonClient, serviceClient } from "../src/lib/supabase";

const REFERENCE_TABLES = ["climate_fields", "example_roles", "example_job_posts"] as const;

const SESSION_ID = `rlscheck-${randomUUID().slice(0, 20)}`;

/**
 * A real column per table, so an anon UPDATE is refused for the right reason
 * (a permission error) rather than bouncing off an unknown column name.
 */
const UPDATE_PATCHES: Record<(typeof REFERENCE_TABLES)[number], Record<string, unknown>> = {
  climate_fields: { name: "tampered" },
  example_roles: { title: "tampered" },
  example_job_posts: { title: "tampered" },
};

/** Minimal rows an anon write would use, if it were allowed to. */
const SAMPLE_ROWS: Record<(typeof REFERENCE_TABLES)[number], Record<string, unknown>> = {
  climate_fields: {
    id: "rls-check-should-not-exist",
    name: "RLS check",
    sector_group: "check",
    description: "written by scripts/check-rls.ts; must never land",
    climate_link: "n/a",
  },
  example_roles: {
    id: "rls-check-should-not-exist",
    field_id: "rls-check-should-not-exist",
    title: "RLS check",
    function: "check",
    day_to_day: "written by scripts/check-rls.ts; must never land",
  },
  example_job_posts: {
    id: "rls-check-should-not-exist",
    field_id: "rls-check-should-not-exist",
    title: "RLS check",
    company: "RLS check",
    requirements_summary: "written by scripts/check-rls.ts; must never land",
    source_url: "https://example.com/rls-check",
    retrieved_at: "2026-01-01",
  },
};

interface CheckResult {
  group: string;
  what: string;
  expected: string;
  actual: string;
  ok: boolean;
}

const results: CheckResult[] = [];

function record(group: string, what: string, expected: string, actual: string, ok: boolean): void {
  results.push({ group, what, expected, actual, ok });
}

function describeError(error: PostgrestError | null): string {
  if (error === null) return "no error";
  return `${error.code ?? "?"} ${error.message}`.trim();
}

/**
 * Postgres 42501. The checks insist on this specific code rather than "some
 * error", because a write that is merely filtered out by a policy comes back
 * as a silent success affecting zero rows — which would pass a laxer check
 * while leaving the table writable the moment a row matched. The grants
 * revoked in the RLS migration are what make the refusal unconditional.
 */
function isPermissionDenied(error: PostgrestError | null): boolean {
  return error !== null && error.code === "42501";
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** (a) A row exists, and the anon key still cannot see it. */
async function checkLlmUsageNotReadable(): Promise<void> {
  const service = serviceClient();
  const seeded = await service.from("llm_usage").insert({
    session_id: SESSION_ID,
    step: "discover",
    model: "claude-opus-5",
    input_tokens: 10,
    output_tokens: 20,
    cost_usd: 0.001234,
    duration_ms: 1234,
  });
  if (seeded.error !== null) {
    record("a", "service role can write llm_usage", "insert succeeds", describeError(seeded.error), false);
    return;
  }
  record("a", "service role can write llm_usage", "insert succeeds", "inserted 1 row", true);

  const read = await anonClient().from("llm_usage").select("*").eq("session_id", SESSION_ID);
  const rows = read.data ?? [];
  record(
    "a",
    "anon SELECT llm_usage (1 row exists)",
    "error, or zero rows",
    read.error !== null ? `refused: ${describeError(read.error)}` : `returned ${rows.length} row(s)`,
    isPermissionDenied(read.error) || (read.error === null && rows.length === 0),
  );
}

/** (b) The one write the browser is allowed to make. */
async function checkLlmUsageInsertable(): Promise<void> {
  const { error } = await anonClient().from("llm_usage").insert({
    session_id: SESSION_ID,
    step: "cards",
    model: "claude-opus-5",
    input_tokens: 1,
    output_tokens: 1,
    cost_usd: 0.000001,
    duration_ms: 1,
  });
  record(
    "b",
    "anon INSERT llm_usage",
    "succeeds",
    error === null ? "inserted 1 row" : `refused: ${describeError(error)}`,
    error === null,
  );
}

/** llm_usage is insert-only: no updates, no deletes either. */
async function checkLlmUsageNotMutable(): Promise<void> {
  const anon = anonClient();
  const updated = await anon.from("llm_usage").update({ step: "tampered" }).eq("session_id", SESSION_ID);
  record(
    "b",
    "anon UPDATE llm_usage",
    "refused",
    updated.error !== null ? `refused: ${describeError(updated.error)}` : "succeeded",
    isPermissionDenied(updated.error),
  );

  const deleted = await anon.from("llm_usage").delete().eq("session_id", SESSION_ID);
  record(
    "b",
    "anon DELETE llm_usage",
    "refused",
    deleted.error !== null ? `refused: ${describeError(deleted.error)}` : "succeeded",
    isPermissionDenied(deleted.error),
  );
}

/** (c) The reference collection is read-only for the browser. */
async function checkReferenceTablesNotWritable(): Promise<void> {
  const anon = anonClient();
  for (const table of REFERENCE_TABLES) {
    /* eslint-disable @typescript-eslint/no-explicit-any -- deliberately writing
       rows the typed client would not allow; the point is the server's answer. */
    const inserted = await anon.from(table).insert(SAMPLE_ROWS[table] as any);
    record(
      "c",
      `anon INSERT ${table}`,
      "refused",
      inserted.error !== null ? `refused: ${describeError(inserted.error)}` : "succeeded",
      isPermissionDenied(inserted.error),
    );

    const updated = await anon
      .from(table)
      .update(UPDATE_PATCHES[table] as any)
      .eq("id", "rls-check-should-not-exist");
    /* eslint-enable @typescript-eslint/no-explicit-any */
    record(
      "c",
      `anon UPDATE ${table}`,
      "refused",
      updated.error !== null ? `refused: ${describeError(updated.error)}` : "succeeded",
      isPermissionDenied(updated.error),
    );

    const deleted = await anon.from(table).delete().eq("id", "rls-check-should-not-exist");
    record(
      "c",
      `anon DELETE ${table}`,
      "refused",
      deleted.error !== null ? `refused: ${describeError(deleted.error)}` : "succeeded",
      isPermissionDenied(deleted.error),
    );
  }
}

/** (d) …and readable, which is what the app actually needs. */
async function checkReferenceTablesReadable(): Promise<void> {
  const anon = anonClient();
  for (const table of REFERENCE_TABLES) {
    const { error, data } = await anon.from(table).select("id");
    record(
      "d",
      `anon SELECT ${table}`,
      "succeeds",
      error === null ? `returned ${(data ?? []).length} row(s)` : `refused: ${describeError(error)}`,
      error === null,
    );
  }
}

/** (e) Blocked domains are rejected by the schema itself, service role included. */
async function checkBlockedSourceRejected(): Promise<void> {
  const service = serviceClient();
  const blocked = {
    id: "rls-check-blocked-source",
    name: "RLS check",
    sector_group: "check",
    description: "written by scripts/check-rls.ts; must be rejected",
    climate_link: "n/a",
    transferable_functions: [],
    sources: ["https://www.linkedin.com/company/acme"],
  };
  const { error } = await service.from("climate_fields").insert(blocked);
  record(
    "e",
    "service role INSERT climate_fields with a linkedin.com source",
    "rejected by CHECK constraint",
    error === null ? "ACCEPTED — the constraint is missing" : `rejected: ${describeError(error)}`,
    error !== null && (error.code === "23514" || /check constraint/i.test(error.message)),
  );
  if (error === null) {
    await service.from("climate_fields").delete().eq("id", blocked.id);
  }
}

async function cleanUp(): Promise<void> {
  const { error } = await serviceClient().from("llm_usage").delete().eq("session_id", SESSION_ID);
  if (error !== null) {
    console.error(`warning: could not clean up llm_usage rows for ${SESSION_ID}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printTable(): void {
  const columns: [string, (result: CheckResult) => string][] = [
    ["", (result) => (result.ok ? "pass" : "FAIL")],
    ["#", (result) => result.group],
    ["check", (result) => result.what],
    ["expected", (result) => result.expected],
    ["actual", (result) => result.actual],
  ];
  const widths = columns.map(([header, get]) =>
    Math.max(header.length, ...results.map((result) => get(result).length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();

  console.log("");
  console.log(line(columns.map(([header]) => header)));
  console.log(line(widths.map((width) => "-".repeat(width))));
  for (const result of results) {
    console.log(line(columns.map(([, get]) => get(result))));
  }
  console.log("");
}

async function main(): Promise<void> {
  try {
    await checkLlmUsageNotReadable();
    await checkLlmUsageInsertable();
    await checkLlmUsageNotMutable();
    await checkReferenceTablesNotWritable();
    await checkReferenceTablesReadable();
    await checkBlockedSourceRejected();
    await cleanUp();
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      console.error(`\nRLS check aborted — ${error.message}\n`);
    } else {
      console.error("\nRLS check aborted.\n");
      console.error(error instanceof Error ? error.stack ?? error.message : error);
    }
    process.exitCode = 1;
    return;
  }

  printTable();
  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    console.error(`${failures.length} of ${results.length} checks FAILED.`);
    process.exitCode = 1;
    return;
  }
  console.log(`All ${results.length} checks passed.`);
}

void main();
