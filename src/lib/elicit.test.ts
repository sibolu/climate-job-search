import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  CLIMATE_AREAS,
  ELICIT_ORDER,
  SUMMARY_ORDER,
  INFERRED_TAG,
  INFER_SYSTEM,
  INTERPRET_SYSTEM,
  InferredPreferencesSchema,
  MAX_PREFERENCE_VALUE_CHARS,
  OPEN_TO_SUGGESTIONS,
  QUESTIONS,
  applyPillAnswer,
  inferPreferences,
  interpretAnswer,
  isElicitationComplete,
  isOpenToSuggestions,
  nextQuestion,
  pillsFor,
  toggleClimateInterest,
  type InferredPreferences,
  type InterpretedAnswer,
} from "./elicit";
import type { CallMetrics, Llm, StructuredRequest } from "./llm";
import {
  KNOWN_PREFERENCE_KEYS,
  missingPreferences,
  parseProfile,
  setClimateInterests,
  setPreference,
  type Profile,
} from "./profile";

const SESSION_ID = "0123456789abcdef0123456789abcdef";

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

describe("acceptance: one optional question", () => {
  it("asks the interest question once, takes any number of picks, and stops for good", async () => {
    // Cards exist; seniority is inferable from them and is recorded, though
    // nothing asks for it or reads it (technical-plan.md D48).
    const { profile: afterInfer, updatedKeys } = await inferPreferences(
      fakeLlm(inference({ seniority: { value: "mid-level, 7 years", confidence: "high", evidence: "C1, C2" } })),
      { sessionId: SESSION_ID, profile: cardsOnly() },
    );
    expect(updatedKeys).toEqual(["seniority"]);
    expect(afterInfer.preferences.seniority).toEqual({ value: "mid-level, 7 years", source: "inferred" });

    // The one question: climate interests, answered from its six pills.
    let p = afterInfer;
    const ask = nextQuestion(p);
    if (ask.kind !== "ask") throw new Error("expected a question");
    expect(ask.key).toBe("climateInterests");
    expect(questionMarks(ask.question)).toBe(1);
    expect(ask.pills).toEqual(pillsFor("climateInterests"));

    // Two picks, each one tap.
    p = applyPillAnswer(p, ask.key, ask.pills[3]);
    p = applyPillAnswer(p, ask.key, ask.pills[5]);
    expect(p.preferences.climateInterests).toEqual({ values: ["Energy", "Carbon Removal"], source: "stated" });

    // Retraining, location and work mode are never asked, but all three are
    // recorded when the person says them in free text.
    const answered = await interpretAnswer(
      fakeLlm(
        interpretation({
          retrainingAppetite: "a short course, not a degree",
          location: "Portland, OR",
          workMode: "hybrid",
        }),
      ),
      {
        sessionId: SESSION_ID,
        profile: p,
        key: "retrainingAppetite",
        answer: "A short course maybe. I'm in Portland and would like hybrid.",
      },
    );
    expect(answered.answered).toBe(true);
    expect(answered.updatedKeys).toEqual(["location", "workMode", "retrainingAppetite"]);
    p = answered.profile;

    // Done, and it stays done.
    const done = nextQuestion(p);
    expect(nextQuestion(p)).toEqual(done);
    if (done.kind !== "done") throw new Error("expected done");
    expect(isElicitationComplete(p)).toBe(true);
    expect(missingPreferences(p)).toEqual([]);
    expect(questionMarks(done.summary)).toBe(0);
    expect(done.summary).toContain("Climate interests: Energy, Carbon Removal");
    expect(done.summary).toContain(`Seniority: mid-level, 7 years ${INFERRED_TAG}`);
    expect(done.summary).toContain("Location: Portland, OR");
    expect(done.summary).not.toContain(`Location: Portland, OR ${INFERRED_TAG}`);
    expect(done.summary).toContain("2 experience cards");
  });

  it("with nothing picked the one question is on offer, and nothing else is ever asked", () => {
    const p = cardsOnly();
    expect(nextQuestion(p)).toMatchObject({ kind: "ask", key: "climateInterests" });
    expect(isElicitationComplete(p)).toBe(false);
    const picked = toggleClimateInterest(p, "Energy");
    expect(nextQuestion(picked).kind).toBe("done");
    expect(isElicitationComplete(picked)).toBe(true);
    // Done with no retraining appetite, seniority, location or work mode on file.
    expect(missingPreferences(picked).sort()).toEqual(["location", "retrainingAppetite", "seniority", "workMode"]);
  });
});

describe("policy tables", () => {
  it("asks one question: climate interests", () => {
    // technical-plan.md D54: retraining joins seniority (D48) and location and
    // work mode (D36) as preference keys nothing asks for.
    expect(ELICIT_ORDER).toEqual(["climateInterests"]);
    for (const key of ["retrainingAppetite", "seniority", "location", "workMode"] as const) {
      expect(ELICIT_ORDER).not.toContain(key);
      expect(KNOWN_PREFERENCE_KEYS).toContain(key);
    }
    expect(QUESTIONS.climateInterests).toBe(
      "Which area of climate work interests you most? Pick as many as you like.",
    );
  });

  it("the asked question can be answered by a tap alone", () => {
    // The screen has pills and no text box, so a question may not invite typing.
    for (const key of ELICIT_ORDER) {
      expect(QUESTIONS[key]).not.toMatch(/\btyp(?:e|ing)\b|tell me|describe|your own|\bwrite\b/i);
      // It sits inline on a form: no assistant voice, no instruction to tap (technical-plan.md D49).
      expect(QUESTIONS[key]).not.toMatch(/\b(?:I|I'll|I'd|me|let's)\b|\btap\b|\bbelow\b/i);
    }
  });

  it("ELICIT_ORDER lists known preference keys, each at most once", () => {
    expect(new Set(ELICIT_ORDER).size).toBe(ELICIT_ORDER.length);
    for (const key of ELICIT_ORDER) expect(KNOWN_PREFERENCE_KEYS).toContain(key);
  });

  it("the summary shows every preference, asked or not", () => {
    expect([...SUMMARY_ORDER].sort()).toEqual([...KNOWN_PREFERENCE_KEYS].sort());
  });

  it("every question is exactly one question", () => {
    for (const key of KNOWN_PREFERENCE_KEYS) expect(questionMarks(QUESTIONS[key])).toBe(1);
  });

  it("the interest pills are the six climate areas, in order, label and value the same", () => {
    const areas = [
      "Circular Economy",
      "Built Environment",
      "Transportation",
      "Energy",
      "Food & Agriculture",
      "Carbon Removal",
    ];
    expect([...CLIMATE_AREAS]).toEqual(areas);
    expect(pillsFor("climateInterests")).toEqual(areas.map((area) => ({ label: area, value: area })));
  });

  it("pillsFor returns unique, non-empty pills for every key", () => {
    for (const key of KNOWN_PREFERENCE_KEYS) {
      const pills = pillsFor(key);
      expect(pills.length).toBeGreaterThan(0);
      expect(new Set(pills.map((x) => x.label)).size).toBe(pills.length);
      expect(new Set(pills.map((x) => x.value)).size).toBe(pills.length);
      for (const pill of pills) {
        expect(pill.label.length).toBeGreaterThan(0);
        expect(pill.value.length).toBeGreaterThan(0);
      }
    }
  });

  it("system prompts are byte-stable strings with no per-call content", () => {
    expect(INFER_SYSTEM).not.toMatch(/\$\{|Portland|C1:/);
    expect(INTERPRET_SYSTEM).not.toMatch(/\$\{|Portland|C1:/);
  });
});

describe("toggleClimateInterest", () => {
  it("toggles one area on, then off", () => {
    const on = toggleClimateInterest(cardsOnly(), "Energy");
    expect(on.preferences.climateInterests).toEqual({ values: ["Energy"], source: "stated" });
    const off = toggleClimateInterest(on, "Energy");
    expect(off.preferences.climateInterests).toBeUndefined();
    expect(missingPreferences(off)).toContain("climateInterests");
  });

  it("holds several areas at once, in the order picked, and removes only the one toggled", () => {
    let p = cardsOnly();
    for (const area of ["Energy", "Carbon Removal", "Food & Agriculture"]) p = toggleClimateInterest(p, area);
    expect(p.preferences.climateInterests).toEqual({
      values: ["Energy", "Carbon Removal", "Food & Agriculture"],
      source: "stated",
    });
    p = toggleClimateInterest(p, "Carbon Removal");
    expect(p.preferences.climateInterests).toEqual({ values: ["Energy", "Food & Agriculture"], source: "stated" });
  });

  it("matches case-insensitively and writes the pill's own spelling", () => {
    const on = toggleClimateInterest(cardsOnly(), " carbon removal ");
    expect(on.preferences.climateInterests?.values).toEqual(["Carbon Removal"]);
    expect(toggleClimateInterest(on, "CARBON REMOVAL").preferences.climateInterests).toBeUndefined();
  });

  it("adding an area drops open-to-suggestions", () => {
    const open = setClimateInterests(cardsOnly(), [OPEN_TO_SUGGESTIONS], "stated");
    expect(isOpenToSuggestions(open)).toBe(true);
    const picked = toggleClimateInterest(open, "Energy");
    expect(picked.preferences.climateInterests).toEqual({ values: ["Energy"], source: "stated" });
    expect(isOpenToSuggestions(picked)).toBe(false);
  });

  it("keeps values that are not one of the six, and the result is stated", () => {
    const noted = setClimateInterests(cardsOnly(), ["regenerative agriculture"], "inferred");
    const both = toggleClimateInterest(noted, "Energy");
    expect(both.preferences.climateInterests).toEqual({
      values: ["regenerative agriculture", "Energy"],
      source: "stated",
    });
    expect(toggleClimateInterest(both, "Energy").preferences.climateInterests?.values).toEqual([
      "regenerative agriculture",
    ]);
  });

  it("is pure: the profile passed in is not changed", () => {
    const p = cardsOnly();
    toggleClimateInterest(p, "Energy");
    expect(p.preferences.climateInterests).toBeUndefined();
  });
});

describe("applyPillAnswer", () => {
  it("records a stated value", () => {
    const p = applyPillAnswer(cardsOnly(), "seniority", pillsFor("seniority")[2]);
    expect(p.preferences.seniority).toEqual({ value: "senior", source: "stated" });
  });

  it("a remote-only location also settles work mode, but never over a stated one", () => {
    const remoteOnly = pillsFor("location").find((x) => x.value === "anywhere, remote only");
    if (!remoteOnly) throw new Error("pill missing");
    const fresh = applyPillAnswer(cardsOnly(), "location", remoteOnly);
    expect(fresh.preferences.workMode).toEqual({ value: "remote", source: "stated" });

    const hybrid = applyPillAnswer(cardsOnly(), "workMode", { label: "Hybrid", value: "hybrid" });
    const kept = applyPillAnswer(hybrid, "location", remoteOnly);
    expect(kept.preferences.workMode).toEqual({ value: "hybrid", source: "stated" });
  });

  it("a click on an interest pill toggles it", () => {
    const [first] = pillsFor("climateInterests");
    const on = applyPillAnswer(cardsOnly(), "climateInterests", first);
    expect(on.preferences.climateInterests).toEqual({ values: ["Circular Economy"], source: "stated" });
    expect(applyPillAnswer(on, "climateInterests", first).preferences.climateInterests).toBeUndefined();
  });

  it("OPEN_TO_SUGGESTIONS is a known value, and open phrases normalize to it", () => {
    const p = applyPillAnswer(cardsOnly(), "climateInterests", { label: "?", value: "Not sure yet." });
    expect(p.preferences.climateInterests).toEqual({ values: [OPEN_TO_SUGGESTIONS], source: "stated" });
    expect(isOpenToSuggestions(p)).toBe(true);
    expect(missingPreferences(p)).not.toContain("climateInterests");
    const real = applyPillAnswer(cardsOnly(), "climateInterests", { label: "Energy", value: "Energy" });
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
      }),
    );
    const stated = applyPillAnswer(cardsOnly(), "workMode", { label: "Hybrid", value: "hybrid" });
    const r = await inferPreferences(llm, { sessionId: SESSION_ID, profile: stated });
    expect(llm.requests[0].step).toBe("elicit");
    expect(llm.requests[0].system).toBe(INFER_SYSTEM);
    expect(llm.requests[0].messages[0].content).toContain("### C1:");
    expect(llm.requests[0].messages[0].content).not.toContain("### C3:"); // excluded card
    expect(r.updatedKeys).toEqual(["seniority"]);
    expect(r.profile.preferences.seniority).toEqual({ value: "senior", source: "inferred" });
    expect(r.profile.preferences.location).toBeUndefined();
    expect(r.profile.preferences.workMode).toEqual({ value: "hybrid", source: "stated" });
    expect(r.inferred.map((x) => x.key)).toEqual(["seniority"]);
  });

  it("never writes climate interests, and makes no call when only they are missing (D54)", async () => {
    expect(Object.keys(InferredPreferencesSchema.shape)).not.toContain("climateInterests");
    expect(INFER_SYSTEM).not.toMatch(/climate ?interests/i);
    const some = await inferPreferences(
      fakeLlm(inference({ seniority: { value: "senior", confidence: "high", evidence: "C1" } })),
      { sessionId: SESSION_ID, profile: cardsOnly() },
    );
    expect(some.profile.preferences.climateInterests).toBeUndefined();

    let known = cardsOnly();
    for (const key of ["location", "workMode", "seniority", "retrainingAppetite"] as const) {
      known = setPreference(known, key, "x", "stated");
    }
    const llm = fakeLlm(inference());
    const r = await inferPreferences(llm, { sessionId: SESSION_ID, profile: known });
    expect(llm.requests).toHaveLength(0);
    expect(r.updatedKeys).toEqual([]);
    expect(r.profile.preferences.climateInterests).toBeUndefined();
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
      key: "retrainingAppetite",
      answer: "no idea what area yet",
    });
    expect(r.answered).toBe(false);
    expect(r.updatedKeys).toEqual(["climateInterests"]);
    expect(isOpenToSuggestions(r.profile)).toBe(true);
    expect(r.profile.preferences.retrainingAppetite).toBeUndefined();
  });
});
