import { describe, expect, it } from "vitest";

import { classifyStatus, extractUrls } from "./research-links";

describe("extractUrls", () => {
  it("finds bare URLs and strips trailing punctuation", () => {
    const md = "See https://example.org/a. Also https://example.org/b, and https://example.org/c;";
    expect(extractUrls(md)).toEqual([
      "https://example.org/a",
      "https://example.org/b",
      "https://example.org/c",
    ]);
  });

  it("finds autolinks and markdown links", () => {
    const md = "<https://a.example/x> and [text](https://b.example/y) and **https://c.example/z**";
    expect(extractUrls(md)).toEqual([
      "https://a.example/x",
      "https://b.example/y",
      "https://c.example/z",
    ]);
  });

  it("keeps a closing paren that belongs to the URL", () => {
    const md =
      "[wiki](https://en.wikipedia.org/wiki/Heat_pump_(device)) and (see https://en.wikipedia.org/wiki/Foo_(bar))";
    expect(extractUrls(md)).toEqual([
      "https://en.wikipedia.org/wiki/Heat_pump_(device)",
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    ]);
  });

  it("drops an unmatched closing paren", () => {
    expect(extractUrls("(source: https://example.org/page)")).toEqual(["https://example.org/page"]);
  });

  it("splits a link whose text is itself a URL", () => {
    expect(extractUrls("[https://example.org](https://example.org/full)")).toEqual([
      "https://example.org",
      "https://example.org/full",
    ]);
  });

  it("dedupes in first-seen order and keeps query strings", () => {
    const md = "https://b.example/?q=1&r=2 https://a.example https://b.example/?q=1&r=2";
    expect(extractUrls(md)).toEqual(["https://b.example/?q=1&r=2", "https://a.example"]);
  });

  it("stops at table pipes and code spans", () => {
    expect(extractUrls("| https://a.example/x| `https://b.example/y` |")).toEqual([
      "https://a.example/x",
      "https://b.example/y",
    ]);
  });

  it("treats an ellipsis as punctuation, so a placeholder like https://… is not a URL", () => {
    expect(extractUrls("format: https://… or https://example.org/a…")).toEqual(["https://example.org/a"]);
  });

  it("ignores non-http schemes and bare schemes", () => {
    expect(extractUrls("mailto:x@example.org ftp://example.org https:// http://")).toEqual([]);
  });
});

describe("classifyStatus", () => {
  it.each([
    [200, "ok"],
    [204, "ok"],
    [301, "ok"],
    [308, "ok"],
    [401, "refused"],
    [403, "refused"],
    [429, "refused"],
    [400, "broken"],
    [404, "broken"],
    [410, "broken"],
    [500, "broken"],
    [503, "broken"],
    [100, "broken"],
  ] as const)("%i is %s", (status, expected) => {
    expect(classifyStatus(status)).toBe(expected);
  });
});
