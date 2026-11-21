import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { emptyProfile, parseProfile, type Profile } from "./profile";
import { profileSummary, type ProfileSummary } from "./profile-summary";

const FIXTURES = join(__dirname, "__fixtures__");
const load = (name: string): Profile =>
  parseProfile(readFileSync(join(FIXTURES, name), "utf8")).profile;

/** Every string the summary returns, for the no-raw-ids check. */
function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(allStrings);
  return [];
}

function expectNoRawIds(summary: ProfileSummary) {
  for (const s of allStrings(summary)) {
    expect(s).not.toMatch(/\b[CFRQ]\d+\b/);
    expect(s).not.toMatch(/retrainingAppetite|climateInterests|workMode/);
  }
}

describe("profileSummary", () => {
  it("says so for every empty section of an empty profile", () => {
    const summary = profileSummary(emptyProfile());
    expect(Object.keys(summary)).toEqual([
      "preferences",
      "skills",
      "highlights",
      "selectedRoles",
      "searches",
    ]);
    for (const section of Object.values(summary)) {
      expect(section.items).toEqual([]);
      expect(section.emptyText.length).toBeGreaterThan(0);
    }
    expect(summary.selectedRoles.emptyText).toBe("No roles selected yet.");
    expectNoRawIds(summary);
  });

  it("summarises the data-scientist fixture", () => {
    const summary = profileSummary(load("data-scientist.md"));

    expect(summary.preferences.items.map((p) => p.label)).toEqual([
      "Climate interests",
      "Openness to retraining",
      "Location",
      "Work mode",
      "Seniority",
    ]);
    const interests = summary.preferences.items[0];
    expect(interests.value).toBe("grid and storage, carbon markets integrity, methane monitoring");
    expect(interests.source).toBe("inferred");
    expect(interests.sourceText).toBe("Inferred from your experience");
    const location = summary.preferences.items.find((p) => p.label === "Location");
    expect(location).toMatchObject({ value: "San Francisco Bay Area", source: "stated" });
    expect(location?.sourceText).toBe("You said this");

    // One list, no mark for inferred skills; the removed one is last and flagged (D53).
    expect(summary.skills.heading).toBe("Skills");
    expect(summary.skills.items).toEqual([
      { name: "causal inference", excluded: false },
      { name: "experiment design", excluded: false },
      { name: "Python", excluded: false },
      { name: "time-series forecasting", excluded: false },
      { name: "econometrics", excluded: false },
      { name: "MLOps", excluded: false },
      { name: "technical leadership", excluded: false },
      { name: "policy analysis", excluded: false },
      { name: "deep learning research", excluded: true },
    ]);

    expect(summary.highlights.items[0]).toEqual({
      title: "Causal measurement platform for marketplace pricing",
      excluded: false,
    });

    expect(summary.selectedRoles.items.map((r) => r.title)).toEqual([
      "Staff Data Scientist, program measurement",
      "Quantitative Analyst, credit ratings",
    ]);
    expect(summary.selectedRoles.items.every((r) => r.fieldName !== "")).toBe(true);
    expectNoRawIds(summary);
  });

  it("lists one search per selected role in the engineer fixture", () => {
    const summary = profileSummary(load("queries/engineer.md"));
    // Field order, then role order (`selectedRoles`).
    expect(summary.selectedRoles.items.map((r) => r.title)).toEqual([
      "Senior Mechanical Engineer, electrification studies",
      "Electrification Project Engineer",
      "Senior Product Engineer, residential heat pumps",
    ]);
    expect(summary.selectedRoles.items[0].fieldName).toBe(
      "Building electrification consulting and MEP design",
    );
    expect(summary.searches.items.length).toBeGreaterThan(0);
    for (const search of summary.searches.items) {
      expect(summary.selectedRoles.items.map((r) => r.title)).toContain(search.roleTitle);
      expect(search.query.trim()).not.toBe("");
    }
    // Years are never shown (technical-plan.md D57).
    expect(summary.highlights.items.every((h) => !("years" in h))).toBe(true);
    expectNoRawIds(summary);
  });

  it("flags excluded highlights and keeps them listed", () => {
    const profile = load("data-scientist.md");
    profile.cards[1] = { ...profile.cards[1], excluded: true };
    const items = profileSummary(profile).highlights.items;
    expect(items).toHaveLength(profile.cards.length);
    expect(items.map((h) => h.excluded)).toEqual([false, true, false]);
  });

  it("shows other preferences under their own label and open-to-suggestions plainly", () => {
    const profile = emptyProfile();
    profile.preferences.climateInterests = { values: ["open to suggestions"], source: "stated" };
    profile.preferences.other.push({ key: "Salary floor", value: "90k", source: "stated" });
    const items = profileSummary(profile).preferences.items;
    expect(items).toEqual([
      { label: "Climate interests", value: "Open to suggestions", source: "stated", sourceText: "You said this" },
      { label: "Salary floor", value: "90k", source: "stated", sourceText: "You said this" },
    ]);
  });
});
