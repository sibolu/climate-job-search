import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { z } from "zod";

import { describe, expect, it } from "vitest";

import type { CallMetrics, Llm, StreamText, StructuredRequest } from "./llm";
import { type Profile, emptyProfile, parseProfile, serializeProfile } from "./profile";
import {
  ALERT_STEPS,
  BOARDS,
  BOARD_NAME_KEY,
  type GenerateOutput,
  MAX_QUERIES_PER_BOARD,
  QueriesInputError,
  RETIRED_KEY,
  RETIRED_REASON_KEY,
  type ReviseOutput,
  STATUS_NOTE_KEY,
  WHY_KEY,
  applyFeedback,
  buildReviseMessage,
  generateQueries,
  queryKey,
  reviseQueries,
} from "./queries";

const METRICS: CallMetrics = {
  usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0.001,
  durationMs: 5,
  continuations: 0,
  stopReason: "end_turn",
};

interface FakeLlm extends Llm {
  requests: StructuredRequest<z.ZodType>[];
}

function fakeLlm(values: readonly unknown[]): FakeLlm {
  const requests: StructuredRequest<z.ZodType>[] = [];
  let i = 0;
  return {
    requests,
    streamText(): StreamText {
      throw new Error("queries must not stream");
    },
    structured<S extends z.ZodType>(request: StructuredRequest<S>) {
      requests.push(request as unknown as StructuredRequest<z.ZodType>);
      const value = values[Math.min(i, values.length - 1)];
      i += 1;
      return Promise.resolve({ value: value as z.infer<S>, message: {} as never, messages: [], ...METRICS });
    },
  };
}

const SESSION_ID = "a".repeat(32);
const FIXTURE = join(__dirname, "__fixtures__", "queries", "engineer.md");

function engineer(): Profile {
  return parseProfile(readFileSync(FIXTURE, "utf8")).profile;
}

type Draft = GenerateOutput["queries"][number];
const draft = (d: Partial<Draft>): Draft => ({
  board: "linkedin",
  query: "x",
  fieldIds: ["F1"],
  boardName: null,
  rationale: "r",
  ...d,
});

describe("fixture", () => {
  it("engineer.md is canonical", () => {
    const md = readFileSync(FIXTURE, "utf8");
    const parsed = parseProfile(md);
    expect(parsed.warnings).toEqual([]);
    expect(serializeProfile(parsed.profile)).toBe(md);
  });
});

describe("ALERT_STEPS", () => {
  it("has non-empty plain-text steps for every board", () => {
    for (const board of BOARDS) {
      expect(ALERT_STEPS[board].length).toBeGreaterThan(0);
      for (const step of ALERT_STEPS[board]) expect(step.trim()).not.toBe("");
    }
  });
});

describe("generateQueries", () => {
  const output: GenerateOutput = {
    queries: [
      // Same key as the untried Q1 (whitespace and case differ): updated, not duplicated.
      draft({ query: '  "Mechanical Engineer" AND (electrification OR "heat pump")   AND (decarbonization OR MEP) ' }),
      // F9 is unknown and dropped; the draft survives on F2.
      draft({ query: '"senior engineer" AND "heat pump" AND NOT "PE required"', fieldIds: ["F2", "F9"] }),
      draft({ board: "indeed", query: '"retro-commissioning" engineer', fieldIds: ["F3"] }),
      // F4 is a candidate: not eligible, so unfielded.
      draft({ board: "indeed", query: "utility dsm engineer", fieldIds: ["F4"] }),
      // "other" without a board name.
      draft({ board: "other", query: "heat pump engineer", fieldIds: ["F2"] }),
      draft({ board: "other", query: "heat pump engineer", fieldIds: ["F2"], boardName: "Google Jobs" }),
      // Matches the good Q4: never overwritten.
      draft({ board: "climatebase", query: "Heat Pump Product Engineer", fieldIds: ["F2"] }),
      // Duplicate of an earlier draft.
      draft({ board: "indeed", query: '"retro-commissioning"   ENGINEER', fieldIds: ["F3"] }),
      draft({ query: "" }),
    ],
  };

  it("upserts by (board, normalized query), adds the rest, and counts every drop", async () => {
    const llm = fakeLlm([output]);
    const result = await generateQueries({ sessionId: SESSION_ID, profile: engineer() }, { llm });

    expect(llm.requests[0]?.step).toBe("queries");
    expect(result.updated.map((q) => q.id)).toEqual(["Q1"]);
    expect(result.added.map((q) => q.id)).toEqual(["Q5", "Q6", "Q7"]);
    expect(result.profile.queries).toHaveLength(7);
    expect(result.dropped).toEqual({
      emptyQuery: 1,
      unfielded: 1,
      unnamedBoard: 1,
      duplicate: 1,
      surplus: 0,
      judgedQueries: 1,
      unknownQueryIds: 0,
      unknownFieldIds: 1,
      fieldsProtected: 0,
    });

    const q1 = result.profile.queries.find((q) => q.id === "Q1");
    expect(q1?.query).toBe('"Mechanical Engineer" AND (electrification OR "heat pump") AND (decarbonization OR MEP)');
    expect(q1?.status).toBe("untried");
    expect(q1?.extra[WHY_KEY]).toBe("r");
    expect(result.profile.queries.find((q) => q.id === "Q5")?.fieldIds).toEqual(["F2"]);
    expect(result.profile.queries.find((q) => q.id === "Q7")?.extra[BOARD_NAME_KEY]).toBe("Google Jobs");
    expect(result.profile.queries.find((q) => q.id === "Q4")?.status).toBe("good");
    // Round-trips through the contract.
    expect(parseProfile(serializeProfile(result.profile)).profile).toEqual(result.profile);
  });

  it("caps queries per board and counts the surplus", async () => {
    const many = Array.from({ length: MAX_QUERIES_PER_BOARD + 2 }, (_, i) =>
      draft({ query: `"heat pump" AND term${i}`, fieldIds: ["F2"] }),
    );
    const result = await generateQueries(
      { sessionId: SESSION_ID, profile: engineer() },
      { llm: fakeLlm([{ queries: many }]) },
    );
    expect(result.added).toHaveLength(MAX_QUERIES_PER_BOARD);
    expect(result.dropped.surplus).toBe(2);
  });

  it("refuses a profile with no accepted or unsure field", async () => {
    await expect(
      generateQueries({ sessionId: SESSION_ID, profile: emptyProfile() }, { llm: fakeLlm([]) }),
    ).rejects.toBeInstanceOf(QueriesInputError);
  });
});

describe("reviseQueries", () => {
  const feedback = { queryId: "Q1", verdict: "bad", reason: "bad fit: all roles need PE license" } as const;
  const output: ReviseOutput = {
    explanation:
      "You found Q1 a bad fit because all the roles need a PE license. I retired Q2 (same F1 consulting roles), narrowed Q3 to exclude licensed roles, replaced Q1 with a query that rules out PE requirements, and added an Indeed query for F2 and F3. F1 is now unsure.",
    retire: [
      { id: "Q2", reason: "Same F1 consulting roles; PE licence required" },
      { id: "Q1", reason: "already judged" },
      { id: "Q4", reason: "good query; must not retire" },
      { id: "Q99", reason: "unknown" },
    ],
    narrow: [
      { id: "Q3", query: '"product engineer" "heat pump" refrigerant -"PE license"' },
      // Q1 is judged: this narrow becomes an add under a new id.
      { id: "Q1", query: '"mechanical engineer" AND "heat pump" AND NOT ("PE license" OR "professional engineer")' },
    ],
    add: [
      draft({
        board: "indeed",
        query: '"energy engineer" "heat pump" -"PE license"',
        fieldIds: ["F2", "F3"],
        rationale: "F2 and F3 without licensure",
      }),
    ],
    fieldStatus: [
      { id: "F1", status: "unsure", reason: "PE license required for senior design roles" },
      { id: "F2", status: "rejected", reason: "accepted may never be rejected" },
      { id: "F4", status: "unsure", reason: "candidate may move" },
      { id: "F5", status: "candidate", reason: "rejected is protected" },
      { id: "F3", status: "unsure", reason: "no-op" },
      { id: "F42", status: "unsure", reason: "unknown" },
    ],
    notes: "User will not pursue a PE license; steer away from stamped-design roles.",
    preferenceEdits: [{ key: "retrainingAppetite", value: "short courses only; no PE license" }],
  };

  it("applies 'bad fit: all roles need PE license': verdict lands, queries retire/narrow, explanation returned", async () => {
    const llm = fakeLlm([output]);
    const result = await reviseQueries(
      { sessionId: SESSION_ID, profile: engineer(), feedback },
      { llm, changedAt: "2026-09-12" },
    );
    const p = result.profile;
    const byId = (id: string) => p.queries.find((q) => q.id === id);

    expect(llm.requests[0]?.step).toBe("revise");
    expect(String(llm.requests[0]?.messages[0]?.content)).toContain(feedback.reason);

    // The user's verdict, applied before the model ran.
    expect(byId("Q1")).toMatchObject({ status: "bad", reason: feedback.reason, changedAt: "2026-09-12" });
    expect(byId("Q1")?.query).toBe(engineer().queries[0]?.query);

    // Retire: only the untried Q2; Q1 (the feedback) is skipped, Q4 (good) protected, Q99 unknown.
    expect(result.retired).toEqual(["Q2"]);
    expect(byId("Q2")?.extra[RETIRED_KEY]).toBe("yes");
    expect(byId("Q2")?.extra[RETIRED_REASON_KEY]).toBe("Same F1 consulting roles; PE licence required");
    expect(byId("Q2")?.status).toBe("untried");
    expect(byId("Q4")).toEqual(engineer().queries[3]);

    // Narrow: Q3 in place; the Q1 narrow became Q5 on the same board and fields.
    expect(result.narrowed).toEqual(["Q3"]);
    expect(byId("Q3")?.query).toBe('"product engineer" "heat pump" refrigerant -"PE license"');
    expect(result.added.map((q) => q.id)).toEqual(["Q5", "Q6"]);
    expect(byId("Q5")).toMatchObject({ board: "linkedin", fieldIds: ["F1"], status: "untried" });
    expect(byId("Q5")?.extra[WHY_KEY]).toBe("Narrowed from Q1");
    expect(byId("Q6")).toMatchObject({ board: "indeed", fieldIds: ["F2", "F3"] });
    expect(p.queries).toHaveLength(6);

    // Field statuses under the rule.
    expect(result.fieldChanges).toEqual([
      { id: "F1", from: "accepted", to: "unsure" },
      { id: "F4", from: "candidate", to: "unsure" },
    ]);
    expect(p.fields.find((f) => f.id === "F1")?.extra[STATUS_NOTE_KEY]).toBe(
      "PE license required for senior design roles",
    );
    expect(p.fields.find((f) => f.id === "F2")?.status).toBe("accepted");
    expect(p.fields.find((f) => f.id === "F5")?.status).toBe("rejected");

    expect(result.dropped).toMatchObject({
      judgedQueries: 1,
      unknownQueryIds: 1,
      fieldsProtected: 2,
      unknownFieldIds: 1,
    });
    expect(result.explanation).toBe(output.explanation);
    expect(p.sessionNotes).toBe(
      "Discussed F1 and F2. User does not want to pursue a PE license.\n\nUser will not pursue a PE license; steer away from stamped-design roles.",
    );
    expect(p.preferences.retrainingAppetite).toEqual({ value: "short courses only; no PE license", source: "inferred" });
    expect(parseProfile(serializeProfile(p)).profile).toEqual(p);
  });

  it("refuses unknown query ids before calling the model", async () => {
    const llm = fakeLlm([output]);
    await expect(
      reviseQueries({ sessionId: SESSION_ID, profile: engineer(), feedback: { ...feedback, queryId: "Q9" } }, { llm }),
    ).rejects.toBeInstanceOf(QueriesInputError);
    expect(llm.requests).toHaveLength(0);
    expect(() => applyFeedback(engineer(), { ...feedback, queryId: "Q9" })).toThrow(QueriesInputError);
  });

  it("applyFeedback is pure and records the verdict with the user's words", () => {
    const before = engineer();
    const after = applyFeedback(before, { ...feedback, verdict: "good" }, "2026-09-12");
    expect(before.queries[0]?.status).toBe("untried");
    expect(after.queries[0]).toMatchObject({ status: "good", reason: feedback.reason, changedAt: "2026-09-12" });
    expect(buildReviseMessage(after, feedback)).toContain("Verdict: bad");
  });

  it("queryKey ignores case and whitespace but not the board", () => {
    expect(queryKey("linkedin", '  "Heat   Pump" AND x ')).toBe(queryKey("linkedin", '"heat pump" and x'));
    expect(queryKey("linkedin", "x")).not.toBe(queryKey("indeed", "x"));
  });
});
