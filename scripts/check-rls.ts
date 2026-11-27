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
 *     back. It must not be usable to fetch anything about anyone.
 *   * The browser cannot touch `access_codes` at all; it reaches a code's
 *     running total only through the two SECURITY DEFINER functions, with a
 *     key (technical-plan.md D67).
 *
 * It also checks the CHECK constraints that keep the shape honest, using the
 * service role so RLS is out of the picture: the blocked-domain constraint
 * rejects a LinkedIn source, and `llm_usage` rejects a session_id that is not
 * 32 hex chars or a step outside the StepName vocabulary.
 *
 * Run it after every migration:
 *
 *   pnpm db:start && pnpm db:reset && pnpm db:check-rls
 *
 * Exits non-zero if any check fails. Writes only to `llm_usage` and one
 * `access_codes` row, and cleans up the rows it wrote.
 */

import process from "node:process";
import { randomUUID } from "node:crypto";

import type { PostgrestError } from "@supabase/supabase-js";

import { SupabaseConfigError, anonClient, serviceClient } from "../src/lib/supabase";

const REFERENCE_TABLES = ["climate_fields", "example_roles", "example_job_posts"] as const;

/** 32 hex chars, the shape `llm_usage.session_id` is constrained to. */
const SESSION_ID = randomUUID().replace(/-/g, "");

/** 32 hex chars, the shape `access_codes.code_key` is constrained to. */
const CODE_KEY = randomUUID().replace(/-/g, "");
/** A key no row has: the functions must treat it as unknown. */
const UNKNOWN_KEY = randomUUID().replace(/-/g, "");

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

/** (a) A row exists, and the publishable key still cannot see it. */
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
    "refused",
    read.error !== null ? `refused: ${describeError(read.error)}` : `returned ${rows.length} row(s)`,
    // 42501, not "zero rows": a SELECT merely filtered by a policy returns an
    // empty list, which would pass while the table stayed readable the moment a
    // policy changed. This is the same standard the UPDATE and DELETE checks use.
    isPermissionDenied(read.error),
  );
}

/**
 * (a2) The table's own shape refuses anything that is not a counter or the
 * anonymous id: a session_id that is not 32 hex chars, and a step outside the
 * StepName vocabulary. Checked with the service role, so it is the CHECK
 * constraint answering (23514) and not RLS.
 */
async function checkLlmUsageShapeEnforced(): Promise<void> {
  const service = serviceClient();
  const base = { model: "claude-opus-5", input_tokens: 1, output_tokens: 1 };

  const badSession = await service
    .from("llm_usage")
    .insert({ ...base, session_id: "not-a-session-id", step: "cards" });
  record(
    "a",
    "service role INSERT llm_usage with a non-32-hex session_id",
    "rejected by CHECK constraint",
    badSession.error === null
      ? "ACCEPTED — the constraint is missing"
      : `rejected: ${describeError(badSession.error)}`,
    badSession.error !== null && badSession.error.code === "23514",
  );

  const badStep = await service
    .from("llm_usage")
    .insert({ ...base, session_id: SESSION_ID, step: "resume text goes here" });
  record(
    "a",
    "service role INSERT llm_usage with a step outside the vocabulary",
    "rejected by CHECK constraint",
    badStep.error === null
      ? "ACCEPTED — the constraint is missing"
      : `rejected: ${describeError(badStep.error)}`,
    badStep.error !== null && badStep.error.code === "23514",
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
  // A valid step, so the only thing this check can fail on is the permission.
  const updated = await anon.from("llm_usage").update({ step: "revise" }).eq("session_id", SESSION_ID);
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

/**
 * (f) access_codes is closed to the browser; the two SECURITY DEFINER
 * functions are the only way in (technical-plan.md D67). One row is created
 * through the service role to prove the functions read and raise it.
 */
async function checkAccessCodes(): Promise<void> {
  const service = serviceClient();
  const anon = anonClient();

  const badKey = await service.from("access_codes").insert({ code_key: "not-a-code-key", cap_usd: 1 });
  record(
    "f",
    "service role INSERT access_codes with a non-32-hex code_key",
    "rejected by CHECK constraint",
    badKey.error === null ? "ACCEPTED — the constraint is missing" : `rejected: ${describeError(badKey.error)}`,
    badKey.error !== null && badKey.error.code === "23514",
  );

  const seeded = await service.from("access_codes").insert({ code_key: CODE_KEY, cap_usd: 1 });
  record(
    "f",
    "service role can write access_codes",
    "insert succeeds",
    seeded.error === null ? "inserted 1 row" : describeError(seeded.error),
    seeded.error === null,
  );
  if (seeded.error !== null) return;

  // The table itself: every direct operation is a hard permission error.
  const read = await anon.from("access_codes").select("*").eq("code_key", CODE_KEY);
  record(
    "f",
    "anon SELECT access_codes (1 row exists)",
    "refused",
    read.error !== null ? `refused: ${describeError(read.error)}` : `returned ${(read.data ?? []).length} row(s)`,
    isPermissionDenied(read.error),
  );
  const inserted = await anon.from("access_codes").insert({ code_key: UNKNOWN_KEY, cap_usd: 100 });
  record(
    "f",
    "anon INSERT access_codes",
    "refused",
    inserted.error !== null ? `refused: ${describeError(inserted.error)}` : "succeeded",
    isPermissionDenied(inserted.error),
  );
  const updated = await anon.from("access_codes").update({ spent_usd: 0 }).eq("code_key", CODE_KEY);
  record(
    "f",
    "anon UPDATE access_codes",
    "refused",
    updated.error !== null ? `refused: ${describeError(updated.error)}` : "succeeded",
    isPermissionDenied(updated.error),
  );
  const deleted = await anon.from("access_codes").delete().eq("code_key", CODE_KEY);
  record(
    "f",
    "anon DELETE access_codes",
    "refused",
    deleted.error !== null ? `refused: ${describeError(deleted.error)}` : "succeeded",
    isPermissionDenied(deleted.error),
  );

  // The functions, as anon.
  const budget = await anon.rpc("access_code_budget", { key: CODE_KEY });
  const row = budget.data?.[0];
  const budgetOk =
    budget.error === null &&
    budget.data?.length === 1 &&
    Number(row?.cap_usd) === 1 &&
    Number(row?.spent_usd) === 0 &&
    row?.disabled === false;
  record(
    "f",
    "anon access_code_budget(known key)",
    "1 row: cap 1, spent 0, enabled",
    budget.error !== null
      ? `refused: ${describeError(budget.error)}`
      : `${budget.data?.length ?? 0} row(s): cap ${row?.cap_usd}, spent ${row?.spent_usd}, disabled ${row?.disabled}`,
    budgetOk,
  );

  const unknown = await anon.rpc("access_code_budget", { key: UNKNOWN_KEY });
  record(
    "f",
    "anon access_code_budget(unknown key)",
    "no row",
    unknown.error !== null ? `refused: ${describeError(unknown.error)}` : `${unknown.data?.length ?? 0} row(s)`,
    unknown.error === null && (unknown.data?.length ?? 0) === 0,
  );

  const added = await anon.rpc("access_code_add_spend", { key: CODE_KEY, usd: 0.125 });
  const afterAdd = await service.from("access_codes").select("spent_usd").eq("code_key", CODE_KEY).single();
  record(
    "f",
    "anon access_code_add_spend(known key, 0.125)",
    "total raised to exactly 0.125",
    added.error !== null
      ? `refused: ${describeError(added.error)}`
      : afterAdd.error !== null
        ? `read back failed: ${describeError(afterAdd.error)}`
        : `total ${afterAdd.data.spent_usd}`,
    added.error === null && afterAdd.error === null && Number(afterAdd.data.spent_usd) === 0.125,
  );

  const addUnknown = await anon.rpc("access_code_add_spend", { key: UNKNOWN_KEY, usd: 1 });
  const unknownRows = await service.from("access_codes").select("code_key").eq("code_key", UNKNOWN_KEY);
  record(
    "f",
    "anon access_code_add_spend(unknown key)",
    "no error, no row created",
    addUnknown.error !== null
      ? `refused: ${describeError(addUnknown.error)}`
      : `${(unknownRows.data ?? []).length} row(s) for the key`,
    addUnknown.error === null && unknownRows.error === null && (unknownRows.data ?? []).length === 0,
  );

  // Bad amounts. NaN and Infinity cannot travel as JSON numbers, so they are
  // sent as the strings PostgREST hands to numeric.
  const badAmounts: [string, unknown][] = [
    ["-0.5", -0.5],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["null", null],
  ];
  for (const [label, usd] of badAmounts) {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately
       sending values the typed client would not allow; the point is the server's answer. */
    const bad = await anon.rpc("access_code_add_spend", { key: CODE_KEY, usd: usd as any });
    record(
      "f",
      `anon access_code_add_spend(known key, ${label})`,
      "refused (22023)",
      bad.error === null ? "ACCEPTED" : `refused: ${describeError(bad.error)}`,
      bad.error !== null && bad.error.code === "22023",
    );
  }
  const afterBad = await service.from("access_codes").select("spent_usd").eq("code_key", CODE_KEY).single();
  record(
    "f",
    "total after the refused amounts",
    "still 0.125",
    afterBad.error !== null ? `read back failed: ${describeError(afterBad.error)}` : `total ${afterBad.data.spent_usd}`,
    afterBad.error === null && Number(afterBad.data.spent_usd) === 0.125,
  );
}

async function cleanUp(): Promise<void> {
  const service = serviceClient();
  const { error } = await service.from("llm_usage").delete().eq("session_id", SESSION_ID);
  if (error !== null) {
    console.error(`warning: could not clean up llm_usage rows for ${SESSION_ID}: ${error.message}`);
  }
  const codes = await service.from("access_codes").delete().in("code_key", [CODE_KEY, UNKNOWN_KEY]);
  if (codes.error !== null) {
    console.error(`warning: could not clean up the access_codes check row: ${codes.error.code}`);
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
    await checkLlmUsageShapeEnforced();
    await checkLlmUsageInsertable();
    await checkLlmUsageNotMutable();
    await checkReferenceTablesNotWritable();
    await checkReferenceTablesReadable();
    await checkBlockedSourceRejected();
    await checkAccessCodes();
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      console.error(`\nRLS check aborted — ${error.message}\n`);
    } else {
      console.error("\nRLS check aborted.\n");
      console.error(error instanceof Error ? error.stack ?? error.message : error);
    }
    process.exitCode = 1;
    return;
  } finally {
    // Runs whether a check failed, threw or passed, so no check row is left behind.
    await cleanUp().catch(() => {
      console.error("warning: clean-up did not run; check llm_usage and access_codes by hand.");
    });
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
