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
  LEADING_LEVEL_MODIFIERS,
  LEVEL_HEADS,
  LEVEL_MODIFIERS,
  LEVEL_WORD_OCCUPATIONS,
  MAX_CHIPS,
  MAX_FIELDS,
  REF_KEY,
  type ReferenceReader,
  applyDiscovery,
  buildDiscoverMessage,
  citedActiveCardIds,
  catalogueSourceUrls,
  cleanCatalogueSources,
  cleanSources,
  discoverFields,
  hasLevelHead,
  hasLevelWord,
  renderCardsForDiscover,
  renderCatalogue,
  renderPreferencesForDiscover,
  stripLevelWords,
  validateOutput,
} from "./discover";
import type { CallMetrics, Llm, StreamText, StructuredRequest } from "./llm";
import {
  type Profile,
  activeCards,
  emptyProfile,
  parseProfile,
  serializeProfile,
  setCardExcluded,
  setFieldStatus,
  setPreference,
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
      throw new Error("discover must not stream");
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
const ALLOWED = catalogueSourceUrls(CAT_FIELDS, CAT_ROLES);

function output(overrides: Partial<DiscoverOutput["fields"][number]> = {}): DiscoverOutput {
  return {
    fields: [
      {
        ref: "ag-nonprofits",
        name: "Regenerative agriculture nonprofits",
        move: "sector",
        sector: "Regenerative agriculture",
        fitLevel: "strong",
        summary: "You already make films about farms changing practice. Nonprofits in this space hire for exactly that.",
        chips: ["field production", "documentary interviewing", "client management"],
        fit: "C1 is exactly this work; C2 shows the client relationships.",
        evidence: [
          { cardId: "C1", why: "An eight-part series on no-till farming is the work itself." },
          { cardId: "C2", why: "Land trusts and a watershed council were already clients." },
        ],
        uncertainties: ["In-house or freelance?"],
        ask: { question: "Would you take in-house work over freelance?", key: "Work setup", placeholder: "In-house, if it pays" },
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

  it("keeps only catalogue sources for discovery, then strips blocked and malformed ones", () => {
    const allowed = new Set(["https://example.org/a", "https://www.linkedin.com/x", "not a url"]);
    const { kept, removed } = cleanCatalogueSources(
      [
        "https://example.org/a",
        "https://uk.indeed.com/job",
        "https://www.linkedin.com/x",
        "not a url",
        "https://example.org/remembered",
        "https://example.org/a",
      ],
      allowed,
    );
    expect(kept).toEqual(["https://example.org/a"]);
    expect(removed).toBe(4);
  });

  it("allows every source the catalogue lists, trimmed", () => {
    expect([...catalogueSourceUrls([{ ...CAT_FIELDS[0]!, sources: [" https://example.org/t "] }], [{ ...CAT_ROLES[0]!, sources: null }])]).toEqual([
      "https://example.org/t",
    ]);
    expect(ALLOWED.has("https://example.org/offshore-wind/jobs/video")).toBe(true);
  });

  it("drops uncited fields and roles and counts them", () => {
    const v = validateOutput(output(), profile, ALLOWED);
    expect(v.fields).toHaveLength(1);
    expect(v.fields[0]!.sources).toEqual(["https://example.org/regen"]);
    expect(v.fields[0]!.roles.map((r) => r.title)).toEqual(["Video Producer, farmer outreach"]);
    // The role's URL is not in the catalogue: removed, and the role is kept without one.
    expect(v.fields[0]!.roles[0]!.sources).toEqual([]);
    expect(v.dropped.rolesUncited).toBe(1);
    expect(v.dropped.sourcesRemoved).toBe(2);

    const uncited = validateOutput(output({ fit: "Everyone is needed in climate." }), profile, ALLOWED);
    expect(uncited.fields).toHaveLength(0);
    expect(uncited.dropped.fieldsUncited).toBe(1);

    // A field the model named from memory keeps its place, with no sources.
    const recalled = validateOutput(output({ ref: null, sources: ["https://example.org/remembered"] }), profile, ALLOWED);
    expect(recalled.fields).toHaveLength(1);
    expect(recalled.fields[0]!.sources).toEqual([]);
    expect(recalled.dropped.sourcesRemoved).toBe(2);
  });

  it("only counts citations of active cards", () => {
    const excluded = setCardExcluded(profile, "C1", true);
    expect(citedActiveCardIds("C1 and C2", excluded)).toEqual(["C2"]);
    const v = validateOutput(output({ fit: "Only C1 fits." }), excluded, ALLOWED);
    expect(v.dropped.fieldsUncited).toBe(1);
  });

  it("keeps only evidence that cites an active card, once per card", () => {
    const v = validateOutput(
      output({
        evidence: [
          { cardId: "c1", why: " Series on farms. " },
          { cardId: "C1", why: "Repeated card." },
          { cardId: "C9", why: "No such card." },
          { cardId: "C2", why: "   " },
        ],
      }),
      profile, ALLOWED,
    );
    expect(v.fields[0]!.evidence).toEqual([{ cardId: "C1", why: "Series on farms." }]);
    expect(v.dropped.evidenceDropped).toBe(3);

    const excluded = setCardExcluded(profile, "C2", true);
    const w = validateOutput(output(), excluded, ALLOWED);
    expect(w.fields[0]!.evidence.map((e) => e.cardId)).toEqual(["C1"]);
    expect(w.dropped.evidenceDropped).toBe(1);
  });

  it("trims, dedupes and caps chips, and derives them from cited cards when the model gives none", () => {
    const v = validateOutput(
      output({ chips: [" Field production", "field  production", "", "editing", "budgeting", "pitching", "one more"] }),
      profile, ALLOWED,
    );
    expect(v.fields[0]!.chips).toEqual(["Field production", "editing", "budgeting", "pitching"]);
    expect(v.fields[0]!.chips).toHaveLength(MAX_CHIPS);

    const derived = validateOutput(output({ chips: [], fit: "Only C2 counts." }), profile, ALLOWED);
    const c2 = activeCards(profile).find((c) => c.id === "C2")!;
    expect(derived.fields[0]!.chips).toEqual(c2.skills.slice(0, MAX_CHIPS));
    expect(derived.fields[0]!.chips.length).toBeGreaterThan(0);
  });

  it("drops an ask without a question or key and counts it", () => {
    const v = validateOutput(output({ ask: { question: "  ", key: "Travel", placeholder: "" } }), profile, ALLOWED);
    expect(v.fields[0]!.ask).toBeUndefined();
    expect(v.dropped.asksDropped).toBe(1);
    const kept = validateOutput(output(), profile, ALLOWED);
    expect(kept.fields[0]!.ask).toEqual({
      question: "Would you take in-house work over freelance?",
      key: "Work setup",
      placeholder: "In-house, if it pays",
    });
    expect(kept.dropped.asksDropped).toBe(0);
  });

  it("carries sector, fit level and summary through, whitespace collapsed", () => {
    const v = validateOutput(output({ sector: "  Regen   ag ", fitLevel: "stretch", summary: " Two\nsentences. " }), profile, ALLOWED);
    expect(v.fields[0]!.sector).toBe("Regen ag");
    expect(v.fields[0]!.fitLevel).toBe("stretch");
    expect(v.fields[0]!.summary).toBe("Two sentences.");
  });

  it("caps fields and dedups by ref", () => {
    const many: DiscoverOutput = { fields: Array.from({ length: MAX_FIELDS + 2 }, () => output().fields[0]!) };
    const v = validateOutput(many, profile, ALLOWED);
    expect(v.fields).toHaveLength(1);
    expect(v.dropped.fieldsSurplus).toBe(MAX_FIELDS + 1);
  });
});

describe("profile writes", () => {
  it("keeps IDs stable and user statuses across two runs", async () => {
    const llm = fakeLlm([output()]);
    const first = await discoverFields({ sessionId: SESSION_ID, profile: fixture("videographer") }, { llm, reference });
    expect(first.call.costUsd).toBeGreaterThanOrEqual(0);
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
    expect(applyDiscovery(reparsed, validateOutput(output(), reparsed, ALLOWED).fields).fields[0]!.id).toBe("F1");
  });

  it("writes the exploration-first keys and replaces them on the next run", () => {
    const profile = fixture("videographer");
    const first = applyDiscovery(profile, validateOutput(output(), profile, ALLOWED).fields);
    const f1 = first.fields[0]!;
    expect(f1.sector).toBe("Regenerative agriculture");
    expect(f1.fitLevel).toBe("strong");
    expect(f1.chips).toEqual(["field production", "documentary interviewing", "client management"]);
    expect(f1.evidence.map((e) => e.cardId)).toEqual(["C1", "C2"]);
    expect(f1.ask?.key).toBe("Work setup");
    expect(f1.summary).toMatch(/^You already/);

    const reparsed = parseProfile(serializeProfile(first.profile)).profile;
    expect(reparsed.fields[0]).toEqual(f1);

    const accepted = setFieldStatus(reparsed, "F1", "accepted");
    const second = applyDiscovery(
      accepted,
      validateOutput(
        output({ fitLevel: "some", chips: ["editing"], ask: { question: "", key: "", placeholder: "" }, evidence: [] }),
        accepted, ALLOWED,
      ).fields,
    );
    const f2 = second.fields[0]!;
    expect(f2.id).toBe("F1");
    expect(f2.status).toBe("accepted");
    expect(f2.fitLevel).toBe("some");
    expect(f2.chips).toEqual(["editing"]);
    expect(f2.evidence).toEqual([]);
    expect(f2.ask).toBeUndefined();
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
      profile, ALLOWED,
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
      profile, ALLOWED,
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
      profile, ALLOWED,
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
      discoverFields({ sessionId: SESSION_ID, profile: emptyProfile() }, { llm: fakeLlm([]), reference }),
    ).rejects.toBeInstanceOf(DiscoverInputError);
  });
});

describe("level words (technical-plan.md D48)", () => {
  it("strips level modifiers and leaves the occupation", () => {
    const cases: [string, string][] = [
      ["Senior Data Scientist", "Data Scientist"],
      ["Sr. Product Manager", "Product Manager"],
      ["junior policy analyst", "policy analyst"],
      ["Senior software engineer, full stack", "Software engineer, full stack"],
      ["Lead Process Engineer, Battery Recycling", "Process Engineer, Battery Recycling"],
      ["Principal Engineer", "Engineer"],
      ["Staff Software Engineer", "Software Engineer"],
      ["Senior Staff Engineer", "Engineer"],
      ["Senior / Staff Manufacturing Engineer - High Voltage", "Manufacturing Engineer - High Voltage"],
      ["Associate Product Manager", "Product Manager"],
      ["Assistant Site Manager, Electrical Operations", "Site Manager, Electrical Operations"],
      ["Founding Engineer, Next-Gen Geothermal", "Engineer, Next-Gen Geothermal"],
      ["Wind Technician II", "Wind Technician"],
      ["Engineer I, Fuel Cell System Test", "Engineer, Fuel Cell System Test"],
      ["Process Operator I/II", "Process Operator"],
      ["Building Energy Analyst (entry-level)", "Building Energy Analyst"],
      ["HVAC Engineer (Mid Level)", "HVAC Engineer"],
      ["Analyst, Senior", "Analyst"],
      ["Technician, Level 2", "Technician"],
    ];
    for (const [title, plain] of cases) {
      expect(stripLevelWords(title)).toBe(plain);
      expect(hasLevelWord(title)).toBe(true);
      expect(hasLevelWord(plain)).toBe(false);
    }
  });

  it("leaves a title alone when the word is the occupation itself", () => {
    const occupations = [
      "Product Manager",
      "Project Manager, Hydrogen Systems",
      "Engineering Manager",
      "Offshore Operations & Maintenance Lead",
      "Research Associate",
      "Associate, Renewable Development",
      "Executive Assistant",
      "Account Executive, Enterprise",
      "Chief of Staff",
      "Principal Investigator",
      "Art Director",
      "Lead Generation Specialist",
      "Environmental Consultant, Phase II",
      "Level 2 Charger Installer",
      "Carbon Accountant, Scope 3",
      "I/O Psychologist",
      "Staffing Coordinator",
      "Leadership Development Trainer",
      "Wellhead Technician",
      "Data scientist",
    ];
    for (const title of occupations) {
      expect(stripLevelWords(title)).toBe(title);
      expect(hasLevelWord(title)).toBe(false);
    }
  });

  it("flags a rank it cannot strip down to an occupation", () => {
    const ranks = [
      "Director of Data Science",
      "Policy director",
      "Head of Partnerships",
      "VP, Investor Relations",
      "Vice President of Sales",
      "Chief Sustainability Officer",
      "CTO",
      "Associate Director, Development",
    ];
    for (const title of ranks) {
      expect(hasLevelHead(title)).toBe(true);
      expect(hasLevelWord(title)).toBe(true);
      // Stripping never invents an occupation: the rank is still there.
      expect(hasLevelHead(stripLevelWords(title))).toBe(true);
    }
    expect(hasLevelHead("Product Manager")).toBe(false);
  });

  it("every list entry is lower case, and no entry is both protected and stripped", () => {
    const all = [...LEVEL_MODIFIERS, ...LEADING_LEVEL_MODIFIERS, ...LEVEL_HEADS, ...LEVEL_WORD_OCCUPATIONS];
    for (const word of all) expect(word).toBe(word.toLowerCase().trim());
    expect(new Set(all).size).toBe(all.length);
    expect(LEVEL_HEADS).not.toContain("manager");
    for (const title of LEVEL_WORD_OCCUPATIONS) expect(hasLevelWord(title)).toBe(false);
  });

  it("validation strips levels, dedupes within the field and drops a rank", () => {
    const profile = fixture("videographer");
    const role = (title: string, ref: string | null = null) => ({
      ref,
      title,
      companies: ["Example Coalition"],
      why: "Same field craft as C1.",
      sources: [],
    });
    const v = validateOutput(
      output({
        roles: [
          role("Senior Video Producer"),
          role("video producer"),
          role("Director of Communications"),
          role("Lead Storyteller, Video II", "ow-video"),
        ],
      }),
      profile,
      ALLOWED,
    );
    expect(v.fields[0]!.roles.map((r) => r.title)).toEqual(["Video Producer", "Storyteller, Video"]);
    expect(v.dropped.rolesLevelTitled).toBe(1);
    expect(v.dropped.rolesUncited).toBe(0);
    for (const r of v.fields[0]!.roles) expect(hasLevelWord(r.title)).toBe(false);
  });

  it("a re-run updates a role stored with a level in place", () => {
    const profile = fixture("videographer");
    const draft = (title: string) =>
      output({ roles: [{ ref: null, title, companies: [], why: "Same field craft as C1.", sources: [] }] });
    const validated = validateOutput(draft("Video Producer"), profile, ALLOWED);
    const first = applyDiscovery(profile, validated.fields);
    // An older profile may hold the levelled title; it is the same role.
    const stored = {
      ...first.profile,
      roles: first.profile.roles.map((r) => ({ ...r, title: `Senior ${r.title}` })),
    };
    const second = applyDiscovery(stored, validated.fields);
    expect(second.profile.roles.map((r) => r.id)).toEqual(first.profile.roles.map((r) => r.id));
    expect(second.profile.roles.map((r) => r.title)).toEqual(["Video Producer"]);
  });

  it("the prompt asks for plain occupations at companies, and seniority is not sent", () => {
    expect(DISCOVER_SYSTEM_PROMPT).toContain("carries no level");
    expect(DISCOVER_SYSTEM_PROMPT).not.toMatch(/employer/i);
    expect(DISCOVER_SYSTEM_PROMPT).not.toMatch(/seniority/i);
    const profile = setPreference(fixture("videographer"), "seniority", "director or above", "stated");
    const prefs = renderPreferencesForDiscover(profile);
    expect(prefs).not.toMatch(/seniority|director/i);
    expect(buildDiscoverMessage(profile, CAT_FIELDS, CAT_ROLES)).not.toContain("director or above");
  });

  it("sends named climate areas as an unordered set, and no line when none is named (D54)", () => {
    const base = fixture("videographer");
    const withInterests = (values: string[]) => ({
      ...base,
      preferences: { ...base.preferences, climateInterests: { values, source: "stated" as const } },
    });
    expect(renderPreferencesForDiscover(withInterests(["Energy", "Carbon Removal"])).split("\n")).toContain(
      "- Climate interests (areas named, in no order of preference): Energy; Carbon Removal (stated)",
    );
    expect(renderPreferencesForDiscover(withInterests(["open to suggestions"]))).not.toMatch(/climate interests/i);
    expect(DISCOVER_SYSTEM_PROMPT).toContain("Climate interests set the order, never the list");
  });

  it("sends every skill the person has not removed, untouched inferred ones included (D53)", () => {
    const profile = {
      ...fixture("videographer"),
      skills: {
        confirmed: ["Video editing"],
        inferred: ["field production", "video editing", "tax accounting"],
        excluded: ["Tax Accounting"],
        extra: {},
      },
    };
    const prefs = renderPreferencesForDiscover(profile);
    expect(prefs.split("\n")).toContain("- Skills: Video editing, field production");
    expect(prefs).not.toMatch(/tax accounting/i);
    expect(prefs).not.toMatch(/confirmed/i);
    const message = buildDiscoverMessage(profile, CAT_FIELDS, CAT_ROLES);
    expect(message).toContain("- Skills: Video editing, field production\n");
    expect(message).not.toMatch(/tax accounting/i);

    const allRemoved = { ...profile, skills: { confirmed: [], inferred: ["x"], excluded: ["X"], extra: {} } };
    expect(renderPreferencesForDiscover(allRemoved)).not.toContain("- Skills:");
  });

  it("shows the catalogue's roles without their level modifiers", () => {
    const roles: CatalogueRole[] = CAT_ROLES.map((r, i) => (i === 0 ? { ...r, title: `Senior ${r.title} II` } : r));
    expect(renderCatalogue(CAT_FIELDS, roles)).toBe(renderCatalogue(CAT_FIELDS, CAT_ROLES));
  });
});
