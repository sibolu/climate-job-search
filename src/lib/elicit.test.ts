import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  DEFAULT_CLIMATE_AREAS,
  ELICIT_ORDER,
  SUMMARY_ORDER,
  INFERRED_TAG,
  INFER_SYSTEM,
  INTERPRET_SYSTEM,
  MAX_INTEREST_CHIPS,
  MAX_PREFERENCE_VALUE_CHARS,
  NOT_SURE_PILL,
  OPEN_TO_SUGGESTIONS,
  QUESTIONS,
  applyPillAnswer,
  inferPreferences,
  interpretAnswer,
  isElicitationComplete,
  isOpenToSuggestions,
  nextQuestion,
  pillsFor,
  type ElicitContext,
  type ElicitDecision,
  type InferredPreferences,
  type InterpretedAnswer,
} from "./elicit";
import type { CallMetrics, Llm, StructuredRequest } from "./llm";
import { KNOWN_PREFERENCE_KEYS, missingPreferences, parseProfile, type Profile } from "./profile";

const SESSION_ID = "0123456789abcdef0123456789abcdef";
const CTX: ElicitContext = { sectorGroups: [] };

/** The videographer fixture with every preference wiped: cards, no preferences. */
function cardsOnly(): Profile {
  const md = readFileSync(join(__dirname, "__fixtures__", "videographer.md"), "utf8");
  const { profile } = parseProfile(md);
  return { ...profile, preferences: { other: [] } };
}

const METRICS: CallMetrics = {
  usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0.001,
  durationMs: 12,
  continuations: 0,
  stopReason: "end_turn",
};

interface FakeLlm extends Llm {
  requests: StructuredRequest<z.ZodType>[];
}

/** An `Llm` whose `structured` returns the canned value; records requests for assertions. */
function fakeLlm(value: unknown): FakeLlm {
  const requests: StructuredRequest<z.ZodType>[] = [];
  return {
    requests,
    streamText() {
      throw new Error("elicit never streams");
    },
    async structured(request) {
      requests.push(request);
      return { value: request.schema.parse(value), message: {} as never, messages: [], ...METRICS };
    },
  };
}

const NONE = { value: null, confidence: "none", evidence: "" } as const;
function inference(overrides: Partial<InferredPreferences> = {}): InferredPreferences {
  return {
    location: NONE,
    workMode: NONE,
    seniority: NONE,
    retrainingAppetite: NONE,
    climateInterests: { values: [], confidence: "none", evidence: "" },
    ...overrides,
  };
}

function interpretation(overrides: Partial<InterpretedAnswer> = {}): InterpretedAnswer {
  return {
    location: null,
    workMode: null,
    seniority: null,
    retrainingAppetite: null,
    climateInterests: null,
    other: [],
    ...overrides,
  };
}

function questionMarks(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

describe("acceptance: a scripted 5-turn transcript", () => {
  it("asks exactly one preference per turn, skips what is known, and stops for good", async () => {
    // Cards exist; seniority is inferable from them, nothing else is.
    const { profile: afterInfer, updatedKeys } = await inferPreferences(
      fakeLlm(inference({ seniority: { value: "mid-level, 7 years", confidence: "high", evidence: "C1, C2" } })),
      { sessionId: SESSION_ID, profile: cardsOnly() },
    );
    expect(updatedKeys).toEqual(["seniority"]);
    expect(afterInfer.preferences.seniority).toEqual({ value: "mid-level, 7 years", source: "inferred" });

    const decisions: ElicitDecision[] = [];
    let p = afterInfer;

    // Turn 1: climate interests, answered with the "not sure" pill.
    let d = nextQuestion(p, CTX);
    decisions.push(d);
    if (d.kind !== "ask") throw new Error("expected a question");
    expect(d.key).toBe("climateInterests");
    p = applyPillAnswer(p, d.key, NOT_SURE_PILL);
    expect(isOpenToSuggestions(p)).toBe(true);

    // Turn 2: seniority is inferred, so retraining appetite is next. It is
    // answered in free text that also volunteers location and work mode —
    // neither is ever asked, but both are recorded when the person says them.
    d = nextQuestion(p, CTX);
    decisions.push(d);
    if (d.kind !== "ask") throw new Error("expected a question");
    expect(d.key).toBe("retrainingAppetite");
    const llm = fakeLlm(
      interpretation({
        retrainingAppetite: "a short course, not a degree",
        location: "Portland, OR",
        workMode: "hybrid",
      }),
    );
    const answered = await interpretAnswer(llm, {
      sessionId: SESSION_ID,
      profile: p,
      key: d.key,
      answer: "A short course maybe. I'm in Portland and would like hybrid.",
    });
    expect(answered.answered).toBe(true);
    expect(answered.updatedKeys).toEqual(["location", "workMode", "retrainingAppetite"]);
    p = answered.profile;

    // Turns 3 and 4: done, and it stays done.
    d = nextQuestion(p, CTX);
    decisions.push(d);
    expect(d.kind).toBe("done");
    d = nextQuestion(p, CTX);
    decisions.push(d);
    expect(d.kind).toBe("done");

    expect(decisions).toHaveLength(4);
    const asks = decisions.filter((x) => x.kind === "ask");
    expect(asks).toHaveLength(2);
    const askedKeys = asks.map((a) => a.key);
    expect(new Set(askedKeys).size).toBe(askedKeys.length);
    expect(askedKeys).not.toContain("seniority");
    expect(askedKeys).not.toContain("location");
    expect(askedKeys).not.toContain("workMode");
    for (const ask of asks) {
      expect(questionMarks(ask.question)).toBe(1);
      expect(ask.pills).toEqual(pillsFor(ask.key, CTX));
      expect(ask.allowFreeText).toBe(true);
    }

    expect(isElicitationComplete(p)).toBe(true);
    expect(missingPreferences(p)).toEqual([]);
    if (d.kind !== "done") throw new Error("expected done");
    expect(questionMarks(d.summary)).toBe(0);
    expect(d.summary).toContain(`Seniority: mid-level, 7 years ${INFERRED_TAG}`);
    expect(d.summary).toContain("Location: Portland, OR");
    expect(d.summary).not.toContain(`Location: Portland, OR ${INFERRED_TAG}`);
    expect(d.summary).toContain("2 experience cards");
  });

  it("asks every key in ELICIT_ORDER when nothing is inferable, then is done", () => {
    let p = cardsOnly();
    const asked: string[] = [];
    for (let turn = 0; turn < ELICIT_ORDER.length; turn++) {
      const d = nextQuestion(p, CTX);
      if (d.kind !== "ask") throw new Error(`turn ${turn} should ask`);
      asked.push(d.key);
      p = applyPillAnswer(p, d.key, d.pills[0]);
    }
    expect(asked).toEqual([...ELICIT_ORDER]);
    expect(nextQuestion(p, CTX).kind).toBe("done");
  });
});

describe("policy tables", () => {
  it("ELICIT_ORDER lists known preference keys, each at most once", () => {
    expect(new Set(ELICIT_ORDER).size).toBe(ELICIT_ORDER.length);
    for (const key of ELICIT_ORDER) expect(KNOWN_PREFERENCE_KEYS).toContain(key);
  });

  it("never asks for location or work mode — the job boards filter on those", () => {
    // PLAN.md §7.36: both stay PreferenceKeys (inferred, editable, settable
    // from query feedback); only the conversational question is gone.
    expect(ELICIT_ORDER).not.toContain("location");
    expect(ELICIT_ORDER).not.toContain("workMode");
    expect(SUMMARY_ORDER).toContain("location");
    expect(SUMMARY_ORDER).toContain("workMode");
    expect([...SUMMARY_ORDER].sort()).toEqual([...KNOWN_PREFERENCE_KEYS].sort());
  });

  it("completes even when location and work mode are unknown", () => {
    let p = cardsOnly();
    for (let turn = 0; turn < ELICIT_ORDER.length; turn++) {
      const d = nextQuestion(p, CTX);
      if (d.kind !== "ask") throw new Error("expected a question");
      p = applyPillAnswer(p, d.key, d.pills[0]);
    }
    expect(isElicitationComplete(p)).toBe(true);
    expect(p.preferences.location).toBeUndefined();
    expect(p.preferences.workMode).toBeUndefined();
  });

  it("every question is exactly one question", () => {
    for (const key of KNOWN_PREFERENCE_KEYS) expect(questionMarks(QUESTIONS[key])).toBe(1);
  });

  it("pillsFor returns a small set of unique, non-empty pills for every key", () => {
    for (const key of KNOWN_PREFERENCE_KEYS) {
      const pills = pillsFor(key, CTX);
      expect(pills.length).toBeGreaterThan(0);
      expect(pills.length).toBeLessThanOrEqual(MAX_INTEREST_CHIPS + 1);
      expect(new Set(pills.map((x) => x.label)).size).toBe(pills.length);
      expect(new Set(pills.map((x) => x.value)).size).toBe(pills.length);
      for (const pill of pills) {
        expect(pill.label.length).toBeGreaterThan(0);
        expect(pill.value.length).toBeGreaterThan(0);
      }
    }
  });

  it("climate chips come from sector groups, capped, deduped, with the not-sure pill last", () => {
    const groups = ["energy/grid/storage", " energy/grid/storage ", "", "b", "c", "d", "e", "f", "g", "h"];
    const pills = pillsFor("climateInterests", { sectorGroups: groups });
    expect(pills).toHaveLength(MAX_INTEREST_CHIPS + 1);
    expect(pills[0]).toEqual({ label: "Energy / grid / storage", value: "energy/grid/storage" });
    expect(pills.at(-1)).toEqual(NOT_SURE_PILL);
    expect(pillsFor("climateInterests", CTX).map((x) => x.value)).toEqual([
      ...DEFAULT_CLIMATE_AREAS,
      OPEN_TO_SUGGESTIONS,
    ]);
  });

  it("system prompts are byte-stable strings with no per-call content", () => {
    expect(INFER_SYSTEM).not.toMatch(/\$\{|Portland|C1:/);
    expect(INTERPRET_SYSTEM).not.toMatch(/\$\{|Portland|C1:/);
  });
});

describe("applyPillAnswer", () => {
  it("records a stated value", () => {
    const p = applyPillAnswer(cardsOnly(), "seniority", pillsFor("seniority", CTX)[2]);
    expect(p.preferences.seniority).toEqual({ value: "senior", source: "stated" });
  });

  it("a remote-only location also settles work mode, but never over a stated one", () => {
    const remoteOnly = pillsFor("location", CTX).find((x) => x.value === "anywhere, remote only");
    if (!remoteOnly) throw new Error("pill missing");
    const fresh = applyPillAnswer(cardsOnly(), "location", remoteOnly);
    expect(fresh.preferences.workMode).toEqual({ value: "remote", source: "stated" });

    const hybrid = applyPillAnswer(cardsOnly(), "workMode", { label: "Hybrid", value: "hybrid" });
    const kept = applyPillAnswer(hybrid, "location", remoteOnly);
    expect(kept.preferences.workMode).toEqual({ value: "hybrid", source: "stated" });
  });

  it("OPEN_TO_SUGGESTIONS is a known value, and open phrases normalize to it", () => {
    const p = applyPillAnswer(cardsOnly(), "climateInterests", { label: "?", value: "Not sure yet." });
    expect(p.preferences.climateInterests).toEqual({ values: [OPEN_TO_SUGGESTIONS], source: "stated" });
    expect(isOpenToSuggestions(p)).toBe(true);
    expect(missingPreferences(p)).not.toContain("climateInterests");
    const real = applyPillAnswer(cardsOnly(), "climateInterests", { label: "Grid", value: "energy/grid" });
    expect(isOpenToSuggestions(real)).toBe(false);
    expect(isOpenToSuggestions(cardsOnly())).toBe(false);
  });
});

describe("inferPreferences", () => {
  it("makes no call without active cards or with nothing missing", async () => {
    const llm = fakeLlm(inference());
    const noCards = { ...cardsOnly(), cards: [] };
    const r = await inferPreferences(llm, { sessionId: SESSION_ID, profile: noCards });
    expect(r.updatedKeys).toEqual([]);
    expect(r.metrics.costUsd).toBe(0);
    const full = parseProfile(
      readFileSync(join(__dirname, "__fixtures__", "videographer.md"), "utf8"),
    ).profile;
    await inferPreferences(llm, { sessionId: SESSION_ID, profile: full });
    expect(llm.requests).toHaveLength(0);
  });

  it("writes only high-confidence values, tagged inferred, and never over a stated value", async () => {
    const llm = fakeLlm(
      inference({
        seniority: { value: "senior (inferred)", confidence: "high", evidence: "C1" },
        location: { value: "Seattle", confidence: "medium", evidence: "C2" },
        workMode: { value: "remote", confidence: "high", evidence: "C1" },
        climateInterests: { values: ["Regenerative agriculture", "not sure", "regenerative agriculture"], confidence: "high", evidence: "C1" },
      }),
    );
    const stated = applyPillAnswer(cardsOnly(), "workMode", { label: "Hybrid", value: "hybrid" });
    const r = await inferPreferences(llm, { sessionId: SESSION_ID, profile: stated });
    expect(llm.requests[0].step).toBe("elicit");
    expect(llm.requests[0].system).toBe(INFER_SYSTEM);
    expect(llm.requests[0].messages[0].content).toContain("### C1:");
    expect(llm.requests[0].messages[0].content).not.toContain("### C3:"); // excluded card
    expect(r.updatedKeys).toEqual(["seniority", "climateInterests"]);
    expect(r.profile.preferences.seniority).toEqual({ value: "senior", source: "inferred" });
    expect(r.profile.preferences.location).toBeUndefined();
    expect(r.profile.preferences.workMode).toEqual({ value: "hybrid", source: "stated" });
    expect(r.profile.preferences.climateInterests).toEqual({
      values: ["Regenerative agriculture"],
      source: "inferred",
    });
    expect(r.inferred.map((x) => x.key)).toEqual(["seniority", "climateInterests"]);
  });

  it("caps an over-long value at MAX_PREFERENCE_VALUE_CHARS", async () => {
    const long = "x ".repeat(MAX_PREFERENCE_VALUE_CHARS);
    const llm = fakeLlm(inference({ seniority: { value: long, confidence: "high", evidence: "C1" } }));
    const r = await inferPreferences(llm, { sessionId: SESSION_ID, profile: cardsOnly() });
    const value = r.profile.preferences.seniority?.value ?? "";
    expect(value.length).toBeLessThanOrEqual(MAX_PREFERENCE_VALUE_CHARS);
    expect(value).toBe(value.trim());
  });
});

describe("interpretAnswer", () => {
  it("records the asked preference and anything volunteered as stated, correcting what is on file", async () => {
    const llm = fakeLlm(
      interpretation({
        retrainingAppetite: "a short course",
        seniority: "senior",
        other: [
          { key: "Salary floor", value: "75k" },
          { key: "Seniority", value: "smuggled" },
          { key: "", value: "x" },
        ],
      }),
    );
    let p = applyPillAnswer(cardsOnly(), "seniority", { label: "Mid", value: "mid-level" });
    p = { ...p, preferences: { ...p.preferences, other: [{ key: "Salary floor", value: "60k", source: "stated" }] } };
    const r = await interpretAnswer(llm, {
      sessionId: SESSION_ID,
      profile: p,
      key: "retrainingAppetite",
      answer: "a short course; actually I'm senior and need 75k",
    });
    expect(llm.requests[0].system).toBe(INTERPRET_SYSTEM);
    expect(llm.requests[0].messages[0].content).toContain("a short course; actually");
    expect(llm.requests[0].messages[0].content).not.toContain("### C1:");
    expect(r.answered).toBe(true);
    expect(r.profile.preferences.retrainingAppetite).toEqual({ value: "a short course", source: "stated" });
    expect(r.profile.preferences.seniority).toEqual({ value: "senior", source: "stated" });
    expect(r.profile.preferences.other).toEqual([{ key: "Salary floor", value: "75k", source: "stated" }]);
  });

  it("reports answered=false when the reply changed the subject", async () => {
    const llm = fakeLlm(interpretation({ climateInterests: ["unsure"] }));
    const r = await interpretAnswer(llm, {
      sessionId: SESSION_ID,
      profile: cardsOnly(),
      key: "seniority",
      answer: "no idea what area yet",
    });
    expect(r.answered).toBe(false);
    expect(r.updatedKeys).toEqual(["climateInterests"]);
    expect(isOpenToSuggestions(r.profile)).toBe(true);
    expect(nextQuestion(r.profile, CTX)).toMatchObject({ kind: "ask", key: "seniority" });
  });
});
