/**
 * Access codes: generate one, normalise what a person types, derive the
 * database key (technical-plan.md D67).
 *
 * A code is 16 random characters (80 bits) from a 32-symbol, Crockford-style
 * alphabet, shown as `XXXX-XXXX-XXXX-XXXX`. It is generated, never chosen. The
 * database stores only `accessCodeKey(code)`: the first 32 lowercase hex
 * characters of the SHA-256 of the normalised code. The code itself is never
 * stored or logged; the only place it appears is the one-time print of
 * `pnpm codes:add`.
 *
 * No server secret goes into the key, deliberately. An 80-bit random code
 * cannot be guessed, so a keyed hash would add nothing, and keeping
 * `PASSCODE_COOKIE_SECRET` out of it means rotating that secret never resets
 * anyone's running total.
 *
 * Web Crypto only (`crypto.getRandomValues`, `crypto.subtle.digest`) and no
 * `node:*` import, so the module runs in the proxy / Edge runtime, in route
 * handlers, in the browser and under `tsx`. Nothing here logs.
 */

export const ACCESS_CODE_LENGTH = 16;

/**
 * 32 symbols, so each carries exactly 5 bits and `byte & 31` picks one with no
 * modulo bias. Digits and upper-case letters without I, L, O and U, the
 * look-alikes. Those letters are simply not in the alphabet; normalisation
 * does not map them to anything.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUP = 4;
const KEY_HEX_LENGTH = 32;
const KEY_SHAPE = /^[0-9a-f]{32}$/;
const CODE_SHAPE = new RegExp(`^[${ALPHABET}]{${ACCESS_CODE_LENGTH}}$`);

/** 16 random characters (80 bits), shown as XXXX-XXXX-XXXX-XXXX. Generated, never chosen. */
export function generateAccessCode(): string {
  const bytes = new Uint8Array(ACCESS_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let bare = "";
  for (const byte of bytes) bare += ALPHABET[byte & 31];
  const groups: string[] = [];
  for (let i = 0; i < ACCESS_CODE_LENGTH; i += GROUP) groups.push(bare.slice(i, i + GROUP));
  return groups.join("-");
}

/** Trim, upper-case, drop dashes and all whitespace. Returns the bare 16 characters (or whatever was typed, normalised). */
export function normalizeAccessCode(typed: string): string {
  return typed.trim().toUpperCase().replace(/[-\s]/g, "");
}

/**
 * True only for exactly 16 characters of the alphabet: the bare form
 * `normalizeAccessCode` returns for a real code. `/api/enter` uses it to
 * refuse text that cannot be a code without a database round trip.
 */
export function isAccessCodeShape(normalized: string): boolean {
  return CODE_SHAPE.test(normalized);
}

/**
 * SHA-256 of the normalised code, first 32 lowercase hex characters.
 * Normalises its input itself, so `accessCodeKey("abcd efgh …")` equals the
 * key of the canonical form.
 */
export async function accessCodeKey(code: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeAccessCode(code));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex.slice(0, KEY_HEX_LENGTH);
}

/** True for exactly 32 lowercase hex characters (the shape the table's CHECK enforces: ^[0-9a-f]{32}$). */
export function isAccessCodeKey(value: unknown): value is string {
  return typeof value === "string" && KEY_SHAPE.test(value);
}
