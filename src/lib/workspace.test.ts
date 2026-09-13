import { describe, expect, it } from "vitest";

import type { Card, Field, Profile } from "./profile";
import { activeCards, emptyProfile, parseProfile, serializeProfile } from "./profile";
import {
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
  applyTurnResponse,
  confirmProfileSkill,
  EXPORT_FILENAME,
  nextStep,
  profileView,
  rejectProfileSkill,
  toggleCardExcluded,
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
