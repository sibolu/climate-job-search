import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { z } from "zod";

import { describe, expect, it } from "vitest";

import {
  type CatalogueField,
  type CatalogueRole,
  DISCOVER_SYSTEM_PROMPT,
  type DiscoverOutput,
  DiscoverInputError,
  MAX_FIELDS,
  REF_KEY,
  type ReferenceReader,
  applyDiscovery,
  buildDiscoverMessage,
  citedActiveCardIds,
  cleanSources,
  discoverFields,
  renderCardsForDiscover,
  renderCatalogue,
  validateOutput,
} from "./discover";
import type { CallMetrics, Llm, StreamText, StructuredRequest } from "./llm";
import {
  type Profile,
  emptyProfile,
  parseProfile,
  serializeProfile,
  setCardExcluded,
  setFieldStatus,
} from "./profile";

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

function fakeLlm(values: readonly unknown[]): FakeLlm {
  const requests: StructuredRequest<z.ZodType>[] = [];
  let i = 0;
  return {
    requests,
    streamText(): StreamText {
      throw new Error("single-call discover must not stream");
    },
    structured<S extends z.ZodType>(request: StructuredRequest<S>) {
      requests.push(request as unknown as StructuredRequest<z.ZodType>);
      const value = values[Math.min(i, values.length - 1)];
      i += 1;
      return Promise.resolve({ value: value as z.infer<S>, message: {} as never, messages: [], ...METRICS });
    },
  };
}

const SESSION_ID = "a".repeat(32);

function fixture(name: string): Profile {
  const md = readFileSync(join(__dirname, "__fixtures__", "discover", `${name}.md`), "utf8");
  return parseProfile(md).profile;
}

const CAT_FIELDS: CatalogueField[] = [
  {
    id: "offshore-wind",
    name: "Offshore wind development",
    sector_group: "energy",
    description: "Developers and operators of offshore wind farms.",
    transferable_functions: ["communications", "project management"],
    sources: ["https://example.org/offshore-wind", "https://example.org/owic"],
  },
  {
    id: "ag-nonprofits",
    name: "Regenerative agriculture nonprofits",
    sector_group: "nature",
    description: "Farmer networks and soil-health coalitions.",
    transferable_functions: ["communications", "fundraising"],
    sources: ["https://example.org/regen"],
  },
];
const CAT_ROLES: CatalogueRole[] = [
  {
    id: "ow-video",
    field_id: "offshore-wind",
    title: "Video Producer",
    function: "communications",
    example_companies: ["Example Wind Co"],
    sources: ["https://example.org/offshore-wind/jobs/video"],
  },
];
const reference: ReferenceReader = {
  listFields: () => Promise.resolve(CAT_FIELDS),
  listRoles: () => Promise.resolve(CAT_ROLES),
};

function output(overrides: Partial<DiscoverOutput["fields"][number]> = {}): DiscoverOutput {
  return {
    fields: [
      {
        ref: "ag-nonprofits",
        name: "Regenerative agriculture nonprofits",
        move: "sector",
        fit: "C1 is exactly this work; C2 shows the client relationships.",
        uncertainties: ["In-house or freelance?"],
        sources: ["https://example.org/regen", "https://www.linkedin.com/company/x"],
        roles: [
          {
            ref: null,
            title: "Video Producer, farmer outreach",
            companies: ["Example Coalition"],
            why: "Same field craft as C1.",
            sources: ["https://example.org/regen/jobs"],
          },
          {
            ref: null,
            title: "Uncited role",
            companies: [],
            why: "No card here.",
            sources: ["https://example.org/x"],
          },
        ],
        ...overrides,
      },
    ],
  };
}

describe("prompt builder", () => {
  it("renders active cards and the catalogue deterministically", () => {
    const profile = fixture("videographer");
    const a = buildDiscoverMessage(profile, CAT_FIELDS, CAT_ROLES);
    const b = buildDiscoverMessage(profile, [...CAT_FIELDS].reverse(), CAT_ROLES);
    expect(a).toBe(b);
    expect(a).toContain("### C1: Eight-part documentary series");
    expect(a).toContain("### offshore-wind: Offshore wind development");
    expect(a).toContain("ow-video: Video Producer [communications]");
    expect(a.indexOf("## Sector group: energy")).toBeLessThan(a.indexOf("## Sector group: nature"));
    expect(DISCOVER_SYSTEM_PROMPT).not.toContain("C1:");
  });

  it("omits excluded cards", () => {
    const profile = setCardExcluded(fixture("videographer"), "C4", true);
    const rendered = renderCardsForDiscover(profile);
    expect(rendered).not.toContain("C4");
    expect(rendered).toContain("C3");
  });

  it("tolerates null arrays from the database", () => {
    const text = renderCatalogue(
      [{ ...CAT_FIELDS[0]!, transferable_functions: null, sources: null }],
      [{ ...CAT_ROLES[0]!, example_companies: null, sources: null }],
    );
    expect(text).toContain("Transferable functions: ");
  });
});

describe("post-validation", () => {
  const profile = fixture("videographer");

  it("strips blocked and malformed sources", () => {
    const { kept, removed } = cleanSources([
      "https://example.org/a",
      "https://uk.indeed.com/job",
      "https://www.linkedin.com/x",
      "not a url",
      "https://example.org/a",
    ]);
    expect(kept).toEqual(["https://example.org/a"]);
    expect(removed).toBe(3);
  });

  it("drops uncited fields and roles and counts them", () => {
    const v = validateOutput(output(), profile);
    expect(v.fields).toHaveLength(1);
    expect(v.fields[0]!.sources).toEqual(["https://example.org/regen"]);
    expect(v.fields[0]!.roles.map((r) => r.title)).toEqual(["Video Producer, farmer outreach"]);
    expect(v.dropped.rolesUncited).toBe(1);
    expect(v.dropped.sourcesRemoved).toBe(1);

    const uncited = validateOutput(output({ fit: "Everyone is needed in climate." }), profile);
    expect(uncited.fields).toHaveLength(0);
    expect(uncited.dropped.fieldsUncited).toBe(1);

    const blockedOnly = validateOutput(output({ sources: ["https://climatebase.org/x"] }), profile);
    expect(blockedOnly.fields).toHaveLength(0);
    expect(blockedOnly.dropped.fieldsUnsourced).toBe(1);
  });

  it("only counts citations of active cards", () => {
    const excluded = setCardExcluded(profile, "C1", true);
    expect(citedActiveCardIds("C1 and C2", excluded)).toEqual(["C2"]);
    const v = validateOutput(output({ fit: "Only C1 fits." }), excluded);
    expect(v.dropped.fieldsUncited).toBe(1);
  });

  it("caps fields and dedups by ref", () => {
    const many: DiscoverOutput = { fields: Array.from({ length: MAX_FIELDS + 2 }, () => output().fields[0]!) };
    const v = validateOutput(many, profile);
    expect(v.fields).toHaveLength(1);
    expect(v.dropped.fieldsSurplus).toBe(MAX_FIELDS + 1);
  });
});

describe("profile writes", () => {
  it("keeps IDs stable and user statuses across two runs", async () => {
    const llm = fakeLlm([output()]);
    const first = await discoverFields({ sessionId: SESSION_ID, profile: fixture("videographer") }, { llm, reference, tools: [] });
    expect(first.strategy).toBe("single");
    expect(first.fields.map((f) => f.id)).toEqual(["F1"]);
    expect(first.fields[0]!.status).toBe("candidate");
    expect(first.fields[0]!.extra[REF_KEY]).toBe("ag-nonprofits");
    expect(first.roles.map((r) => [r.id, r.fieldId])).toEqual([["R1", "F1"]]);
    expect(llm.requests[0]!.tools).toBeUndefined();

    const accepted = setFieldStatus(first.profile, "F1", "accepted");
    const second = await discoverFields(
      { sessionId: SESSION_ID, profile: accepted },
      {
        llm: fakeLlm([output({ fit: "Updated: C2 and C1.", name: "Regen ag nonprofits (renamed)" })]),
        reference,
        tools: [],
      },
    );
    expect(second.profile.fields).toHaveLength(1);
    expect(second.profile.roles).toHaveLength(1);
    expect(second.fields[0]!.id).toBe("F1");
    expect(second.fields[0]!.status).toBe("accepted");
    expect(second.fields[0]!.fit).toBe("Updated: C2 and C1.");
    expect(second.fields[0]!.name).toBe("Regen ag nonprofits (renamed)");
    expect(second.roles[0]!.id).toBe("R1");

    // A round trip through the serializer keeps the ref link.
    const reparsed = parseProfile(serializeProfile(second.profile)).profile;
    expect(reparsed.fields[0]!.extra[REF_KEY]).toBe("ag-nonprofits");
    expect(applyDiscovery(reparsed, validateOutput(output(), reparsed).fields).fields[0]!.id).toBe("F1");
  });

  it("appends new fields after existing ones without renumbering", () => {
    const profile = fixture("web-designer");
    const v = validateOutput(
      {
        fields: [
          ...output().fields,
          { ...output().fields[0]!, ref: null, name: "Brand new field", fit: "C3 shows it." },
        ],
      },
      profile,
    );
    const applied = applyDiscovery(profile, v.fields);
    expect(applied.fields.map((f) => f.id)).toEqual(["F1", "F2"]);
    expect(applied.fields[1]!.extra[REF_KEY]).toBeUndefined();
  });

  it("dedupes on the same key it matches on: one name, two refs", () => {
    const profile = fixture("videographer");
    const base = output().fields[0]!;
    const cited = base.roles[0]!;
    const v = validateOutput(
      {
        fields: [
          { ...base, roles: [cited, { ...cited, ref: "role-b" }] },
          { ...base, ref: "ag-nonprofits-2" },
        ],
      },
      profile,
    );
    expect(v.fields).toHaveLength(1);
    expect(v.dropped.fieldsSurplus).toBe(1);
    expect(v.fields[0]!.roles).toHaveLength(1);

    const applied = applyDiscovery(profile, v.fields);
    expect(applied.fields).toHaveLength(1);
    expect(applied.roles).toHaveLength(1);
    expect(applied.profile.fields).toHaveLength(1);
    expect(applied.profile.roles).toHaveLength(1);
  });

  it("stores refs trimmed so a field and its roles match themselves next run", () => {
    const profile = fixture("videographer");
    const base = output().fields[0]!;
    const cited = base.roles[0]!;
    const v = validateOutput(
      {
        fields: [{ ...base, ref: "  ag-nonprofits  ", roles: [{ ...cited, ref: "  role-a  " }] }],
      },
      profile,
    );
    expect(v.fields[0]!.ref).toBe("ag-nonprofits");
    expect(v.fields[0]!.roles[0]!.ref).toBe("role-a");

    const first = applyDiscovery(profile, v.fields);
    expect(first.profile.fields[0]!.extra[REF_KEY]).toBe("ag-nonprofits");
    expect(first.profile.roles[0]!.extra[REF_KEY]).toBe("role-a");

    const again = applyDiscovery(first.profile, v.fields);
    expect(again.profile.fields).toHaveLength(1);
    expect(again.profile.roles).toHaveLength(1);
    expect(again.fields[0]!.id).toBe("F1");
    expect(again.roles[0]!.id).toBe("R1");
  });

  it("refuses a profile without active cards", async () => {
    await expect(
      discoverFields({ sessionId: SESSION_ID, profile: emptyProfile() }, { llm: fakeLlm([]), reference, tools: [] }),
    ).rejects.toBeInstanceOf(DiscoverInputError);
  });
});
