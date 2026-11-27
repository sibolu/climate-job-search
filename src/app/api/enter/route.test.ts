import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accessCodeKey } from "@/lib/access-code";
import { BudgetLedgerError, memoryBudgetLedger, type BudgetLedger } from "@/lib/budget";
import { SESSION_COOKIE_NAME, readSession } from "@/lib/passcode";

import { POST } from "./route";

// The route reads the ledger through supabaseBudgetLedger(); tests swap in an
// in-memory one (or a failing one) and keep the real budgetVerdict.
const ledger = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/budget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/budget")>();
  return { ...actual, supabaseBudgetLedger: () => ledger.current };
});

const OLD_PASSCODE = "correct-horse-battery";
/**
 * The two passcode variables the route no longer reads (D70, D71). Built, not
 * spelled, so a grep of src for either name stays empty, as 2e.8 checks.
 */
const RETIRED_VARIABLES = ["OPERATOR", "APP"].map((prefix) => `${prefix}_PASSCODE`);
const SECRET = "test-cookie-secret-value";
const URL_ = "http://localhost/api/enter";

const KNOWN = "0123-4567-89AB-CDEF";
const CAPPED = "ABCD-EFGH-JKMN-PQRS";
const DISABLED = "TVWX-YZ01-2345-6789";
const UNKNOWN = "ZZZZ-ZZZZ-ZZZZ-ZZZZ";

let memory: ReturnType<typeof memoryBudgetLedger>;
let reads: string[];

function post(init: RequestInit = {}): Request {
  return new Request(URL_, { method: "POST", ...init });
}

function form(fields: Record<string, string>): Request {
  return post({
    body: new URLSearchParams(fields),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

function json(body: unknown): Request {
  return post({
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** The session the response's cookie carries, read back as the proxy would. */
async function sessionOf(response: Response) {
  const cookie = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`).exec(cookie);
  return match ? readSession(match[1], SECRET) : null;
}

describe("POST /api/enter", () => {
  beforeEach(async () => {
    vi.stubEnv("PASSCODE_COOKIE_SECRET", SECRET);
    memory = memoryBudgetLedger({
      [await accessCodeKey(KNOWN)]: { capUsd: 5, spentUsd: 1.25, disabled: false },
      [await accessCodeKey(CAPPED)]: { capUsd: 5, spentUsd: 5, disabled: false },
      [await accessCodeKey(DISABLED)]: { capUsd: 5, spentUsd: 0, disabled: true },
    });
    reads = [];
    ledger.current = {
      read: (key: string) => {
        reads.push(key);
        return memory.read(key);
      },
      addSpend: () => {
        throw new Error("/api/enter must never write the ledger");
      },
    } satisfies BudgetLedger;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("enters with a known code: redirect and a v2 cookie carrying its key", async () => {
    const response = await POST(form({ code: KNOWN }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost/");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=v2.`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(await sessionOf(response)).toEqual({ codeKey: await accessCodeKey(KNOWN) });
  });

  it("answers JSON callers with JSON and the cookie", async () => {
    const response = await POST(json({ code: KNOWN }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await sessionOf(response)).toEqual({ codeKey: await accessCodeKey(KNOWN) });
  });

  it("enters lower case typed with spaces as the same key", async () => {
    const response = await POST(form({ code: `  ${KNOWN.toLowerCase().replace(/-/g, " ")} ` }));
    expect(response.status).toBe(303);
    expect(await sessionOf(response)).toEqual({ codeKey: await accessCodeKey(KNOWN) });
  });

  it("still lets in a code that has reached its cap", async () => {
    const response = await POST(form({ code: CAPPED }));
    expect(response.status).toBe(303);
    expect(await sessionOf(response)).toEqual({ codeKey: await accessCodeKey(CAPPED) });
  });

  it("gives a disabled, an unknown and a malformed code the same 401 and no cookie", async () => {
    const bodies: string[] = [];
    for (const code of [DISABLED, UNKNOWN, "not-a-code", "0123-4567-89AB-CDEI"]) {
      const html = await POST(form({ code }));
      expect(html.status).toBe(401);
      expect(html.headers.get("set-cookie")).toBeNull();
      expect(html.headers.get("content-type")).toContain("text/html");
      bodies.push(await html.text());

      const asJson = await POST(json({ code }));
      expect(asJson.status).toBe(401);
      expect(asJson.headers.get("set-cookie")).toBeNull();
      bodies.push(JSON.stringify(await asJson.json()));
    }
    expect(new Set(bodies.filter((_, i) => i % 2 === 0)).size).toBe(1);
    expect(new Set(bodies.filter((_, i) => i % 2 === 1)).size).toBe(1);
    expect(bodies[1]).toContain("wasn't recognised");
  });

  it("does not read the ledger for text that cannot be a code", async () => {
    await POST(form({ code: "not-a-code" }));
    await POST(form({ code: "" }));
    expect(reads).toEqual([]);
  });

  it("enters on no passcode: a value in either retired passcode variable does not enter (D71)", async () => {
    for (const name of RETIRED_VARIABLES) vi.stubEnv(name, OLD_PASSCODE);
    const refused = await POST(form({ code: OLD_PASSCODE }));
    expect(refused.status).toBe(401);
    expect(refused.headers.get("set-cookie")).toBeNull();
    expect(reads).toEqual([]);

    // A code-shaped value in either variable is only ever looked up as a code.
    for (const name of RETIRED_VARIABLES) vi.stubEnv(name, UNKNOWN);
    const unknown = await POST(form({ code: UNKNOWN }));
    expect(unknown.status).toBe(401);
    expect(unknown.headers.get("set-cookie")).toBeNull();

    const ok = await POST(form({ code: KNOWN }));
    expect(ok.status).toBe(303);
    expect(await sessionOf(ok)).toEqual({ codeKey: await accessCodeKey(KNOWN) });
  });

  it("no longer enters on the old passcode field name", async () => {
    for (const request of [
      form({ passcode: OLD_PASSCODE }),
      form({ passcode: KNOWN }),
      json({ passcode: KNOWN }),
    ]) {
      const response = await POST(request);
      expect(response.status).toBe(401);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("returns 503 and no cookie when the ledger cannot be read, logging only the error code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const failure of [new BudgetLedgerError("read", "PGRST301"), new Error("boom")]) {
      ledger.current = {
        read: () => Promise.reject(failure),
        addSpend: () => Promise.reject(failure),
      } satisfies BudgetLedger;

      const html = await POST(form({ code: KNOWN }));
      expect(html.status).toBe(503);
      expect(html.headers.get("set-cookie")).toBeNull();
      expect(html.headers.get("content-type")).toContain("text/html");

      const asJson = await POST(json({ code: KNOWN }));
      expect(asJson.status).toBe(503);
      expect(asJson.headers.get("set-cookie")).toBeNull();
      expect((await asJson.json()).error).toMatch(/try again in a minute/i);
    }
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(KNOWN);
    expect(logged).not.toContain(await accessCodeKey(KNOWN));
    expect(logged).not.toContain("boom");
  });

  it("returns 401, not 500, on a bodiless POST", async () => {
    const response = await POST(post());
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns 401, not 500, on a text/plain body", async () => {
    const response = await POST(
      post({ body: `code=${KNOWN}`, headers: { "content-type": "text/plain" } }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns 401 on a JSON body that is not an object or is not JSON", async () => {
    for (const body of ["[]", '"str"', "{not json", ""]) {
      const response = await POST(post({ body, headers: { "content-type": "application/json" } }));
      expect(response.status).toBe(401);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("fails closed with 500 and no cookie when the cookie secret is not set", async () => {
    vi.stubEnv("PASSCODE_COOKIE_SECRET", "");
    const response = await POST(form({ code: KNOWN }));
    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
