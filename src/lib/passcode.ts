/**
 * Shared-passcode access gate (PLAN.md §2 "Access", §7 decision 5).
 *
 * Pure logic only: no Node-only imports, no I/O, no logging. Everything here
 * runs in the Next.js proxy (request interception) as well as in route
 * handlers, so it uses the Web Crypto API (`globalThis.crypto.subtle`) rather
 * than `node:crypto`.
 *
 * Nothing about the user is encoded in the session token — it carries only a
 * format version and an expiry, per the PRD constraint that no user data is
 * stored server-side.
 */

/** Cookie that carries the signed session token. */
export const SESSION_COOKIE_NAME = "cjs_session";

/** Session lifetime: 30 days. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Token format version; bump to invalidate every existing session. */
const SESSION_VERSION = "v1";

const encoder = new TextEncoder();

/**
 * Compares two strings without leaking which byte differed. The comparison
 * still runs over the longer of the two inputs, so only length is observable.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let diff = aBytes.length ^ bBytes.length;
  const length = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < length; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

/**
 * True when `input` is the configured passcode. Empty or missing values are
 * always rejected, so an unset `APP_PASSCODE` cannot open the app.
 */
export function isValidPasscode(
  input: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!input || !expected) return false;
  return timingSafeEqual(input, expected);
}

function toBase64Url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export interface SignSessionOptions {
  /** Current time in milliseconds since the epoch. Injectable for tests. */
  now?: number;
  maxAgeSeconds?: number;
}

/**
 * Mints a session token of the form `<version>.<expiryUnixSeconds>.<hmac>`.
 * Throws when the signing secret is missing rather than minting an unsigned
 * token.
 */
export async function signSession(
  secret: string,
  { now = Date.now(), maxAgeSeconds = SESSION_MAX_AGE_SECONDS }: SignSessionOptions = {},
): Promise<string> {
  if (!secret) throw new Error("PASSCODE_COOKIE_SECRET is not set");
  const expiresAt = Math.floor(now / 1000) + maxAgeSeconds;
  const payload = `${SESSION_VERSION}.${expiresAt}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

export interface VerifySessionOptions {
  now?: number;
}

/** True when `token` was signed by `secret` and has not expired. */
export async function verifySession(
  token: string | null | undefined,
  secret: string | null | undefined,
  { now = Date.now() }: VerifySessionOptions = {},
): Promise<boolean> {
  if (!token || !secret) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expiresAtRaw, signature] = parts;
  if (version !== SESSION_VERSION) return false;

  const expected = await hmac(secret, `${version}.${expiresAtRaw}`);
  if (!timingSafeEqual(signature, expected)) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt)) return false;
  return now / 1000 < expiresAt;
}
