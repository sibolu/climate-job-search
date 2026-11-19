import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { z } from "zod";

import { describe, expect, it } from "vitest";

import type { CallMetrics, Llm, StreamText, StructuredRequest } from "./llm";
import {
  type Profile,
  parseProfile,
  selectedRoles,
  serializeProfile,
  setQueryStatus,
  setRoleSelected,
  upsertQuery,
} from "./profile";
import { LEADING_LEVEL_MODIFIERS, LEVEL_HEADS, LEVEL_MODIFIERS } from "./discover";
import {
  ALERT_STEPS,
  BOARDS,
  type GenerateOutput,
  QUERIES_SYSTEM_PROMPT,
  QUERY_BOARDS,
  QueriesInputError,
  QueriesOutputError,
  RETIRED_KEY,
  RETIRED_REASON_KEY,
  REVISE_SYSTEM_PROMPT,
  type ReviseOutput,
  STATUS_NOTE_KEY,
  WHY_KEY,
  applyFeedback,
  applyRoleDrafts,
  buildGenerateMessage,
  buildReviseMessage,
  generateOutputSchema,
  generateQueries,
  levelPhrasesIn,
  queryKey,
  reviseQueries,
  validateRoleDrafts,
  zeroDropped,
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

/** Three selected roles in two fields: R1 and R4 on F1, R2 on F2. Q1 is R1's untried LinkedIn query. */
function engineer(): Profile {
  return parseProfile(readFileSync(FIXTURE, "utf8")).profile;
}

type Draft = ReviseOutput["add"][number];
const draft = (d: Partial<Draft>): Draft => ({ query: "x", fieldIds: ["F1"], rationale: "r", ...d });

const TEXT: Record<string, string> = {
  R1: '("mechanical engineer" OR "HVAC engineer") AND (electrification OR "heat pump")',
  R4: '("project engineer" OR "retrofit engineer") AND (electrification OR decarbonization)',
  R2: '("product engineer" OR "design engineer") AND ("heat pump" OR refrigerant)',
};
const roleOutput = (o: Record<string, string> = {}): GenerateOutput =>
  Object.fromEntries(
    Object.entries({ ...TEXT, ...o }).map(([id, query]) => [id, { query, rationale: `why-${id}` }]),
  );

describe("fixture", () => {
  it("engineer.md is canonical and has three selected roles in two fields", () => {
    const md = readFileSync(FIXTURE, "utf8");
    const parsed = parseProfile(md);
    expect(parsed.warnings).toEqual([]);
    expect(serializeProfile(parsed.profile)).toBe(md);
    expect(selectedRoles(parsed.profile).map((r) => `${r.id}/${r.fieldId}`)).toEqual(["R1/F1", "R4/F1", "R2/F2"]);
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

describe("generation prompt", () => {
  it("writes for LinkedIn only and forbids level and location words in both system prompts", () => {
    expect([...QUERY_BOARDS]).toEqual(["linkedin"]);
    for (const prompt of [QUERIES_SYSTEM_PROMPT, REVISE_SYSTEM_PROMPT]) {
      expect(prompt).toContain("No seniority or level words anywhere in a query");
      // The words come from discover.ts, the one owner of what a level word is (technical-plan.md D48).
      for (const word of [...LEVEL_MODIFIERS, ...LEADING_LEVEL_MODIFIERS, ...LEVEL_HEADS]) expect(prompt).toContain(word);
      expect(prompt).toContain("No location or work-mode wording in a query");
      expect(prompt).not.toMatch(/indeed|climatebase/i);
    }
  });

  it("renders the selected roles by field without location, work mode or the seniority preference", () => {
    const profile = setQueryStatus(engineer(), "Q1", "bad", "all agency jobs", "2026-09-12");
    const withUntried = upsertQuery(profile, {
      board: "linkedin",
      query: '"project engineer" AND electrification',
      fieldIds: ["F1"],
      roleId: "R4",
      status: "untried",
      reason: "",
      extra: {},
    });
    const message = buildGenerateMessage(withUntried, selectedRoles(withUntried));
    expect(message).toContain("- Areas of expertise: HVAC design, energy modeling");
    expect(message).toContain("- Climate interests: building electrification, heat pumps, grid flexibility");
    expect(message).toContain("## F1: Building electrification consulting and MEP design");
    expect(message).toContain("## F2: Heat pump manufacturer product engineering");
    expect(message).toContain("### R1: Senior Mechanical Engineer, electrification studies");
    expect(message).toContain("### R4: Electrification Project Engineer");
    expect(message).toContain("### R2: Senior Product Engineer, residential heat pumps");
    // F1's roles come before F2's, and the unselected R3 (and its field F3) are absent.
    expect(message.indexOf("### R4:")).toBeLessThan(message.indexOf("### R2:"));
    expect(message).not.toContain("R3");
    expect(message).not.toContain("F3");
    // The judged search and its reason, and the untried one being replaced.
    expect(message).toContain("Q1 for R1 on LinkedIn, judged bad; their reason: all agency jobs");
    expect(message).toContain('- Current untried search (you are replacing it): "project engineer" AND electrification');
    expect(message).toContain("Q4 on Climatebase, judged good");
    // Nothing that may not appear in a query is in the message.
    expect(message).not.toContain("Denver");
    expect(message).not.toMatch(/work mode|location/i);
    expect(message).not.toContain("8 years");
    expect(message).not.toMatch(/seniority/i);
    expect(message.trimEnd().endsWith("Write one LinkedIn search for each of these role ids: R1, R4, R2.")).toBe(true);
  });

  it("builds a schema that requires exactly one draft per role id", () => {
    const schema = generateOutputSchema(["R3", "R5"]);
    expect(Object.keys(schema.shape)).toEqual(["R3", "R5"]);
    const one = { query: "q", rationale: "r" };
    expect(schema.safeParse({ R3: one, R5: one }).success).toBe(true);
    expect(schema.safeParse({ R3: one }).success).toBe(false);
    expect(schema.safeParse({ R3: one, R5: { query: "q" } }).success).toBe(false);
  });

  it("levelPhrasesIn reports each query phrase that carries a level word, by discover.ts's rules", () => {
    expect(levelPhrasesIn('("Senior Mechanical Engineer" OR "lead engineer") AND "Vice President"')).toEqual([
      "senior mechanical engineer",
      "lead engineer",
      "vice president",
    ]);
    expect(levelPhrasesIn('("mechanical engineer" OR "project manager") AND (leadership OR internal OR "entry level")')).toEqual([
      "entry level",
    ]);
    // Bare words between operators are one phrase; a level word that is the job's own noun is not a level.
    expect(levelPhrasesIn('(senior analyst OR "research associate" OR "maintenance lead") AND ("lead generation" OR solar)')).toEqual([
      "senior analyst",
    ]);
    expect(levelPhrasesIn(TEXT.R1 ?? "")).toEqual([]);
  });
});

describe("generateQueries", () => {
  it("writes one LinkedIn query per selected role across fields, replacing a role's untried one in place", async () => {
    const llm = fakeLlm([roleOutput()]);
    const before = engineer();
    const result = await generateQueries({ sessionId: SESSION_ID, profile: before }, { llm });

    const request = llm.requests[0];
    expect(llm.requests).toHaveLength(1);
    expect(request?.step).toBe("queries");
    expect(request?.system).toBe(QUERIES_SYSTEM_PROMPT);
    // The schema is built from the selected role ids, in field order then role order.
    expect(Object.keys((request?.schema as ReturnType<typeof generateOutputSchema>).shape)).toEqual(["R1", "R4", "R2"]);

    expect(result.roles.map((r) => r.id)).toEqual(["R1", "R4", "R2"]);
    // Q1 was R1's untried LinkedIn query: replaced in place. R4 and R2 had none: new ids.
    expect(result.updated.map((q) => q.id)).toEqual(["Q1"]);
    expect(result.added.map((q) => q.id)).toEqual(["Q5", "Q6"]);
    expect(result.superseded).toEqual([]);
    expect(result.written.map((q) => `${q.id}/${q.roleId}/${q.fieldIds.join("+")}`)).toEqual([
      "Q1/R1/F1",
      "Q5/R4/F1",
      "Q6/R2/F2",
    ]);
    for (const q of result.written) {
      expect(q.board).toBe("linkedin");
      expect(q.status).toBe("untried");
      expect(q.reason).toBe("");
      expect(q.query).toBe(TEXT[q.roleId]);
      expect(q.extra[WHY_KEY]).toBe(`why-${q.roleId}`);
    }
    expect(result.profile.queries).toHaveLength(6);
    // Queries with no Role (written before D47) are untouched, whatever their field and status.
    for (const id of ["Q2", "Q3", "Q4"]) {
      expect(result.profile.queries.find((q) => q.id === id)).toEqual(before.queries.find((q) => q.id === id));
    }
    expect(serializeProfile(result.profile)).toContain("- **Fields:** F2\n- **Role:** R2\n- **Status:** untried");
    expect(parseProfile(serializeProfile(result.profile)).profile).toEqual(result.profile);
  });

  it("never touches a judged query: the role gets a new id beside it", async () => {
    const profile = setQueryStatus(engineer(), "Q1", "good", "three relevant consulting roles", "2026-09-12");
    const result = await generateQueries({ sessionId: SESSION_ID, profile }, { llm: fakeLlm([roleOutput()]) });
    expect(result.updated).toEqual([]);
    expect(result.added.map((q) => `${q.id}/${q.roleId}`)).toEqual(["Q5/R1", "Q6/R4", "Q7/R2"]);
    expect(result.profile.queries.find((q) => q.id === "Q1")).toEqual(profile.queries.find((q) => q.id === "Q1"));
  });

  it("retires a second untried query of the same role as superseded", async () => {
    const profile = upsertQuery(engineer(), {
      board: "linkedin",
      query: '"HVAC engineer" AND electrification',
      fieldIds: ["F1"],
      roleId: "R1",
      status: "untried",
      reason: "",
      extra: {},
    });
    const result = await generateQueries({ sessionId: SESSION_ID, profile }, { llm: fakeLlm([roleOutput()]) });
    expect(result.updated.map((q) => q.id)).toEqual(["Q1"]);
    expect(result.superseded).toEqual(["Q5"]);
    expect(result.added.map((q) => `${q.id}/${q.roleId}`)).toEqual(["Q6/R4", "Q7/R2"]);
    const q5 = result.profile.queries.find((q) => q.id === "Q5");
    expect(q5?.status).toBe("untried");
    expect(q5?.extra[RETIRED_KEY]).toBe("yes");
    expect(q5?.extra[RETIRED_REASON_KEY]).toBe("Superseded by Q1");
  });

  it("leaves the queries of a role that is no longer selected alone", async () => {
    const profile = setRoleSelected(engineer(), "R1", false);
    const llm = fakeLlm([roleOutput()]);
    const result = await generateQueries({ sessionId: SESSION_ID, profile }, { llm });
    expect(String(llm.requests[0]?.messages[0]?.content)).not.toContain("### R1:");
    expect(result.written.map((q) => `${q.id}/${q.roleId}`)).toEqual(["Q5/R4", "Q6/R2"]);
    expect(result.profile.queries.find((q) => q.id === "Q1")).toEqual(profile.queries.find((q) => q.id === "Q1"));
  });

  it("fails typed, with role ids and counters only, when a draft is empty or repeats a judged query", async () => {
    const profile = setQueryStatus(engineer(), "Q1", "bad", "all agency jobs", "2026-09-12");
    const judgedText = profile.queries[0]?.query ?? "";
    const llm = fakeLlm([roleOutput({ R4: `  ${judgedText.toUpperCase()}  `, R2: "  " })]);
    const error = await generateQueries({ sessionId: SESSION_ID, profile }, { llm }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueriesOutputError);
    if (error instanceof QueriesOutputError) {
      expect(error.missingRoles).toEqual(["R4", "R2"]);
      expect(error.dropped.judgedQueries).toBe(1);
      expect(error.dropped.emptyQuery).toBe(1);
      expect(error.message).toBe("No usable query came back for R4, R2.");
    }
    // A role the answer does not mention at all is missing too.
    expect(() => validateRoleDrafts({ R1: { query: "q", rationale: "" } }, engineer(), selectedRoles(engineer()), zeroDropped())).toThrow(
      QueriesOutputError,
    );
  });

  it("does not fail when two roles come back with the same text", async () => {
    const same = '"engineer" AND electrification';
    const result = await generateQueries(
      { sessionId: SESSION_ID, profile: engineer() },
      { llm: fakeLlm([roleOutput({ R1: same, R4: same })]) },
    );
    expect(result.written.map((q) => q.query)).toEqual([same, same, TEXT.R2]);
    expect(result.written.map((q) => q.roleId)).toEqual(["R1", "R4", "R2"]);
  });

  it("refuses before calling the model when no role is selected", async () => {
    const llm = fakeLlm([]);
    const none = ["R1", "R4", "R2"].reduce((p, id) => setRoleSelected(p, id, false), engineer());
    await expect(generateQueries({ sessionId: SESSION_ID, profile: none }, { llm })).rejects.toBeInstanceOf(QueriesInputError);
    expect(llm.requests).toHaveLength(0);
  });

  it("applyRoleDrafts is pure and keeps a role with no field unfielded", () => {
    const before = engineer();
    const result = applyRoleDrafts(before, [{ roleId: "R9", fieldId: "", query: "q", rationale: "" }]);
    expect(before.queries).toHaveLength(4);
    expect(result.written[0]).toMatchObject({ id: "Q5", roleId: "R9", fieldIds: [], board: "linkedin" });
    expect(result.written[0]?.extra[WHY_KEY]).toBeUndefined();
  });
});

describe("reviseQueries", () => {
  const feedback = { queryId: "Q1", verdict: "bad", reason: "bad fit: all roles need PE license" } as const;
  const output: ReviseOutput = {
    explanation:
      "You found Q1 a bad fit because all the roles need a PE license. I retired Q2 (same F1 consulting roles), narrowed Q3 to exclude licensed roles, replaced Q1 with a query that rules out PE requirements, and added a query for F2 and F3. F1 is now unsure.",
    retire: [
      { id: "Q2", reason: "Same F1 consulting roles; PE licence required" },
      { id: "Q1", reason: "already judged" },
      { id: "Q4", reason: "good query; must not retire" },
      { id: "Q99", reason: "unknown" },
    ],
    narrow: [
      { id: "Q3", query: '"product engineer" AND "heat pump" AND NOT "PE license"' },
      // Q1 is judged: this narrow becomes an add under a new id that keeps Q1's role.
      { id: "Q1", query: '"mechanical engineer" AND "heat pump" AND NOT ("PE license" OR "professional engineer")' },
    ],
    add: [
      draft({
        query: '"energy engineer" AND "heat pump" AND NOT "PE license"',
        fieldIds: ["F2", "F3"],
        rationale: "F2 and F3 without licensure",
      }),
      draft({ query: '"commissioning engineer" AND electrification', fieldIds: ["F1"], rationale: "F1 sibling" }),
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
    const content = String(llm.requests[0]?.messages[0]?.content);
    expect(content).toContain(feedback.reason);
    expect(content).toContain("Q1 [linkedin] role R1; fields F1");
    expect(content).not.toMatch(/seniority/i);

    // The user's verdict, applied before the model ran.
    expect(byId("Q1")).toMatchObject({ status: "bad", reason: feedback.reason, changedAt: "2026-09-12", roleId: "R1" });
    expect(byId("Q1")?.query).toBe(engineer().queries[0]?.query);

    // Retire: only the untried Q2; Q1 (the feedback) is skipped, Q4 (good) protected, Q99 unknown.
    expect(result.retired).toEqual(["Q2"]);
    expect(byId("Q2")?.extra[RETIRED_KEY]).toBe("yes");
    expect(byId("Q2")?.extra[RETIRED_REASON_KEY]).toBe("Same F1 consulting roles; PE licence required");
    expect(byId("Q2")?.status).toBe("untried");
    expect(byId("Q4")).toEqual(engineer().queries[3]);

    // Narrow: Q3 in place; the Q1 narrow became Q5, a LinkedIn query with Q1's fields and role.
    expect(result.narrowed).toEqual(["Q3"]);
    expect(byId("Q3")?.query).toBe('"product engineer" AND "heat pump" AND NOT "PE license"');
    expect(result.added.map((q) => q.id)).toEqual(["Q5", "Q6", "Q7"]);
    expect(byId("Q5")).toMatchObject({ board: "linkedin", fieldIds: ["F1"], roleId: "R1", status: "untried" });
    expect(byId("Q5")?.extra[WHY_KEY]).toBe("Narrowed from Q1");
    // Every added query is on LinkedIn. One that serves no field of Q1 names no role;
    // one that serves Q1's field stands in for it and takes its role.
    expect(byId("Q6")).toMatchObject({ board: "linkedin", fieldIds: ["F2", "F3"], roleId: "" });
    expect(byId("Q7")).toMatchObject({ board: "linkedin", fieldIds: ["F1"], roleId: "R1" });
    expect(p.queries).toHaveLength(7);

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
