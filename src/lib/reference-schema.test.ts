import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BLOCKED_SOURCE_DOMAINS,
  ClimateFieldSchema,
  ExampleJobPostSchema,
  ReferenceDataError,
  assertAllowedSource,
  isBlockedSourceHost,
  sourceHost,
  validateReferenceCollection,
} from "./reference-schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const field = {
  id: "grid-scale-storage",
  name: "Grid-scale energy storage",
  sector_group: "energy/grid/storage",
  description: "Batteries sized and dispatched to firm up variable generation.",
  climate_link: "Storage is what lets a grid run on wind and solar overnight.",
  transferable_functions: ["software", "finance"],
  sources: ["https://www.nrel.gov/analysis/storage-futures.html"],
};

const role = {
  id: "dispatch-optimization-engineer",
  field_id: "grid-scale-storage",
  title: "Dispatch optimization engineer",
  function: "software",
  day_to_day: "Tunes the models that decide when a battery charges and discharges.",
  example_companies: ["Fluence"],
  sources: ["https://fluenceenergy.com/careers"],
};

const post = {
  id: "fluence-dispatch-engineer-2026-03",
  field_id: "grid-scale-storage",
  role_id: "dispatch-optimization-engineer",
  title: "Senior Software Engineer, Dispatch",
  company: "Fluence",
  requirements_summary: "Five years of backend Python; no energy background required.",
  source_url: "https://fluenceenergy.com/careers/12345",
  posted_date: "2026-03-04",
  retrieved_at: "2026-03-11",
};

// ---------------------------------------------------------------------------
// Blocked hosts (PRD hard constraint)
// ---------------------------------------------------------------------------

describe("sourceHost", () => {
  it("strips scheme, userinfo, port, path, query and case", () => {
    expect(sourceHost("HTTPS://User@WWW.LinkedIn.COM:443/jobs?x=1#y")).toBe("www.linkedin.com");
  });

  it("reads a scheme-less string as a host", () => {
    expect(sourceHost("linkedin.com/jobs/view/1")).toBe("linkedin.com");
  });

  it("returns null for empty or unparseable input", () => {
    expect(sourceHost("")).toBeNull();
    expect(sourceHost("   ")).toBeNull();
    expect(sourceHost("https://")).toBeNull();
  });
});

describe("isBlockedSourceHost", () => {
  it.each([
    "https://linkedin.com/jobs/view/1",
    "https://www.linkedin.com/jobs/view/4123456789",
    "https://uk.indeed.com/q-climate-jobs.html",
    "https://indeed.com",
    "https://climatebase.org/jobs/12345",
    "https://www.climatebase.org/job/1",
    "HTTPS://WWW.LINKEDIN.COM/in/someone",
    "linkedin.com/jobs",
  ])("blocks %s", (url) => {
    expect(isBlockedSourceHost(url)).toBe(true);
  });

  it.each([
    "https://notlinkedin.com/x",
    "https://linkedin.com.example.org/jobs",
    "https://indeed.com.evil.test/a",
    "https://careers.tesla.com/job/1",
    "https://myclimatebase.org/x",
    "https://www.nrel.gov/analysis/storage-futures.html",
  ])("allows %s", (url) => {
    expect(isBlockedSourceHost(url)).toBe(false);
  });

  it("covers exactly the three domains the PRD names", () => {
    expect([...BLOCKED_SOURCE_DOMAINS]).toEqual(["linkedin.com", "indeed.com", "climatebase.org"]);
  });
});

describe("assertAllowedSource", () => {
  it("throws ReferenceDataError naming the entry", () => {
    expect(() => assertAllowedSource("https://www.linkedin.com/jobs/1", "posts[acme-1].source_url"))
      .toThrowError(ReferenceDataError);
    try {
      assertAllowedSource("https://uk.indeed.com/x", "posts[acme-1].source_url");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ReferenceDataError);
      expect((error as ReferenceDataError).message).toContain("posts[acme-1].source_url");
      expect((error as ReferenceDataError).message).toContain("uk.indeed.com");
    }
  });

  it("returns quietly for an allowed URL", () => {
    expect(() => assertAllowedSource("https://notlinkedin.com/x")).not.toThrow();
  });
});

describe("entry schemas", () => {
  it("rejects a blocked URL in climate_fields.sources", () => {
    const result = ClimateFieldSchema.safeParse({
      ...field,
      sources: ["https://www.linkedin.com/company/acme"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blocked source_url on a job post", () => {
    const result = ExampleJobPostSchema.safeParse({
      ...post,
      source_url: "https://climatebase.org/jobs/1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an id that is not a slug", () => {
    expect(ClimateFieldSchema.safeParse({ ...field, id: "Grid Scale Storage" }).success).toBe(false);
  });

  it("rejects unknown keys, so a typo in the YAML is not silently dropped", () => {
    expect(ClimateFieldSchema.safeParse({ ...field, climatelink: "typo" }).success).toBe(false);
  });

  it("defaults optional lists and nullable dates", () => {
    const parsed = ExampleJobPostSchema.parse({ ...post, posted_date: undefined, role_id: undefined });
    expect(parsed.posted_date).toBeNull();
    expect(parsed.role_id).toBeNull();
  });

  it("rejects an impossible calendar date", () => {
    expect(ExampleJobPostSchema.safeParse({ ...post, retrieved_at: "2026-02-30" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Whole-collection validation
// ---------------------------------------------------------------------------

describe("validateReferenceCollection", () => {
  it("accepts a valid minimal set", () => {
    const collection = validateReferenceCollection({
      fields: [field],
      roles: [role],
      posts: [post],
    });
    expect(collection.fields).toHaveLength(1);
    expect(collection.roles[0].field_id).toBe("grid-scale-storage");
    expect(collection.posts[0].role_id).toBe("dispatch-optimization-engineer");
  });

  it("accepts three empty lists (the Phase 0.4 fixture)", () => {
    expect(validateReferenceCollection({ fields: [], roles: [], posts: [] })).toEqual({
      fields: [],
      roles: [],
      posts: [],
    });
  });

  it("rejects a role whose field_id does not exist", () => {
    expect(() =>
      validateReferenceCollection({
        fields: [field],
        roles: [{ ...role, field_id: "nope" }],
        posts: [],
      }),
    ).toThrowError(/field_id "nope" is not in climate_fields/);
  });

  it("rejects a post whose field_id does not exist", () => {
    expect(() =>
      validateReferenceCollection({ fields: [field], roles: [role], posts: [{ ...post, field_id: "nope" }] }),
    ).toThrowError(/field_id "nope" is not in climate_fields/);
  });

  it("rejects a post whose role_id does not exist", () => {
    expect(() =>
      validateReferenceCollection({ fields: [field], roles: [role], posts: [{ ...post, role_id: "nope" }] }),
    ).toThrowError(/role_id "nope" is not in example_roles/);
  });

  it("accepts a post with no role_id", () => {
    const collection = validateReferenceCollection({
      fields: [field],
      roles: [role],
      posts: [{ ...post, role_id: null }],
    });
    expect(collection.posts[0].role_id).toBeNull();
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      validateReferenceCollection({ fields: [field, { ...field }], roles: [], posts: [] }),
    ).toThrowError(/duplicate id/);
  });

  it("reports every problem at once", () => {
    try {
      validateReferenceCollection({
        fields: [field],
        roles: [{ ...role, field_id: "nope" }],
        posts: [{ ...post, field_id: "nope", role_id: "also-nope" }],
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ReferenceDataError);
      expect((error as ReferenceDataError).issues).toHaveLength(3);
    }
  });

  it("rejects a file that is not a list", () => {
    expect(() => validateReferenceCollection({ fields: {}, roles: [], posts: [] })).toThrowError(
      ReferenceDataError,
    );
  });
});

// ---------------------------------------------------------------------------
// The SQL copy of the blocked list
// ---------------------------------------------------------------------------

describe("blocked domains stay in step with SQL", () => {
  const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");

  function referenceTablesSql(): string {
    const file = readdirSync(MIGRATIONS).find(
      (name) => name.includes("reference_tables") && name.endsWith(".sql"),
    );
    if (file === undefined) throw new Error(`no *reference_tables*.sql in ${MIGRATIONS}`);
    return readFileSync(join(MIGRATIONS, file), "utf8");
  }

  /** The `array[...]` literal returned by `private.blocked_source_domains()`. */
  function sqlBlockedDomains(sql: string): string[] {
    const literal = /\barray\s*\[([^\]]*)\]\s*::\s*text\[\]/i.exec(sql);
    if (literal === null) throw new Error("blocked_source_domains() array literal not found");
    return literal[1]
      .split(",")
      .map((part) => part.trim().replace(/^'(.*)'$/, "$1"))
      .filter((part) => part !== "");
  }

  /**
   * A banned domain has to be added in three places: this module's list, the
   * `blocked_domains` the web tools get in `llm.ts` (which imports this list,
   * so that one is free), and the SQL function. `llm.test.ts` pins the two
   * TypeScript lists together; this pins the SQL copy, so the lists cannot
   * drift apart without a test failing (PLAN.md §7.13, §7.25).
   */
  it("the SQL function lists exactly BLOCKED_SOURCE_DOMAINS", () => {
    expect(sqlBlockedDomains(referenceTablesSql())).toEqual([...BLOCKED_SOURCE_DOMAINS]);
  });
});
