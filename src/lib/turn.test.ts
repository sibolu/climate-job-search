import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { CallMetrics, Llm } from "./llm";
import { emptyProfile, parseProfile, type Profile, serializeProfile, setInputs, upsertCard, upsertField, upsertQuery } from "./profile";
import type { TurnRequest } from "./session";
import {
  discoverMessage,
  explorePills,
  fieldIdIn,
  GO_PILL,
  queriesMessage,
  reviseMessage,
  runTurn,
  withCallContext,
  type CallContext,
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
        dropped: { fieldsUncited: 1, rolesUncited: 0, fieldsSurplus: 0, sourcesRemoved: 0, textUrlsStripped: 0, evidenceDropped: 0, asksDropped: 0, rolesLevelTitled: 2 },
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

/** Every turn carries an access code key (technical-plan.md D71). */
const CTX: CallContext = { codeKey: "a".repeat(32) };

describe("runTurn — cards", () => {
  it("extracts, infers, then asks the first missing preference with pills", async () => {
    const deps = fakeDeps();
    const progress = vi.fn();
    const res = await runTurn(request("cards", emptyProfile(), "my resume text"), deps, progress, CTX);
    expect(deps.calls).toEqual(["extractCards", "inferPreferences"]);
    expect(res.message).toContain("C1: Documentary series");
    expect(res.message).toMatch(/\?/);
    expect(res.pills?.length).toBeGreaterThan(0);
    expect(parseProfile(res.profileMd!).profile.cards).toHaveLength(1);
    expect(progress).toHaveBeenCalled();
  });

  it("refuses feedback input on a message step", async () => {
    const req: TurnRequest = { ...request("cards", emptyProfile()), input: { kind: "feedback", feedback: { queryId: "Q1", verdict: "bad", reason: "" } } };
    await expect(runTurn(req, fakeDeps(), undefined, CTX)).rejects.toBeInstanceOf(TurnInputError);
  });
});

describe("runTurn — elicit", () => {
  it("toggles an area pill without a model call, and sends anything else to the model", async () => {
    const deps = fakeDeps();
    const picked = await runTurn(request("elicit", cardsOnly(), "Energy"), deps, undefined, CTX);
    expect(deps.calls).toEqual([]);
    expect(parseProfile(picked.profileMd!).profile.preferences.climateInterests).toEqual({
      values: ["Energy"],
      source: "stated",
    });
    // "x" is not a pill: the model interprets it.
    const typed = await runTurn(request("elicit", cardsOnly(), "x"), deps, undefined, CTX);
    expect(deps.calls).toEqual(["interpretAnswer"]);
    expect(typed.profileMd).not.toEqual(picked.profileMd);
  });

  it("offers the go pill once nothing is missing", async () => {
    const res = await runTurn(request("elicit", fixture(), "ok"), fakeDeps(), undefined, CTX);
    expect(res.pills).toEqual([GO_PILL]);
    expect(res.message).toContain("That's everything I need");
  });
});

describe("runTurn — discover / explore / queries / revise", () => {
  it("discover hands discovery no catalogue, so it runs from the model's own knowledge (technical-plan.md D61)", async () => {
    const base = fakeDeps();
    const options: unknown[] = [];
    const deps = fakeDeps({
      discoverFields: (req, opts) => {
        options.push(opts);
        return base.discoverFields(req, opts);
      },
    });
    await runTurn(request("discover", cardsOnly(), "go"), deps, undefined, CTX);
    expect(options).toHaveLength(1);
    expect(options[0]).not.toHaveProperty("catalogue");
  });

  it("discover lists the written fields, the dropped count, and explore pills", async () => {
    const deps = fakeDeps();
    const res = await runTurn(request("discover", cardsOnly(), "go"), deps, undefined, CTX);
    expect(deps.calls).toEqual(["discoverFields"]);
    expect(res.message).toContain("F9: Grid software");
    expect(res.message).toContain("adjacent move");
    expect(res.message).toContain(
      "Left out: 1 suggestion that cited none of your experience cards; 2 roles titled by rank rather than occupation.",
    );
    expect(res.message).toContain("On the Roles screen");
    expect(res.message).not.toMatch(/Fields tab|tell me|unsure/);
    expect(res.pills?.map((p) => p.value)).toEqual(["Explore F9: Grid software"]);
  });

  it("explore with a field id runs the drill-down on that field", async () => {
    const deps = fakeDeps();
    const res = await runTurn(request("explore", fixture(), "Explore F3: Forestry"), deps, undefined, CTX);
    expect(deps.calls).toEqual(["exploreField:F3"]);
    expect(res.message).toContain("Explored F3");
    expect(parseProfile(res.profileMd!).profile.fields.find((f) => f.id === "F3")?.explored).toBe(true);
    expect(res.pills?.every((p) => p.value.startsWith("Explore "))).toBe(true);
    expect(res.pills?.some((p) => p.value.startsWith("Explore F3"))).toBe(false);
  });

  it("explore without a field id asks which one and offers pills, no model call", async () => {
    const deps = fakeDeps();
    const res = await runTurn(request("explore", fixture(), "tell me more"), deps, undefined, CTX);
    expect(deps.calls).toEqual([]);
    expect(res.message).toContain("Which field");
    expect(res.pills?.every((p) => p.value.startsWith("Explore "))).toBe(true);
  });

  it("queries needs a selectedRoles input and names each role's search", async () => {
    const deps = fakeDeps();
    await expect(runTurn(request("queries", fixture(), "write queries"), deps, undefined, CTX)).rejects.toBeInstanceOf(TurnInputError);
    expect(deps.calls).toEqual([]);
    const req: TurnRequest = { ...request("queries", fixture()), input: { kind: "selectedRoles" } };
    const res = await runTurn(req, deps, undefined, CTX);
    expect(deps.calls).toEqual(["generateQueries"]);
    expect(res.message).toContain("LinkedIn search for the role you selected");
    expect(res.message).toContain("**Grid video producer**");
    expect(res.message).toContain("grid AND video");
    expect(res.pills).toBeUndefined();
  });

  it("revise needs feedback input and returns the explanation with the change list", async () => {
    const deps = fakeDeps();
    await expect(runTurn(request("revise", fixture(), "x"), deps, undefined, CTX)).rejects.toBeInstanceOf(TurnInputError);
    const req: TurnRequest = {
      ...request("revise", fixture()),
      input: { kind: "feedback", feedback: { queryId: "Q2", verdict: "bad", reason: "all sales videos" } },
    };
    const res = await runTurn(req, deps, undefined, CTX);
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
    expect(discoverMessage({ profile: emptyProfile(), fields: [], roles: [], dropped: { fieldsUncited: 0, rolesUncited: 0, fieldsSurplus: 0, sourcesRemoved: 0, textUrlsStripped: 0, evidenceDropped: 0, asksDropped: 0, rolesLevelTitled: 0 }, call: METRICS })).toContain("could not find");
    expect(queriesMessage({ profile: emptyProfile(), roles: [], written: [], added: [], updated: [], superseded: [], dropped: {} as never, metrics: METRICS })).toContain("could not write");
    expect(reviseMessage({ profile: emptyProfile(), explanation: "Nothing.", retired: [], added: [], narrowed: [], fieldChanges: [], dropped: {} as never, metrics: METRICS })).toContain("No queries changed");
  });
});

/** An `Llm` that records the request of every call made through it. */
function recordingLlm(): { llm: Llm; seen: { signal?: AbortSignal; codeKey?: string }[] } {
  const seen: { signal?: AbortSignal; codeKey?: string }[] = [];
  const llm = {
    streamText: (r: { signal?: AbortSignal; codeKey?: string }) => {
      seen.push(r);
      return {} as never;
    },
    structured: (r: { signal?: AbortSignal; codeKey?: string }) => {
      seen.push(r);
      return Promise.resolve({} as never);
    },
  } as unknown as Llm;
  return { llm, seen };
}

describe("withCallContext", () => {
  const KEY = "b".repeat(32);

  it("with no signal, puts the key alone on every model request", async () => {
    const { llm, seen } = recordingLlm();
    const wrapped = withCallContext(llm, { codeKey: KEY });
    wrapped.streamText({} as never);
    await wrapped.structured({} as never);
    expect(seen.map((r) => r.codeKey)).toEqual([KEY, KEY]);
    expect(seen.every((r) => !("signal" in r))).toBe(true);
  });

  it("puts both on every model request", async () => {
    const { llm, seen } = recordingLlm();
    const signal = new AbortController().signal;
    const wrapped = withCallContext(llm, { signal, codeKey: KEY });
    wrapped.streamText({} as never);
    await wrapped.structured({} as never);
    expect(seen).toEqual([
      { signal, codeKey: KEY },
      { signal, codeKey: KEY },
    ]);
  });
});

describe("runTurn — every step's model calls carry the turn's context (technical-plan.md D45, D69)", () => {
  const KEY = "c".repeat(32);

  /** Fake steps that each make one model call on the `Llm` they are handed, then do what the plain fakes do. */
  function callingDeps(): { deps: TurnDeps & { calls: string[] }; seen: { signal?: AbortSignal; codeKey?: string }[] } {
    const { llm, seen } = recordingLlm();
    const base = fakeDeps();
    const call = (handed: Llm | undefined) => handed!.structured({} as never);
    const deps = fakeDeps({
      llm: () => llm,
      extractCards: async (handed, req) => (await call(handed), base.extractCards(handed, req)),
      inferPreferences: async (handed, req) => (await call(handed), base.inferPreferences(handed, req)),
      interpretAnswer: async (handed, req) => (await call(handed), base.interpretAnswer(handed, req)),
      discoverFields: async (req, opts) => (await call(opts?.llm), base.discoverFields(req, opts)),
      exploreField: async (req, opts) => (await call(opts?.llm), base.exploreField(req, opts)),
      generateQueries: async (req, opts) => (await call(opts?.llm), base.generateQueries(req, opts)),
      reviseQueries: async (req, opts) => (await call(opts?.llm), base.reviseQueries(req, opts)),
    });
    return { deps, seen };
  }

  const STEPS: [string, () => TurnRequest, number][] = [
    ["cards", () => request("cards", emptyProfile(), "my resume text"), 2],
    ["elicit", () => request("elicit", cardsOnly(), "a typed answer"), 1],
    ["discover", () => request("discover", cardsOnly(), "go"), 1],
    ["explore", () => request("explore", fixture(), "Explore F3: Forestry"), 1],
    ["queries", () => ({ ...request("queries", fixture()), input: { kind: "selectedRoles" } }), 1],
    [
      "revise",
      () => ({ ...request("revise", fixture()), input: { kind: "feedback", feedback: { queryId: "Q2", verdict: "bad", reason: "r" } } }),
      1,
    ],
  ];

  it.each(STEPS)("%s: the key and the signal reach every request", async (_step, req, count) => {
    const { deps, seen } = callingDeps();
    const signal = new AbortController().signal;
    const context: CallContext = { signal, codeKey: KEY };
    await runTurn(req(), deps, undefined, context);
    expect(seen).toHaveLength(count);
    expect(seen.every((r) => r.codeKey === KEY && r.signal === signal)).toBe(true);
  });
});

describe("turnErrorMessage", () => {
  const named = (name: string, message = "model said: SECRET") => Object.assign(new Error(message), { name });

  it("shows our own input errors verbatim", () => {
    expect(turnErrorMessage(new TurnInputError("Pick a field."))).toBe("Pick a field.");
    expect(turnErrorMessage(named("CardsInputError", "Pasted text is too short."))).toBe("Pasted text is too short.");
  });

  it("names a reference read failure: explore still reads the reference tables", () => {
    expect(turnErrorMessage(named("ReferenceReadError"))).toBe(
      "The reference collection is unavailable right now. Try again in a minute.",
    );
  });

  it("never leaks model or SDK text", () => {
    for (const name of ["LlmRefusalError", "LlmOutputError", "LlmTruncatedError", "LlmPauseLimitError", "LlmTimeoutError", "LlmCancelledError", "QueriesOutputError", "SomethingElse"]) {
      expect(turnErrorMessage(named(name))).not.toContain("SECRET");
    }
    expect(turnErrorMessage(named("LlmTimeoutError"))).toContain("three minutes");
    expect(turnErrorMessage(Object.assign(new Error("SECRET"), { status: 429 }))).toContain("busy");
    expect(turnErrorMessage(Object.assign(new Error("SECRET"), { status: 503 }))).toContain("problem");
    expect(turnErrorMessage("nope")).toContain("Something went wrong");
  });
});

describe("runTurn — what the person typed (technical-plan.md D56)", () => {
  const typed = setInputs(emptyProfile(), { resume: "typed resume\n## Skills\n> quoted", notes: "typed notes" });

  it("the cards turn takes its text from the message and returns the stored inputs unchanged", async () => {
    const texts: string[] = [];
    const base = fakeDeps();
    const deps = fakeDeps({
      extractCards: (llm, req) => {
        texts.push(req.text);
        return base.extractCards(llm, req);
      },
    });
    const res = await runTurn(request("cards", typed, "my resume text"), deps, undefined, CTX);
    expect(texts).toEqual(["my resume text"]);
    const after = parseProfile(res.profileMd!).profile;
    expect(after.cards).toHaveLength(1);
    expect(after.inputs).toEqual(typed.inputs);
  });

  it("a later turn returns them unchanged too", async () => {
    const withCard = { ...cardsOnly(), inputs: typed.inputs };
    const res = await runTurn(request("elicit", withCard, "Energy"), fakeDeps(), undefined, CTX);
    expect(parseProfile(res.profileMd!).profile.inputs).toEqual(typed.inputs);
  });
});

describe("turnErrorMessage — access-code budget (technical-plan.md D69)", () => {
  const budget = (reason: unknown) => Object.assign(new Error("SECRET"), { name: "LlmBudgetError", reason });

  it("has one sentence per reason, each saying the work is still in the browser", () => {
    const exhausted = turnErrorMessage(budget("exhausted"));
    const inactive = turnErrorMessage(budget("inactive"));
    const unavailable = turnErrorMessage(budget("unavailable"));
    for (const text of [exhausted, inactive, unavailable]) {
      expect(text).toContain("still in this browser");
      expect(text).toContain("Your profile");
      expect(text).not.toContain("SECRET");
    }
    expect(exhausted).toContain("used up its budget");
    expect(inactive).toContain("no longer active");
    expect(unavailable).toContain("Try again");
    expect(new Set([exhausted, inactive, unavailable]).size).toBe(3);
  });

  it("falls back to the unavailable sentence for a reason it does not know", () => {
    const unavailable = turnErrorMessage(budget("unavailable"));
    expect(turnErrorMessage(budget("something new"))).toBe(unavailable);
    expect(turnErrorMessage(budget(undefined))).toBe(unavailable);
    expect(turnErrorMessage(Object.assign(new Error("x"), { name: "LlmBudgetError" }))).toBe(unavailable);
  });
});
