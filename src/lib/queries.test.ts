import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { z } from "zod";

import { describe, expect, it } from "vitest";

import type { CallMetrics, Llm, StreamText, StructuredRequest } from "./llm";
import { type Profile, parseProfile, serializeProfile, setRoleSelected, upsertQuery } from "./profile";
import {
  ALERT_STEPS,
  BOARDS,
  type GenerateOutput,
  QUERY_BOARDS,
  QueriesInputError,
  QueriesOutputError,
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

type Draft = ReviseOutput["add"][number];
const draft = (d: Partial<Draft>): Draft => ({
  board: "linkedin",
  query: "x",
  fieldIds: ["F1"],
  boardName: null,
  rationale: "r",
  ...d,
});

const fieldOutput = (o: Partial<Record<(typeof QUERY_BOARDS)[number], string>> = {}): GenerateOutput => ({
  linkedin: { query: o.linkedin ?? '"mechanical engineer" AND electrification', rationale: "r-li" },
  indeed: { query: o.indeed ?? '"mechanical engineer" electrification', rationale: "r-in" },
  climatebase: { query: o.climatebase ?? "electrification engineer", rationale: "r-cb" },
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
  it("writes exactly one query per board for the field, replacing its untried ones in place", async () => {
    const llm = fakeLlm([fieldOutput()]);
    const result = await generateQueries({ sessionId: SESSION_ID, profile: engineer(), fieldId: "F1" }, { llm });

    const request = llm.requests[0];
    expect(request?.step).toBe("queries");
    const content = request?.messages[0]?.content;
    // The ticked roles go to the prompt; the unticked one (R2, on F2) does not.
    expect(content).toContain("R1: ");
    expect(content).toContain("R4: ");
    expect(content).not.toContain("R2: ");
    expect(content).toContain("Mark: Interesting");
    expect(content).toContain("F1: Building electrification");

    // Q1 (linkedin) and Q2 (indeed) were untried on F1: replaced in place; climatebase is new.
    expect(result.updated.map((q) => q.id)).toEqual(["Q1", "Q2"]);
    expect(result.added.map((q) => q.id)).toEqual(["Q5"]);
    expect(result.superseded).toEqual([]);
    const written = [...result.updated, ...result.added];
    expect(written.map((q) => q.board)).toEqual([...QUERY_BOARDS]);
    for (const q of written) {
      expect(q.fieldIds).toEqual(["F1"]);
      expect(q.status).toBe("untried");
      expect(q.reason).toBe("");
    }
    expect(result.profile.queries.find((q) => q.id === "Q1")?.query).toBe('"mechanical engineer" AND electrification');
    expect(result.profile.queries.find((q) => q.id === "Q1")?.extra[WHY_KEY]).toBe("r-li");
    expect(result.profile.queries).toHaveLength(5);
    // Other fields' queries are untouched.
    expect(result.profile.queries.find((q) => q.id === "Q3")?.query).toBe('"product engineer" "heat pump" refrigerant');
    expect(parseProfile(serializeProfile(result.profile)).profile).toEqual(result.profile);
  });

  it("keeps a judged query on the field untouched and adds beside it", async () => {
    const profile = setRoleSelected(engineer(), "R2", true);
    const result = await generateQueries(
      { sessionId: SESSION_ID, profile, fieldId: "F2" },
      { llm: fakeLlm([fieldOutput({ climatebase: "heat pump design engineer" })]) },
    );
    // Q3 (indeed, untried) replaced; Q4 (climatebase, good) survives; linkedin and climatebase added.
    expect(result.updated.map((q) => q.id)).toEqual(["Q3"]);
    expect(result.added.map((q) => `${q.id}/${q.board}`)).toEqual(["Q5/linkedin", "Q6/climatebase"]);
    const q4 = result.profile.queries.find((q) => q.id === "Q4");
    expect(q4?.status).toBe("good");
    expect(q4?.query).toBe("heat pump product engineer");
  });

  it("retires a second untried query on the same field and board as superseded", async () => {
    const profile = upsertQuery(engineer(), {
      board: "linkedin",
      query: '"HVAC engineer" AND electrification',
      fieldIds: ["F1"],
      status: "untried",
      reason: "",
      extra: {},
    });
    const result = await generateQueries({ sessionId: SESSION_ID, profile, fieldId: "F1" }, { llm: fakeLlm([fieldOutput()]) });
    expect(result.updated.map((q) => q.id)).toEqual(["Q1", "Q2"]);
    expect(result.superseded).toEqual(["Q5"]);
    const q5 = result.profile.queries.find((q) => q.id === "Q5");
    expect(q5?.status).toBe("untried");
    expect(q5?.extra[RETIRED_KEY]).toBe("yes");
    expect(q5?.extra[RETIRED_REASON_KEY]).toBe("Superseded by Q1");
  });

  it("fails typed, with counters only, when a draft repeats a judged query or is empty", async () => {
    const profile = setRoleSelected(engineer(), "R2", true);
    const llm = fakeLlm([fieldOutput({ climatebase: "Heat Pump  Product Engineer", indeed: "  " })]);
    const error = await generateQueries({ sessionId: SESSION_ID, profile, fieldId: "F2" }, { llm }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueriesOutputError);
    if (error instanceof QueriesOutputError) {
      expect(error.missingBoards).toEqual(["indeed", "climatebase"]);
      expect(error.dropped.judgedQueries).toBe(1);
      expect(error.dropped.emptyQuery).toBe(1);
      expect(error.message).not.toContain("Heat Pump");
    }
  });

  it("refuses a missing, rejected or untouched field before calling the model", async () => {
    const llm = fakeLlm([]);
    for (const fieldId of ["F9", "F5", "F3"]) {
      await expect(generateQueries({ sessionId: SESSION_ID, profile: engineer(), fieldId }, { llm })).rejects.toBeInstanceOf(
        QueriesInputError,
      );
    }
    expect(llm.requests).toHaveLength(0);
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
