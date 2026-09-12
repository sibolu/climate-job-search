/**
 * `pnpm seed` — mirror `data/*.yaml` into the Supabase reference tables.
 *
 * Mirror, not append: every entry is upserted by id and any row whose id is no
 * longer in the YAML is deleted. The repo is therefore the single source of
 * truth for the reference collection, and `git diff` on `data/` is the full
 * changelog of what production will contain.
 *
 * Nothing is written until all three files validate (see
 * `src/lib/reference-schema.ts`): a blocked LinkedIn / Indeed / Climatebase
 * URL, a dangling `field_id` or a duplicate id aborts the whole run with a
 * non-zero exit and no partial write. The database enforces the same rules
 * again as CHECK constraints and foreign keys.
 *
 * Uses the service role key, which bypasses RLS. Run it from a laptop or CI,
 * never from the app.
 *
 *   pnpm db:start && pnpm db:reset && pnpm seed
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";
import { parse as parseYaml } from "yaml";

import type { Database } from "../src/lib/database.types";
import {
  ReferenceDataError,
  validateReferenceCollection,
  type ReferenceCollection,
} from "../src/lib/reference-schema";
import { SupabaseConfigError, serviceClient, type TypedSupabaseClient } from "../src/lib/supabase";

// `pnpm seed` always runs from the package root, so `data/` resolves there.
// Resolved from cwd rather than from `import.meta.url` because tsx transpiles
// these scripts to CommonJS (the package has no `"type": "module"`).
const DATA_DIR = path.resolve(process.cwd(), "data");

const FILES = {
  fields: "climate_fields.yaml",
  roles: "example_roles.yaml",
  posts: "example_job_posts.yaml",
} as const;

/** The three reference tables, in dependency order. */
type ReferenceTable = "climate_fields" | "example_roles" | "example_job_posts";

async function loadYamlList(file: string): Promise<unknown> {
  const raw = await readFile(path.join(DATA_DIR, file), "utf8");
  const parsed = parseYaml(raw) as unknown;
  // A file holding only comments parses to null; that is an empty collection.
  return parsed ?? [];
}

async function loadCollection(): Promise<ReferenceCollection> {
  const [fields, roles, posts] = await Promise.all([
    loadYamlList(FILES.fields),
    loadYamlList(FILES.roles),
    loadYamlList(FILES.posts),
  ]);
  return validateReferenceCollection({ fields, roles, posts });
}

interface TableResult {
  table: string;
  inYaml: number;
  upserted: number;
  deleted: number;
}

type Tables = Database["public"]["Tables"];
type InsertRow<T extends keyof Tables> = Tables[T]["Insert"];

function failed(operation: string, error: PostgrestError): Error {
  return new Error(
    `${operation} failed: ${error.message}${error.details === "" ? "" : ` — ${error.details}`}`,
  );
}

/**
 * Deletes every row whose id is not in `keepIds`, which is what makes the seed
 * a mirror of the repo rather than an append. Returns how many went.
 */
async function deleteMissing(
  client: TypedSupabaseClient,
  table: ReferenceTable,
  keepIds: readonly string[],
): Promise<number> {
  const existing = await client.from(table).select("id");
  if (existing.error !== null) throw failed(`reading ids from ${table}`, existing.error);

  const keep = new Set(keepIds);
  const stale = (existing.data ?? []).map((row) => row.id).filter((id) => !keep.has(id));
  if (stale.length === 0) return 0;

  const { error } = await client.from(table).delete().in("id", stale);
  if (error !== null) throw failed(`deleting stale rows from ${table}`, error);
  return stale.length;
}

async function seed(): Promise<TableResult[]> {
  const collection = await loadCollection();
  const client = serviceClient();

  const now = new Date().toISOString();
  const fields: InsertRow<"climate_fields">[] = collection.fields.map((field) => ({
    ...field,
    updated_at: now,
  }));
  const roles: InsertRow<"example_roles">[] = collection.roles.map((role) => ({
    ...role,
    updated_at: now,
  }));
  const posts: InsertRow<"example_job_posts">[] = collection.posts.map((post) => ({ ...post }));

  // Parents before children, so a new field exists before the roles and posts
  // that reference it. The upserts are written out one table at a time rather
  // than looped, because each table has its own row type and the point of the
  // generated `Database` type is to check them.
  if (fields.length > 0) {
    const { error } = await client.from("climate_fields").upsert(fields, { onConflict: "id" });
    if (error !== null) throw failed("upsert into climate_fields", error);
  }
  if (roles.length > 0) {
    const { error } = await client.from("example_roles").upsert(roles, { onConflict: "id" });
    if (error !== null) throw failed("upsert into example_roles", error);
  }
  if (posts.length > 0) {
    const { error } = await client.from("example_job_posts").upsert(posts, { onConflict: "id" });
    if (error !== null) throw failed("upsert into example_job_posts", error);
  }

  // Children before parents on the way out, so a cascade never deletes a row
  // this run was about to count as kept.
  const postsDeleted = await deleteMissing(client, "example_job_posts", posts.map((row) => row.id));
  const rolesDeleted = await deleteMissing(client, "example_roles", roles.map((row) => row.id));
  const fieldsDeleted = await deleteMissing(client, "climate_fields", fields.map((row) => row.id));

  return [
    { table: "climate_fields", inYaml: fields.length, upserted: fields.length, deleted: fieldsDeleted },
    { table: "example_roles", inYaml: roles.length, upserted: roles.length, deleted: rolesDeleted },
    { table: "example_job_posts", inYaml: posts.length, upserted: posts.length, deleted: postsDeleted },
  ];
}

function printResults(results: TableResult[]): void {
  const width = Math.max(...results.map((result) => result.table.length), 5);
  console.log("");
  console.log(`${"table".padEnd(width)}  in yaml  upserted  deleted`);
  console.log(`${"-".repeat(width)}  -------  --------  -------`);
  for (const result of results) {
    console.log(
      `${result.table.padEnd(width)}  ${String(result.inYaml).padStart(7)}  ` +
        `${String(result.upserted).padStart(8)}  ${String(result.deleted).padStart(7)}`,
    );
  }
  console.log("");
}

async function main(): Promise<void> {
  try {
    const results = await seed();
    printResults(results);
    const total = results.reduce((sum, result) => sum + result.inYaml, 0);
    console.log(
      total === 0
        ? "Seed complete: data/*.yaml is empty, so the reference tables are now empty too."
        : `Seed complete: ${total} row(s) now mirror data/*.yaml.`,
    );
  } catch (error) {
    if (error instanceof ReferenceDataError) {
      console.error("\nSeed aborted — nothing was written.\n");
      console.error(error.message);
    } else if (error instanceof SupabaseConfigError) {
      console.error(`\nSeed aborted — ${error.message}\n`);
    } else {
      console.error("\nSeed failed.\n");
      console.error(error instanceof Error ? error.stack ?? error.message : error);
    }
    process.exitCode = 1;
  }
}

void main();
