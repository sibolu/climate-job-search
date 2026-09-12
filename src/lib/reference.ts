/**
 * Typed reads of the reference collection (PLAN.md §2 "Reference data").
 *
 * Read-only by design: the tables are written only by `scripts/seed.ts` from
 * `data/*.yaml`, so the repo stays the source of truth and every row in
 * production is reviewable in a pull request. The anon key this module uses
 * physically cannot write them (select-only RLS).
 *
 * The collection explains fields and roles. It is small, hand-curated and
 * deliberately not a job index; nothing here powers job search (PRD hard
 * constraint).
 *
 * Every failure throws {@link ReferenceReadError} — a Supabase error is never
 * swallowed into an empty list, because "no rows" and "the query was wrong"
 * must not look the same to the caller.
 */

import type { PostgrestError } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { anonClient } from "./supabase";

export type ClimateFieldRow = Database["public"]["Tables"]["climate_fields"]["Row"];
export type ExampleRoleRow = Database["public"]["Tables"]["example_roles"]["Row"];
export type ExampleJobPostRow = Database["public"]["Tables"]["example_job_posts"]["Row"];

/** A read against the reference collection failed. Carries the Supabase error. */
export class ReferenceReadError extends Error {
  readonly cause?: PostgrestError;

  constructor(operation: string, cause?: PostgrestError) {
    super(
      cause === undefined
        ? `Reference read failed: ${operation}`
        : `Reference read failed: ${operation} — ${cause.message}` +
            (cause.hint === null || cause.hint === undefined ? "" : ` (${cause.hint})`),
    );
    this.name = "ReferenceReadError";
    this.cause = cause;
  }
}

function unwrap<T>(
  operation: string,
  result: { data: T | null; error: PostgrestError | null },
): T {
  if (result.error !== null) throw new ReferenceReadError(operation, result.error);
  if (result.data === null) throw new ReferenceReadError(`${operation} returned no data`);
  return result.data;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/** Every field, ordered by sector group then name (the order the UI shows). */
export async function listFields(): Promise<ClimateFieldRow[]> {
  return unwrap(
    "listFields",
    await anonClient()
      .from("climate_fields")
      .select("*")
      .order("sector_group", { ascending: true })
      .order("name", { ascending: true }),
  );
}

/** One field by slug, or `null` when there is no such field. */
export async function getField(id: string): Promise<ClimateFieldRow | null> {
  const result = await anonClient().from("climate_fields").select("*").eq("id", id).maybeSingle();
  if (result.error !== null) throw new ReferenceReadError(`getField(${id})`, result.error);
  return result.data;
}

/** The distinct `sector_group` values, sorted. Drives the "browse industries" chips. */
export async function listSectorGroups(): Promise<string[]> {
  const rows = unwrap(
    "listSectorGroups",
    await anonClient().from("climate_fields").select("sector_group"),
  );
  return [...new Set(rows.map((row) => row.sector_group))].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Roles and example posts
// ---------------------------------------------------------------------------

/** Role profiles — what someone in the role does, never a real person (PLAN.md §7.6). */
export async function listRoles(fieldId?: string): Promise<ExampleRoleRow[]> {
  let query = anonClient().from("example_roles").select("*");
  if (fieldId !== undefined) query = query.eq("field_id", fieldId);
  return unwrap(
    `listRoles(${fieldId ?? "all"})`,
    await query.order("function", { ascending: true }).order("title", { ascending: true }),
  );
}

/** Example job posts, newest retrieval first. Illustrations only — not a job index. */
export async function listJobPosts(fieldId?: string): Promise<ExampleJobPostRow[]> {
  let query = anonClient().from("example_job_posts").select("*");
  if (fieldId !== undefined) query = query.eq("field_id", fieldId);
  return unwrap(
    `listJobPosts(${fieldId ?? "all"})`,
    await query.order("retrieved_at", { ascending: false }).order("id", { ascending: true }),
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Keyword lookup over name, description, climate link, sector group and the
 * transferable-function list. Deliberately just `ilike` plus an array
 * containment test: the collection is a few dozen rows, so full-text
 * infrastructure would be cost without benefit.
 *
 * Any term may match; results are ordered by how many terms matched, then by
 * name. An empty or all-blank `terms` returns `[]` rather than everything.
 */
export async function searchFields(terms: string[]): Promise<ClimateFieldRow[]> {
  const cleaned = [...new Set(terms.map(sanitizeTerm).filter((term) => term.length > 0))];
  if (cleaned.length === 0) return [];

  const filter = cleaned
    .flatMap((term) => [
      `name.ilike."%${term}%"`,
      `description.ilike."%${term}%"`,
      `climate_link.ilike."%${term}%"`,
      `sector_group.ilike."%${term}%"`,
      `transferable_functions.cs.{"${term}"}`,
    ])
    .join(",");

  const rows = unwrap(
    `searchFields(${cleaned.join(", ")})`,
    await anonClient().from("climate_fields").select("*").or(filter),
  );

  const lowered = cleaned.map((term) => term.toLowerCase());
  return rows
    .map((row) => ({ row, score: countMatches(row, lowered) }))
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
    .map((scored) => scored.row);
}

/**
 * PostgREST's `or=` filter is comma- and parenthesis-delimited, and terms are
 * interpolated into it, so those characters (and the quoting and wildcard
 * characters) are removed rather than escaped.
 */
function sanitizeTerm(term: string): string {
  return term
    .replace(/["\\%_*]/g, " ")
    .replace(/[(),.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function countMatches(row: ClimateFieldRow, loweredTerms: string[]): number {
  const haystack = [
    row.name,
    row.description,
    row.climate_link,
    row.sector_group,
    ...(row.transferable_functions ?? []),
  ]
    .join("\n")
    .toLowerCase();
  return loweredTerms.filter((term) => haystack.includes(term)).length;
}
