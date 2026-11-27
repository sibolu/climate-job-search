/**
 * Access gate: the signed session cookie (technical-plan.md §1 "Access",
 * D68, which supersedes D5 for invited people).
 *
 * Pure logic only: no Node-only imports, no I/O, no logging. Everything here
 * runs in the Next.js proxy (request interception) as well as in route
 * handlers, so it uses the Web Crypto API (`globalThis.crypto.subtle`) rather
 * than `node:crypto`.
 *
 * Token: `v2.<expiryUnixSeconds>.<scope>.<hmac>`, the HMAC (SHA-256, keyed by
 * `PASSCODE_COOKIE_SECRET`) covering `v2.<expiry>.<scope>`. The scope is the
 * access code's key (`accessCodeKey`, 32 lowercase hex, D67) or
 * `OPERATOR_SCOPE` for a session opened with the optional operator passcode.
 * Signing the scope means the browser cannot swap in another code's key.
 * Any other version is refused, so every v1 cookie signs its holder out once.
 *
 * The token encodes no user data: a derived key, never the code itself, a
 * format version and an expiry.
 */

import { isAccessCodeKey } from "./access-code";

/** Cookie that carries the signed session token. */
export const SESSION_COOKIE_NAME = "cjs_session";

/** Session lifetime: 30 days. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Token format version; bump to invalidate every existing session. */
const SESSION_VERSION = "v2";

/**
 * Scope of a session opened with the operator passcode: it carries no code
 * key, so its calls are not metered. Not hex, so it can never be a key.
 */
export const OPERATOR_SCOPE = "operator";

/** What a valid session token says: whose budget its calls draw on. */
export interface Session {
  /** The access code's key, or null for an operator session. */
  codeKey: string | null;
}

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
 * always rejected, so an unset `OPERATOR_PASSCODE` cannot open the app.
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

/**
 * Imported `CryptoKey`s, one per secret. The proxy verifies a cookie on every
 * non-static request, and `importKey` is not free; the secret comes from the
 * environment, so this map holds at most one entry in practice. The promise
 * itself is cached so concurrent requests share a single import.
 */
const keyCache = new Map<string, Promise<CryptoKey>>();

function signingKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret);
  if (cached !== undefined) return cached;
  const key = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  keyCache.set(secret, key);
  return key;
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await signingKey(secret);
  return toBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export interface SignSessionOptions {
  /**
   * The access code's key, or null for an operator session. Required, so no
   * caller can mint a session without deciding which it is.
   */
  codeKey: string | null;
  /** Current time in milliseconds since the epoch. Injectable for tests. */
  now?: number;
  maxAgeSeconds?: number;
}

/**
 * Mints a session token of the form `v2.<expiryUnixSeconds>.<scope>.<hmac>`.
 * Throws when the signing secret is missing rather than minting an unsigned
 * token, and on a `codeKey` that is neither null nor a valid key.
 */
export async function signSession(
  secret: string,
  { codeKey, now = Date.now(), maxAgeSeconds = SESSION_MAX_AGE_SECONDS }: SignSessionOptions,
): Promise<string> {
  if (!secret) throw new Error("PASSCODE_COOKIE_SECRET is not set");
  if (codeKey !== null && !isAccessCodeKey(codeKey)) {
    throw new Error("signSession: codeKey must be null or an access-code key");
  }
  const expiresAt = Math.floor(now / 1000) + maxAgeSeconds;
  const scope = codeKey ?? OPERATOR_SCOPE;
  const payload = `${SESSION_VERSION}.${expiresAt}.${scope}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

export interface ReadSessionOptions {
  now?: number;
}

/**
 * The session `token` carries, or null unless it is a v2 token signed by
 * `secret`, not expired, whose scope is the operator marker or a valid key.
 */
export async function readSession(
  token: string | null | undefined,
  secret: string | null | undefined,
  { now = Date.now() }: ReadSessionOptions = {},
): Promise<Session | null> {
  if (!token || !secret) return null;

  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, expiresAtRaw, scope, signature] = parts;
  if (version !== SESSION_VERSION) return null;

  const expected = await hmac(secret, `${version}.${expiresAtRaw}.${scope}`);
  if (!timingSafeEqual(signature, expected)) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || now / 1000 >= expiresAt) return null;

  if (scope === OPERATOR_SCOPE) return { codeKey: null };
  if (isAccessCodeKey(scope)) return { codeKey: scope };
  return null;
}
