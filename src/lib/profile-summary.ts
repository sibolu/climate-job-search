/**
 * The readable profile summary the drawer shows (technical-plan.md D42, D49).
 *
 * The drawer is read-only: corrections happen through the UI, not here
 * (D42). It shows the profile as short headed sections in plain language
 * instead of the raw `profile.md` (D49; its wording may be rewritten by a
 * later step). All policy — what is shown, in which order, with which
 * labels and empty-state sentences — lives here, so the component only
 * renders. Nothing returned carries a raw id (`C1`, `F2`, `R3`, `Q4`) or a
 * schema key name.
 *
 * Browser-safe: imports only `profile.ts`, `workspace.ts` and `elicit.ts`.
 */

import { isOpenToSuggestions, PREFERENCE_LABELS } from "./elicit";
import { activeSkills, type PreferenceSource, type Profile } from "./profile";
import { liveQueryForRole, selectedRoles } from "./workspace";

/** The filename for the raw `profile.md` download. */
export const PROFILE_MD_FILENAME = "profile.md";

export interface PreferenceLine {
  /** Plain label, e.g. "Location". Never a key name. */
  label: string;
  value: string;
  source: PreferenceSource;
  /** "You said this" or "Inferred from your experience". */
  sourceText: string;
}

export interface SkillLine {
  name: string;
  /** Removed skills stay listed so the drawer can strike them through. */
  excluded: boolean;
}

export interface HighlightLine {
  title: string;
  /** Excluded highlights stay listed so the drawer can strike them through. */
  excluded: boolean;
}

export interface SelectedRoleLine {
  title: string;
  /** The role's field name; empty when the field is unknown. */
  fieldName: string;
}

export interface SearchLine {
  roleTitle: string;
  query: string;
}

export interface SummarySection<T> {
  heading: string;
  /** Shown when `items` is empty: sections never disappear. */
  emptyText: string;
  items: T[];
}

export interface ProfileSummary {
  preferences: SummarySection<PreferenceLine>;
  skills: SummarySection<SkillLine>;
  highlights: SummarySection<HighlightLine>;
  selectedRoles: SummarySection<SelectedRoleLine>;
  searches: SummarySection<SearchLine>;
}

/** Labels that read more naturally than the `profile.md` key labels. */
const LABEL_OVERRIDES: Partial<Record<keyof typeof PREFERENCE_LABELS, string>> = {
  retrainingAppetite: "Openness to retraining",
};

const SOURCE_TEXT: Record<PreferenceSource, string> = {
  stated: "You said this",
  inferred: "Inferred from your experience",
};

function prefLine(label: string, value: string, source: PreferenceSource): PreferenceLine {
  return { label, value, source, sourceText: SOURCE_TEXT[source] };
}

function labelFor(key: keyof typeof PREFERENCE_LABELS): string {
  return LABEL_OVERRIDES[key] ?? PREFERENCE_LABELS[key];
}

function preferenceLines(profile: Profile): PreferenceLine[] {
  const prefs = profile.preferences;
  const lines: PreferenceLine[] = [];

  const interests = prefs.climateInterests;
  const values = (interests?.values ?? []).map((v) => v.trim()).filter((v) => v !== "");
  if (interests !== undefined && values.length > 0) {
    const text = isOpenToSuggestions(profile) ? "Open to suggestions" : values.join(", ");
    lines.push(prefLine(labelFor("climateInterests"), text, interests.source));
  }

  for (const key of ["retrainingAppetite", "location", "workMode", "seniority"] as const) {
    const pref = prefs[key];
    if (pref === undefined || pref.value.trim() === "") continue;
    lines.push(prefLine(labelFor(key), pref.value.trim(), pref.source));
  }

  // Unknown preference keys are stored under their `profile.md` label, which
  // is already plain text.
  for (const other of prefs.other) {
    if (other.value.trim() === "" || other.key.trim() === "") continue;
    lines.push(prefLine(other.key.trim(), other.value.trim(), other.source));
  }
  return lines;
}

/**
 * One list (technical-plan.md D53): the skills in use, in `activeSkills`
 * order with no mark for how each got there, then the removed ones.
 */
function skillLines(profile: Profile): SkillLine[] {
  const lines: SkillLine[] = activeSkills(profile).map((name) => ({ name, excluded: false }));
  const seen = new Set<string>();
  for (const skill of profile.skills.excluded) {
    const name = skill.trim();
    const key = name.toLowerCase();
    if (name === "" || seen.has(key)) continue;
    seen.add(key);
    lines.push({ name, excluded: true });
  }
  return lines;
}

function highlightLines(profile: Profile): HighlightLine[] {
  // Years stay in profile.md but are not shown (technical-plan.md D57).
  return profile.cards.map((card) => ({ title: card.title.trim(), excluded: card.excluded }));
}

function fieldNameOf(profile: Profile, fieldId: string): string {
  return profile.fields.find((f) => f.id === fieldId)?.name.trim() ?? "";
}

/** The readable summary of a parsed profile, in drawer order. */
export function profileSummary(profile: Profile): ProfileSummary {
  const roles = selectedRoles(profile);
  const searches: SearchLine[] = [];
  for (const role of roles) {
    const query = liveQueryForRole(profile, role.id);
    if (query === undefined || query.query.trim() === "") continue;
    searches.push({ roleTitle: role.title.trim(), query: query.query.trim() });
  }

  return {
    preferences: {
      heading: "Preferences",
      emptyText: "No preferences recorded yet.",
      items: preferenceLines(profile),
    },
    skills: {
      heading: "Skills",
      emptyText: "No skills recorded yet.",
      items: skillLines(profile),
    },
    highlights: {
      heading: "Highlights",
      emptyText: "No highlights yet.",
      items: highlightLines(profile),
    },
    selectedRoles: {
      heading: "Selected roles",
      emptyText: "No roles selected yet.",
      items: roles.map((role) => ({
        title: role.title.trim(),
        fieldName: fieldNameOf(profile, role.fieldId),
      })),
    },
    searches: {
      heading: "Searches",
      emptyText: "No searches written yet.",
      items: searches,
    },
  };
}
