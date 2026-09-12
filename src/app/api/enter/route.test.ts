import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE_NAME } from "@/lib/passcode";

import { POST } from "./route";

const PASSCODE = "correct-horse-battery";
const SECRET = "test-cookie-secret-value";
const URL_ = "http://localhost/api/enter";

function post(init: RequestInit = {}): Request {
  return new Request(URL_, { method: "POST", ...init });
}

function form(passcode: string): Request {
  const body = new URLSearchParams({ passcode });
  return post({
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

function json(body: unknown): Request {
  return post({
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/enter", () => {
  beforeEach(() => {
    vi.stubEnv("APP_PASSCODE", PASSCODE);
    vi.stubEnv("PASSCODE_COOKIE_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets the session cookie and redirects on a correct form passcode", async () => {
    const response = await POST(form(PASSCODE));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost/");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=v1.`);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("answers JSON callers with JSON and the cookie", async () => {
    const response = await POST(json({ passcode: PASSCODE }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("set-cookie") ?? "").toContain(`${SESSION_COOKIE_NAME}=`);
  });

  it("returns 401 and no cookie on a wrong passcode", async () => {
    const html = await POST(form("wrong"));
    expect(html.status).toBe(401);
    expect(html.headers.get("set-cookie")).toBeNull();
    expect(html.headers.get("content-type")).toContain("text/html");

    const asJson = await POST(json({ passcode: "wrong" }));
    expect(asJson.status).toBe(401);
    expect(asJson.headers.get("set-cookie")).toBeNull();
    expect(await asJson.json()).toEqual({ error: "Incorrect passcode." });
  });

  it("returns 401, not 500, on a bodiless POST", async () => {
    const response = await POST(post());
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns 401, not 500, on a text/plain body", async () => {
    const response = await POST(
      post({ body: `passcode=${PASSCODE}`, headers: { "content-type": "text/plain" } }),
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

  it("fails closed with 500 and no cookie when the deployment is not configured", async () => {
    vi.stubEnv("APP_PASSCODE", "");
    const response = await POST(form(PASSCODE));
    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
