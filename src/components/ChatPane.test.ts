import { describe, expect, it } from "vitest";

import { WORKING_REASSURE_MS, latestProgressLine, pillTurn, workingMessage } from "./ChatPane";

describe("latestProgressLine", () => {
  it("is empty when nothing has streamed yet", () => {
    expect(latestProgressLine("")).toBe("");
  });

  it("ignores the empty heartbeat deltas and returns the newest real line", () => {
    const streamed = "Reading what you pasted…\nMatching your experience…\n\n\n";
    expect(latestProgressLine(streamed)).toBe("Matching your experience…");
  });
});

describe("workingMessage", () => {
  it("falls back to a generic line before any progress arrives", () => {
    const message = workingMessage("", 0);
    expect(message.source).toBe("fallback");
    expect(message.text).toBe("Working on it");
    expect(message.note).toBeNull();
  });

  it("shows the server's own progress line, without its written ellipsis", () => {
    const message = workingMessage("Reading what you pasted…\n", 1_000);
    expect(message.source).toBe("progress");
    expect(message.text).toBe("Reading what you pasted");
    expect(message.note).toBeNull();
  });

  it("strips a three-dot ellipsis too", () => {
    expect(workingMessage("Noting that...\n", 0).text).toBe("Noting that");
  });

  it("reassures instead of repeating once the stream has been quiet a while", () => {
    const quiet = workingMessage("Looking into Grid software: titles…\n", WORKING_REASSURE_MS);
    expect(quiet.text).toBe("Looking into Grid software: titles");
    expect(quiet.note).toBe("Still going — this step can take a couple of minutes.");
  });

  it("reassures during a long quiet stretch with no progress at all", () => {
    const quiet = workingMessage("", WORKING_REASSURE_MS + 30_000);
    expect(quiet.source).toBe("fallback");
    expect(quiet.note).toBe("This step can take a couple of minutes.");
  });

  it("never invents a step the server did not send", () => {
    // The only text that is not a verbatim server line is the generic fallback.
    expect(workingMessage("", 120_000).text).toBe("Working on it");
  });
});

describe("pillTurn", () => {
  it("shows the label and sends the value", () => {
    // The literal shape of `GO_PILL` in `turn.ts`, inlined because a client
    // component's test may not import a server-only module.
    const goPill = { label: "Find climate fields for me", value: "go" };
    const turn = pillTurn(goPill);
    expect(turn.display).toBe("Find climate fields for me");
    expect(turn.content).toBe("go");
  });

  it("never swaps the two, even when the label reads like a sentence", () => {
    const pill = { label: "Anywhere in the US", value: "us-remote" };
    expect(pillTurn(pill)).toEqual({ content: "us-remote", display: "Anywhere in the US" });
  });

  it("leaves the wire value byte-identical, whitespace and case included", () => {
    // `turn.ts` matches an elicitation answer with
    // `pillsFor(key, ctx).find((p) => p.value === answer.trim())`.
    const pill = { label: "Not sure yet", value: "Not sure" };
    expect(pillTurn(pill).content).toBe(pill.value);
  });
});
