import { describe, expect, it } from "vitest";

import {
  SESSION_MAX_AGE_SECONDS,
  isValidPasscode,
  signSession,
  verifySession,
} from "./passcode";

const PASSCODE = "correct-horse-battery";
const SECRET = "test-cookie-secret-value";

describe("isValidPasscode", () => {
  it("accepts the configured passcode", () => {
    expect(isValidPasscode(PASSCODE, PASSCODE)).toBe(true);
  });

  it("rejects a wrong passcode", () => {
    expect(isValidPasscode("wrong-horse-battery", PASSCODE)).toBe(false);
  });

  it("rejects a passcode that is only a prefix of the real one", () => {
    expect(isValidPasscode(PASSCODE.slice(0, -1), PASSCODE)).toBe(false);
  });

  it("rejects empty input", () => {
    expect(isValidPasscode("", PASSCODE)).toBe(false);
    expect(isValidPasscode(undefined, PASSCODE)).toBe(false);
  });

  it("rejects every input when no passcode is configured", () => {
    expect(isValidPasscode("anything", "")).toBe(false);
    expect(isValidPasscode("", "")).toBe(false);
    expect(isValidPasscode("anything", undefined)).toBe(false);
  });
});

describe("signSession / verifySession", () => {
  it("verifies a freshly signed token", async () => {
    const token = await signSession(SECRET);
    await expect(verifySession(token, SECRET)).resolves.toBe(true);
  });

  it("rejects a tampered token", async () => {
    const token = await signSession(SECRET);
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    await expect(verifySession(tampered, SECRET)).resolves.toBe(false);
  });

  it("rejects a token whose expiry was extended", async () => {
    const now = Date.now();
    const token = await signSession(SECRET, { now });
    const [version, expiresAt, signature] = token.split(".");
    const extended = `${version}.${Number(expiresAt) + 3600}.${signature}`;
    expect(extended).not.toBe(token);
    await expect(verifySession(extended, SECRET)).resolves.toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession(SECRET);
    await expect(verifySession(token, "some-other-secret")).resolves.toBe(false);
  });

  it("rejects malformed and empty tokens", async () => {
    await expect(verifySession("", SECRET)).resolves.toBe(false);
    await expect(verifySession("not-a-token", SECRET)).resolves.toBe(false);
    await expect(verifySession("v1.123", SECRET)).resolves.toBe(false);
    await expect(verifySession("v2.123.sig", SECRET)).resolves.toBe(false);
  });

  it("rejects an expired token", async () => {
    const now = Date.now();
    const token = await signSession(SECRET, { now });
    const afterExpiry = now + (SESSION_MAX_AGE_SECONDS + 1) * 1000;
    await expect(verifySession(token, SECRET, { now: afterExpiry })).resolves.toBe(false);
  });

  it("refuses to sign without a secret", async () => {
    await expect(signSession("")).rejects.toThrow(/PASSCODE_COOKIE_SECRET/);
  });
});
