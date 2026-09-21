import { describe, expect, it } from "vitest";

import {
  activeQuestion,
  answerRows,
  appendLogLines,
  composeStartText,
  currentScreen,
  formatElapsed,
  matchFieldsGate,
  navStepEnabled,
  navStepFor,
  preferenceText,
  remainingQuestions,
  restoreSnapshot,
  showNav,
  showRail,
  takeSnapshot,
  MAX_LOG_LINES,
} from "./screens";
import {
  emptyProfile,
  setClimateInterests,
  setPreference,
  upsertCard,
  type Card,
  type Profile,
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
  p = setPreference(p, "seniority", "mid-level", "stated");
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
  it("maps board and pending onto the Fields step", () => {
    expect(navStepFor("board")).toBe("fields");
    expect(navStepFor("pending")).toBe("fields");
    expect(navStepFor("highlights")).toBe("highlights");
  });

  it("disables steps the person has not reached", () => {
    const early = { hasCards: true, hasFields: false, busy: false };
    expect(navStepEnabled("highlights", early)).toBe(true);
    expect(navStepEnabled("fields", early)).toBe(false);
    expect(navStepEnabled("searches", early)).toBe(false);
    expect(navStepEnabled("fields", { ...early, hasFields: true })).toBe(true);
  });

  it("hides the nav and the rail on first run only", () => {
    expect(showNav("firstRun")).toBe(false);
    expect(showRail("firstRun")).toBe(false);
    expect(showNav("highlights")).toBe(true);
    expect(showRail("pending")).toBe(true);
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
    const p = setPreference(emptyProfile(), "seniority", "mid-level", "stated");
    expect(remainingQuestions(p)).toEqual(["climateInterests", "retrainingAppetite"]);
    expect(remainingQuestions(answered())).toEqual([]);
  });

  it("asks the first unanswered key and uses the server's sector groups", () => {
    const view = activeQuestion(emptyProfile(), { sectorGroups: ["energy/grid"] });
    expect(view?.key).toBe("climateInterests");
    expect(view?.pills.some((pill) => pill.value === "energy/grid")).toBe(true);
  });

  it("re-asks an overridden key even when everything is answered", () => {
    expect(activeQuestion(answered())).toBeUndefined();
    expect(activeQuestion(answered(), { override: "seniority" })?.key).toBe("seniority");
  });

  it("renders current values for the Change an answer rows", () => {
    const rows = answerRows(answered());
    expect(rows.map((row) => row.key)).toEqual([
      "climateInterests",
      "seniority",
      "retrainingAppetite",
    ]);
    expect(rows[1].value).toBe("mid-level");
    expect(preferenceText(emptyProfile(), "seniority")).toBe("");
  });

  it("collapses the open-to-suggestions marker", () => {
    const p = setClimateInterests(emptyProfile(), ["open to suggestions"], "stated");
    expect(preferenceText(p, "climateInterests")).toBe("open to suggestions");
  });
});

describe("matchFieldsGate", () => {
  it("needs at least one active card", () => {
    const p = setClimateInterests(emptyProfile(), ["clean energy & grid"], "stated");
    expect(matchFieldsGate(p).enabled).toBe(false);
    expect(matchFieldsGate(p).note).toMatch(/highlight/i);
  });

  it("needs the three questions answered", () => {
    const p = upsertCard(emptyProfile(), card());
    const gate = matchFieldsGate(p);
    expect(gate.enabled).toBe(false);
    expect(gate.note).toMatch(/climate interests/i);
  });

  it("opens once both hold", () => {
    expect(matchFieldsGate(answered()).enabled).toBe(true);
  });

  it("stays shut when every card is excluded", () => {
    const p = upsertCard(answered(), { ...card({ excluded: true }), id: "C1" });
    expect(matchFieldsGate(p).enabled).toBe(false);
  });
});

describe("the pending log", () => {
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
