import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LlmBudgetError, MAX_DURATION_SECONDS } from "@/lib/llm";
import { SESSION_COOKIE_NAME, signSession } from "@/lib/passcode";
import type { TurnRequest } from "@/lib/session";
import type { CallContext } from "@/lib/turn";

// `after()` needs a live Next request scope; the tests only need it not to throw.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn() }));
// The real `turnErrorMessage`, a recorded `runTurn`: no step module and no model call runs here.
const runTurn = vi.fn();
vi.mock("@/lib/turn", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/turn")>()), runTurn }));

const { maxDuration, POST } = await import("./route");
const { turnErrorMessage } = await import("@/lib/turn");

const SECRET = "test-cookie-secret-0123456789abcdef";
const KEY = "d".repeat(32);
const TURN: TurnRequest = {
  sessionId: "a".repeat(32),
  step: "cards",
  profileMd: "",
  messages: [],
  input: { kind: "message", content: "my resume" },
};

function post(body: unknown, cookie?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie !== undefined) headers.cookie = `${SESSION_COOKIE_NAME}=${cookie}`;
  return new NextRequest("http://localhost/api/turn", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function events(res: Response): Promise<{ type: string; message?: string }[]> {
  return (await res.text())
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { type: string; message?: string });
}

/** The context `runTurn` was handed on its only call. */
function contextOfOnlyCall(): CallContext {
  expect(runTurn).toHaveBeenCalledTimes(1);
  return runTurn.mock.calls[0]![3] as CallContext;
}

let previousSecret: string | undefined;
beforeAll(() => {
  previousSecret = process.env.PASSCODE_COOKIE_SECRET;
  process.env.PASSCODE_COOKIE_SECRET = SECRET;
});
afterAll(() => {
  if (previousSecret === undefined) delete process.env.PASSCODE_COOKIE_SECRET;
  else process.env.PASSCODE_COOKIE_SECRET = previousSecret;
});
beforeEach(() => {
  runTurn.mockReset();
  runTurn.mockResolvedValue({ message: "ok", profileMd: "" });
});

describe("POST /api/turn", () => {
  it("keeps the segment config literal equal to MAX_DURATION_SECONDS", () => {
    expect(maxDuration).toBe(MAX_DURATION_SECONDS);
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await POST(post("nope", await signSession(SECRET, { codeKey: null })));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a JSON body that is not a turn request, without echoing it", async () => {
    const body = { sessionId: "not-hex", step: "cards", profileMd: "SECRET", messages: [], input: { kind: "message", content: "hi" } };
    const res = await POST(post(body, await signSession(SECRET, { codeKey: null })));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("SECRET");
  });
});

describe("POST /api/turn — the session cookie (technical-plan.md D68, D69)", () => {
  it("answers 401 without a cookie, before the body is read and with no turn run", async () => {
    const res = await POST(post("not even json"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Access code required." });
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("answers 401 for a tampered cookie", async () => {
    const token = await signSession(SECRET, { codeKey: KEY });
    const tampered = `${token.slice(0, -2)}${token.endsWith("00") ? "11" : "00"}`;
    const res = await POST(post(TURN, tampered));
    expect(res.status).toBe(401);
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("answers 401 for a cookie signed with another secret", async () => {
    const res = await POST(post(TURN, await signSession("another-secret-0123456789abcdef", { codeKey: KEY })));
    expect(res.status).toBe(401);
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("hands the access code's key from the cookie to runTurn, with the abort signal", async () => {
    const res = await POST(post(TURN, await signSession(SECRET, { codeKey: KEY })));
    expect((await events(res)).at(-1)?.type).toBe("final");
    const context = contextOfOnlyCall();
    expect(context.codeKey).toBe(KEY);
    expect(context.signal).toBeInstanceOf(AbortSignal);
  });

  it("hands no key for the operator passcode's session", async () => {
    await events(await POST(post(TURN, await signSession(SECRET, { codeKey: null }))));
    expect(contextOfOnlyCall().codeKey).toBeUndefined();
  });

  it("ignores a codeKey in the body: the key comes only from the signed cookie", async () => {
    const forged = "e".repeat(32);
    await events(await POST(post({ ...TURN, codeKey: forged }, await signSession(SECRET, { codeKey: KEY }))));
    expect(contextOfOnlyCall().codeKey).toBe(KEY);
    expect(runTurn.mock.calls[0]![0]).not.toHaveProperty("codeKey");

    runTurn.mockClear();
    await events(await POST(post({ ...TURN, codeKey: forged }, await signSession(SECRET, { codeKey: null }))));
    expect(contextOfOnlyCall().codeKey).toBeUndefined();
  });

  it("turns a budget refusal into an error event carrying the sentence", async () => {
    const refusal = new LlmBudgetError("cards", "exhausted");
    runTurn.mockRejectedValue(refusal);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const out = await events(await POST(post(TURN, await signSession(SECRET, { codeKey: KEY }))));
      expect(out).toEqual([{ type: "error", message: turnErrorMessage(refusal) }]);
      expect(out[0]!.message).toContain("used up its budget");
      // Class and step only: never the key.
      expect(warn.mock.calls.flat().join(" ")).not.toContain(KEY);
    } finally {
      warn.mockRestore();
    }
  });
});
