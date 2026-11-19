import { describe, expect, it } from "vitest";

import {
  answerRows,
  findRolesGate,
  highlightsCountNote,
  pendingStatusLine,
  questionViews,
  FIND_ROLES_PILL,
  appendLogLines,
  composeStartText,
  currentScreen,
  formatElapsed,
  navStepEnabled,
  navStepFor,
  preferenceText,
  remainingQuestions,
  showNav,
  askAnswer,
  boardSearchUrl,
  citationsToTitles,
  hasLiveQueries,
  roleGroups,
  searchCards,
  selectedRolesNote,
  sourceLabel,
  writeSearchesLabel,
  MAX_LOG_LINES,
} from "./screens";
import {
  addOtherPreference,
  emptyProfile,
  setClimateInterests,
  setPreference,
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
  let p = upsertCard(emptyProfile(), card());
  p = setClimateInterests(p, ["clean energy & grid"], "stated");
  p = setPreference(p, "retrainingAppetite", "short courses", "stated");
  return p;
}

describe("currentScreen", () => {
  it("is firstRun with no cards, even while busy", () => {
    expect(currentScreen({ hasCards: false, hasFields: false, busy: false })).toBe("firstRun");
    expect(currentScreen({ hasCards: false, hasFields: false, busy: true })).toBe("firstRun");
  });

  it("is highlights once cards exist and no fields do", () => {
    expect(currentScreen({ hasCards: true, hasFields: false, busy: false })).toBe("highlights");
  });

  it("is pending whenever a turn is in flight behind existing cards", () => {
    expect(currentScreen({ hasCards: true, hasFields: false, busy: true })).toBe("pending");
    expect(currentScreen({ hasCards: true, hasFields: true, busy: true })).toBe("pending");
  });

  it("is the Roles screen once discovery has landed", () => {
    expect(currentScreen({ hasCards: true, hasFields: true, busy: false })).toBe("roles");
  });
});

describe("nav", () => {
  it("maps roles and pending onto the Roles step", () => {
    expect(navStepFor("roles")).toBe("roles");
    expect(navStepFor("pending")).toBe("roles");
    expect(navStepFor("highlights")).toBe("highlights");
  });

  it("disables steps the person has not reached", () => {
    const early = { hasCards: true, hasFields: false, busy: false };
    expect(navStepEnabled("highlights", early)).toBe(true);
    expect(navStepEnabled("roles", early)).toBe(false);
    expect(navStepEnabled("searches", early)).toBe(false);
    expect(navStepEnabled("roles", { ...early, hasFields: true })).toBe(true);
  });

  it("hides the nav on first run only", () => {
    expect(showNav("firstRun")).toBe(false);
    expect(showNav("highlights")).toBe(true);
    expect(showNav("pending")).toBe(true);
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

describe("preference questions", () => {
  it("lists the unanswered keys in ELICIT_ORDER", () => {
    expect(remainingQuestions(emptyProfile())).toEqual(["climateInterests", "retrainingAppetite"]);
    // Seniority is not asked (technical-plan.md D48): having it on file answers nothing.
    const p = setPreference(emptyProfile(), "seniority", "mid-level", "stated");
    expect(remainingQuestions(p)).toEqual(["climateInterests", "retrainingAppetite"]);
    expect(remainingQuestions(answered())).toEqual([]);
  });

  it("shows both questions at once and uses the server's sector groups", () => {
    const views = questionViews(emptyProfile(), { sectorGroups: ["energy/grid"] });
    expect(views.map((view) => view.key)).toEqual(["climateInterests", "retrainingAppetite"]);
    expect(views[0].pills.some((pill) => pill.value === "energy/grid")).toBe(true);
    expect(views.every((view) => view.answer === "")).toBe(true);
    expect(views.flatMap((view) => view.pills).some((pill) => pill.selected)).toBe(false);
  });

  it("keeps an answered question's pills and marks the recorded one", () => {
    const p = setPreference(answered(), "retrainingAppetite", "low, a short course or certificate", "stated");
    const [interests, retraining] = questionViews(p, { sectorGroups: ["clean energy & grid"] });
    expect(retraining.answer).toBe("low, a short course or certificate");
    expect(retraining.pills.filter((pill) => pill.selected).map((pill) => pill.value)).toEqual([
      "low, a short course or certificate",
    ]);
    expect(interests.pills.filter((pill) => pill.selected).map((pill) => pill.value)).toEqual([
      "clean energy & grid",
    ]);
  });

  it("labels the questions in plain words, never by profile key", () => {
    const labels = questionViews(emptyProfile()).map((view) => view.label);
    expect(labels.join(" ")).not.toMatch(/appetite/i);
    expect(labels[1]).toBe("How much retraining you're open to");
  });

  it("renders current values for the answer rows", () => {
    const rows = answerRows(answered());
    expect(rows.map((row) => row.key)).toEqual(["climateInterests", "retrainingAppetite"]);
    expect(rows[1].value).toBe("short courses");
    expect(preferenceText(emptyProfile(), "seniority")).toBe("");
  });

  it("collapses the open-to-suggestions marker", () => {
    const p = setClimateInterests(emptyProfile(), ["open to suggestions"], "stated");
    expect(preferenceText(p, "climateInterests")).toBe("open to suggestions");
  });
});

describe("findRolesGate", () => {
  it("needs at least one active card", () => {
    const p = setClimateInterests(emptyProfile(), ["clean energy & grid"], "stated");
    expect(findRolesGate(p).enabled).toBe(false);
    expect(findRolesGate(p).note).toMatch(/highlight/i);
  });

  it("needs the questions answered", () => {
    const p = upsertCard(emptyProfile(), card());
    const gate = findRolesGate(p);
    expect(gate.enabled).toBe(false);
    expect(gate.note).toBe("Answer the two questions above first.");
    expect(gate.note).not.toMatch(/rail|assistant/i);
  });

  it("names the one question still open", () => {
    let p = upsertCard(emptyProfile(), card());
    p = setClimateInterests(p, ["clean energy & grid"], "stated");
    expect(findRolesGate(p).note).toMatch(/how much retraining you're open to/i);
  });

  it("labels the button with the pill the server offers", () => {
    expect(FIND_ROLES_PILL).toEqual({ label: "Find climate roles", value: "go" });
  });

  it("counts the highlights used to match", () => {
    const p = upsertCard(answered(), card({ excluded: true }));
    expect(highlightsCountNote(p)).toBe("1 of 2 highlights used to match roles.");
  });

  it("opens once both hold", () => {
    expect(findRolesGate(answered()).enabled).toBe(true);
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
    expect(citationsToTitles(p, "Draws on (C1, C03).")).toBe("Draws on (Grid analyst, Ops lead).");
  });

  it("never leaves a raw id for an unknown card and leaves other text alone", () => {
    expect(citationsToTitles(p, "C7 shows it")).toBe("one of your highlights shows it");
    expect(citationsToTitles(p, "CO2 and ABC1 stay")).toBe("CO2 and ABC1 stay");
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
    expect(group.drawsOn).toEqual(["Grid analyst", "Ops lead"]);
    expect(group.uncertain).toBe("Unclear whether Ops lead counts.");
    expect(group.askAnswer).toBeUndefined();
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

  it("reads a saved ask answer by key, whatever its spacing or case", () => {
    const answeredP = addOtherPreference(p, "pe  LICENCE", "Yes, since 2019");
    expect(roleGroups(answeredP)[0].askAnswer).toBe("Yes, since 2019");
    expect(askAnswer(answeredP, { question: "", key: "other", placeholder: "" })).toBeUndefined();
  });
});

describe("sourceLabel", () => {
  it("shows a link's host, or the raw text when it is not a URL", () => {
    expect(sourceLabel("https://www.example.org/a/b?c=1")).toBe("example.org");
    expect(sourceLabel("not a url")).toBe("not a url");
  });
});

describe("the write-searches label", () => {
  it("is singular for one role", () => {
    expect(writeSearchesLabel(1)).toBe("Write LinkedIn searches for 1 role");
    expect(writeSearchesLabel(3)).toBe("Write LinkedIn searches for 3 roles");
    expect(selectedRolesNote(0)).toBe("Tick at least one role first.");
    expect(selectedRolesNote(2)).toBe("2 roles ticked.");
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
    expect(currentScreen({ ...base, view: "searches" })).toBe("searches");
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
