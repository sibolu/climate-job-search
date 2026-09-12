/**
 * The reference collection's shape and its rules — one module, shared by the
 * seed script and by anything that validates reference data.
 *
 * The repo is the source of truth: `data/*.yaml` is validated here and then
 * mirrored into Supabase by `scripts/seed.ts`. The tables themselves are
 * described in `supabase/migrations/`, and the two hard rules below are
 * enforced twice on purpose — here, so the seed fails loudly with a readable
 * message, and again as CHECK constraints in SQL, so no other code path can
 * get around them:
 *
 *   1. **Blocked sources.** No URL in the collection may point at
 *      linkedin.com, indeed.com or climatebase.org, or any subdomain
 *      (PRD hard constraint: no scraping those sites). Look-alike hosts such
 *      as `notlinkedin.com` are unaffected.
 *   2. **Role profiles, never personal profiles.** `example_roles` describes
 *      what someone in a role does day to day; it never describes, names or
 *      links to a real individual (PLAN.md §7.6). That one is a curation
 *      rule, not something a schema can check — the header comments in
 *      `data/example_roles.yaml` state it, and Phase 1.3's review enforces it.
 *
 * Pure module: no I/O, no Supabase, no Node-only imports.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Blocked sources
// ---------------------------------------------------------------------------

/**
 * Hosts that may never appear as a source. Mirrors
 * `private.blocked_source_domains()` in the migration and the `blocked_domains`
 * list the web tools get in `llm.ts`; keep the three in step.
 */
export const BLOCKED_SOURCE_DOMAINS = ["linkedin.com", "indeed.com", "climatebase.org"] as const;

/** Thrown when reference data breaks a rule. Carries every problem, not the first. */
export class ReferenceDataError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[]) {
    super(issues.length > 0 ? `${message}\n  - ${issues.join("\n  - ")}` : message);
    this.name = "ReferenceDataError";
    this.issues = issues;
  }
}

/**
 * Lowercased host of a URL, or `null` when there is none. Mirrors
 * `private.source_host(text)` in SQL: scheme, userinfo, port, path, query and
 * fragment are stripped, and a scheme-less string like `linkedin.com/jobs` is
 * still read as a host (people paste those).
 */
export function sourceHost(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed === "") return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  return host === "" ? null : host;
}

/**
 * True when the URL's host is a blocked domain or a subdomain of one.
 * `www.linkedin.com` and `uk.indeed.com` are blocked; `notlinkedin.com` and
 * `indeed.com.example.org` are not.
 */
export function isBlockedSourceHost(url: string): boolean {
  const host = sourceHost(url);
  if (host === null) return false;
  return BLOCKED_SOURCE_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/**
 * Throws `ReferenceDataError` when `url` is a blocked source. `where`
 * describes the offending entry so the seed's error names the YAML row.
 */
export function assertAllowedSource(url: string, where = "source"): void {
  if (isBlockedSourceHost(url)) {
    throw new ReferenceDataError("Blocked source URL", [
      `${where}: ${url} — ${sourceHost(url)} is one of ${BLOCKED_SOURCE_DOMAINS.join(", ")} ` +
        "(or a subdomain). The PRD forbids scraping those sites; cite a company career page " +
        "or a board that permits access instead.",
    ]);
  }
}

// ---------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------

/** Stable lowercase-hyphenated slug; also the primary key in Postgres. */
const SlugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be a lowercase-hyphenated slug, e.g. grid-scale-storage");

const NonEmptyText = (max: number) => z.string().trim().min(1).max(max);

/** An http(s) URL that is not a blocked source. */
const SourceUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine((url) => /^https?:\/\//i.test(url), { message: "must be an http(s) URL" })
  .refine((url) => !isBlockedSourceHost(url), {
    message: `must not be on ${BLOCKED_SOURCE_DOMAINS.join(", ")} or a subdomain (PRD: no scraping those sites)`,
  });

const SourcesSchema = z.array(SourceUrlSchema).max(20);

/** `YYYY-MM-DD`, and a date that actually exists. */
const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "must be a real calendar date");

// ---------------------------------------------------------------------------
// The three entry shapes (also the row types)
// ---------------------------------------------------------------------------

export const ClimateFieldSchema = z
  .object({
    id: SlugSchema,
    name: NonEmptyText(200),
    /** Coarse grouping used by the UI, e.g. "energy/grid/storage". */
    sector_group: NonEmptyText(120),
    description: NonEmptyText(4_000),
    /** Why the field matters for climate, in plain language. */
    climate_link: NonEmptyText(4_000),
    /** Job functions that transfer in: marketing, software, video, finance… */
    transferable_functions: z.array(NonEmptyText(80)).max(40).default([]),
    sources: SourcesSchema.default([]),
  })
  .strict();
export type ClimateField = z.infer<typeof ClimateFieldSchema>;

export const ExampleRoleSchema = z
  .object({
    id: SlugSchema,
    field_id: SlugSchema,
    title: NonEmptyText(200),
    /** The job function the role belongs to. */
    function: NonEmptyText(80),
    /** What the ROLE involves day to day. A role profile, never a person. */
    day_to_day: NonEmptyText(4_000),
    example_companies: z.array(NonEmptyText(200)).max(40).default([]),
    sources: SourcesSchema.default([]),
  })
  .strict();
export type ExampleRole = z.infer<typeof ExampleRoleSchema>;

export const ExampleJobPostSchema = z
  .object({
    id: SlugSchema,
    field_id: SlugSchema,
    role_id: SlugSchema.nullish().transform((value) => value ?? null),
    title: NonEmptyText(300),
    company: NonEmptyText(200),
    /** The curator's summary of the requirements, not a copy of the post. */
    requirements_summary: NonEmptyText(4_000),
    source_url: SourceUrlSchema,
    posted_date: DateOnlySchema.nullish().transform((value) => value ?? null),
    retrieved_at: DateOnlySchema,
  })
  .strict();
export type ExampleJobPost = z.infer<typeof ExampleJobPostSchema>;

/** Every YAML file is a top-level list. */
export const ClimateFieldsFileSchema = z.array(ClimateFieldSchema);
export const ExampleRolesFileSchema = z.array(ExampleRoleSchema);
export const ExampleJobPostsFileSchema = z.array(ExampleJobPostSchema);

export interface ReferenceCollection {
  fields: ClimateField[];
  roles: ExampleRole[];
  posts: ExampleJobPost[];
}

/** The unparsed shape the loader hands to {@link validateReferenceCollection}. */
export interface RawReferenceCollection {
  fields: unknown;
  roles: unknown;
  posts: unknown;
}

// ---------------------------------------------------------------------------
// Whole-collection validation
// ---------------------------------------------------------------------------

function issuesFrom(file: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${file}[${path}]: ${issue.message}`;
  });
}

/**
 * Validates the three files together: per-entry schemas, unique ids, and the
 * referential rules (`role.field_id`, `post.field_id`, `post.role_id` must all
 * resolve). Throws `ReferenceDataError` listing every problem found, so one
 * seed run reports all of them rather than one per attempt.
 */
export function validateReferenceCollection(raw: RawReferenceCollection): ReferenceCollection {
  const issues: string[] = [];

  const fieldsResult = ClimateFieldsFileSchema.safeParse(raw.fields);
  const rolesResult = ExampleRolesFileSchema.safeParse(raw.roles);
  const postsResult = ExampleJobPostsFileSchema.safeParse(raw.posts);

  if (!fieldsResult.success) issues.push(...issuesFrom("climate_fields", fieldsResult.error));
  if (!rolesResult.success) issues.push(...issuesFrom("example_roles", rolesResult.error));
  if (!postsResult.success) issues.push(...issuesFrom("example_job_posts", postsResult.error));

  if (!fieldsResult.success || !rolesResult.success || !postsResult.success) {
    throw new ReferenceDataError("Reference data failed validation", issues);
  }

  const fields = fieldsResult.data;
  const roles = rolesResult.data;
  const posts = postsResult.data;

  const fieldIds = collectIds("climate_fields", fields, issues);
  const roleIds = collectIds("example_roles", roles, issues);
  collectIds("example_job_posts", posts, issues);

  for (const role of roles) {
    if (!fieldIds.has(role.field_id)) {
      issues.push(`example_roles[${role.id}]: field_id "${role.field_id}" is not in climate_fields`);
    }
  }
  for (const post of posts) {
    if (!fieldIds.has(post.field_id)) {
      issues.push(
        `example_job_posts[${post.id}]: field_id "${post.field_id}" is not in climate_fields`,
      );
    }
    if (post.role_id !== null && !roleIds.has(post.role_id)) {
      issues.push(
        `example_job_posts[${post.id}]: role_id "${post.role_id}" is not in example_roles`,
      );
    }
  }

  if (issues.length > 0) {
    throw new ReferenceDataError("Reference data failed validation", issues);
  }

  return { fields, roles, posts };
}

function collectIds(file: string, entries: readonly { id: string }[], issues: string[]): Set<string> {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      issues.push(`${file}[${entry.id}]: duplicate id`);
    }
    seen.add(entry.id);
  }
  return seen;
}
