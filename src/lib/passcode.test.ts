import { describe, expect, it } from "vitest";

import { SESSION_MAX_AGE_SECONDS, readSession, signSession } from "./passcode";

const SECRET = "test-cookie-secret-value";

const KEY = "0123456789abcdef0123456789abcdef";
const OTHER_KEY = "fedcba9876543210fedcba9876543210";

/** Mints a token for any payload, valid HMAC included, as an attacker holding the secret could not. */
async function forge(payload: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  let binary = "";
  for (const byte of sig) binary += String.fromCharCode(byte);
  const b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${payload}.${b64}`;
}

function swapScope(token: string, scope: string): string {
  const [version, expiresAt, , signature] = token.split(".");
  return `${version}.${expiresAt}.${scope}.${signature}`;
}

describe("signSession / readSession", () => {
  it("round-trips a code key in a v2 token", async () => {
    const token = await signSession(SECRET, { codeKey: KEY });
    expect(token.startsWith(`v2.`)).toBe(true);
    expect(token.split(".")[2]).toBe(KEY);
    await expect(readSession(token, SECRET)).resolves.toEqual({ codeKey: KEY });
  });

  it("refuses a correctly signed cookie with the pre-D71 operator scope", async () => {
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    await expect(readSession(await forge(`v2.${expiry}.operator`), SECRET)).resolves.toBeNull();
  });

  it("throws without a key: no session is minted without one (D71)", async () => {
    for (const codeKey of [null, undefined, ""]) {
      await expect(
        signSession(SECRET, { codeKey: codeKey as unknown as string }),
      ).rejects.toThrow(/codeKey/);
    }
  });

  it("refuses to sign a code key that is not a key", async () => {
    for (const codeKey of ["operator", "0123456789ABCDEF0123456789ABCDEF", "0123-4567-89AB-CDEF"]) {
      await expect(signSession(SECRET, { codeKey })).rejects.toThrow(/codeKey/);
    }
  });

  it("refuses every v1 cookie, even one correctly signed", async () => {
    const now = Math.floor(Date.now() / 1000) + 3600;
    await expect(readSession(await forge(`v1.${now}`), SECRET)).resolves.toBeNull();
    await expect(readSession(await forge(`v1.${now}.${KEY}`), SECRET)).resolves.toBeNull();
  });

  it("fails the HMAC when the key is tampered with or swapped", async () => {
    const token = await signSession(SECRET, { codeKey: KEY });
    const flipped = `${KEY.slice(0, -1)}${KEY.endsWith("f") ? "e" : "f"}`;
    await expect(readSession(swapScope(token, flipped), SECRET)).resolves.toBeNull();
    await expect(readSession(swapScope(token, OTHER_KEY), SECRET)).resolves.toBeNull();
    await expect(readSession(swapScope(token, "operator"), SECRET)).resolves.toBeNull();
  });

  it("refuses a v2 token whose scope is malformed even with a valid HMAC for it", async () => {
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    for (const scope of ["", "operator", "OPERATOR", "0123456789ABCDEF0123456789ABCDEF", `${KEY}0`, "0123-4567-89AB-CDEF"]) {
      await expect(readSession(await forge(`v2.${expiry}.${scope}`), SECRET)).resolves.toBeNull();
    }
    // The forge helper itself mints tokens readSession accepts.
    await expect(readSession(await forge(`v2.${expiry}.${KEY}`), SECRET)).resolves.toEqual({ codeKey: KEY });
  });

  it("rejects a tampered signature", async () => {
    const token = await signSession(SECRET, { codeKey: KEY });
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    await expect(readSession(tampered, SECRET)).resolves.toBeNull();
  });

  it("rejects a token whose expiry was extended", async () => {
    const now = Date.now();
    const token = await signSession(SECRET, { codeKey: KEY, now });
    const [version, expiresAt, scope, signature] = token.split(".");
    const extended = `${version}.${Number(expiresAt) + 3600}.${scope}.${signature}`;
    expect(extended).not.toBe(token);
    await expect(readSession(extended, SECRET)).resolves.toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession(SECRET, { codeKey: KEY });
    await expect(readSession(token, "some-other-secret")).resolves.toBeNull();
  });

  it("rejects malformed and empty tokens", async () => {
    await expect(readSession("", SECRET)).resolves.toBeNull();
    await expect(readSession(undefined, SECRET)).resolves.toBeNull();
    await expect(readSession("not-a-token", SECRET)).resolves.toBeNull();
    await expect(readSession("v1.123.sig", SECRET)).resolves.toBeNull();
    await expect(readSession("v2.123.sig", SECRET)).resolves.toBeNull();
    await expect(readSession(`v2.123.${KEY}.sig.extra`, SECRET)).resolves.toBeNull();
    const token = await signSession(SECRET, { codeKey: KEY });
    await expect(readSession(token, "")).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const now = Date.now();
    const token = await signSession(SECRET, { codeKey: KEY, now });
    const afterExpiry = now + (SESSION_MAX_AGE_SECONDS + 1) * 1000;
    await expect(readSession(token, SECRET, { now: afterExpiry })).resolves.toBeNull();
  });

  it("refuses to sign without a secret", async () => {
    await expect(signSession("", { codeKey: KEY })).rejects.toThrow(/PASSCODE_COOKIE_SECRET/);
  });
});
