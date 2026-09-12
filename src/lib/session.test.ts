import { describe, expect, it } from "vitest";

import {
  DEFAULT_KEEP_LAST_N,
  SESSION_STORAGE_KEY,
  SESSION_VERSION,
  SessionStateSchema,
  TurnResponseSchema,
  appendMessage,
  browserStore,
  buildTurnRequest,
  clearSession,
  exportSession,
  importSession,
  loadSession,
  memoryStore,
  newSessionId,
  newSessionState,
  parseTurnRequest,
  saveSession,
  startOver,
  trimMessages,
  type SessionState,
} from "./session";

function populated(): SessionState {
  let s = { ...newSessionState(), profileMd: "# Profile\n\n## Preferences\n\n- **Location:** Boston\n" };
  s = appendMessage(s, { role: "user", content: "hi", createdAt: "2026-09-12T00:00:00.000Z" });
  s = appendMessage(s, {
    role: "assistant",
    content: "Where are you based?",
    pills: [{ label: "Remote", value: "I want fully remote work" }],
    createdAt: "2026-09-12T00:00:01.000Z",
  });
  return s;
}

describe("session state", () => {
  it("creates a fresh state with a random anonymous id", () => {
    const a = newSessionState();
    const b = newSessionState();
    expect(a.version).toBe(SESSION_VERSION);
    expect(a.sessionId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.profileMd).toBe("");
    expect(a.messages).toEqual([]);
    expect(SessionStateSchema.safeParse(a).success).toBe(true);
    expect(newSessionId()).not.toBe(newSessionId());
  });

  it("carries no identity fields", () => {
    expect(Object.keys(newSessionState()).sort()).toEqual(["messages", "profileMd", "sessionId", "version"]);
  });

  it("export / import round-trips", () => {
    const state = populated();
    const json = exportSession(state);
    const result = importSession(json);
    expect(result).toEqual({ ok: true, value: state });
  });

  it("import of garbage returns an error result and never throws", () => {
    for (const bad of ["", "not json", "{", "null", "42", "[]", "{}", '{"version":1}']) {
      const r = importSession(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBeTruthy();
    }
    const wrongVersion = importSession(JSON.stringify({ ...populated(), version: 99 }));
    expect(wrongVersion).toEqual({ ok: false, error: "Unsupported session version 99 (expected 1)." });
    const badMessage = importSession(JSON.stringify({ ...populated(), messages: [{ role: "system", content: "x", createdAt: "t" }] }));
    expect(badMessage.ok).toBe(false);
    if (!badMessage.ok) expect(badMessage.error).toMatch(/messages\.0\.role/);
  });

  it("trimMessages keeps the last N and is a no-op when already short", () => {
    let s = newSessionState();
    for (let i = 0; i < 10; i++) s = appendMessage(s, { role: i % 2 ? "assistant" : "user", content: `m${i}` });
    const trimmed = trimMessages(s, 3);
    expect(trimmed.messages.map((m) => m.content)).toEqual(["m7", "m8", "m9"]);
    expect(trimmed.sessionId).toBe(s.sessionId);
    expect(trimMessages(s, 50)).toBe(s);
    expect(trimMessages(s, 0).messages).toEqual([]);
    expect(trimMessages(s, -5).messages).toEqual([]);
    expect(s.messages).toHaveLength(10); // pure
  });

  it("startOver clears the profile and messages and mints a new session id", () => {
    const before = populated();
    const after = startOver();
    expect(after.profileMd).toBe("");
    expect(after.messages).toEqual([]);
    expect(after.sessionId).toMatch(/^[0-9a-f]{32}$/);
    expect(after.sessionId).not.toBe(before.sessionId);
  });
});

describe("turn payload", () => {
  it("buildTurnRequest trims messages and carries the step and input", () => {
    let s = populated();
    for (let i = 0; i < DEFAULT_KEEP_LAST_N + 5; i++) s = appendMessage(s, { role: "user", content: `m${i}` });
    const req = buildTurnRequest(s, "elicit", { kind: "message", content: "Boston" });
    expect(req.messages).toHaveLength(DEFAULT_KEEP_LAST_N);
    expect(req.sessionId).toBe(s.sessionId);
    expect(req.profileMd).toBe(s.profileMd);
    expect(req.step).toBe("elicit");
    expect(parseTurnRequest(JSON.parse(JSON.stringify(req)))).toEqual({ ok: true, value: req });
    expect(buildTurnRequest(s, "revise", { kind: "message", content: "x" }, { keepLastN: 2 }).messages).toHaveLength(2);
  });

  it("accepts a feedback turn", () => {
    const req = buildTurnRequest(populated(), "revise", {
      kind: "feedback",
      feedback: { queryId: "Q2", verdict: "bad", reason: "all roles need a PE license" },
    });
    expect(parseTurnRequest(req).ok).toBe(true);
  });

  it("rejects malformed requests without throwing", () => {
    const good = buildTurnRequest(populated(), "cards", { kind: "message", content: "paste" });
    const cases: unknown[] = [
      null,
      "string",
      {},
      { ...good, step: "hack" },
      { ...good, input: { kind: "message", content: "" } },
      { ...good, input: { kind: "feedback", feedback: { queryId: "C1", verdict: "good", reason: "" } } },
      { ...good, input: { kind: "feedback", feedback: { queryId: "Q1", verdict: "meh", reason: "" } } },
      { ...good, sessionId: "short" },
      { ...good, messages: [{ role: "user", content: "x" }] },
    ];
    for (const c of cases) {
      const r = parseTurnRequest(c);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/^Invalid turn request: /);
    }
  });

  it("TurnResponse schema accepts the minimal and the full shape", () => {
    expect(TurnResponseSchema.safeParse({ message: "ok" }).success).toBe(true);
    expect(
      TurnResponseSchema.safeParse({ message: "ok", profileMd: "# Profile\n", pills: [{ label: "A", value: "a" }] }).success,
    ).toBe(true);
    expect(TurnResponseSchema.safeParse({ profileMd: "x" }).success).toBe(false);
  });
});

describe("storage adapter", () => {
  it("save / load / clear through an injected store", () => {
    const store = memoryStore();
    expect(loadSession(store).messages).toEqual([]);
    const state = populated();
    saveSession(state, store);
    expect(store.getItem(SESSION_STORAGE_KEY)).toBe(JSON.stringify(state));
    expect(loadSession(store)).toEqual(state);
    clearSession(store);
    expect(store.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(loadSession(store).sessionId).not.toBe(state.sessionId);
  });

  it("load falls back to a fresh session when the stored value is corrupt", () => {
    const store = memoryStore({ [SESSION_STORAGE_KEY]: "{corrupt" });
    const s = loadSession(store);
    expect(s.version).toBe(SESSION_VERSION);
    expect(s.messages).toEqual([]);
  });

  it("browserStore is a safe no-op when localStorage is unavailable (node / SSR)", () => {
    const store = browserStore();
    expect(() => store.setItem("k", "v")).not.toThrow();
    expect(store.getItem("k")).toBeNull();
    expect(() => store.removeItem("k")).not.toThrow();
    expect(loadSession().messages).toEqual([]);
    expect(() => saveSession(populated())).not.toThrow();
    expect(() => clearSession()).not.toThrow();
  });

  it("browserStore uses localStorage when present and swallows its errors", () => {
    const backing = new Map<string, string>();
    const fake = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (v.length > 10) throw new Error("QuotaExceededError");
        backing.set(k, v);
      },
      removeItem: (k: string) => void backing.delete(k),
    };
    const g = globalThis as { localStorage?: unknown };
    const original = g.localStorage;
    g.localStorage = fake;
    try {
      const store = browserStore();
      store.setItem("a", "short");
      expect(store.getItem("a")).toBe("short");
      expect(() => store.setItem("b", "this is far too long")).not.toThrow();
      expect(store.getItem("b")).toBeNull();
      store.removeItem("a");
      expect(store.getItem("a")).toBeNull();
    } finally {
      if (original === undefined) delete g.localStorage;
      else g.localStorage = original;
    }
  });
});
