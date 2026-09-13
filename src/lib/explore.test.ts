import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { REF_KEY } from "./discover";
import {
  DAY_TO_DAY_KEY,
  EXPLORE_SYSTEM_PROMPT,
  type ExploreOutput,
  type ExploreReferenceReader,
  ExploreBlockedFetchError,
  ExploreInputError,
  KEYWORDS_KEY,
  MAX_ROLES_PER_FIELD,
  assertNoBlockedFetches,
  buildExploreMessage,
  collectFetchedUrls,
  exploreField,
  linkedinGuidanceLinks,
  validateExploreOutput,
} from "./explore";
import type { CallMetrics, Llm, StreamText, StructuredRequest } from "./llm";
import { type Profile, parseProfile, serializeProfile, upsertField } from "./profile";

const METRICS: CallMetrics = {
  usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0.001,
  durationMs: 5,
  continuations: 0,
  stopReason: "end_turn",
};

interface FakeLlm extends Llm {
  requests: StructuredRequest<z.ZodType>[];
}

/**
 * `content` is the last response's blocks; `pausedContent` is one entry per
 * `pause_turn` continuation that preceded it, so a test can put a tool result
 * in a segment that is not the final message.
 */
function fakeLlm(
  values: readonly unknown[],
  content: readonly unknown[] = [],
  pausedContent: readonly (readonly unknown[])[] = [],
): FakeLlm {
  const requests: StructuredRequest<z.ZodType>[] = [];
  let i = 0;
  return {
    requests,
    streamText(): StreamText {
      throw new Error("single-call explore must not stream");
    },
    structured<S extends z.ZodType>(request: StructuredRequest<S>) {
      requests.push(request as unknown as StructuredRequest<z.ZodType>);
      const value = values[Math.min(i, values.length - 1)];
      i += 1;
      const message = { content } as never;
      const messages = [...pausedContent.map((c) => ({ content: c }) as never), message];
      return Promise.resolve({ value: value as z.infer<S>, message, messages, ...METRICS });
    },
  };
}

const SESSION_ID = "a".repeat(32);

function profileWithField(ref: string | null = "climate-communications-and-media"): Profile {
  const md = readFileSync(join(__dirname, "__fixtures__", "discover", "videographer.md"), "utf8");
  const p = parseProfile(md).profile;
  return upsertField(p, {
    name: "Climate communications and media",
    status: "candidate",
    explored: false,
    move: "adjacent",
    fit: "C1 and C2 are climate storytelling already.",
    uncertain: "Whether in-house roles exist at this seniority.",
    sources: ["https://example.org/climate-media"],
    extra: ref === null ? {} : { [REF_KEY]: ref },
  });
}

const reference: ExploreReferenceReader = {
  getField: (id) =>
    Promise.resolve(
      id === "climate-communications-and-media"
        ? {
            id,
            name: "Climate communications and media",
            description: "Newsrooms, studios and nonprofits telling climate stories.",
            climate_link: "Public understanding drives policy and adoption.",
            transferable_functions: ["video-media", "communications"],
            sources: ["https://example.org/climate-media"],
          }
        : null,
    ),
  listRoles: () =>
    Promise.resolve([
      {
        id: "ccm-video-producer",
        title: "Video Producer",
        function: "video-media",
        day_to_day: "Plans shoots, interviews scientists, edits explainers.",
        example_companies: ["Example Climate Studio"],
        sources: ["https://example.org/climate-media/jobs/video"],
      },
    ]),
  listJobPosts: () =>
    Promise.resolve([
      {
        id: "post-1",
        title: "Video Producer",
        company: "Example Climate Studio",
        requirements_summary: "3+ years field production; Premiere.",
        source_url: "https://example.org/climate-media/jobs/video-producer",
        posted_date: "2026-08-01",
      },
    ]),
  searchFields: () => Promise.resolve([]),
};

function output(overrides: Partial<ExploreOutput> = {}): ExploreOutput {
  return {
    dayToDay: "Plans and shoots interviews with scientists, cuts explainers, and works with a comms lead.",
    titles: ["Video Producer", "Multimedia Producer", "video producer"],
    employers: ["Example Climate Studio", "Example Nonprofit"],
    examplePosts: [
      {
        title: "Video Producer",
        company: "Example Climate Studio",
        summary: "Field production and editing.",
        sourceUrl: "https://example.org/climate-media/jobs/video-producer",
      },
      { title: "Editor", company: "Blocked Co", summary: "x", sourceUrl: "https://www.linkedin.com/jobs/view/1" },
      { title: "Editor", company: "Bad URL", summary: "x", sourceUrl: "not a url" },
    ],
    keywords: ["climate video producer", "science communications video"],
    sources: ["https://example.org/climate-media", "https://jobs.climatebase.org/x", "https://example.org/climate-media"],
    roles: [
      {
        title: "Video Producer",
        companies: ["Example Climate Studio"],
        why: "C1 and C2 are the same work.",
        sources: ["https://example.org/climate-media/jobs/video"],
      },
      { title: "Unsourced Role", companies: [], why: "C3.", sources: ["https://indeed.com/q"] },
    ],
    uncertain: ["Whether Portland has in-house roles."],
    ...overrides,
  };
}

describe("validateExploreOutput", () => {
  it("drops blocked and malformed URLs, dedups, and counts every drop", () => {
    const v = validateExploreOutput(output());
    expect(v.posts.map((p) => p.sourceUrl)).toEqual(["https://example.org/climate-media/jobs/video-producer"]);
    expect(v.sources).toEqual(["https://example.org/climate-media"]);
    expect(v.titles).toEqual(["Video Producer", "Multimedia Producer"]);
    expect(v.roles.map((r) => r.title)).toEqual(["Video Producer"]);
    expect(v.dropped).toEqual({ postsRemoved: 2, sourcesRemoved: 2, rolesUnsourced: 1, rolesSurplus: 0 });
  });

  it("caps roles per field and counts the surplus", () => {
    const roles = Array.from({ length: 6 }, (_, i) => ({
      title: `Role ${String(i)}`,
      companies: [],
      why: "C1.",
      sources: ["https://example.org/r"],
    }));
    const v = validateExploreOutput(output({ roles }));
    expect(v.roles).toHaveLength(MAX_ROLES_PER_FIELD);
    expect(v.dropped.rolesSurplus).toBe(2);
  });
});

describe("linkedinGuidanceLinks", () => {
  it("encodes keywords and location into user-facing search URLs", () => {
    const links = linkedinGuidanceLinks(["heat pump installer", "HVAC & controls"], "Portland, OR");
    expect(links[0]).toEqual({
      label: "LinkedIn jobs: heat pump installer",
      url: "https://www.linkedin.com/jobs/search/?keywords=heat%20pump%20installer&location=Portland%2C%20OR",
    });
    expect(links[1]!.url).toBe(
      "https://www.linkedin.com/jobs/search/?keywords=HVAC%20%26%20controls&location=Portland%2C%20OR",
    );
    expect(links[2]!.url).toContain("keywords=heat%20pump%20installer%20HVAC%20%26%20controls");
    expect(links).toHaveLength(3);
  });

  it("omits the location parameter when none is given", () => {
    expect(linkedinGuidanceLinks(["solar"])).toEqual([
      { label: "LinkedIn jobs: solar", url: "https://www.linkedin.com/jobs/search/?keywords=solar" },
    ]);
  });
});

describe("assertNoBlockedFetches", () => {
  const ok = [
    { type: "server_tool_use", name: "web_fetch", input: { url: "https://example.org/jobs" } },
    {
      type: "web_search_tool_result",
      content: [{ type: "web_search_result", url: "https://example.org/a" }, { type: "web_search_result", url: "https://example.com/b" }],
    },
    { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: "https://example.org/jobs" } },
    { type: "text", text: "x", citations: [{ type: "web_search_result_location", url: "https://example.org/a" }] },
    { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "unavailable" } },
  ];

  it("collects every searched, fetched and cited URL", () => {
    expect(collectFetchedUrls({ content: ok })).toHaveLength(5);
    expect(assertNoBlockedFetches({ content: ok })).toEqual({ checked: 5 });
    expect(assertNoBlockedFetches({ content: [] })).toEqual({ checked: 0 });
  });

  it("throws naming the blocked host when a subdomain of one appears anywhere", () => {
    const bad = [
      ...ok,
      { type: "text", text: "y", citations: [{ type: "web_search_result_location", url: "https://www.linkedin.com/in/x" }] },
      { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: "https://jobs.climatebase.org/x" } },
    ];
    expect(() => assertNoBlockedFetches({ content: bad })).toThrow(ExploreBlockedFetchError);
    try {
      assertNoBlockedFetches({ content: bad });
    } catch (e) {
      expect((e as ExploreBlockedFetchError).hosts).toEqual(["www.linkedin.com", "jobs.climatebase.org"]);
    }
    expect(() => assertNoBlockedFetches({ content: [{ type: "text", citations: [{ url: "https://notlinkedin.com/x" }] }] })).not.toThrow();
  });
});

describe("exploreField", () => {
  it("renders the reference material first, then applies the output to the profile", async () => {
    const llm = fakeLlm([output()]);
    const profile = profileWithField();
    const result = await exploreField({ sessionId: SESSION_ID, profile, fieldId: "F1" }, { llm, reference, tools: [] });

    const req = llm.requests[0]!;
    expect(req.step).toBe("explore");
    expect(req.system).toBe(EXPLORE_SYSTEM_PROMPT);
    expect(req.tools).toBeUndefined();
    const content = req.messages[0]!.content as string;
    expect(content).toContain("### Catalogue entry");
    expect(content).toContain("ccm-video-producer");
    expect(content).toContain("https://example.org/climate-media/jobs/video-producer");
    expect(content).toContain("### C1:");

    expect(result.field.explored).toBe(true);
    expect(result.field.extra[REF_KEY]).toBe("climate-communications-and-media");
    expect(result.field.extra[DAY_TO_DAY_KEY]).toContain("Plans and shoots");
    expect(result.field.extra[KEYWORDS_KEY]).toBe("climate video producer, science communications video");
    expect(result.roles.map((r) => [r.id, r.title, r.fieldId])).toEqual([["R1", "Video Producer", "F1"]]);
    expect(result.strategy).toBe("single");
    expect(result.fetchedUrls).toBe(0);

    expect(result.message).toContain("**Day to day.**");
    expect(result.message).toContain("https://example.org/climate-media/jobs/video-producer");
    expect(result.message).toContain("linkedin.com/jobs/search/?keywords=climate%20video%20producer");
    expect(result.message).toContain("**What I'm unsure about:**");
    expect(result.message).not.toContain("climatebase");

    // Round trip: what was stored survives profile.ts unchanged.
    const md = serializeProfile(result.profile);
    const again = parseProfile(md).profile;
    expect(again.fields[0]!.extra[DAY_TO_DAY_KEY]).toBe(result.field.extra[DAY_TO_DAY_KEY]);
    expect(again.roles[0]!.title).toBe("Video Producer");
    expect(serializeProfile(again)).toBe(md);
  });

  it("re-running updates the role by title instead of duplicating it", async () => {
    const profile = profileWithField();
    const first = await exploreField(
      { sessionId: SESSION_ID, profile, fieldId: "F1" },
      { llm: fakeLlm([output()]), reference, tools: [] },
    );
    const second = await exploreField(
      { sessionId: SESSION_ID, profile: first.profile, fieldId: "F1" },
      {
        llm: fakeLlm([output({ roles: [{ ...output().roles[0]!, title: "video producer", why: "Updated: C1." }] })]),
        reference,
        tools: [],
      },
    );
    expect(second.profile.roles).toHaveLength(1);
    expect(second.profile.roles[0]).toMatchObject({ id: "R1", title: "video producer", why: "Updated: C1." });
    expect(second.profile.fields[0]!.sources).toEqual(["https://example.org/climate-media"]);
  });

  it("falls back to catalogue search when the field has no ref", async () => {
    const llm = fakeLlm([output()]);
    const searched: string[][] = [];
    const ref: ExploreReferenceReader = {
      ...reference,
      getField: () => Promise.reject(new Error("must not be called without a ref")),
      searchFields: (terms) => {
        searched.push(terms);
        return Promise.resolve([]);
      },
    };
    await exploreField({ sessionId: SESSION_ID, profile: profileWithField(null), fieldId: "F1" }, { llm, reference: ref, tools: [] });
    expect(searched).toEqual([["climate", "communications", "media"]]);
    expect(llm.requests[0]!.messages[0]!.content as string).toContain("no catalogue entry");
  });

  it("refuses an unknown field, a profile without cards, and a blocked fetch", async () => {
    await expect(
      exploreField({ sessionId: SESSION_ID, profile: profileWithField(), fieldId: "F9" }, { llm: fakeLlm([]), reference, tools: [] }),
    ).rejects.toThrow(ExploreInputError);
    const noCards = { ...profileWithField(), cards: [] };
    await expect(
      exploreField({ sessionId: SESSION_ID, profile: noCards, fieldId: "F1" }, { llm: fakeLlm([]), reference, tools: [] }),
    ).rejects.toThrow(ExploreInputError);
    const blocked = fakeLlm([output()], [
      { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: "https://www.indeed.com/viewjob?jk=1" } },
    ]);
    await expect(
      exploreField({ sessionId: SESSION_ID, profile: profileWithField(), fieldId: "F1" }, { llm: blocked, reference, tools: [] }),
    ).rejects.toThrow(ExploreBlockedFetchError);
  });

  it("catches a blocked fetch in a pause_turn continuation, not just the last message", async () => {
    const paused = fakeLlm(
      [output()],
      [],
      [[{ type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: "https://www.linkedin.com/jobs/view/1" } }]],
    );
    await expect(
      exploreField({ sessionId: SESSION_ID, profile: profileWithField(), fieldId: "F1" }, { llm: paused, reference, tools: [] }),
    ).rejects.toThrow(ExploreBlockedFetchError);
  });

  it("builds a deterministic message", () => {
    const p = profileWithField();
    const a = buildExploreMessage(p, p.fields[0]!, { field: null, roles: [], posts: [], related: [] });
    const b = buildExploreMessage(p, p.fields[0]!, { field: null, roles: [], posts: [], related: [] });
    expect(a).toBe(b);
    expect(a).toContain("## Field to explore: F1:");
  });
});
