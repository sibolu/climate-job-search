import { describe, expect, it } from "vitest";

import type { Card, Field, Profile, Query } from "./profile";
import { activeCards, emptyProfile, parseProfile, serializeProfile } from "./profile";
import type { QueryFeedback } from "./session";
import {
  buildTurnRequest,
  clearSession,
  exportSession,
  importSession,
  loadSession,
  memoryStore,
  newSessionState,
  saveSession,
  startOver,
  type SessionState,
} from "./session";
import {
  appendUserMessage,
  applyQueryFeedback,
  applyTurnResponse,
  canGenerateQueries,
  confirmProfileSkill,
  EXPORT_FILENAME,
  exploreChatText,
  feedbackChatText,
  GENERATE_QUERIES_TEXT,
  MAX_FEEDBACK_REASON,
  nextStep,
  normalizeFeedbackReason,
  profileView,
  rejectProfileSkill,
  rolesForField,
  setProfileFieldStatus,
  toggleCardExcluded,
  unassignedRoles,
  updateProfile,
} from "./workspace";

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    title: `Card ${id}`,
    situation: "A small team needed a data pipeline.",
    actions: "Built it in Python.",
    results: "Cut reporting time in half.",
    skills: ["Python", "data pipelines"],
    excluded: false,
    extra: {},
    ...overrides,
  };
}

function field(id: string): Field {
  return {
    id,
    name: "Grid software",
    status: "candidate",
    explored: false,
    fit: "Your pipeline work in C1 transfers directly.",
    uncertain: "Unclear how much power-systems depth is expected.",
    sources: ["https://example.org/grid"],
    extra: {},
  };
}

function withAllPreferences(p: Profile): Profile {
  return {
    ...p,
    preferences: {
      location: { value: "Berlin", source: "stated" },
      workMode: { value: "hybrid", source: "stated" },
      seniority: { value: "mid", source: "stated" },
      retrainingAppetite: { value: "short courses", source: "stated" },
      climateInterests: { values: ["grid"], source: "stated" },
      other: [],
    },
  };
}

function stateWith(profile: Profile): SessionState {
  return { ...newSessionState(), profileMd: serializeProfile(profile) };
}

describe("nextStep", () => {
  const ready = withAllPreferences({ ...emptyProfile(), cards: [card("C1")] });

  it("routes pasted text to cards even when the profile is complete", () => {
    expect(nextStep({ ...ready, fields: [field("F1")] }, { source: "paste" })).toBe("cards");
  });

  it("routes to cards while there are no active cards", () => {
    expect(nextStep(emptyProfile(), { source: "chat" })).toBe("cards");
    const excludedOnly = { ...ready, cards: [card("C1", { excluded: true })] };
    expect(activeCards(excludedOnly)).toHaveLength(0);
    expect(nextStep(excludedOnly, { source: "chat" })).toBe("cards");
  });

  it("routes to elicit while preferences are missing", () => {
    expect(nextStep({ ...emptyProfile(), cards: [card("C1")] }, { source: "chat" })).toBe("elicit");
  });

  it("routes to discover once preferences are complete and no fields exist", () => {
    expect(nextStep(ready, { source: "chat" })).toBe("discover");
  });

  it("routes to explore once fields exist", () => {
    expect(nextStep({ ...ready, fields: [field("F1")] }, { source: "chat" })).toBe("explore");
  });
});

describe("profile edits through session state", () => {
  const base = stateWith({
    ...emptyProfile(),
    cards: [card("C1"), card("C2")],
    skills: { confirmed: [], inferred: ["Python", "stakeholder comms"], excluded: [], extra: {} },
  });

  it("excludes and re-includes a card without deleting it", () => {
    const excluded = toggleCardExcluded(base, "C1", true);
    expect(profileView(excluded).profile.cards).toHaveLength(2);
    expect(activeCards(profileView(excluded).profile).map((c) => c.id)).toEqual(["C2"]);
    const restored = toggleCardExcluded(excluded, "C1", false);
    expect(activeCards(profileView(restored).profile)).toHaveLength(2);
  });

  it("confirms and rejects inferred skills", () => {
    const confirmed = profileView(confirmProfileSkill(base, "Python")).profile.skills;
    expect(confirmed.confirmed).toContain("Python");
    expect(confirmed.inferred).not.toContain("Python");

    const rejected = profileView(rejectProfileSkill(base, "stakeholder comms")).profile.skills;
    expect(rejected.excluded).toContain("stakeholder comms");
    expect(rejected.inferred).not.toContain("stakeholder comms");
  });

  it("keeps the stored markdown canonical after an edit", () => {
    const edited = updateProfile(base, (p) => p);
    expect(serializeProfile(parseProfile(edited.profileMd).profile)).toBe(edited.profileMd);
  });

  it("surfaces parser warnings rather than discarding them", () => {
    const broken: SessionState = { ...newSessionState(), profileMd: "## Experience Cards\n\n- no card here\n" };
    expect(profileView(broken).warnings.length).toBeGreaterThan(0);
  });
});

describe("turn bookkeeping", () => {
  it("appends the user message and then the assistant answer", () => {
    const afterUser = appendUserMessage(newSessionState(), "here is my resume");
    const afterTurn = applyTurnResponse(afterUser, {
      message: "I made three cards.",
      profileMd: serializeProfile({ ...emptyProfile(), cards: [card("C1")] }),
      pills: [{ label: "Looks right", value: "looks right" }],
    });
    expect(afterTurn.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(afterTurn.messages[1]?.pills).toHaveLength(1);
    expect(profileView(afterTurn).profile.cards).toHaveLength(1);
  });

  it("leaves the profile untouched when the turn returns none", () => {
    const before = stateWith({ ...emptyProfile(), cards: [card("C1")] });
    const after = applyTurnResponse(before, { message: "Tell me more." });
    expect(after.profileMd).toBe(before.profileMd);
    expect(after.messages[0]?.pills).toBeUndefined();
  });
});

describe("acceptance: reload, export round-trip, start over", () => {
  const store = () => memoryStore();

  function busyState(): SessionState {
    const withProfile = stateWith({ ...emptyProfile(), cards: [card("C1")] });
    return applyTurnResponse(appendUserMessage(withProfile, "hello"), { message: "hi there" });
  }

  it("restores the same state after a reload", () => {
    const s = store();
    const state = busyState();
    saveSession(state, s);
    expect(loadSession(s)).toEqual(state);
  });

  it("round-trips through the exported file", () => {
    const state = busyState();
    const imported = importSession(exportSession(state));
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.value).toEqual(state);
    expect(EXPORT_FILENAME).toBe("profile-session.json");
  });

  it("reports an unreadable import instead of throwing", () => {
    const result = importSession("not json at all");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("clears everything on start over", () => {
    const s = store();
    saveSession(busyState(), s);
    const fresh = startOver();
    clearSession(s);
    expect(fresh.messages).toEqual([]);
    expect(fresh.profileMd).toBe("");
    const reloaded = loadSession(s);
    expect(reloaded.messages).toEqual([]);
    expect(reloaded.profileMd).toBe("");
    saveSession(fresh, s);
    expect(loadSession(s)).toEqual(fresh);
  });
});

// ---------------------------------------------------------------------------
// Fields and Queries tabs (step 2.4)
// ---------------------------------------------------------------------------

function query(id: string, overrides: Partial<Query> = {}): Query {
  return {
    id,
    board: "linkedin",
    query: '"grid software" AND (engineer OR developer)',
    fieldIds: ["F1"],
    status: "untried",
    reason: "",
    extra: {},
    ...overrides,
  };
}

describe("nextStep for the tab buttons", () => {
  const ready = withAllPreferences({ ...emptyProfile(), cards: [card("C1")] });

  it("routes each button source to its own step regardless of the profile", () => {
    expect(nextStep(emptyProfile(), { source: "explore" })).toBe("explore");
    expect(nextStep(emptyProfile(), { source: "queries" })).toBe("queries");
    expect(nextStep(emptyProfile(), { source: "feedback" })).toBe("revise");
    expect(nextStep({ ...ready, fields: [field("F1")] }, { source: "feedback" })).toBe("revise");
  });
});

describe("fields tab helpers", () => {
  const profile: Profile = {
    ...emptyProfile(),
    fields: [field("F1"), { ...field("F2"), name: "Heat pumps" }],
    roles: [
      {
        id: "R1",
        title: "Grid engineer",
        fieldId: "F1",
        companies: ["Acme"],
        why: "",
        sources: [],
        extra: {},
      },
      {
        id: "R2",
        title: "Installer lead",
        fieldId: "F9",
        companies: [],
        why: "",
        sources: [],
        extra: {},
      },
    ],
  };

  it("sets a field status without touching the rest of the profile", () => {
    const next = setProfileFieldStatus(stateWith(profile), "F1", "accepted");
    const parsed = parseProfile(next.profileMd).profile;
    expect(parsed.fields.map((f) => f.status)).toEqual(["accepted", "candidate"]);
    expect(parsed.fields).toHaveLength(2);
  });

  it("groups roles under their field and keeps the orphans visible", () => {
    expect(rolesForField(profile, "F1").map((r) => r.id)).toEqual(["R1"]);
    expect(rolesForField(profile, "F2")).toEqual([]);
    expect(unassignedRoles(profile).map((r) => r.id)).toEqual(["R2"]);
  });

  it("builds the explore message the server parses the field id out of", () => {
    expect(exploreChatText(field("F1"))).toBe("Explore F1: Grid software");
  });

  it("offers query generation only once a field is accepted or unsure", () => {
    expect(canGenerateQueries(profile)).toBe(false);
    const withStatus = (status: Field["status"]) => ({
      ...profile,
      fields: [{ ...field("F1"), status }],
    });
    expect(canGenerateQueries(withStatus("rejected"))).toBe(false);
    expect(canGenerateQueries(withStatus("unsure"))).toBe(true);
    expect(canGenerateQueries(withStatus("accepted"))).toBe(true);
  });
});

describe("query feedback", () => {
  const profile: Profile = {
    ...emptyProfile(),
    fields: [{ ...field("F1"), status: "accepted" }],
    queries: [query("Q1"), query("Q2", { board: "other" })],
  };
  const feedback: QueryFeedback = {
    queryId: "Q1",
    verdict: "bad",
    reason: "  Mostly senior roles in the wrong country.  ",
  };

  // The Phase 2.4 acceptance check: feedback on a query changes the profile
  // text and triggers a revision turn.
  it("writes the verdict and the reason into the profile text", () => {
    const next = applyQueryFeedback(stateWith(profile), feedback);
    expect(next.profileMd).toContain("Mostly senior roles in the wrong country.");
    const parsed = parseProfile(next.profileMd).profile;
    const q1 = parsed.queries.find((q) => q.id === "Q1");
    expect(q1?.status).toBe("bad");
    expect(q1?.reason).toBe("Mostly senior roles in the wrong country.");
    expect(q1?.changedAt).toBeDefined();
    // The other query is untouched and nothing is ever deleted.
    expect(parsed.queries.map((q) => q.id)).toEqual(["Q1", "Q2"]);
    expect(parsed.queries[1]?.status).toBe("untried");
  });

  it("builds a revision turn carrying the feedback", () => {
    const next = applyQueryFeedback(stateWith(profile), feedback);
    const step = nextStep(parseProfile(next.profileMd).profile, { source: "feedback" });
    const request = buildTurnRequest(next, step, { kind: "feedback", feedback });
    expect(request.step).toBe("revise");
    expect(request.input.kind).toBe("feedback");
    if (request.input.kind === "feedback") {
      expect(request.input.feedback.queryId).toBe("Q1");
      expect(request.input.feedback.verdict).toBe("bad");
    }
    // The revision turn resends the already-updated profile text.
    expect(request.profileMd).toBe(next.profileMd);
  });

  it("shows the verdict in the chat bubble, with the reason when there is one", () => {
    expect(feedbackChatText(feedback, "LinkedIn")).toBe(
      "Tried Q1 on LinkedIn: bad fit — Mostly senior roles in the wrong country.",
    );
    const good: QueryFeedback = { queryId: "Q2", verdict: "good", reason: "   " };
    expect(feedbackChatText(good, "Work on Climate")).toBe("Tried Q2 on Work on Climate: good fit");
  });

  it("trims and caps the reason at what the request schema accepts", () => {
    const long = "x".repeat(MAX_FEEDBACK_REASON + 100);
    expect(normalizeFeedbackReason(long)).toHaveLength(MAX_FEEDBACK_REASON);
    expect(normalizeFeedbackReason("  hi  ")).toBe("hi");
    expect(GENERATE_QUERIES_TEXT.length).toBeGreaterThan(0);
  });
});
