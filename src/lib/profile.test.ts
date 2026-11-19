import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ProfileSchema,
  activeCards,
  addOtherPreference,
  rolesForField,
  selectedRoles,
  setQueryText,
  setRoleSelected,
  citedCardIds,
  emptyProfile,
  missingPreferences,
  moveSkill,
  nextCardId,
  nextFieldId,
  nextQueryId,
  nextRoleId,
  normalizeProfile,
  parseProfile,
  serializeProfile,
  setCardExcluded,
  setClimateInterests,
  setFieldExplored,
  setFieldStatus,
  setPreference,
  setQueryStatus,
  upsertCard,
  upsertField,
  upsertQuery,
  upsertRole,
  type Profile,
} from "./profile";

const FIXTURES = ["videographer", "web-designer", "data-scientist"] as const;

function fixture(name: (typeof FIXTURES)[number]): string {
  return readFileSync(join(__dirname, "__fixtures__", `${name}.md`), "utf8");
}

describe("fixtures round-trip", () => {
  for (const name of FIXTURES) {
    describe(name, () => {
      const md = fixture(name);
      const first = parseProfile(md);

      it("parses without warnings", () => {
        expect(first.warnings).toEqual([]);
      });

      it("passes the zod schema", () => {
        expect(() => ProfileSchema.parse(first.profile)).not.toThrow();
      });

      it("parse → serialize → parse deep-equals", () => {
        const second = parseProfile(serializeProfile(first.profile));
        expect(second.warnings).toEqual([]);
        expect(second.profile).toEqual(first.profile);
      });

      it("serialize is idempotent and the fixture is already canonical", () => {
        const once = serializeProfile(first.profile);
        const twice = serializeProfile(parseProfile(once).profile);
        expect(twice).toBe(once);
        expect(once).toBe(md);
      });

      it("is populated across all sections", () => {
        const p = first.profile;
        expect(p.cards.length).toBeGreaterThanOrEqual(3);
        expect(p.cards.every((c) => c.situation && c.actions && c.results && c.skills.length > 0)).toBe(true);
        expect(p.skills.confirmed.length).toBeGreaterThan(0);
        expect(p.skills.inferred.length).toBeGreaterThan(0);
        expect(p.skills.excluded.length).toBeGreaterThan(0);
        expect(p.fields.some((f) => f.status === "accepted")).toBe(true);
        expect(p.fields.some((f) => f.status === "rejected")).toBe(true);
        expect(p.fields.every((f) => f.move !== undefined && f.sources.length > 0)).toBe(true);
        expect(p.fields.every((f) => citedCardIds(f.fit).length > 0)).toBe(true);
        expect(p.roles.length).toBeGreaterThanOrEqual(2);
        expect(p.roles.every((r) => p.fields.some((f) => f.id === r.fieldId))).toBe(true);
        const tried = p.queries.filter((q) => q.status !== "untried");
        expect(tried.length).toBeGreaterThanOrEqual(1);
        expect(tried.every((q) => q.reason !== "" && q.changedAt !== undefined)).toBe(true);
        expect(p.queries.every((q) => q.fieldIds.every((id) => p.fields.some((f) => f.id === id)))).toBe(true);
        expect(p.sessionNotes).not.toBe("");
        expect(p.extraSections).toEqual([]);
      });

      it("carries the exploration-first keys (technical-plan.md D39, D40)", () => {
        const p = first.profile;
        expect(p.cards.some((c) => c.years !== undefined)).toBe(true);
        expect(p.fields.every((f) => f.sector !== "" && f.fitLevel !== undefined && f.summary !== "")).toBe(true);
        expect(p.fields.every((f) => f.chips.length >= 1 && f.chips.length <= 4)).toBe(true);
        expect(p.fields.every((f) => f.evidence.length > 0 && f.evidence.every((e) => /^C\d+$/.test(e.cardId) && e.why !== ""))).toBe(true);
        expect(p.fields.every((f) => f.evidence.every((e) => p.cards.some((c) => c.id === e.cardId)))).toBe(true);
        expect(p.fields.some((f) => f.ask !== undefined && f.ask.question !== "" && f.ask.key !== "")).toBe(true);
        expect(p.fields.some((f) => f.ask === undefined)).toBe(true);
        expect(p.roles.some((r) => r.selected)).toBe(true);
        expect(p.roles.some((r) => !r.selected)).toBe(true);
      });
    });
  }

  it("the videographer has an excluded card that stays in the file", () => {
    const p = parseProfile(fixture("videographer")).profile;
    expect(p.cards.find((c) => c.id === "C3")?.excluded).toBe(true);
    expect(activeCards(p).map((c) => c.id)).toEqual(["C1", "C2"]);
    expect(serializeProfile(p)).toContain("### C3: Wedding videography business");
  });
});

describe("hand edits survive reload", () => {
  it("keeps an edited Results line, an unknown key and an unknown section", () => {
    const md = fixture("web-designer")
      .replace(
        "- **Results:** Mobile bounce fell to 18%; rebate enrollment completions doubled in the first quarter after launch.",
        "- **Results:** Mobile bounce fell to 18%. Also won an internal design award.\n- **Client:** Example Electric (regional utility)",
      )
      .replace("## Session Notes", "## Companies I already applied to\n\n- Example Utility Software (rejected)\n- Sample Grid Services\n\n## Session Notes");

    const first = parseProfile(md);
    const reloaded = parseProfile(serializeProfile(first.profile));

    for (const p of [first.profile, reloaded.profile]) {
      const c1 = p.cards.find((c) => c.id === "C1");
      expect(c1?.results).toBe("Mobile bounce fell to 18%. Also won an internal design award.");
      expect(c1?.extra).toEqual({ Client: "Example Electric (regional utility)" });
      expect(p.extraSections).toEqual([
        {
          heading: "Companies I already applied to",
          body: "- Example Utility Software (rejected)\n- Sample Grid Services",
        },
      ]);
    }
    expect(reloaded.profile).toEqual(first.profile);
    // The only warning is about the unknown section, on the first parse and on reload.
    expect(first.warnings).toEqual([
      expect.stringMatching(/^Line \d+: unknown section "## Companies I already applied to" preserved as-is\.$/),
    ]);
    expect(reloaded.warnings).toHaveLength(1);
    expect(serializeProfile(reloaded.profile)).toContain("- **Client:** Example Electric (regional utility)");
  });

  it("accepts sloppy formatting: missing bold, colon outside bold, mixed case, blank lines, trailing spaces", () => {
    const md = [
      "## experience cards   ",
      "",
      "### c2 - A card with a lowercase id",
      "",
      "  ",
      "- situation: typed without bold   ",
      "* **Actions**: colon outside the bold",
      "- **RESULTS:** shouting",
      "- Skills: a, b ,c",
      "- Excluded: YES",
      "",
      "## PREFERENCES:",
      "- **Location:** Denver",
      "- **Seniority:** junior (Inferred)",
      "- location: Boulder",
    ].join("\r\n");
    const { profile, warnings } = parseProfile(md);
    expect(profile.cards).toEqual([
      {
        id: "C2",
        title: "A card with a lowercase id",
        situation: "typed without bold",
        actions: "colon outside the bold",
        results: "shouting",
        skills: ["a", "b", "c"],
        excluded: true,
        extra: {},
      },
    ]);
    expect(profile.preferences.location).toEqual({ value: "Boulder", source: "stated" });
    expect(profile.preferences.seniority).toEqual({ value: "junior", source: "inferred" });
    expect(warnings).toEqual(['Preferences: duplicate "location"; the last one wins.']);
  });
});

describe("tolerant parsing", () => {
  it("parses a totally empty string to an empty profile with no warnings", () => {
    const { profile, warnings } = parseProfile("");
    expect(profile).toEqual(emptyProfile());
    expect(warnings).toEqual([]);
    expect(parseProfile("   \n\n\t\n").profile).toEqual(emptyProfile());
  });

  it("serializes and re-parses the empty profile", () => {
    const md = serializeProfile(emptyProfile());
    expect(md).toContain("## Session Notes");
    expect(parseProfile(md)).toEqual({ profile: emptyProfile(), warnings: [] });
  });

  it("does not throw on garbage", () => {
    const inputs = ["# just a title", "random words\n\nmore words", "## ", "###", "- **:**", "**bold only**", "\x00\x01"];
    for (const input of inputs) expect(() => parseProfile(input)).not.toThrow();
    const { profile, warnings } = parseProfile("random words\n\nmore words");
    expect(profile.sessionNotes).toBe("random words\nmore words");
    expect(warnings).toEqual(["Text before the first section was moved to Session Notes."]);
  });

  it("handles CRLF input identically to LF", () => {
    const md = fixture("data-scientist");
    const crlf = md.replace(/\n/g, "\r\n");
    expect(parseProfile(crlf)).toEqual(parseProfile(md));
  });

  it("fills a card with missing fields sensibly", () => {
    const { profile, warnings } = parseProfile("## Experience Cards\n\n### C1: Only a title\n- **Situation:** something");
    expect(profile.cards).toEqual([
      { id: "C1", title: "Only a title", situation: "something", actions: "", results: "", skills: [], excluded: false, extra: {} },
    ]);
    expect(warnings).toEqual([]);
  });

  it("assigns the next free ID to an item without one, and renames a duplicate", () => {
    const md = [
      "## Fields",
      "### F3: Has an id",
      "### A new field the user typed",
      "### F3: Duplicate id",
      "- **Status:** accepted",
    ].join("\n");
    const { profile, warnings } = parseProfile(md);
    expect(profile.fields.map((f) => [f.id, f.name])).toEqual([
      ["F3", "Has an id"],
      ["F4", "A new field the user typed"],
      ["F5", "Duplicate id"],
    ]);
    expect(warnings).toEqual([
      'Line 3: "### A new field the user typed" had no ID; assigned F4.',
      "Line 4: duplicate ID F3; renamed to F5.",
    ]);
    expect(profile.fields[2].status).toBe("accepted");
  });

  it("keeps sections in any order and tolerates a missing section", () => {
    const md = [
      "## Session Notes",
      "notes first",
      "## Queries",
      '### Q1: "solar" analyst',
      "- **Board:** Indeed",
      "## Preferences",
      "- **Location:** Remote",
    ].join("\n");
    const { profile, warnings } = parseProfile(md);
    expect(warnings).toEqual([]);
    expect(profile.sessionNotes).toBe("notes first");
    expect(profile.queries[0]).toMatchObject({ id: "Q1", board: "indeed", query: '"solar" analyst', status: "untried" });
    expect(profile.cards).toEqual([]);
    const out = serializeProfile(profile);
    expect(out.indexOf("## Preferences")).toBeLessThan(out.indexOf("## Queries"));
    expect(out.indexOf("## Queries")).toBeLessThan(out.indexOf("## Session Notes"));
  });

  it("falls back with a warning on invalid enum and boolean values", () => {
    const md = [
      "## Fields",
      "### F1: X",
      "- **Status:** thinking about it",
      "- **Explored:** kind of",
      "- **Move:** sideways",
      "## Queries",
      "### Q1: y",
      "- **Board:** Google Jobs",
      "- **Status:** meh",
    ].join("\n");
    const { profile, warnings } = parseProfile(md);
    expect(profile.fields[0]).toMatchObject({ status: "candidate", explored: false });
    expect(profile.fields[0].move).toBeUndefined();
    expect(profile.queries[0]).toMatchObject({ board: "other", status: "untried" });
    expect(warnings).toEqual([
      'F1 Status: unknown value "thinking about it".',
      'F1 Explored: could not read "kind of" as yes/no; using "no".',
      'F1 Move: unknown value "sideways".',
      'Q1 Board: unknown value "Google Jobs".',
      'Q1 Status: unknown value "meh".',
    ]);
  });

  it("moves unlabeled text to the nearest free-text slot instead of dropping it", () => {
    const md = [
      "## Experience Cards",
      "This line is under the section but not under a card.",
      "### C1: Title",
      "A sentence under the card before any key.",
      "- **Situation:** s",
      "  continued situation",
      "## Skills",
      "some stray text under skills",
    ].join("\n");
    const { profile, warnings } = parseProfile(md);
    expect(profile.cards[0].extra).toEqual({ Notes: "A sentence under the card before any key." });
    expect(profile.cards[0].situation).toBe("s\ncontinued situation");
    expect(profile.sessionNotes).toBe(
      "This line is under the section but not under a card.\n\nsome stray text under skills",
    );
    expect(warnings).toHaveLength(3);
    const again = parseProfile(serializeProfile(profile));
    expect(again.profile).toEqual(profile);
    expect(again.warnings).toEqual([]);
  });

  it("preserves list items that contain commas and heading-like lines in notes", () => {
    const p: Profile = {
      ...emptyProfile(),
      cards: [
        { id: "C1", title: "T", situation: "", actions: "", results: "", skills: ["Python, R", "SQL"], excluded: false, extra: {} },
      ],
      fields: [
        { id: "F1", name: "N", status: "unsure", explored: true, move: "retraining", sector: "", summary: "", chips: [], evidence: [], fit: "line one\nline two", uncertain: "", sources: ["https://a.example/x,y", "https://b.example"], extra: {} },
      ],
      sessionNotes: "# not a title\n## not a section\nplain",
      extraSections: [{ heading: "Extra", body: "## also not a section" }],
    };
    const again = parseProfile(serializeProfile(p));
    expect(again.warnings).toEqual([expect.stringMatching(/^Line \d+: unknown section "## Extra" preserved as-is\.$/)]);
    expect(again.profile).toEqual(p);
    expect(serializeProfile(again.profile)).toBe(serializeProfile(p));
  });

  it("never throws on a non-string input", () => {
    expect(parseProfile(undefined as unknown as string).profile).toEqual(emptyProfile());
  });

  it("parses hostile input in linear time", () => {
    // Both lines used to be pathological: an unterminated `**` made the old
    // bold-key regex backtrack cubically (55 s for a kilobyte), and a long run
    // of trailing spaces made `/\s+$/` quadratic. Nothing here is exotic — a
    // user can paste either into the textarea (technical-plan.md D24).
    const unterminatedBold = `**${" ".repeat(5 * 1024)}x`;
    const longSpaceRun = `${"x".repeat(40 * 1024)}${" ".repeat(40 * 1024)}y`;
    const md = [
      "## Preferences",
      "",
      unterminatedBold,
      `- **Location:** ${longSpaceRun}`,
      "",
      "## Session Notes",
      "",
      longSpaceRun,
      unterminatedBold,
    ].join("\n");

    const started = performance.now();
    const { profile } = parseProfile(md);
    const elapsed = performance.now() - started;

    expect(profile.preferences.location?.value).toContain("x");
    expect(elapsed).toBeLessThan(500);
  });
});

describe("exploration-first keys", () => {
  it("reads the Ask block, a question on the label line, and warns on an unknown part", () => {
    const md = [
      "## Fields",
      "### F1: A",
      "- **Ask:** Is remote ok?",
      "  - Key: Remote",
      "  - Placeholder: e.g. yes",
      "### F2: B",
      "- **Ask:**",
      "  - Question: Only the question",
      "### F3: C",
      "- **Ask:**",
      "  - Question: q",
      "  - Mystery: m",
      "### F4: D",
      "- **Ask:**",
    ].join("\n");
    const { profile, warnings } = parseProfile(md);
    expect(profile.fields[0].ask).toEqual({ question: "Is remote ok?", key: "Remote", placeholder: "e.g. yes" });
    expect(profile.fields[1].ask).toEqual({ question: "Only the question", key: "", placeholder: "" });
    expect(profile.fields[2].ask).toEqual({ question: "q Mystery: m", key: "", placeholder: "" });
    expect(profile.fields[3].ask).toBeUndefined();
    expect(warnings).toEqual([expect.stringContaining("unknown Ask part")]);
    const again = parseProfile(serializeProfile(profile));
    expect(again.warnings).toEqual([]);
    expect(again.profile.fields.map((f) => f.ask)).toEqual(profile.fields.map((f) => f.ask));
  });

  it("reads evidence lines, keeps one without a card id, and round-trips", () => {
    const md = ["## Fields", "### F1: A", "- **Evidence:**", "  - c2: Shot the series.", "  - C3:", "  - no id here"].join("\n");
    const { profile, warnings } = parseProfile(md);
    expect(warnings).toEqual([]);
    expect(profile.fields[0].evidence).toEqual([
      { cardId: "C2", why: "Shot the series." },
      { cardId: "C3", why: "" },
      { cardId: "", why: "no id here" },
    ]);
    expect(parseProfile(serializeProfile(profile)).profile).toEqual(profile);
  });

  it("fit level: aliases, blank, and an invalid value with a warning", () => {
    const md = ["## Fields", "### F1: A", "- **Fit level:** Strong fit", "### F2: B", "- **Level:**", "### F3: C", "- **Fit level:** 87%"].join("\n");
    const { profile, warnings } = parseProfile(md);
    expect(profile.fields.map((f) => f.fitLevel)).toEqual(["strong", undefined, undefined]);
    expect(warnings).toEqual([expect.stringContaining("F3")]);
  });

  it("years on a card and selected on a role default to absent and false", () => {
    const md = ["## Experience Cards", "### C1: T", "- **Years:**", "### C2: U", "- **Period:** since 2020", "## Role Shortlist", "### R1: R", "- **Field:** F1", "### R2: S", "- **Ticked:** yes"].join("\n");
    const { profile, warnings } = parseProfile(md);
    expect(warnings).toEqual([]);
    expect(profile.cards.map((c) => c.years)).toEqual([undefined, "since 2020"]);
    expect(profile.roles.map((r) => r.selected)).toEqual([false, true]);
    const out = serializeProfile(profile);
    expect(out).toContain("- **Years:**\n");
    expect(out).toContain("- **Years:** since 2020");
    expect(out).toContain("- **Selected:** yes");
    expect(parseProfile(out).profile).toEqual(profile);
  });
});

describe("climate interests", () => {
  it("reads the bullet-list form the header documents", () => {
    const { profile, warnings } = parseProfile(
      ["## Preferences", "", "- **Climate interests:**", "  - grid", "  - storage"].join("\n"),
    );
    expect(warnings).toEqual([]);
    expect(profile.preferences.climateInterests).toEqual({
      values: ["grid", "storage"],
      source: "stated",
    });
  });

  it("reads the bullet-list form with an (inferred) tag on the label line", () => {
    const { profile } = parseProfile(
      ["## Preferences", "", "- **Climate interests:** (inferred)", "  - grid", "  - storage"].join("\n"),
    );
    expect(profile.preferences.climateInterests).toEqual({
      values: ["grid", "storage"],
      source: "inferred",
    });
  });

  it("still reads the inline comma form", () => {
    const { profile } = parseProfile(
      ["## Preferences", "", "- **Climate interests:** grid, storage (inferred)"].join("\n"),
    );
    expect(profile.preferences.climateInterests).toEqual({
      values: ["grid", "storage"],
      source: "inferred",
    });
  });

  it("round-trips an interest that contains a comma", () => {
    for (const source of ["stated", "inferred"] as const) {
      const p: Profile = {
        ...emptyProfile(),
        preferences: {
          other: [],
          climateInterests: { values: ["carbon capture, utilization and storage", "grid"], source },
        },
      };
      const md = serializeProfile(p);
      const again = parseProfile(md);
      expect(again.warnings).toEqual([]);
      expect(again.profile).toEqual(p);
      expect(serializeProfile(again.profile)).toBe(md);
    }
  });
});

describe("a query's role (technical-plan.md D47)", () => {
  const md = [
    "## Queries",
    "",
    '### Q1: "video producer" AND (solar OR "energy storage")',
    "- **Board:** linkedin",
    "- **Fields:** F1",
    "- **Role:** r3",
    "- **Status:** untried",
    "- **Rationale:** title plus field terms",
    "",
    "### Q2: videographer solar",
    "- **Board:** indeed",
    "- **Fields:** F1",
    "- **Status:** untried",
  ].join("\n");

  it("parses Role as a known key, uppercased, and leaves it empty when absent", () => {
    const { profile, warnings } = parseProfile(md);
    expect(warnings).toEqual([]);
    expect(profile.queries.map((q) => q.roleId)).toEqual(["R3", ""]);
    // Role is no longer an unknown key; a real unknown key still survives beside it.
    expect(profile.queries[0]?.extra).toEqual({ Rationale: "title plus field terms" });
    expect(profile.queries[0]?.fieldIds).toEqual(["F1"]);
  });

  it("serializes Role right after Fields and omits the line when the role is unknown", () => {
    const out = serializeProfile(parseProfile(md).profile);
    expect(out).toContain("- **Fields:** F1\n- **Role:** R3\n- **Status:** untried");
    expect(out.match(/\*\*Role:\*\*/g)).toHaveLength(1);
    expect(out).toContain("- **Changed:**\n- **Rationale:** title plus field terms");
  });

  it("round-trips: parse → serialize is idempotent and ids are not renumbered", () => {
    const first = parseProfile(md).profile;
    const once = serializeProfile(first);
    const second = parseProfile(once);
    expect(second.warnings).toEqual([]);
    expect(second.profile).toEqual(first);
    expect(serializeProfile(second.profile)).toBe(once);
    expect(second.profile.queries.map((q) => q.id)).toEqual(["Q1", "Q2"]);
  });

  it("accepts the `Role id` spelling and survives upsertQuery", () => {
    const { profile } = parseProfile(md.replace("- **Role:** r3", "- **Role id:** R4"));
    expect(profile.queries[0]?.roleId).toBe("R4");
    const next = upsertQuery(profile, { board: "linkedin", query: "q", fieldIds: ["F2"], roleId: "R5", status: "untried", reason: "", extra: {} });
    expect(next.queries.at(-1)).toMatchObject({ id: "Q3", roleId: "R5" });
    expect(serializeProfile(next)).toContain("### Q3: q\n- **Board:** linkedin\n- **Fields:** F2\n- **Role:** R5");
  });

  it("every fixture carries a query with a Role and one without, each naming a real role", () => {
    for (const name of FIXTURES) {
      const p = parseProfile(fixture(name)).profile;
      const withRole = p.queries.filter((q) => q.roleId !== "");
      expect(withRole.length).toBeGreaterThanOrEqual(1);
      expect(p.queries.some((q) => q.roleId === "")).toBe(true);
      for (const q of withRole) {
        const role = p.roles.find((r) => r.id === q.roleId);
        expect(role).toBeDefined();
        expect(q.fieldIds).toEqual([role?.fieldId]);
      }
    }
  });
});

describe("selectedRoles", () => {
  const base = parseProfile(fixture("data-scientist")).profile;

  it("lists ticked roles in field order then role order, whatever the field's status, skipping unknown fields", () => {
    const all = base.roles.reduce((p, r) => setRoleSelected(p, r.id, true), base);
    const fieldOrder = all.fields.map((f) => f.id);
    const got = selectedRoles(all);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((r) => r.selected && fieldOrder.includes(r.fieldId))).toBe(true);
    expect(got.map((r) => fieldOrder.indexOf(r.fieldId))).toEqual([...got.map((r) => fieldOrder.indexOf(r.fieldId))].sort((a, b) => a - b));
    // Reversing the role list does not change the field order of the result.
    const reversed = selectedRoles({ ...all, roles: [...all.roles].reverse() });
    expect(reversed.map((r) => r.fieldId)).toEqual(got.map((r) => r.fieldId));
    // A field's status does not matter; a ticked role under a field that does not exist is left out.
    const first = got[0];
    expect(selectedRoles(setFieldStatus(all, first?.fieldId ?? "", "rejected")).some((r) => r.fieldId === first?.fieldId)).toBe(true);
    const orphan = upsertRole(all, { title: "Orphan", fieldId: "F99", companies: [], why: "", selected: true, sources: [], extra: {} });
    expect(selectedRoles(orphan).some((r) => r.title === "Orphan")).toBe(false);
    expect(selectedRoles(emptyProfile())).toEqual([]);
  });
});

describe("helpers", () => {
  const base = parseProfile(fixture("videographer")).profile;

  it("next IDs are max + 1 and never reuse a gap", () => {
    expect(nextCardId(base)).toBe("C4");
    expect(nextFieldId(base)).toBe("F5");
    expect(nextRoleId(base)).toBe("R3");
    expect(nextQueryId(base)).toBe("Q4");
    const withGap: Profile = { ...base, cards: base.cards.filter((c) => c.id !== "C2") };
    expect(nextCardId(withGap)).toBe("C4");
    expect(nextCardId(emptyProfile())).toBe("C1");
  });

  it("upsert assigns an ID to new items and replaces existing ones in place", () => {
    const added = upsertCard(base, { title: "New", situation: "", actions: "", results: "", skills: [], excluded: false, extra: {} });
    expect(added.cards.map((c) => c.id)).toEqual(["C1", "C2", "C3", "C4"]);
    const replaced = upsertCard(added, { ...added.cards[0], title: "Renamed" });
    expect(replaced.cards.map((c) => c.title)[0]).toBe("Renamed");
    expect(replaced.cards).toHaveLength(4);
    expect(upsertField(base, { name: "F", status: "candidate", explored: false, sector: "", summary: "", chips: [], evidence: [], fit: "", uncertain: "", sources: [], extra: {} }).fields.at(-1)?.id).toBe("F5");
    expect(upsertRole(base, { title: "R", fieldId: "F1", companies: [], why: "", selected: false, sources: [], extra: {} }).roles.at(-1)?.id).toBe("R3");
    expect(upsertQuery(base, { board: "other", query: "q", fieldIds: [], roleId: "", status: "untried", reason: "", extra: {} }).queries.at(-1)?.id).toBe("Q4");
    expect(base.cards).toHaveLength(3); // pure: input untouched
  });

  it("status setters are pure and ignore unknown IDs", () => {
    expect(setFieldStatus(base, "F3", "accepted").fields.find((f) => f.id === "F3")?.status).toBe("accepted");
    expect(setFieldStatus(base, "F99", "accepted")).toEqual(base);
    expect(setFieldExplored(base, "F3").fields.find((f) => f.id === "F3")?.explored).toBe(true);
    expect(setCardExcluded(base, "C3", false).cards.find((c) => c.id === "C3")?.excluded).toBe(false);

    const tried = setQueryStatus(base, "Q3", "bad", "all senior roles", "2026-09-12");
    expect(tried.queries.find((q) => q.id === "Q3")).toMatchObject({ status: "bad", reason: "all senior roles", changedAt: "2026-09-12" });
    const reset = setQueryStatus(tried, "Q3", "untried");
    expect(reset.queries.find((q) => q.id === "Q3")).toEqual(base.queries.find((q) => q.id === "Q3"));
    expect(parseProfile(serializeProfile(tried)).profile).toEqual(tried);
  });

  it("moveSkill moves between buckets case-insensitively", () => {
    const p = moveSkill(base, "Client Management", "confirmed");
    expect(p.skills.inferred).not.toContain("client management");
    expect(p.skills.confirmed).toContain("Client Management");
    expect(moveSkill(p, "Client Management", "excluded").skills.confirmed).not.toContain("Client Management");
  });

  it("citedCardIds extracts and dedupes", () => {
    expect(citedCardIds("Uses C1 and C3, see C1 again; not CX or C")).toEqual(["C1", "C3"]);
    expect(citedCardIds("")).toEqual([]);
  });

  it("preferences: missing keys and setters", () => {
    expect(missingPreferences(emptyProfile())).toEqual(["location", "workMode", "seniority", "retrainingAppetite", "climateInterests"]);
    expect(missingPreferences(base)).toEqual([]);
    const p = setPreference(setPreference(base, "location", "Seattle", "inferred"), "seniority", undefined);
    expect(p.preferences.location).toEqual({ value: "Seattle", source: "inferred" });
    expect(p.preferences.seniority).toBeUndefined();
    expect(missingPreferences(p)).toEqual(["seniority"]);
    expect(setClimateInterests(p, [" grid ", ""]).preferences.climateInterests).toEqual({ values: ["grid"], source: "stated" });
    expect(missingPreferences(setClimateInterests(p, [])) ).toEqual(["seniority", "climateInterests"]);
    expect(serializeProfile(p)).toContain("- **Location:** Seattle (inferred)");
  });

  it("setRoleSelected and rolesForField", () => {
    const p = setRoleSelected(base, "R2", true);
    expect(p.roles.find((r) => r.id === "R2")?.selected).toBe(true);
    expect(base.roles.find((r) => r.id === "R2")?.selected).toBe(false);
    expect(setRoleSelected(base, "R99", true)).toEqual(base);
    expect(rolesForField(p, "F2").map((r) => r.id)).toEqual(["R2"]);
    expect(rolesForField(p, "F2", true).map((r) => r.id)).toEqual(["R2"]);
    expect(rolesForField(setRoleSelected(p, "R2", false), "F2", true)).toEqual([]);
  });

  it("setQueryText replaces the text only and collapses whitespace", () => {
    const p = setQueryText(base, "Q1", '  "video  producer"\n AND farm ');
    const q = p.queries.find((x) => x.id === "Q1");
    expect(q?.query).toBe('"video producer" AND farm');
    expect(q?.status).toBe(base.queries[0].status);
    expect(q?.reason).toBe(base.queries[0].reason);
    expect(setQueryText(base, "Q99", "x")).toEqual(base);
  });

  it("addOtherPreference appends, replaces case-insensitively, removes on empty, and serializes", () => {
    const p1 = addOtherPreference(base, "Content mix", "video only");
    expect(p1.preferences.other.at(-1)).toEqual({ key: "Content mix", value: "video only", source: "stated" });
    const p2 = addOtherPreference(p1, "content MIX", "happy to write too", "inferred");
    expect(p2.preferences.other.filter((o) => o.key.toLowerCase() === "content mix")).toEqual([
      { key: "content MIX", value: "happy to write too", source: "inferred" },
    ]);
    expect(p2.preferences.other).toHaveLength(p1.preferences.other.length);
    expect(addOtherPreference(p2, "Content mix", "").preferences.other).toHaveLength(base.preferences.other.length);
    expect(addOtherPreference(base, "  ", "x")).toEqual(base);
    const again = parseProfile(serializeProfile(p1)).profile;
    expect(again.preferences.other).toEqual(p1.preferences.other);
  });

  it("normalizeProfile equals parse(serialize(p))", () => {
    const messy: Profile = { ...emptyProfile(), sessionNotes: "\n\nhello  \n  indented\n\n" };
    expect(normalizeProfile(messy).sessionNotes).toBe("hello\n  indented");
  });
});
