import { describe, expect, it } from "vitest";

import { ALERT_STEPS, BOARD_LABELS, boardLabel } from "./boards";
import type { Board, Query } from "./profile";
import { BoardSchema } from "./profile";

const BOARDS = BoardSchema.options as Board[];

function query(board: Board, extra: Record<string, string> = {}): Query {
  return {
    id: "Q1",
    board,
    query: "climate data engineer",
    fieldIds: ["F1"],
    status: "untried",
    reason: "",
    extra,
  };
}

describe("boards", () => {
  it("labels and describes every board in the schema", () => {
    for (const board of BOARDS) {
      expect(BOARD_LABELS[board].length).toBeGreaterThan(0);
      expect(ALERT_STEPS[board].length).toBeGreaterThan(0);
    }
  });

  it("uses the generic label unless an 'other' query names its site", () => {
    expect(boardLabel(query("linkedin"))).toBe("LinkedIn");
    // A named board only applies to `other`; a known board keeps its own name.
    expect(boardLabel(query("indeed", { "Board name": "Ignored" }))).toBe("Indeed");
    expect(boardLabel(query("other"))).toBe("Other");
    expect(boardLabel(query("other", { "Board name": " Work on Climate " }))).toBe(
      "Work on Climate",
    );
    expect(boardLabel(query("other", { "Board name": "   " }))).toBe("Other");
  });

  it("points every board at its own location and remote/hybrid filters", () => {
    // PLAN.md §7.36: the boards filter on these, so the queries never do.
    for (const board of BOARDS) {
      const steps = ALERT_STEPS[board].join(" ").toLowerCase();
      expect(steps).toContain("location");
      expect(steps).toMatch(/remote|hybrid/);
      expect(steps).toContain("filter");
    }
  });

  it("keeps the alert steps phrased as hints rather than exact UI text", () => {
    // A board redesign should make these vague, not wrong.
    for (const board of BOARDS) {
      expect(ALERT_STEPS[board].some((step) => step.toLowerCase().includes("look for"))).toBe(true);
    }
  });
});
