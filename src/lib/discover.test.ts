import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { z } from "zod";

import { describe, expect, it } from "vitest";

import {
  type Catalogue,
  type CatalogueField,
  type CatalogueRole,
  DISCOVER_SYSTEM_PROMPT_CATALOGUE,
  DISCOVER_SYSTEM_PROMPT_MEMORY,
  type DiscoverOutputCatalogue,
  type DiscoverOutputMemory,
  DiscoverOutputSchemaCatalogue,
  DiscoverOutputSchemaMemory,
  DiscoverInputError,
  FieldDraftSchemaCatalogue,
  FieldDraftSchemaMemory,
  LEADING_LEVEL_MODIFIERS,
  LEVEL_HEADS,
  LEVEL_MODIFIERS,
  LEVEL_WORD_OCCUPATIONS,
  MAX_CHIPS,
  MAX_FIELDS,
  REF_KEY,
  RoleDraftSchemaCatalogue,
  RoleDraftSchemaMemory,
  type ReferenceReader,
  applyDiscovery,
  buildDiscoverMessage,
  citedActiveCardIds,
  catalogueSourceUrls,
  cleanCatalogueSources,
  cleanSources,
  discoverFields,
  droppedSummary,
  hasLevelHead,
  hasLevelWord,
  hasUrl,
  renderCardsForDiscover,
  renderCatalogue,
  renderPreferencesForDiscover,
  stripLevelWords,
  stripUrls,
  validateOutput,
} from "./discover";
import { CLIMATE_AREAS } from "./elicit";
import type { CallMetrics, Llm, StreamText, StructuredRequest } from "./llm";
import {
  type Profile,
  activeCards,
  emptyProfile,
  isDropped,
  parseProfile,
  selectedRoles,
  serializeProfile,
  setCardExcluded,
  setFieldStatus,
  setInputs,
  setPreference,
  setRoleSelected,
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
const CATALOGUE: Catalogue = { fields: CAT_FIELDS, roles: CAT_ROLES };

function output(overrides: Partial<DiscoverOutputCatalogue["fields"][number]> = {}): DiscoverOutputCatalogue {
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
    const a = buildDiscoverMessage(profile, CATALOGUE);
    const b = buildDiscoverMessage(profile, { fields: [...CAT_FIELDS].reverse(), roles: CAT_ROLES });
    expect(a).toBe(b);
    expect(a).toContain("### C1: Eight-part documentary series");
    expect(a).toContain("### offshore-wind: Offshore wind development");
    expect(a).toContain("ow-video: Video Producer [communications]");
    expect(a.indexOf("## Sector group: energy")).toBeLessThan(a.indexOf("## Sector group: nature"));
    expect(DISCOVER_SYSTEM_PROMPT_CATALOGUE).not.toContain("C1:");
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
    const many: DiscoverOutputCatalogue = { fields: Array.from({ length: MAX_FIELDS + 2 }, () => output().fields[0]!) };
    const v = validateOutput(many, profile, ALLOWED);
    expect(v.fields).toHaveLength(1);
    expect(v.dropped.fieldsSurplus).toBe(MAX_FIELDS + 1);
  });
});

describe("profile writes", () => {
  it("keeps IDs stable and user statuses across two runs", async () => {
    const llm = fakeLlm([output()]);
    const first = await discoverFields({ sessionId: SESSION_ID, profile: fixture("videographer") }, { llm, catalogue: reference });
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
        catalogue: reference,
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

  it("drops and un-ticks what a later run does not return, and ranks by the latest run (D58)", () => {
    const profile = fixture("web-designer");
    const original = output().fields[0]!;
    const fresh = { ...original, ref: null, name: "Brand new field", fit: "C3 shows it." };
    const first = applyDiscovery(profile, validateOutput({ fields: [original, fresh] }, profile, ALLOWED).fields);
    const [f1, f2] = first.fields.map((f) => f.id);
    const r2 = first.profile.roles.find((r) => r.fieldId === f2)!.id;
    const ticked = setRoleSelected(first.profile, r2, true);
    expect(selectedRoles(ticked).map((r) => r.id)).toEqual([r2]);

    const second = applyDiscovery(ticked, validateOutput({ fields: [original] }, ticked, ALLOWED).fields);
    const dropped = second.profile.fields.find((f) => f.id === f2)!;
    expect(isDropped(dropped)).toBe(true);
    expect(isDropped(second.profile.fields.find((f) => f.id === f1)!)).toBe(false);
    const droppedRole = second.profile.roles.find((r) => r.id === r2)!;
    expect(isDropped(droppedRole)).toBe(true);
    expect(droppedRole.selected).toBe(false);
    expect(selectedRoles(second.profile)).toEqual([]);

    const third = applyDiscovery(second.profile, validateOutput({ fields: [fresh, original] }, second.profile, ALLOWED).fields);
    expect(third.profile.fields.map((f) => f.id)).toEqual([f2, f1]);
    expect(third.profile.fields.some(isDropped)).toBe(false);
    expect(parseProfile(serializeProfile(third.profile)).profile.fields.map((f) => f.id)).toEqual([f2, f1]);
  });

  it("leaves the profile as it was when a run writes no field", () => {
    const profile = fixture("web-designer");
    const first = applyDiscovery(profile, validateOutput(output(), profile, ALLOWED).fields);
    expect(applyDiscovery(first.profile, []).profile).toBe(first.profile);
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
      discoverFields({ sessionId: SESSION_ID, profile: emptyProfile() }, { llm: fakeLlm([]), catalogue: reference }),
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
    expect(DISCOVER_SYSTEM_PROMPT_CATALOGUE).toContain("carries no level");
    expect(DISCOVER_SYSTEM_PROMPT_CATALOGUE).not.toMatch(/employer/i);
    expect(DISCOVER_SYSTEM_PROMPT_CATALOGUE).not.toMatch(/seniority/i);
    const profile = setPreference(fixture("videographer"), "seniority", "director or above", "stated");
    const prefs = renderPreferencesForDiscover(profile);
    expect(prefs).not.toMatch(/seniority|director/i);
    expect(buildDiscoverMessage(profile, CATALOGUE)).not.toContain("director or above");
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
    expect(DISCOVER_SYSTEM_PROMPT_CATALOGUE).toContain("Climate interests set the order, never the list");
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
    const message = buildDiscoverMessage(profile, CATALOGUE);
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

describe("what the person typed (technical-plan.md D56)", () => {
  it("is not in the discovery prompt, and comes back in the profile", async () => {
    const MARKER = "TYPED-INPUT-MARKER-7f3a";
    const typed = setInputs(fixture("videographer"), { resume: `resume ${MARKER}`, notes: `notes ${MARKER}` });
    const llm = fakeLlm([output()]);
    const result = await discoverFields({ sessionId: SESSION_ID, profile: typed }, { llm, catalogue: reference });

    expect(llm.requests.length).toBeGreaterThan(0);
    for (const request of llm.requests) {
      expect(JSON.stringify([request.system, request.messages])).not.toContain(MARKER);
    }
    expect(result.profile.inputs).toEqual(typed.inputs);
  });
});

// ---------------------------------------------------------------------------
// Memory mode, which the app runs, beside the catalogue arm (technical-plan.md D61)
// ---------------------------------------------------------------------------

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** A `Sources` key with at least one entry under it, in serialized profile text. */
const SOURCE_ENTRY = /^- \*\*Sources:\*\*\n {2}- /m;

/** {@link output} as the memory-mode schema returns it: no ref, no sources. */
function memoryOutput(overrides: Partial<DiscoverOutputMemory["fields"][number]> = {}): DiscoverOutputMemory {
  const field = DiscoverOutputSchemaMemory.parse(output()).fields[0]!;
  return { fields: [{ ...field, ...overrides }] };
}

/** The paragraph of a prompt that starts with `opening`. */
function paragraph(prompt: string, opening: string): string | undefined {
  return prompt.split("\n\n").find((p) => p.startsWith(opening));
}

describe("the two system prompts (technical-plan.md D61)", () => {
  // Pinned in step 2d.2, when the catalogue path became an evaluation arm. A
  // deliberate change to that arm updates the hash in the same commit; the
  // message hash also moves if the videographer fixture or a renderer does.
  it("the catalogue arm's prompt and message are byte for byte what they were before memory mode", () => {
    expect(sha256(DISCOVER_SYSTEM_PROMPT_CATALOGUE)).toBe(
      "1cefadecfcab7aa668a9ebaefd1fec51d9061b762cf117577616e312915e132a",
    );
    expect(sha256(buildDiscoverMessage(fixture("videographer"), CATALOGUE))).toBe(
      "467bb41a289caa3b3a531ab0180d9a560a2a57b4e5a74ddc0c0cd17db94b955a",
    );
  });

  it("the memory prompt frames climate work in ten areas, the six pills by their exact names", () => {
    for (const area of CLIMATE_AREAS) expect(DISCOVER_SYSTEM_PROMPT_MEMORY).toContain(`\n- ${area}\n`);
    for (const area of [
      "Climate Finance (including climate risk, insurance and carbon markets)",
      "Industry & Materials (steel, cement, chemicals, hydrogen, industrial heat)",
      "Nature & Water (conservation, forestry, oceans, water systems)",
      "Corporate Sustainability & Climate Services (carbon accounting, disclosure, climate data and software, policy and advocacy)",
    ]) {
      expect(DISCOVER_SYSTEM_PROMPT_MEMORY).toContain(`\n- ${area}\n`);
    }
    expect(DISCOVER_SYSTEM_PROMPT_MEMORY.match(/^- /gm)).toHaveLength(CLIMATE_AREAS.length + 4);
    expect(DISCOVER_SYSTEM_PROMPT_MEMORY).toContain("a map, not a list to fill");
  });

  it("the memory prompt mentions no catalogue, no ref, no sources, and carries no URL", () => {
    expect(DISCOVER_SYSTEM_PROMPT_MEMORY).not.toMatch(/catalogue/i);
    expect(DISCOVER_SYSTEM_PROMPT_MEMORY).not.toContain('"ref"');
    expect(DISCOVER_SYSTEM_PROMPT_MEMORY).not.toContain('"sources"');
    expect(hasUrl(DISCOVER_SYSTEM_PROMPT_MEMORY)).toBe(false);
    expect(DISCOVER_SYSTEM_PROMPT_MEMORY).toContain("Name real fields and roles you know well");
    expect(DISCOVER_SYSTEM_PROMPT_MEMORY).toContain("Write no URL");
    // Companies: plain text, sure-to-exist organisations, a type rather than a guessed name, never a person.
    const companies = paragraph(DISCOVER_SYSTEM_PROMPT_MEMORY, '"companies" are');
    expect(companies).toContain("plain text");
    expect(companies).toContain("that you are sure exist");
    expect(companies).toContain("the United States or the European Union");
    expect(companies).toContain(`"a utility's grid-planning team"`);
    expect(companies).toContain("never individual people");
    // The same vocabulary rules the catalogue prompt keeps (D48).
    expect(DISCOVER_SYSTEM_PROMPT_MEMORY).not.toMatch(/employer/i);
    expect(DISCOVER_SYSTEM_PROMPT_MEMORY).not.toMatch(/seniority/i);
    expect(DISCOVER_SYSTEM_PROMPT_MEMORY).not.toContain("C1:");
  });

  it("the rules both prompts share are word for word the same", () => {
    for (const n of [1, 3, 4, 7]) {
      const rule = paragraph(DISCOVER_SYSTEM_PROMPT_MEMORY, `${String(n)}. `);
      expect(rule).toBeDefined();
      expect(rule).toBe(paragraph(DISCOVER_SYSTEM_PROMPT_CATALOGUE, `${String(n)}. `));
    }
    // Rule 5 loses only its clause about the catalogue's headings.
    expect(paragraph(DISCOVER_SYSTEM_PROMPT_MEMORY, "5. ")).toBe(
      paragraph(DISCOVER_SYSTEM_PROMPT_CATALOGUE, "5. ")!.replace(
        ", not from the catalogue's sector-group headings, which are coarser",
        "",
      ),
    );
    expect(paragraph(DISCOVER_SYSTEM_PROMPT_MEMORY, "5. ")).toContain("Climate interests set the order, never the list");
    // The title rule loses only its sentence about the catalogue's own titles.
    expect(paragraph(DISCOVER_SYSTEM_PROMPT_MEMORY, "The title is")).toBe(
      paragraph(DISCOVER_SYSTEM_PROMPT_CATALOGUE, "The title is")!.replace(
        ` The catalogue's own titles sometimes carry a rank; when you use such a role, keep its "ref" and write the plain occupation as the title.`,
        "",
      ),
    );
    expect(paragraph(DISCOVER_SYSTEM_PROMPT_MEMORY, "The title is")).toContain("carries no level");
  });
});

describe("the two message shapes and schemas (technical-plan.md D61)", () => {
  it("memory mode leaves the catalogue out and matches a kept field by name", () => {
    const profile = fixture("videographer");
    const withField = applyDiscovery(profile, validateOutput(output(), profile, ALLOWED).fields).profile;
    expect(withField.fields[0]!.extra[REF_KEY]).toBe("ag-nonprofits");

    const memory = buildDiscoverMessage(withField);
    expect(memory).toContain("### C1: Eight-part documentary series");
    expect(memory).toContain("# Preferences\n\n");
    expect(memory).toContain("- F1 Regenerative agriculture nonprofits — status candidate\n");
    expect(memory).toContain("use the same name so it is updated rather than duplicated");
    expect(memory).not.toContain("# Reference catalogue");
    expect(memory).not.toContain("Sector group");
    expect(memory).not.toContain("ag-nonprofits");
    expect(memory).not.toContain("example.org");
    expect(memory.endsWith("duplicated.)\n\nReturn 4-7 ranked fields for this person as JSON.")).toBe(true);

    const catalogue = buildDiscoverMessage(withField, CATALOGUE);
    expect(catalogue).toContain("- F1 Regenerative agriculture nonprofits — status candidate — ref ag-nonprofits\n");
    expect(catalogue).toContain("use the same ref so it is updated rather than duplicated");
    expect(catalogue).toContain("# Reference catalogue\n\n## Sector group: energy");
    // Everything but the catalogue block and the ref wording is shared.
    expect(memory.split("# Fields already in the profile")[0]).toBe(catalogue.split("# Fields already in the profile")[0]);
  });

  it("the memory schema has no ref and no sources; the catalogue schema keeps its keys in order", () => {
    expect(Object.keys(FieldDraftSchemaCatalogue.shape)).toEqual([
      "ref", "name", "move", "sector", "fitLevel", "summary", "chips", "fit", "evidence", "uncertainties", "ask", "sources", "roles",
    ]);
    expect(Object.keys(RoleDraftSchemaCatalogue.shape)).toEqual(["title", "ref", "companies", "why", "sources"]);
    expect(Object.keys(FieldDraftSchemaMemory.shape)).toEqual([
      "name", "move", "sector", "fitLevel", "summary", "chips", "fit", "evidence", "uncertainties", "ask", "roles",
    ]);
    expect(Object.keys(RoleDraftSchemaMemory.shape)).toEqual(["title", "companies", "why"]);
    const parsed = memoryOutput().fields[0]!;
    expect(parsed).not.toHaveProperty("ref");
    expect(parsed).not.toHaveProperty("sources");
    expect(parsed.roles[0]).toEqual({
      title: "Video Producer, farmer outreach",
      companies: ["Example Coalition"],
      why: "Same field craft as C1.",
    });
  });
});

describe("memory mode validation (technical-plan.md D61)", () => {
  const profile = fixture("videographer");

  it("strips URLs and leaves readable text", () => {
    expect(stripUrls("C1 is this work.")).toEqual({ text: "C1 is this work.", removed: 0 });
    expect(stripUrls("C1 is this work (see https://example.org/a).")).toEqual({ text: "C1 is this work.", removed: 1 });
    expect(stripUrls("C1 is this work. See https://example.org/a. C2 adds clients.")).toEqual({
      text: "C1 is this work. C2 adds clients.",
      removed: 1,
    });
    expect(stripUrls("Read [the C1 series](https://example.org/a) first.")).toEqual({
      text: "Read the C1 series first.",
      removed: 1,
    });
    expect(stripUrls("Listed at www.example.org/jobs, and C2 shows it <http://example.org/b>.")).toEqual({
      text: "Listed, and C2 shows it.",
      removed: 2,
    });
    expect(stripUrls("Same field craft as C1: https://example.org/a.")).toEqual({
      text: "Same field craft as C1.",
      removed: 1,
    });
    expect(stripUrls("Source: https://example.org/C1")).toEqual({ text: "", removed: 1 });
    // An organisation's name is not a link.
    expect(stripUrls("350.org hires for this.")).toEqual({ text: "350.org hires for this.", removed: 0 });
    expect(hasUrl("350.org hires for this.")).toBe(false);
    expect(hasUrl("See WWW.example.org")).toBe(true);
  });

  it("leaves no broken brackets, keeps citations next to a URL, and keeps ordinary words", () => {
    const cases: [string, string][] = [
      ["Data from C1 (https://a.com, https://b.com) shows", "Data from C1 shows"],
      ["Your work (C1; https://vimeo.com/x) transfers.", "Your work (C1) transfers."],
      ["Your work (https://a.com, C1) transfers.", "Your work (C1) transfers."],
      ["Your C1 skills matter at http://x.org/a_(b) today", "Your C1 skills matter today"],
      ["Your film work (https://a.com,C1) transfers.", "Your film work (C1) transfers."],
      ["Open source https://github.com/x tools from C1", "Open source tools from C1"],
      ["Query https://a.com/?a=1,2 works.", "Query works."],
      ["Read [x](https://a.com/b_(c)) now, per C1.", "Read x now, per C1."],
    ];
    for (const [input, expected] of cases) expect(stripUrls(input).text).toBe(expected);
  });

  it("removes a link written with no scheme, and leaves names and skills alone (technical-plan.md D66)", () => {
    const links: [string, string][] = [
      ["See rmi.org/insights for more (C1).", "for more (C1)."],
      ["Your C1 work matches energy.gov/eere programmes.", "Your C1 work matches programmes."],
      ["Listed on gov.uk/guidance/heat-networks, per C1.", "Listed on, per C1."],
      ["Read [the C1 series](iea.org/reports/x) first.", "Read the C1 series first."],
      ["C1 is this work (rmi.org/insights).", "C1 is this work."],
    ];
    for (const [input, expected] of links) {
      expect(hasUrl(input)).toBe(true);
      expect(stripUrls(input)).toEqual({ text: expected, removed: 1 });
    }
    // One link, not two: the host inside a query string is part of the link around it.
    expect(stripUrls("C1 https://a.org/r?u=rmi.org/x counts.")).toEqual({ text: "C1 counts.", removed: 1 });
    const kept = [
      "350.org hires for this.",
      "Groups such as 350.org/Sunrise Movement hire for this.",
      "Built on ASP.NET/C# and Node.js/TypeScript (C1).",
      "Socket.IO/REST services and node.js/typescript tooling.",
      "Ask jobs@example.org/hr about C1.",
      "U.S./Canada grid work and/or policy, e.g./i.e. C1.",
    ];
    for (const text of kept) {
      expect(hasUrl(text)).toBe(false);
      expect(stripUrls(text)).toEqual({ text, removed: 0 });
    }
  });

  it("strips URLs from catalogue-mode text too, keeping refs and catalogue sources (technical-plan.md D66)", () => {
    const base = output().fields[0]!;
    const v = validateOutput(
      {
        fields: [
          {
            ...base,
            fit: `${base.fit} (see https://made-up.org/a)`,
            summary: `${base.summary} More at rmi.org/insights.`,
            roles: base.roles.map((r) => ({ ...r, why: `${r.why} See https://made-up.org/b.` })),
          },
        ],
      },
      profile,
      ALLOWED,
    );
    expect(v.fields).toHaveLength(1);
    const field = v.fields[0]!;
    expect(field.ref).toBe(base.ref);
    expect(field.sources).toEqual(["https://example.org/regen"]);
    expect(field.fit).toBe(base.fit.trim());
    expect([field.fit, field.summary, ...field.roles.map((r) => r.why)].some((text) => hasUrl(text))).toBe(false);
    // Two from the field's text, one from the one role that is kept.
    expect(v.dropped.textUrlsStripped).toBe(2 + field.roles.length);
    expect(field.roles).toHaveLength(1);
  });

  it("strips URLs from names and titles, and counts only what is kept", () => {
    const base = memoryOutput().fields[0]!;
    const v = validateOutput(
      {
        fields: [
          {
            ...base,
            name: "Impact media (www.example.org)",
            roles: [
              { title: "Producer – https://x.com", companies: ["Example Coalition"], why: "Same field craft as C1." },
              { title: "Editor", companies: ["https://example.org/a"], why: "No citation here." },
            ],
          },
          { ...base, name: "Another field", fit: "Uncited, see https://example.org/a and https://example.org/b." },
          { ...base, name: "https://example.org/only-a-link" },
        ],
      },
      profile,
    );
    expect(v.fields.map((f) => f.name)).toEqual(["Impact media"]);
    expect(v.fields[0]!.roles.map((r) => r.title)).toEqual(["Producer"]);
    expect(v.dropped.fieldsUncited).toBe(1);
    expect(v.dropped.fieldsSurplus).toBe(1);
    expect(v.dropped.rolesUncited).toBe(1);
    // The name's and the kept title's URLs only: not the uncited field's two or the uncited role's one.
    expect(v.dropped.textUrlsStripped).toBe(2);
  });

  it("removes URLs from the model's prose, counts them, and keeps the citations", () => {
    const v = validateOutput(
      memoryOutput({
        summary: "You already film farms changing practice (https://example.org/regen). Nonprofits hire for exactly that.",
        fit: "C1 is exactly this work (see https://example.org/a); C2 shows the client relationships.",
        roles: [
          {
            title: "Video Producer, farmer outreach",
            companies: ["Example Coalition", "https://example.org/coalition"],
            why: "Same field craft as C1: www.example.org/jobs.",
          },
        ],
      }),
      profile,
    );
    expect(v.fields).toHaveLength(1);
    const field = v.fields[0]!;
    expect(field.summary).toBe("You already film farms changing practice. Nonprofits hire for exactly that.");
    expect(field.fit).toBe("C1 is exactly this work; C2 shows the client relationships.");
    expect(field.roles).toEqual([
      { ref: null, title: "Video Producer, farmer outreach", companies: ["Example Coalition"], why: "Same field craft as C1.", sources: [] },
    ]);
    expect(field.ref).toBeNull();
    expect(field.sources).toEqual([]);
    expect(v.dropped.textUrlsStripped).toBe(4);
    expect(v.dropped.sourcesRemoved).toBe(0);

    // A card ID that appears only inside a URL is not a citation.
    const onlyInUrl = validateOutput(memoryOutput({ fit: "See https://example.org/C1" }), profile);
    expect(onlyInUrl.fields).toHaveLength(0);
    expect(onlyInUrl.dropped.fieldsUncited).toBe(1);
  });

  it("keeps the post-checks: uncited roles, level words, evidence, and dedupe by name", () => {
    const base = memoryOutput().fields[0]!;
    const role = (title: string) => ({ title, companies: ["Example Coalition"], why: "Same field craft as C1." });
    const v = validateOutput(
      {
        fields: [
          { ...base, roles: [...base.roles, role("Senior Video Producer"), role("Director of Communications")] },
          { ...base, summary: "The same name again." },
        ],
      },
      profile,
    );
    expect(v.fields).toHaveLength(1);
    expect(v.dropped.fieldsSurplus).toBe(1);
    expect(v.fields[0]!.roles.map((r) => r.title)).toEqual(["Video Producer, farmer outreach", "Video Producer"]);
    expect(v.dropped.rolesUncited).toBe(1);
    expect(v.dropped.rolesLevelTitled).toBe(1);
    expect(v.fields[0]!.evidence.map((e) => e.cardId)).toEqual(["C1", "C2"]);
    expect(validateOutput(memoryOutput({ fit: "Everyone is needed in climate." }), profile).dropped.fieldsUncited).toBe(1);
  });

  it("ignores a ref or a source that reaches it without a catalogue", () => {
    const catalogueShaped = output();
    const v = validateOutput(catalogueShaped, profile);
    expect(v.fields[0]!.ref).toBeNull();
    expect(v.fields[0]!.sources).toEqual([]);
    expect(v.fields[0]!.roles[0]!.sources).toEqual([]);
    expect(v.dropped.sourcesRemoved).toBe(0);
  });

  it("reports both URL counters in words that hold in either mode", () => {
    const text = droppedSummary({ ...validateOutput(memoryOutput(), profile).dropped, sourcesRemoved: 2, textUrlsStripped: 3 });
    expect(text).toContain("2 source URLs removed");
    expect(text).toContain("3 URLs stripped from text");
    expect(text).not.toMatch(/catalogue/i);
  });
});

describe("memory mode profile writes (technical-plan.md D61)", () => {
  it("runs on the memory prompt and schema when no catalogue is passed, and writes no Ref and no source", async () => {
    const MARKER = "TYPED-INPUT-MARKER-2d2";
    const typed = setInputs(fixture("videographer"), { resume: `resume ${MARKER}`, notes: `notes ${MARKER}` });
    const llm = fakeLlm([memoryOutput()]);
    const result = await discoverFields({ sessionId: SESSION_ID, profile: typed }, { llm });

    expect(llm.requests).toHaveLength(1);
    const request = llm.requests[0]!;
    expect(request.system).toBe(DISCOVER_SYSTEM_PROMPT_MEMORY);
    expect(request.schema).toBe(DiscoverOutputSchemaMemory);
    expect(request.tools).toBeUndefined();
    expect(JSON.stringify(request.messages)).not.toContain("Reference catalogue");
    expect(JSON.stringify([request.system, request.messages])).not.toContain(MARKER);

    expect(result.fields.map((f) => f.id)).toEqual(["F1"]);
    expect(result.roles.map((r) => [r.id, r.fieldId])).toEqual([["R1", "F1"]]);
    const md = serializeProfile(result.profile);
    expect(md).not.toContain(`**${REF_KEY}:**`);
    expect(md).not.toMatch(SOURCE_ENTRY);
    const reparsed = parseProfile(md).profile;
    for (const item of [...reparsed.fields, ...reparsed.roles]) {
      expect(item.sources).toEqual([]);
      expect(item.extra[REF_KEY]).toBeUndefined();
    }
    expect(reparsed.inputs).toEqual(typed.inputs);
  });

  it("runs the catalogue arm only when handed a catalogue", async () => {
    const llm = fakeLlm([output()]);
    await discoverFields({ sessionId: SESSION_ID, profile: fixture("videographer") }, { llm, catalogue: reference });
    const request = llm.requests[0]!;
    expect(request.system).toBe(DISCOVER_SYSTEM_PROMPT_CATALOGUE);
    expect(request.schema).toBe(DiscoverOutputSchemaCatalogue);
    expect(JSON.stringify(request.messages)).toContain("# Reference catalogue");
  });

  it("a memory run over a catalogue-run profile matches by name and removes the Ref and the sources", async () => {
    const catalogueRun = await discoverFields(
      { sessionId: SESSION_ID, profile: fixture("videographer") },
      { llm: fakeLlm([output()]), catalogue: reference },
    );
    const before = serializeProfile(catalogueRun.profile);
    expect(before).toContain(`- **${REF_KEY}:** ag-nonprofits`);
    expect(before).toMatch(SOURCE_ENTRY);

    const accepted = setFieldStatus(catalogueRun.profile, "F1", "accepted");
    const memoryRun = await discoverFields(
      { sessionId: SESSION_ID, profile: accepted },
      { llm: fakeLlm([memoryOutput({ fit: "Updated: C2 and C1." })]) },
    );
    expect(memoryRun.profile.fields).toHaveLength(1);
    expect(memoryRun.profile.roles).toHaveLength(1);
    expect(memoryRun.fields[0]!.id).toBe("F1");
    expect(memoryRun.fields[0]!.status).toBe("accepted");
    expect(memoryRun.fields[0]!.fit).toBe("Updated: C2 and C1.");
    expect(memoryRun.roles[0]!.id).toBe("R1");

    const after = serializeProfile(memoryRun.profile);
    expect(after).not.toContain(`**${REF_KEY}:**`);
    expect(after).not.toMatch(SOURCE_ENTRY);
    expect(after).not.toContain("example.org");
  });
});
