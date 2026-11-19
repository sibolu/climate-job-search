import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { CallMetrics, Llm } from "./llm";
import { emptyProfile, parseProfile, type Profile, serializeProfile, upsertCard, upsertField, upsertQuery } from "./profile";
import type { TurnRequest } from "./session";
import {
  discoverMessage,
  explorePills,
  fieldIdIn,
  GO_PILL,
  queriesMessage,
  reviseMessage,
  runTurn,
  withSignal,
  type TurnDeps,
  TurnInputError,
  turnErrorMessage,
} from "./turn";

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
      return Promise.resolve({ profile: { ...profile, cards: next.cards }, cards: next.cards, noted: [], metrics: METRICS });
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
        sector: "",
        summary: "",
        chips: [],
        evidence: [],
        fit: "C1 shows it.",
        uncertain: "",
        sources: ["https://example.com/a"],
        extra: {},
      });
      return Promise.resolve({
        profile: next,
        fields: [next.fields.find((f) => f.id === "F9")!],
        roles: [],
        dropped: { fieldsUncited: 1, rolesUncited: 0, fieldsSurplus: 0, sourcesRemoved: 0, evidenceDropped: 0, asksDropped: 0, rolesLevelTitled: 0 },
        call: METRICS,
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
      const roles = [{ id: "R1", title: "Grid video producer", fieldId: "F1", companies: [], why: "", selected: true, sources: [], extra: {} }];
      const next = upsertQuery(profile, { board: "linkedin", query: "grid AND video", fieldIds: ["F1"], roleId: "R1", status: "untried", reason: "", extra: {} });
      const added = next.queries[next.queries.length - 1]!;
      return Promise.resolve({ profile: next, roles, written: [added], added: [added], updated: [], superseded: [], dropped: {} as never, metrics: METRICS });
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
    expect(res.pills?.every((p) => p.value.startsWith("Explore "))).toBe(true);
    expect(res.pills?.some((p) => p.value.startsWith("Explore F3"))).toBe(false);
  });

  it("explore without a field id asks which one and offers pills, no model call", async () => {
    const deps = fakeDeps();
    const res = await runTurn(request("explore", fixture(), "tell me more"), deps);
    expect(deps.calls).toEqual([]);
    expect(res.message).toContain("Which field");
    expect(res.pills?.every((p) => p.value.startsWith("Explore "))).toBe(true);
  });

  it("queries needs a selectedRoles input and names each role's search", async () => {
    const deps = fakeDeps();
    await expect(runTurn(request("queries", fixture(), "write queries"), deps)).rejects.toBeInstanceOf(TurnInputError);
    expect(deps.calls).toEqual([]);
    const req: TurnRequest = { ...request("queries", fixture()), input: { kind: "selectedRoles" } };
    const res = await runTurn(req, deps);
    expect(deps.calls).toEqual(["generateQueries"]);
    expect(res.message).toContain("LinkedIn search for the role you selected");
    expect(res.message).toContain("**Grid video producer**");
    expect(res.message).toContain("grid AND video");
    expect(res.pills).toBeUndefined();
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
    expect(discoverMessage({ profile: emptyProfile(), fields: [], roles: [], dropped: { fieldsUncited: 0, rolesUncited: 0, fieldsSurplus: 0, sourcesRemoved: 0, evidenceDropped: 0, asksDropped: 0, rolesLevelTitled: 0 }, call: METRICS })).toContain("could not find");
    expect(queriesMessage({ profile: emptyProfile(), roles: [], written: [], added: [], updated: [], superseded: [], dropped: {} as never, metrics: METRICS })).toContain("could not write");
    expect(reviseMessage({ profile: emptyProfile(), explanation: "Nothing.", retired: [], added: [], narrowed: [], fieldChanges: [], dropped: {} as never, metrics: METRICS })).toContain("No queries changed");
  });
});

describe("withSignal", () => {
  it("puts the turn's abort signal on every model request", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const base = {
      streamText: (r: { signal?: AbortSignal }) => {
        seen.push(r.signal);
        return {} as never;
      },
      structured: (r: { signal?: AbortSignal }) => {
        seen.push(r.signal);
        return Promise.resolve({} as never);
      },
    } as unknown as Llm;
    const signal = new AbortController().signal;
    const wrapped = withSignal(base, signal);
    wrapped.streamText({} as never);
    await wrapped.structured({} as never);
    expect(seen).toEqual([signal, signal]);
    expect(withSignal(base, undefined)).toBe(base);
  });

  it("hands the signal-carrying llm to the step modules", async () => {
    let received: unknown;
    const deps = fakeDeps({
      discoverFields: (_req, options) => {
        received = options?.llm;
        return Promise.reject(new Error("stop here"));
      },
    });
    const signal = new AbortController().signal;
    await runTurn(request("discover", cardsOnly(), "go"), deps, undefined, signal).catch(() => undefined);
    // The fake deps' llm is `{}`; only the signal wrapper has methods.
    expect(typeof (received as Llm).structured).toBe("function");
  });
});

describe("turnErrorMessage", () => {
  const named = (name: string, message = "model said: SECRET") => Object.assign(new Error(message), { name });

  it("shows our own input errors verbatim", () => {
    expect(turnErrorMessage(new TurnInputError("Pick a field."))).toBe("Pick a field.");
    expect(turnErrorMessage(named("CardsInputError", "Pasted text is too short."))).toBe("Pasted text is too short.");
  });

  it("never leaks model or SDK text", () => {
    for (const name of ["LlmRefusalError", "LlmOutputError", "LlmTruncatedError", "LlmPauseLimitError", "LlmTimeoutError", "LlmCancelledError", "ReferenceReadError", "QueriesOutputError", "SomethingElse"]) {
      expect(turnErrorMessage(named(name))).not.toContain("SECRET");
    }
    expect(turnErrorMessage(named("LlmTimeoutError"))).toContain("three minutes");
    expect(turnErrorMessage(Object.assign(new Error("SECRET"), { status: 429 }))).toContain("busy");
    expect(turnErrorMessage(Object.assign(new Error("SECRET"), { status: 503 }))).toContain("problem");
    expect(turnErrorMessage("nope")).toContain("Something went wrong");
  });
});
