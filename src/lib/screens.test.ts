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
  restoreSnapshot,
  showNav,
  takeSnapshot,
  boardOrder,
  boardSearchUrl,
  feedbackReason,
  hasLiveQueries,
  orderFields,
  orderedFieldGroups,
  revisedQueryFor,
  verdictToServer,
  MAX_LOG_LINES,
} from "./screens";
import { MAX_FEEDBACK_REASON } from "./workspace";
import {
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

  it("is the board once discovery has landed", () => {
    expect(currentScreen({ hasCards: true, hasFields: true, busy: false })).toBe("board");
  });
});

describe("nav", () => {
  it("maps board and pending onto the Roles step", () => {
    expect(navStepFor("board")).toBe("roles");
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

describe("the pre-turn snapshot", () => {
  it("round-trips the profile text that was in place", () => {
    const snapshot = takeSnapshot("# Profile\n", 1_700_000_000_000);
    expect(snapshot.startedAt).toBe(1_700_000_000_000);
    expect(restoreSnapshot(snapshot)).toBe("# Profile\n");
  });
});

// ---------------------------------------------------------------------------
// The board / searches ordering and the feedback helpers (2b.5)
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

describe("boardOrder", () => {
  it("bands Interesting, Unsure, unmarked, Not for me and is stable inside a band", () => {
    const p = withFields([
      field("F1", { status: "rejected" }),
      field("F2"),
      field("F3", { status: "unsure" }),
      field("F4", { status: "accepted" }),
      field("F5"),
    ]);
    expect(boardOrder(p)).toEqual(["F4", "F3", "F2", "F5", "F1"]);
  });
});

describe("orderFields", () => {
  it("applies a stored order and appends fields the snapshot never saw", () => {
    const p = withFields([field("F1"), field("F2"), field("F3")]);
    expect(orderFields(p, ["F2", "F1"]).map((f) => f.id)).toEqual(["F2", "F1", "F3"]);
  });

  it("drops ids that no longer exist", () => {
    const p = withFields([field("F1")]);
    expect(orderFields(p, ["F9", "F1"]).map((f) => f.id)).toEqual(["F1"]);
  });
});

describe("orderedFieldGroups", () => {
  it("keeps only fields with ticked roles or live queries, Interesting first", () => {
    const p = withFields(
      [field("F1"), field("F2", { status: "accepted" }), field("F3")],
      [role("R1", "F1", true), role("R2", "F2", true), role("R3", "F3", false)],
      [query("Q1", "linkedin", ["F1"])],
    );
    const groups = orderedFieldGroups(p);
    expect(groups.map((g) => g.field.id)).toEqual(["F2", "F1"]);
    expect(groups[1].queries.map((q) => q.id)).toEqual(["Q1"]);
    expect(groups[0].queries).toEqual([]);
  });

  it("hides retired queries", () => {
    const p = withFields(
      [field("F1")],
      [role("R1", "F1", true)],
      [query("Q1", "indeed", ["F1"], { extra: { Retired: "yes" } })],
    );
    expect(orderedFieldGroups(p)[0].queries).toEqual([]);
    expect(hasLiveQueries(p)).toBe(false);
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

describe("feedback", () => {
  it("collapses the four verdicts onto the server's two", () => {
    expect(verdictToServer("good")).toBe("good");
    expect(verdictToServer("partly")).toBe("bad");
    expect(verdictToServer("wrong")).toBe("bad");
    expect(verdictToServer("none")).toBe("bad");
  });

  it("prefixes the verdict label and the chips onto the free text", () => {
    expect(feedbackReason("wrong", ["Too senior", "Wrong discipline"], " agency jobs ")).toBe(
      "Wrong roles; Too senior; Wrong discipline — agency jobs",
    );
  });

  it("omits the dash when there is no free text and caps the length", () => {
    expect(feedbackReason("none", [], "   ")).toBe("No results");
    expect(feedbackReason("good", [], "x".repeat(MAX_FEEDBACK_REASON + 50))).toHaveLength(
      MAX_FEEDBACK_REASON,
    );
  });
});

describe("revisedQueryFor", () => {
  const before = withFields([field("F1")], [], [query("Q1", "indeed", ["F1"])]);

  it("finds the same query edited in place", () => {
    const after = withFields([field("F1")], [], [query("Q1", "indeed", ["F1"], { query: "new" })]);
    expect(revisedQueryFor(before, after, "Q1")).toEqual({
      query: after.queries[0],
      previousText: "q-Q1",
      changed: true,
    });
  });

  it("falls back to the live replacement on the same field and board", () => {
    const after = withFields(
      [field("F1")],
      [],
      [
        query("Q1", "indeed", ["F1"], { extra: { Retired: "yes" } }),
        query("Q2", "indeed", ["F1"], { query: "new" }),
      ],
    );
    expect(revisedQueryFor(before, after, "Q1")?.query.id).toBe("Q2");
  });

  it("is undefined when the query is unknown or gone", () => {
    expect(revisedQueryFor(before, before, "Q9")).toBeUndefined();
    expect(revisedQueryFor(before, withFields([field("F1")]), "Q1")).toBeUndefined();
  });
});

describe("currentScreen and the nav with searches", () => {
  const base = { hasCards: true, hasFields: true, busy: false };

  it("renders the view the person navigated to", () => {
    expect(currentScreen({ ...base, view: "searches" })).toBe("searches");
    expect(currentScreen({ ...base, view: "feedback" })).toBe("feedback");
    expect(currentScreen(base)).toBe("board");
    expect(currentScreen({ ...base, view: "searches", busy: true })).toBe("pending");
  });

  it("marks searches as the current step and unlocks it once a query exists", () => {
    expect(navStepFor("searches")).toBe("searches");
    expect(navStepFor("feedback")).toBe("searches");
    expect(navStepEnabled("searches", base)).toBe(false);
    expect(navStepEnabled("searches", { ...base, hasQueries: true })).toBe(true);
  });
});
