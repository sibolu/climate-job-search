import { describe, expect, it } from "vitest";

import {
  findRolesGate,
  interestPills,
  pendingStatusLine,
  INTEREST_NOTE,
  QUESTION_LABELS,
  FIND_ROLES_PILL,
  appendLogLines,
  composeStartText,
  currentScreen,
  formatElapsed,
  NAV_LABELS,
  NAV_STEPS,
  navStepEnabled,
  navStepFor,
  boardSearchUrl,
  citationsToTitles,
  hasLiveQueries,
  roleGroups,
  copyKey,
  missingSearchesNote,
  searchCards,
  selectedRolesNote,
  sourceLabel,
  writeSearchesLabel,
  MAX_LOG_LINES,
  resumeView,
} from "./screens";
import { CLIMATE_AREAS } from "./elicit";
import {
  emptyProfile,
  setClimateInterests,
  setInputs,
  upsertCard,
  type Card,
  type Field,
  type Profile,
  type Query,
  type Role,
} from "./profile";

function card(patch: Partial<Card> = {}): Omit<Card, "id"> & { id?: string } {
  return {
    title: "Grid analyst",
    situation: "s",
    actions: "a",
    results: "r",
    skills: ["modelling"],
    excluded: false,
    extra: {},
    ...patch,
  };
}

function answered(): Profile {
  const p = upsertCard(emptyProfile(), card());
  return setClimateInterests(p, ["Energy"], "stated");
}

describe("currentScreen", () => {
  it("is resume with no cards, even while busy", () => {
    expect(currentScreen({ hasCards: false, hasFields: false, busy: false })).toBe("resume");
    expect(currentScreen({ hasCards: false, hasFields: false, busy: true })).toBe("resume");
    expect(
      currentScreen({ hasCards: false, hasFields: false, busy: false, view: "highlights" }),
    ).toBe("resume");
  });

  it("is highlights once cards exist and no fields do", () => {
    expect(currentScreen({ hasCards: true, hasFields: false, busy: false })).toBe("highlights");
  });

  it("is pending whenever a turn is in flight behind existing cards", () => {
    expect(currentScreen({ hasCards: true, hasFields: false, busy: true })).toBe("pending");
    expect(currentScreen({ hasCards: true, hasFields: true, busy: true })).toBe("pending");
    expect(
      currentScreen({ hasCards: true, hasFields: true, busy: true, view: "resume" }),
    ).toBe("pending");
  });

  it("is the Roles screen once discovery has landed", () => {
    expect(currentScreen({ hasCards: true, hasFields: true, busy: false })).toBe("roles");
  });

  it("resolves each navigated view once it is reached", () => {
    const all = { hasCards: true, hasFields: true, busy: false, hasQueries: true };
    expect(currentScreen({ ...all, view: "resume" })).toBe("resume");
    expect(currentScreen({ ...all, view: "highlights" })).toBe("highlights");
    expect(currentScreen({ ...all, view: "roles" })).toBe("roles");
    expect(currentScreen({ ...all, view: "searches" })).toBe("searches");
  });

  it("keeps Highlights reachable after fields exist", () => {
    const input = { hasCards: true, hasFields: true, busy: false, view: "highlights" as const };
    expect(currentScreen(input)).toBe("highlights");
  });

  it("falls back when the navigated view is not reached yet", () => {
    const early = { hasCards: true, hasFields: false, busy: false };
    expect(currentScreen({ ...early, view: "roles" })).toBe("highlights");
    expect(currentScreen({ ...early, view: "searches" })).toBe("highlights");
    expect(currentScreen({ ...early, hasFields: true, view: "searches" })).toBe("roles");
  });
});

describe("nav", () => {
  it("lists four steps without numbers", () => {
    expect(NAV_STEPS).toEqual(["resume", "highlights", "roles", "searches"]);
    expect(NAV_STEPS.map((step) => NAV_LABELS[step])).toEqual([
      "Resume",
      "Highlights",
      "Roles",
      "Searches",
    ]);
  });

  it("maps each screen onto its step, pending onto Roles", () => {
    expect(navStepFor("resume")).toBe("resume");
    expect(navStepFor("highlights")).toBe("highlights");
    expect(navStepFor("roles")).toBe("roles");
    expect(navStepFor("pending")).toBe("roles");
  });

  it("always enables Resume", () => {
    const none = { hasCards: false, hasFields: false, busy: false };
    expect(navStepEnabled("resume", none)).toBe(true);
    expect(navStepEnabled("resume", { ...none, hasCards: true, hasFields: true })).toBe(true);
  });

  it("disables steps the person has not reached", () => {
    const none = { hasCards: false, hasFields: false, busy: false };
    expect(navStepEnabled("highlights", none)).toBe(false);
    const early = { hasCards: true, hasFields: false, busy: false };
    expect(navStepEnabled("highlights", early)).toBe(true);
    expect(navStepEnabled("roles", early)).toBe(false);
    expect(navStepEnabled("searches", early)).toBe(false);
    expect(navStepEnabled("roles", { ...early, hasFields: true })).toBe(true);
    expect(navStepEnabled("highlights", { ...early, hasFields: true })).toBe(true);
  });
});

describe("composeStartText", () => {
  it("appends the notes under a Notes: label", () => {
    expect(composeStartText("  resume text  ", " no relocation ")).toBe(
      "resume text\n\nNotes:\nno relocation",
    );
  });

  it("omits the block when notes are empty", () => {
    expect(composeStartText("resume text", "   ")).toBe("resume text");
  });
});

describe("resumeView", () => {
  it("is the entry form before any card, prefilled from the stored inputs", () => {
    expect(resumeView(emptyProfile())).toEqual({ kind: "entry", resume: "", notes: "" });
    const typed = setInputs(emptyProfile(), { resume: "Grid analyst", notes: "Remote" });
    expect(resumeView(typed)).toEqual({ kind: "entry", resume: "Grid analyst", notes: "Remote" });
  });

  it("shows the stored resume once cards exist, and the notes only when there are any", () => {
    const read = setInputs(upsertCard(emptyProfile(), card()), { resume: "Grid analyst", notes: "" });
    expect(resumeView(read)).toEqual({ kind: "stored", resume: "Grid analyst" });
    const withNotes = setInputs(read, { resume: "Grid analyst", notes: "Remote" });
    expect(resumeView(withNotes)).toEqual({ kind: "stored", resume: "Grid analyst", notes: "Remote" });
  });

  it("says the resume was not stored for a profile saved before inputs were kept", () => {
    expect(resumeView(upsertCard(emptyProfile(), card()))).toEqual({ kind: "notStored" });
  });
});

describe("the interest question", () => {
  it("lists the six areas in order, none pressed on a new profile", () => {
    const pills = interestPills(emptyProfile());
    expect(pills.map((pill) => pill.value)).toEqual([...CLIMATE_AREAS]);
    expect(pills.some((pill) => pill.pressed)).toBe(false);
  });

  it("presses every picked area, matching case-insensitively", () => {
    const p = setClimateInterests(emptyProfile(), ["energy", "carbon removal"], "stated");
    const pressed = interestPills(p).filter((pill) => pill.pressed).map((pill) => pill.value);
    expect(pressed).toEqual(["Energy", "Carbon Removal"]);
  });

  it("asks in plain words and says picks rank, never filter", () => {
    expect(QUESTION_LABELS.climateInterests).toBe("Which area of climate work interests you most?");
    expect(INTEREST_NOTE).toMatch(/still appear/);
  });
});

describe("findRolesGate", () => {
  it("needs at least one active card", () => {
    const p = setClimateInterests(emptyProfile(), ["Energy"], "stated");
    expect(findRolesGate(p)).toEqual({
      enabled: false,
      note: "Include at least one highlight above first.",
    });
  });

  it("opens with a highlight and no answer", () => {
    const p = upsertCard(emptyProfile(), card());
    expect(findRolesGate(p)).toEqual({
      enabled: true,
      note: "You can come back and change any of this.",
    });
  });

  it("opens with a highlight and an answer", () => {
    expect(findRolesGate(answered()).enabled).toBe(true);
  });

  it("says a rerun updates the roles once fields exist", () => {
    const p = { ...answered(), fields: [field("F1")] };
    expect(findRolesGate(p)).toEqual({
      enabled: true,
      note: "Running this again updates your roles.",
    });
  });

  it("labels the button with the pill the server offers", () => {
    expect(FIND_ROLES_PILL).toEqual({ label: "Find climate roles", value: "go" });
  });

  it("stays shut when every card is excluded", () => {
    const p = upsertCard(answered(), { ...card({ excluded: true }), id: "C1" });
    expect(findRolesGate(p).enabled).toBe(false);
  });
});

describe("the pending log", () => {
  it("shows the latest line as the status, or a default", () => {
    expect(pendingStatusLine([])).toBe("Getting started…");
    expect(pendingStatusLine([{ time: "0:01", text: "a" }, { time: "0:02", text: "b" }])).toBe("b");
  });

  it("formats elapsed time as m:ss and clamps junk to 0:00", () => {
    expect(formatElapsed(134_000)).toBe("2:14");
    expect(formatElapsed(9_000)).toBe("0:09");
    expect(formatElapsed(-5)).toBe("0:00");
    expect(formatElapsed(Number.NaN)).toBe("0:00");
  });

  it("splits a delta into lines and drops blanks", () => {
    const lines = appendLogLines([], "reading cards\n\nweighing fields\n", 61_000);
    expect(lines).toEqual([
      { time: "1:01", text: "reading cards" },
      { time: "1:01", text: "weighing fields" },
    ]);
  });

  it("ignores a repeat of the last line", () => {
    const first = appendLogLines([], "reading cards", 0);
    expect(appendLogLines(first, "reading cards", 1_000)).toEqual(first);
  });

  it("keeps only the most recent MAX_LOG_LINES", () => {
    let lines = appendLogLines([], "start", 0);
    for (let i = 0; i < MAX_LOG_LINES + 10; i += 1) {
      lines = appendLogLines(lines, `line ${i}`, i * 1000);
    }
    expect(lines).toHaveLength(MAX_LOG_LINES);
    expect(lines[lines.length - 1].text).toBe(`line ${MAX_LOG_LINES + 9}`);
  });
});

// ---------------------------------------------------------------------------
// The Roles and Searches screens (technical-plan.md D47, D50)
// ---------------------------------------------------------------------------

function field(id: string, patch: Partial<Field> = {}): Field {
  return {
    id,
    name: `Field ${id}`,
    status: "candidate",
    explored: false,
    sector: "energy",
    summary: "",
    chips: [],
    fit: "",
    evidence: [],
    uncertain: "",
    sources: [],
    extra: {},
    ...patch,
  };
}

function role(id: string, fieldId: string, selected: boolean): Role {
  return {
    id,
    title: `Role ${id}`,
    fieldId,
    companies: [],
    why: "",
    selected,
    sources: [],
    extra: {},
  };
}

function query(id: string, board: Query["board"], fieldIds: string[], patch: Partial<Query> = {}): Query {
  return { id, board, query: `q-${id}`, fieldIds, roleId: "", status: "untried", reason: "", extra: {}, ...patch };
}

function withFields(fields: Field[], roles: Role[] = [], queries: Query[] = []): Profile {
  return { ...emptyProfile(), fields, roles, queries };
}

function card2(id: string, title: string): Card {
  return { id, title, situation: "s", actions: "a", results: "r", skills: [], excluded: false, extra: {} };
}

describe("citationsToTitles", () => {
  const p = { ...emptyProfile(), cards: [card2("C1", "Grid analyst"), card2("C3", "Ops lead")] };

  it("renders card ids as the cards' titles, possessives included", () => {
    expect(citationsToTitles(p, "C1's ranking work and C3's rollout")).toBe(
      "Grid analyst's ranking work and Ops lead's rollout",
    );
    expect(citationsToTitles(p, "Based on (C1, C03).")).toBe("Based on (Grid analyst, Ops lead).");
  });

  it("never leaves a raw id for an unknown card and leaves other text alone", () => {
    expect(citationsToTitles(p, "C7 shows it")).toBe("one of your highlights shows it");
    expect(citationsToTitles(p, "CO2 and ABC1 stay")).toBe("CO2 and ABC1 stay");
  });
});

describe("roleGroups and selectedRoles leave dropped items out (D58)", () => {
  it("hides a dropped field and a dropped role, ticked or not", () => {
    const dropped = { Dropped: "yes" };
    const keptRole = role("R1", "F1", true);
    const droppedRole = { ...role("R2", "F1", true), extra: dropped };
    const p = withFields(
      [field("F1"), field("F2", { extra: dropped })],
      [keptRole, droppedRole, role("R3", "F2", true)],
      [],
    );
    expect(roleGroups(p).map((g) => g.field.id)).toEqual(["F1"]);
    expect(roleGroups(p)[0]!.roles.map((r) => r.role.id)).toEqual(["R1"]);
    expect(searchCards(p).map((c) => c.role.id)).toEqual(["R1"]);
  });
});

describe("roleGroups", () => {
  const p: Profile = {
    ...withFields(
      [
        field("F2", {
          status: "rejected",
          fitLevel: "strong",
          move: "sector",
          evidence: [{ cardId: "C1", why: "x" }, { cardId: "C9", why: "y" }],
          fit: "C3 and C1",
          uncertain: "Unclear whether C3 counts.",
          ask: { question: "Licensed?", key: "PE licence", placeholder: "" },
        }),
        field("F1"),
      ],
      [role("R1", "F1", false), role("R2", "F2", true), role("R3", "F9", true)],
    ),
    cards: [card2("C1", "Grid analyst"), card2("C3", "Ops lead")],
  };

  it("keeps discovery's rank order and ignores the field status", () => {
    expect(roleGroups(p).map((g) => g.field.id)).toEqual(["F2", "F1"]);
  });

  it("builds the heading data with card titles, never ids", () => {
    const [group] = roleGroups(p);
    expect(group.fitLabel).toBe("Strong overlap");
    expect(group.moveLabel).toBe("Same work, new sector");
    expect(group.summary).toBe("");
    expect(group.uncertain).toBe("Unclear whether Ops lead counts.");
  });

  it("lists what a field is based on: titles in citation order, with evidence", () => {
    // C1 has an evidence line; C9 is no card; C3 is cited in the fit only.
    expect(roleGroups(p)[0].basedOn).toEqual([
      { title: "Grid analyst", evidence: "x" },
      { title: "Ops lead", evidence: "" },
    ]);
    expect(roleGroups(p)[1].basedOn).toEqual([]);
  });

  it("renders card ids in the evidence as titles and lists each card once", () => {
    const q: Profile = {
      ...p,
      fields: [
        field("F1", {
          evidence: [
            { cardId: "C3", why: "C3's rollout and C1's model" },
            { cardId: "C3", why: "a second line" },
            { cardId: "C1", why: "" },
          ],
          fit: "C1 and C3",
        }),
      ],
    };
    expect(roleGroups(q)[0].basedOn).toEqual([
      { title: "Ops lead", evidence: "Ops lead's rollout and Grid analyst's model" },
      { title: "Grid analyst", evidence: "" },
    ]);
  });

  it("lists each field's roles and leaves out roles under no field", () => {
    const groups = roleGroups(p);
    expect(groups[0].roles.map((r) => r.role.id)).toEqual(["R2"]);
    expect(groups[1].roles.map((r) => r.role.id)).toEqual(["R1"]);
  });

  it("renders the role why and the example companies", () => {
    const q = {
      ...p,
      roles: [{ ...role("R1", "F1", false), why: "C1's ranking work", companies: ["Acme", "Volt"] }],
    };
    const row = roleGroups(q)[1].roles[0];
    expect(row.why).toBe("Grid analyst's ranking work");
    expect(row.companies).toBe("Example companies: Acme, Volt");
    expect(roleGroups(p)[1].roles[0].companies).toBe("");
  });

});

describe("sourceLabel", () => {
  it("shows a link's host, or the raw text when it is not a URL", () => {
    expect(sourceLabel("https://www.example.org/a/b?c=1")).toBe("example.org");
    expect(sourceLabel("not a url")).toBe("not a url");
  });
});

describe("the write-searches label", () => {
  it("has no count and a note when nothing is ticked", () => {
    expect(writeSearchesLabel(0)).toBe("Write LinkedIn searches");
    expect(selectedRolesNote(0)).toBe("Tick at least one role first.");
  });

  it("counts the ticked roles, singular for one, with no note", () => {
    expect(writeSearchesLabel(1)).toBe("Write LinkedIn searches for 1 role");
    expect(writeSearchesLabel(3)).toBe("Write LinkedIn searches for 3 roles");
    expect(selectedRolesNote(1)).toBe("");
    expect(selectedRolesNote(2)).toBe("");
  });
});

describe("copyKey", () => {
  it("changes when a query is rewritten under the same id", () => {
    const before = query("Q3", "linkedin", ["F1"], { roleId: "R1" });
    const after = { ...before, query: `${before.query} rewritten` };
    expect(copyKey(after)).not.toBe(copyKey(before));
    expect(copyKey({ ...before })).toBe(copyKey(before));
  });
});

describe("searchCards and hasLiveQueries", () => {
  const fields = [field("F1"), field("F2")];

  it("gives one card per selected role in selectedRoles order, with its live LinkedIn query", () => {
    const p = withFields(
      fields,
      [role("R1", "F2", true), role("R2", "F1", true), role("R3", "F1", false), role("R4", "F1", true)],
      [
        query("Q1", "linkedin", ["F1"], { roleId: "R2" }),
        query("Q2", "linkedin", ["F2"], { roleId: "R1", extra: { Retired: "yes" } }),
        query("Q3", "linkedin", ["F2"], { roleId: "R1" }),
      ],
    );
    const cards = searchCards(p);
    expect(cards.map((c) => c.role.id)).toEqual(["R2", "R4", "R1"]);
    expect(cards.map((c) => c.fieldName)).toEqual(["Field F1", "Field F1", "Field F2"]);
    expect(cards.map((c) => c.query?.id)).toEqual(["Q1", undefined, "Q3"]);
    expect(hasLiveQueries(p)).toBe(true);
  });

  it("names each ticked role with no search by its title and field, so one occupation under two fields reads apart", () => {
    const p = withFields(fields, [
      { ...role("R1", "F1", true), title: "Data science" },
      { ...role("R2", "F2", true), title: "Data science" },
    ]);
    expect(missingSearchesNote(searchCards(p))).toBe("Data science · Field F1, Data science · Field F2");
    expect(missingSearchesNote([{ role: { ...role("R3", "F9", true), title: "Policy analysis" }, fieldName: "" }])).toBe(
      "Policy analysis",
    );
  });

  it("is false when no selected role has a live search", () => {
    const retired = withFields(
      fields,
      [role("R1", "F1", true)],
      [query("Q1", "linkedin", ["F1"], { roleId: "R1", extra: { Retired: "yes" } })],
    );
    expect(hasLiveQueries(retired)).toBe(false);
    const unticked = withFields(
      fields,
      [role("R1", "F1", false)],
      [query("Q1", "linkedin", ["F1"], { roleId: "R1" })],
    );
    expect(hasLiveQueries(unticked)).toBe(false);
  });
});

describe("boardSearchUrl", () => {
  it("encodes the query into the board's own search page", () => {
    expect(boardSearchUrl("indeed", 'a "b" c')).toBe(
      "https://www.indeed.com/jobs?q=a%20%22b%22%20c",
    );
  });

  it("has no link for an unknown board", () => {
    expect(boardSearchUrl("other", "x")).toBeUndefined();
  });
});

describe("currentScreen and the nav with searches", () => {
  const base = { hasCards: true, hasFields: true, busy: false };

  it("renders the view the person navigated to", () => {
    expect(currentScreen({ ...base, hasQueries: true, view: "searches" })).toBe("searches");
    expect(currentScreen({ ...base, view: "searches" })).toBe("roles");
    expect(currentScreen({ ...base, view: "roles" })).toBe("roles");
    expect(currentScreen(base)).toBe("roles");
    expect(currentScreen({ ...base, view: "searches", busy: true })).toBe("pending");
  });

  it("marks searches as the current step and unlocks it once a query exists", () => {
    expect(navStepFor("searches")).toBe("searches");
    expect(navStepEnabled("searches", base)).toBe(false);
    expect(navStepEnabled("searches", { ...base, hasQueries: true })).toBe(true);
  });
});
