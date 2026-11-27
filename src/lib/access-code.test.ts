import { describe, expect, it } from "vitest";

import {
  ACCESS_CODE_LENGTH,
  accessCodeKey,
  generateAccessCode,
  isAccessCodeKey,
  normalizeAccessCode,
} from "./access-code";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

describe("generateAccessCode", () => {
  it("prints four groups of four alphabet characters", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateAccessCode();
      expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
      const bare = code.replace(/-/g, "");
      expect(bare).toHaveLength(ACCESS_CODE_LENGTH);
      for (const ch of bare) expect(ALPHABET).toContain(ch);
      expect(bare).not.toMatch(/[ILOU]/);
    }
  });

  it("does not repeat", () => {
    expect(generateAccessCode()).not.toBe(generateAccessCode());
  });
});

describe("normalizeAccessCode", () => {
  it("trims, upper-cases and drops dashes and whitespace", () => {
    expect(normalizeAccessCode("abcd-efgh-jkmn-pqrs")).toBe("ABCDEFGHJKMNPQRS");
    expect(normalizeAccessCode("  abcd efgh jkmn pqrs \n")).toBe("ABCDEFGHJKMNPQRS");
    expect(normalizeAccessCode("\tAbCd-EfGh\tjkmn - pqrs")).toBe("ABCDEFGHJKMNPQRS");
    expect(normalizeAccessCode("ABCDEFGHJKMNPQRS")).toBe("ABCDEFGHJKMNPQRS");
  });

  it("does not map look-alike letters", () => {
    expect(normalizeAccessCode("o1il")).toBe("O1IL");
  });
});

describe("accessCodeKey", () => {
  it("is 32 lowercase hex characters and stable", async () => {
    const code = generateAccessCode();
    const key = await accessCodeKey(code);
    expect(isAccessCodeKey(key)).toBe(true);
    expect(await accessCodeKey(code)).toBe(key);
  });

  it("derives the same key from the lower-case form typed with spaces", async () => {
    const code = generateAccessCode();
    const typed = `  ${code.toLowerCase().replace(/-/g, " ")}  `;
    expect(await accessCodeKey(typed)).toBe(await accessCodeKey(code));
  });

  it("matches a known answer (sha256 of the bare code, first 32 hex)", async () => {
    const expected = "2125b2c332b1113aae9bfc5e9f7e3b4c";
    expect(await accessCodeKey("0123-4567-89AB-CDEF")).toBe(expected);
    expect(await accessCodeKey("0123 4567 89ab cdef")).toBe(expected);
  });

  it("differs between codes", async () => {
    expect(await accessCodeKey("0123-4567-89AB-CDEF")).not.toBe(await accessCodeKey("0123-4567-89AB-CDEG"));
  });
});

describe("isAccessCodeKey", () => {
  it("accepts exactly 32 lowercase hex characters", () => {
    expect(isAccessCodeKey("0123456789abcdef0123456789abcdef")).toBe(true);
  });

  it("rejects other shapes", () => {
    expect(isAccessCodeKey("0123456789abcdef0123456789abcde")).toBe(false);
    expect(isAccessCodeKey("0123456789abcdef0123456789abcdef0")).toBe(false);
    expect(isAccessCodeKey("0123456789ABCDEF0123456789ABCDEF")).toBe(false);
    expect(isAccessCodeKey("0123456789abcdef0123456789abcdeg")).toBe(false);
    expect(isAccessCodeKey(42)).toBe(false);
    expect(isAccessCodeKey(null)).toBe(false);
    expect(isAccessCodeKey(undefined)).toBe(false);
  });
});
