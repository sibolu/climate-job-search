import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { CallMetrics } from "./llm";
import { emptyProfile, parseProfile, type Profile, serializeProfile, upsertCard, upsertField, upsertQuery } from "./profile";
import type { TurnRequest } from "./session";
import {
  discoverMessage,
  explorePills,
  fieldIdIn,
  GENERATE_QUERIES_PILL,
  GO_PILL,
  queriesMessage,
  reviseMessage,
  runTurn,
  type TurnDeps,
  TurnInputError,
  turnErrorMessage,
} from "./turn";
import { GENERATE_QUERIES_TEXT } from "./workspace";

const SESSION_ID = "a".repeat(32);
const METRICS: CallMetrics = { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as never, costUsd: 0, durationMs: 0, continuations: 0, stopReason: "end_turn" };

function fixture(): Profile {
  return parseProfile(readFileSync(join(__dirname, "__fixtures__", "videographer.md"), "utf8")).profile;
}

/** Cards but no preferences: elicitation has to ask. */
function cardsOnly(): Profile {
  return upsertCard(emptyProfile(), {
    id: "C1",
    title: "Documentary series",
    situation: "Studio hired by a nonprofit.",
    actions: "Directed and edited eight episodes.",
    results: "1.2M views.",
    skills: ["field production", "editing"],
    excluded: false,
    extra: {},
  });
}

function request(step: TurnRequest["step"], profile: Profile, content = "hello"): TurnRequest {
  return { sessionId: SESSION_ID, step, profileMd: profileMdOf(profile), messages: [], input: { kind: "message", content } };
}

function profileMdOf(profile: Profile): string {
  return serializeProfile(profile);
}

function fakeDeps(overrides: Partial<TurnDeps> = {}): TurnDeps & { calls: string[] } {
  const calls: string[] = [];
  const deps: TurnDeps = {
    llm: () => ({}) as never,
    sectorGroups: () => Promise.resolve(["Energy", "Food"]),
    extractCards: (_llm, { profile = emptyProfile() }) => {
      calls.push("extractCards");
      const next = cardsOnly();
      return Promise.resolve({ profile: { ...profile, cards: next.cards }, cards: next.cards, metrics: METRICS });
    },
    inferPreferences: (_llm, { profile }) => {
      calls.push("inferPreferences");
      return Promise.resolve({ profile, metrics: METRICS, updatedKeys: [], inferred: [] });
    },
    interpretAnswer: (_llm, { profile, key, answer }) => {
      calls.push("interpretAnswer");
      const pref = key === "climateInterests" ? { values: [answer], source: "stated" as const } : { value: answer, source: "stated" as const };
      const next: Profile = { ...profile, preferences: { ...profile.preferences, [key]: pref } };
      return Promise.resolve({ profile: next, metrics: METRICS, updatedKeys: [key], answered: true });
    },
    discoverFields: ({ profile }) => {
      calls.push("discoverFields");
      const next = upsertField(profile, {
        id: "F9",
        name: "Grid software",
        status: "candidate",
        explored: false,
        move: "adjacent",
        fit: "C1 shows it.",
        uncertain: "",
        sources: ["https://example.com/a"],
        extra: {},
      });
      return Promise.resolve({
        profile: next,
        fields: [next.fields.find((f) => f.id === "F9")!],
        roles: [],
        dropped: { fieldsUncited: 1, fieldsUnsourced: 0, rolesUncited: 0, rolesUnsourced: 0, fieldsSurplus: 0, sourcesRemoved: 0 },
        calls: [METRICS],
        strategy: "single",
      });
    },
    exploreField: ({ profile, fieldId }) => {
      calls.push(`exploreField:${fieldId}`);
      return Promise.resolve({
        profile: { ...profile, fields: profile.fields.map((f) => (f.id === fieldId ? { ...f, explored: true } : f)) },
        message: `Explored ${fieldId}`,
      } as never);
    },
    generateQueries: ({ profile }) => {
      calls.push("generateQueries");
      const next = upsertQuery(profile, { board: "linkedin", query: "grid AND video", fieldIds: ["F1"], status: "untried", reason: "", extra: {} });
      const added = next.queries[next.queries.length - 1]!;
      return Promise.resolve({ profile: next, added: [added], updated: [], dropped: {} as never, metrics: METRICS });
    },
    reviseQueries: ({ profile, feedback }) => {
      calls.push(`reviseQueries:${feedback.queryId}`);
      return Promise.resolve({
        profile,
        explanation: `You said: ${feedback.reason}.`,
        retired: ["Q3"],
        added: [],
        narrowed: ["Q1"],
        fieldChanges: [{ id: "F2", from: "unsure", to: "candidate" }],
        dropped: {} as never,
        metrics: METRICS,
      });
    },
    ...overrides,
  };
  return { ...deps, calls };
}

describe("runTurn — cards", () => {
  it("extracts, infers, then asks the first missing preference with pills", async () => {
    const deps = fakeDeps();
    const progress = vi.fn();
    const res = await runTurn(request("cards", emptyProfile(), "my resume text"), deps, progress);
    expect(deps.calls).toEqual(["extractCards", "inferPreferences"]);
    expect(res.message).toContain("C1: Documentary series");
    expect(res.message).toMatch(/\?/);
    expect(res.pills?.length).toBeGreaterThan(0);
    expect(parseProfile(res.profileMd!).profile.cards).toHaveLength(1);
    expect(progress).toHaveBeenCalled();
  });

  it("refuses feedback input on a message step", async () => {
    const req: TurnRequest = { ...request("cards", emptyProfile()), input: { kind: "feedback", feedback: { queryId: "Q1", verdict: "bad", reason: "" } } };
    await expect(runTurn(req, fakeDeps())).rejects.toBeInstanceOf(TurnInputError);
  });
});

describe("runTurn — elicit", () => {
  it("applies a pill click without a model call and asks the next question", async () => {
    const deps = fakeDeps();
    const first = await runTurn(request("elicit", cardsOnly(), "x"), deps);
    // "x" is not a pill: the model interprets it.
    expect(deps.calls).toEqual(["interpretAnswer"]);
    const asked = parseProfile(first.profileMd!).profile;
    const pill = first.pills![0]!;
    const second = await runTurn(request("elicit", asked, pill.value), deps);
    expect(deps.calls).toEqual(["interpretAnswer"]);
    expect(second.profileMd).not.toEqual(first.profileMd);
  });

  it("offers the go pill once nothing is missing", async () => {
    const res = await runTurn(request("elicit", fixture(), "ok"), fakeDeps());
    expect(res.pills).toEqual([GO_PILL]);
    expect(res.message).toContain("That's everything I need");
  });
});

describe("runTurn — discover / explore / queries / revise", () => {
  it("discover lists the written fields, the dropped count, and explore pills", async () => {
    const deps = fakeDeps();
    const res = await runTurn(request("discover", cardsOnly(), "go"), deps);
    expect(deps.calls).toEqual(["discoverFields"]);
    expect(res.message).toContain("F9: Grid software");
    expect(res.message).toContain("adjacent move");
    expect(res.message).toContain("left out 1 suggestion ");
    expect(res.pills?.map((p) => p.value)).toEqual(["Explore F9: Grid software"]);
  });

  it("explore with a field id runs the drill-down on that field", async () => {
    const deps = fakeDeps();
    const res = await runTurn(request("explore", fixture(), "Explore F3: Forestry"), deps);
    expect(deps.calls).toEqual(["exploreField:F3"]);
    expect(res.message).toContain("Explored F3");
    expect(parseProfile(res.profileMd!).profile.fields.find((f) => f.id === "F3")?.explored).toBe(true);
    expect(res.pills?.[0]).toEqual(GENERATE_QUERIES_PILL);
    expect(res.pills?.some((p) => p.value.startsWith("Explore F3"))).toBe(false);
  });

  it("explore without a field id asks which one and offers pills, no model call", async () => {
    const deps = fakeDeps();
    const res = await runTurn(request("explore", fixture(), "tell me more"), deps);
    expect(deps.calls).toEqual([]);
    expect(res.message).toContain("Which field");
    expect(res.pills?.some((p) => p.value === GENERATE_QUERIES_TEXT)).toBe(true);
  });

  it("explore routes the generate-queries text to the queries step", async () => {
    const deps = fakeDeps();
    const res = await runTurn(request("explore", fixture(), GENERATE_QUERIES_TEXT), deps);
    expect(deps.calls).toEqual(["generateQueries"]);
    expect(res.message).toContain("grid AND video");
  });

  it("revise needs feedback input and returns the explanation with the change list", async () => {
    const deps = fakeDeps();
    await expect(runTurn(request("revise", fixture(), "x"), deps)).rejects.toBeInstanceOf(TurnInputError);
    const req: TurnRequest = {
      ...request("revise", fixture()),
      input: { kind: "feedback", feedback: { queryId: "Q2", verdict: "bad", reason: "all sales videos" } },
    };
    const res = await runTurn(req, deps);
    expect(deps.calls).toEqual(["reviseQueries:Q2"]);
    expect(res.message).toContain("You said: all sales videos.");
    expect(res.message).toContain("Retired: Q3");
    expect(res.message).toContain("F2 unsure → candidate");
  });
});

describe("pure helpers", () => {
  it("fieldIdIn finds the first field id", () => {
    expect(fieldIdIn("Explore F12: x")).toBe("F12");
    expect(fieldIdIn("no id here")).toBeUndefined();
    expect(fieldIdIn("F1x")).toBeUndefined();
  });

  it("explorePills skips rejected fields and puts unexplored first", () => {
    const values = explorePills(fixture()).map((p) => p.value);
    expect(values[0]).toMatch(/^Explore F3/);
    expect(values.some((v) => v.startsWith("Explore F4"))).toBe(false);
  });

  it("messages render without throwing on empty results", () => {
    expect(discoverMessage({ profile: emptyProfile(), fields: [], roles: [], dropped: { fieldsUncited: 0, fieldsUnsourced: 0, rolesUncited: 0, rolesUnsourced: 0, fieldsSurplus: 0, sourcesRemoved: 0 }, calls: [], strategy: "single" })).toContain("could not find");
    expect(queriesMessage({ profile: emptyProfile(), added: [], updated: [], dropped: {} as never, metrics: METRICS })).toContain("did not come up");
    expect(reviseMessage({ profile: emptyProfile(), explanation: "Nothing.", retired: [], added: [], narrowed: [], fieldChanges: [], dropped: {} as never, metrics: METRICS })).toContain("No queries changed");
  });
});

describe("turnErrorMessage", () => {
  const named = (name: string, message = "model said: SECRET") => Object.assign(new Error(message), { name });

  it("shows our own input errors verbatim", () => {
    expect(turnErrorMessage(new TurnInputError("Pick a field."))).toBe("Pick a field.");
    expect(turnErrorMessage(named("CardsInputError", "Pasted text is too short."))).toBe("Pasted text is too short.");
  });

  it("never leaks model or SDK text", () => {
    for (const name of ["LlmRefusalError", "LlmOutputError", "LlmTruncatedError", "LlmPauseLimitError", "ReferenceReadError", "SomethingElse"]) {
      expect(turnErrorMessage(named(name))).not.toContain("SECRET");
    }
    expect(turnErrorMessage(Object.assign(new Error("SECRET"), { status: 429 }))).toContain("busy");
    expect(turnErrorMessage(Object.assign(new Error("SECRET"), { status: 503 }))).toContain("problem");
    expect(turnErrorMessage("nope")).toContain("Something went wrong");
  });
});
