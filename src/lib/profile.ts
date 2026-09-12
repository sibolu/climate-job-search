/**
 * `profile.md` — the contract every other module reads and writes.
 *
 * The profile is one markdown document the user keeps (PRD stage 2.2, PLAN.md
 * §2 "Session state"). It is the assistant's compressed memory, resent on
 * every turn, and it must stay hand-editable by a nontechnical person in a
 * textarea. This module owns its shape: the zod schemas, a tolerant parser,
 * a deterministic serializer, and small pure update helpers. No I/O, no
 * React, no Node-only imports — it runs in the browser and in route handlers.
 *
 * ## The format ("labeled-bullet markdown")
 *
 * Seven `##` sections in a fixed order. Items (cards, fields, roles, queries)
 * are `### <ID>: <title>` headings followed by `- **Key:** value` lines.
 * IDs are stable: `C1`, `F1`, `R1`, `Q1`… are never renumbered; a new item
 * takes the highest existing number plus one. Minimal complete example:
 *
 * ```markdown
 * # Profile
 *
 * ## Preferences
 *
 * - **Location:** Boston, MA
 * - **Work mode:** remote or hybrid
 * - **Seniority:** senior (inferred)
 * - **Retraining appetite:** low, a few months of self-study at most
 * - **Climate interests:** grid, storage, buildings
 * - **Salary floor:** 120k
 *
 * ## Experience Cards
 *
 * ### C1: Documentary series on regenerative farms
 * - **Situation:** Small studio, three-person crew, six-month shoot.
 * - **Actions:** Planned shoots, interviewed farmers, edited 8 episodes.
 * - **Results:** 1.2M views; series licensed by a public broadcaster.
 * - **Skills:** field production, interviewing, editing
 * - **Excluded:** no
 *
 * ## Skills
 *
 * - **Confirmed:** field production, editing
 * - **Inferred:** interviewing, project management
 * - **Excluded:** drone piloting
 *
 * ## Fields
 *
 * ### F1: Utility-scale solar development
 * - **Status:** accepted
 * - **Explored:** yes
 * - **Move:** sector
 * - **Fit:** Developers need site stories for permitting and community
 *   meetings; C1 shows exactly that kind of field production.
 * - **Uncertain:** Whether in-house video roles exist below the top 10 developers.
 * - **Sources:**
 *   - https://example.com/solar-developer-careers
 *
 * ## Role Shortlist
 *
 * ### R1: Video Producer, community engagement
 * - **Field:** F1
 * - **Companies:** Example Solar, Sample Renewables
 * - **Why:** Same craft as C1 aimed at permitting audiences.
 * - **Sources:**
 *   - https://example.com/careers/video-producer
 *
 * ## Queries
 *
 * ### Q1: "video producer" AND (solar OR renewable)
 * - **Board:** linkedin
 * - **Fields:** F1
 * - **Status:** bad
 * - **Reason:** every result was an agency job, not in-house
 * - **Changed:** 2026-09-10
 *
 * ## Session Notes
 *
 * Discussed C1 and F1. Next: ask about willingness to relocate.
 * ```
 *
 * Conventions a hand editor needs to know:
 * - A preference is stated by the user unless it ends with `(inferred)`.
 * - Lists (`Skills`, `Companies`, `Fields`, `Climate interests`) are
 *   comma-separated on one line. `Sources` are one URL per indented `-` line.
 *   Any list may also be written one item per indented `-` line.
 * - A value may continue on following lines indented by two spaces.
 * - `Excluded` on a card, `Explored` on a field: `yes` or `no`.
 * - Field `Status`: `candidate | accepted | rejected | unsure`.
 *   Field `Move`: `sector | adjacent | retraining`.
 *   Query `Board`: `linkedin | indeed | climatebase | other`.
 *   Query `Status`: `untried | good | bad`.
 * - Fit reasoning cites cards by ID in the text, e.g. `(C1, C3)`;
 *   `citedCardIds()` extracts them.
 *
 * ## Tolerance rules
 *
 * `parseProfile` never throws on a string. Whitespace, blank lines, CRLF,
 * sections in any order, a missing section, an unknown `##` section, an
 * unknown `- **Key:**` inside an item, an item heading without an ID, and
 * unlabeled text all parse. Unknown sections and keys are preserved through
 * `serializeProfile` so a hand edit is never silently lost; text that fits
 * nowhere is moved to the nearest free-text slot (`Notes` on the item, or
 * `Session Notes`) and reported in `warnings`. Invalid enum values fall back
 * to the default with a warning.
 *
 * ## Serialization rules
 *
 * Output is canonical: fixed section order, fixed key order, every known key
 * always present, extra keys sorted, unknown sections last. So
 * `parse(serialize(p))` deep-equals `p` for any normalized profile and
 * `serialize(parse(md))` is idempotent, which keeps per-turn diffs small.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas and types
// ---------------------------------------------------------------------------

export const PreferenceSourceSchema = z.enum(["stated", "inferred"]);
export type PreferenceSource = z.infer<typeof PreferenceSourceSchema>;

export const PreferenceSchema = z.object({
  value: z.string(),
  source: PreferenceSourceSchema,
});
export type Preference = z.infer<typeof PreferenceSchema>;

export const ListPreferenceSchema = z.object({
  values: z.array(z.string()),
  source: PreferenceSourceSchema,
});
export type ListPreference = z.infer<typeof ListPreferenceSchema>;

export const OtherPreferenceSchema = z.object({
  key: z.string(),
  value: z.string(),
  source: PreferenceSourceSchema,
});
export type OtherPreference = z.infer<typeof OtherPreferenceSchema>;

export const PreferencesSchema = z.object({
  location: PreferenceSchema.optional(),
  workMode: PreferenceSchema.optional(),
  seniority: PreferenceSchema.optional(),
  retrainingAppetite: PreferenceSchema.optional(),
  climateInterests: ListPreferenceSchema.optional(),
  /** Unknown preference keys, preserved verbatim in file order. */
  other: z.array(OtherPreferenceSchema),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

/** The typed preference keys, in serialization order. */
export const KNOWN_PREFERENCE_KEYS = [
  "location",
  "workMode",
  "seniority",
  "retrainingAppetite",
  "climateInterests",
] as const;
export type PreferenceKey = (typeof KNOWN_PREFERENCE_KEYS)[number];

/** Unknown `- **Key:** value` lines inside an item, keyed by the label as typed. */
export const ExtraSchema = z.record(z.string(), z.string());
export type Extra = z.infer<typeof ExtraSchema>;

export const CardSchema = z.object({
  id: z.string(),
  title: z.string(),
  situation: z.string(),
  actions: z.string(),
  results: z.string(),
  skills: z.array(z.string()),
  /** Excluded cards stay in the file but the assistant must not use them. */
  excluded: z.boolean(),
  extra: ExtraSchema,
});
export type Card = z.infer<typeof CardSchema>;

export const SkillsSchema = z.object({
  confirmed: z.array(z.string()),
  inferred: z.array(z.string()),
  excluded: z.array(z.string()),
  extra: ExtraSchema,
});
export type Skills = z.infer<typeof SkillsSchema>;
export type SkillBucket = "confirmed" | "inferred" | "excluded";

export const FieldStatusSchema = z.enum(["candidate", "accepted", "rejected", "unsure"]);
export type FieldStatus = z.infer<typeof FieldStatusSchema>;

export const MoveTypeSchema = z.enum(["sector", "adjacent", "retraining"]);
export type MoveType = z.infer<typeof MoveTypeSchema>;

export const FieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: FieldStatusSchema,
  explored: z.boolean(),
  move: MoveTypeSchema.optional(),
  /** Fit reasoning; cites cards by ID in the text (see `citedCardIds`). */
  fit: z.string(),
  uncertain: z.string(),
  sources: z.array(z.string()),
  extra: ExtraSchema,
});
export type Field = z.infer<typeof FieldSchema>;

export const RoleSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** ID of the field this role belongs to, e.g. `F1`; empty when unknown. */
  fieldId: z.string(),
  companies: z.array(z.string()),
  why: z.string(),
  sources: z.array(z.string()),
  extra: ExtraSchema,
});
export type Role = z.infer<typeof RoleSchema>;

export const BoardSchema = z.enum(["linkedin", "indeed", "climatebase", "other"]);
export type Board = z.infer<typeof BoardSchema>;

export const QueryStatusSchema = z.enum(["untried", "good", "bad"]);
export type QueryStatus = z.infer<typeof QueryStatusSchema>;

export const QuerySchema = z.object({
  id: z.string(),
  board: BoardSchema,
  query: z.string(),
  fieldIds: z.array(z.string()),
  status: QueryStatusSchema,
  /** The user's own words from the "Tried it" feedback. */
  reason: z.string(),
  /** ISO date (or date-time) when `status` last changed; absent when untried. */
  changedAt: z.string().optional(),
  extra: ExtraSchema,
});
export type Query = z.infer<typeof QuerySchema>;

export const ExtraSectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
});
export type ExtraSection = z.infer<typeof ExtraSectionSchema>;

export const ProfileSchema = z.object({
  preferences: PreferencesSchema,
  cards: z.array(CardSchema),
  skills: SkillsSchema,
  fields: z.array(FieldSchema),
  roles: z.array(RoleSchema),
  queries: z.array(QuerySchema),
  sessionNotes: z.string(),
  /** Unknown `##` sections, preserved verbatim and emitted last. */
  extraSections: z.array(ExtraSectionSchema),
});
export type Profile = z.infer<typeof ProfileSchema>;

export interface ParseResult {
  profile: Profile;
  warnings: string[];
}

export function emptyProfile(): Profile {
  return {
    preferences: { other: [] },
    cards: [],
    skills: { confirmed: [], inferred: [], excluded: [], extra: {} },
    fields: [],
    roles: [],
    queries: [],
    sessionNotes: "",
    extraSections: [],
  };
}

// ---------------------------------------------------------------------------
// Label tables (shared by parser and serializer)
// ---------------------------------------------------------------------------

type SectionKind = "preferences" | "cards" | "skills" | "fields" | "roles" | "queries" | "notes";

const SECTION_TITLES: Record<SectionKind, string> = {
  preferences: "Preferences",
  cards: "Experience Cards",
  skills: "Skills",
  fields: "Fields",
  roles: "Role Shortlist",
  queries: "Queries",
  notes: "Session Notes",
};

const SECTION_ORDER: SectionKind[] = [
  "preferences",
  "cards",
  "skills",
  "fields",
  "roles",
  "queries",
  "notes",
];

const SECTION_ALIASES: Record<string, SectionKind> = {
  preferences: "preferences",
  preference: "preferences",
  prefs: "preferences",
  experiencecards: "cards",
  experiences: "cards",
  experience: "cards",
  cards: "cards",
  skills: "skills",
  skill: "skills",
  fields: "fields",
  field: "fields",
  climatefields: "fields",
  roleshortlist: "roles",
  roles: "roles",
  role: "roles",
  shortlist: "roles",
  queries: "queries",
  query: "queries",
  searchqueries: "queries",
  sessionnotes: "notes",
  notes: "notes",
  session: "notes",
};

const ID_PREFIX: Record<Exclude<SectionKind, "preferences" | "skills" | "notes">, string> = {
  cards: "C",
  fields: "F",
  roles: "R",
  queries: "Q",
};

/** Canonical labels as written to the file. */
const LABELS = {
  location: "Location",
  workMode: "Work mode",
  seniority: "Seniority",
  retrainingAppetite: "Retraining appetite",
  climateInterests: "Climate interests",
  confirmed: "Confirmed",
  inferred: "Inferred",
  excludedSkills: "Excluded",
  situation: "Situation",
  actions: "Actions",
  results: "Results",
  skills: "Skills",
  excluded: "Excluded",
  status: "Status",
  explored: "Explored",
  move: "Move",
  fit: "Fit",
  uncertain: "Uncertain",
  sources: "Sources",
  field: "Field",
  companies: "Companies",
  why: "Why",
  board: "Board",
  fields: "Fields",
  reason: "Reason",
  changed: "Changed",
  query: "Query",
  notes: "Notes",
} as const;

/** Normalizes a label or heading for alias lookup: lowercase, letters only. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

const PREFERENCE_ALIASES: Record<string, PreferenceKey> = {
  location: "location",
  locations: "location",
  where: "location",
  workmode: "workMode",
  mode: "workMode",
  remote: "workMode",
  remoteonsite: "workMode",
  remotehybridonsite: "workMode",
  onsite: "workMode",
  seniority: "seniority",
  level: "seniority",
  senioritylevel: "seniority",
  retrainingappetite: "retrainingAppetite",
  retraining: "retrainingAppetite",
  appetiteforretraining: "retrainingAppetite",
  climateinterests: "climateInterests",
  interests: "climateInterests",
  areasofinterest: "climateInterests",
  areasofclimateinterest: "climateInterests",
  climateareas: "climateInterests",
};

const SKILL_ALIASES: Record<string, SkillBucket> = {
  confirmed: "confirmed",
  confirmedskills: "confirmed",
  inferred: "inferred",
  inferredskills: "inferred",
  candidate: "inferred",
  excluded: "excluded",
  excludedskills: "excluded",
  rejected: "excluded",
};

type CardKey = "situation" | "actions" | "results" | "skills" | "excluded";
const CARD_ALIASES: Record<string, CardKey> = {
  situation: "situation",
  context: "situation",
  actions: "actions",
  action: "actions",
  results: "results",
  result: "results",
  outcome: "results",
  outcomes: "results",
  skills: "skills",
  skill: "skills",
  skillsdemonstrated: "skills",
  excluded: "excluded",
  exclude: "excluded",
};

type FieldKey = "status" | "explored" | "move" | "fit" | "uncertain" | "sources";
const FIELD_ALIASES: Record<string, FieldKey> = {
  status: "status",
  explored: "explored",
  move: "move",
  movetype: "move",
  type: "move",
  fit: "fit",
  fitreasoning: "fit",
  why: "fit",
  reasoning: "fit",
  uncertain: "uncertain",
  uncertainty: "uncertain",
  uncertainties: "uncertain",
  whatisuncertain: "uncertain",
  unknowns: "uncertain",
  sources: "sources",
  source: "sources",
  links: "sources",
};

type RoleKey = "field" | "companies" | "why" | "sources";
const ROLE_ALIASES: Record<string, RoleKey> = {
  field: "field",
  fieldid: "field",
  companies: "companies",
  company: "companies",
  examplecompanies: "companies",
  why: "why",
  fit: "why",
  reasoning: "why",
  sources: "sources",
  source: "sources",
  links: "sources",
};

type QueryKey = "board" | "fields" | "status" | "reason" | "changed" | "query";
const QUERY_ALIASES: Record<string, QueryKey> = {
  board: "board",
  site: "board",
  fields: "fields",
  field: "fields",
  fieldids: "fields",
  targets: "fields",
  status: "status",
  reason: "reason",
  feedback: "reason",
  why: "reason",
  changed: "changed",
  changedat: "changed",
  updated: "changed",
  statuschanged: "changed",
  query: "query",
  text: "query",
};

const FIELD_STATUS_ALIASES: Record<string, FieldStatus> = {
  candidate: "candidate",
  new: "candidate",
  "": "candidate",
  accepted: "accepted",
  accept: "accepted",
  yes: "accepted",
  rejected: "rejected",
  reject: "rejected",
  no: "rejected",
  unsure: "unsure",
  maybe: "unsure",
  undecided: "unsure",
};

const MOVE_ALIASES: Record<string, MoveType> = {
  sector: "sector",
  sectormove: "sector",
  adjacent: "adjacent",
  adjacentrole: "adjacent",
  retraining: "retraining",
  retrain: "retraining",
};

const BOARD_ALIASES: Record<string, Board> = {
  linkedin: "linkedin",
  indeed: "indeed",
  climatebase: "climatebase",
  other: "other",
  "": "other",
};

const QUERY_STATUS_ALIASES: Record<string, QueryStatus> = {
  untried: "untried",
  "": "untried",
  nottried: "untried",
  good: "good",
  goodfit: "good",
  bad: "bad",
  badfit: "bad",
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
/** `- **Key:** value`, `**Key**: value`, `* **Key:** value`. */
const BOLD_KEY_RE = /^\s{0,1}(?:[-*+]\s+)?\*\*\s*([^*]+?)\s*:?\s*\*\*\s*:?\s*(.*)$/;
/** `- Key: value` without bold; only accepted for known keys. */
const PLAIN_KEY_RE = /^\s{0,1}[-*+]\s+([A-Za-z][A-Za-z ]{0,40}?)\s*:\s*(.*)$/;
const ITEM_HEADING_RE = /^([A-Za-z])\s*[-.]?\s*(\d+)\s*(?:[:\-–—.]\s*|\s+|$)(.*)$/;
const SOURCE_TAG_RE = /\s*\((stated|inferred)\)\s*$/i;

type RawItem = {
  id: string | null;
  title: string;
  /** Ordered `[label, lines]` pairs, in file order. */
  entries: Array<{ label: string; lines: string[] }>;
  line: number;
};

type RawSection = {
  kind: SectionKind | null;
  heading: string;
  /** Loose key lines (Preferences, Skills) in file order. */
  entries: Array<{ label: string; lines: string[] }>;
  items: RawItem[];
  /** Verbatim body lines (Session Notes, unknown sections). */
  body: string[];
  /** Lines that fit nowhere. */
  stray: string[];
};

function normalizeNewlines(md: string): string {
  return md.replace(/\r\n?/g, "\n");
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/**
 * First pass: split the document into sections, items and labeled entries
 * without interpreting any values.
 */
function tokenize(md: string, warnings: string[]): RawSection[] {
  const lines = normalizeNewlines(md).split("\n");
  const sections: RawSection[] = [];
  let section: RawSection | null = null;
  let item: RawItem | null = null;
  let entry: { label: string; lines: string[] } | null = null;
  const preamble: string[] = [];

  const isItemSection = (s: RawSection | null): boolean =>
    s !== null && (s.kind === "cards" || s.kind === "fields" || s.kind === "roles" || s.kind === "queries");
  const isVerbatim = (s: RawSection | null): boolean =>
    s !== null && (s.kind === "notes" || s.kind === null);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    const heading = HEADING_RE.exec(line);

    if (heading && heading[1].length === 1 && section === null) {
      // The document title. Decorative; not part of the profile.
      continue;
    }

    if (heading && heading[1].length === 2) {
      const title = heading[2].trim().replace(/:+$/, "").trim();
      const kind = SECTION_ALIASES[norm(title)] ?? null;
      const existing = kind ? sections.find((s) => s.kind === kind) : undefined;
      if (existing) {
        warnings.push(`Line ${i + 1}: duplicate section "## ${title}" merged into the first one.`);
        section = existing;
      } else {
        section = { kind, heading: title, entries: [], items: [], body: [], stray: [] };
        sections.push(section);
        if (!kind) warnings.push(`Line ${i + 1}: unknown section "## ${title}" preserved as-is.`);
      }
      item = null;
      entry = null;
      continue;
    }

    if (section === null) {
      if (!isBlank(line)) preamble.push(line.trim());
      continue;
    }

    if (isVerbatim(section)) {
      // Session Notes and unknown sections keep their body verbatim, minus the
      // one-space escape the serializer puts before `#`-leading lines.
      section.body.push(line.startsWith(" #") ? line.slice(1) : line);
      continue;
    }

    if (heading && isItemSection(section)) {
      const title = heading[2].trim();
      const m = ITEM_HEADING_RE.exec(title);
      const prefix = ID_PREFIX[section.kind as keyof typeof ID_PREFIX];
      if (m && m[1].toUpperCase() === prefix) {
        item = { id: `${prefix}${Number(m[2])}`, title: m[3].trim(), entries: [], line: i + 1 };
      } else {
        item = { id: null, title, entries: [], line: i + 1 };
      }
      section.items.push(item);
      entry = null;
      continue;
    }

    if (heading) {
      // A `###` heading inside Preferences or Skills: keep it as text.
      section.stray.push(line.trim());
      entry = null;
      continue;
    }

    if (isBlank(line)) continue;

    const indented = /^(?:\s{2,}|\t)/.test(line);
    let label: string | null = null;
    let value = "";
    if (!indented) {
      const bold = BOLD_KEY_RE.exec(line);
      if (bold) {
        label = bold[1].trim();
        value = bold[2];
      } else {
        const plain = PLAIN_KEY_RE.exec(line);
        if (plain && isKnownLabel(section, plain[1])) {
          label = plain[1].trim();
          value = plain[2];
        }
      }
    }

    if (label !== null) {
      entry = { label, lines: [value.trim()] };
      if (isItemSection(section)) {
        if (item) item.entries.push(entry);
        else {
          section.stray.push(line.trim());
          entry = null;
        }
      } else {
        section.entries.push(entry);
      }
      continue;
    }

    // Continuation of the current value, or text with no home.
    const text = line.trim();
    if (entry) {
      entry.lines.push(text);
    } else if (isItemSection(section) && item) {
      entry = { label: LABELS.notes, lines: [text] };
      item.entries.push(entry);
      warnings.push(`Line ${i + 1}: unlabeled text under "${item.id ?? item.title}" kept as "${LABELS.notes}".`);
    } else {
      section.stray.push(text);
    }
  }

  if (preamble.length > 0) {
    warnings.push("Text before the first section was moved to Session Notes.");
    const notes = ensureSection(sections, "notes");
    notes.body.unshift(...preamble, "");
  }

  for (const s of sections) {
    if (s.stray.length === 0) continue;
    warnings.push(`Unlabeled text under "## ${s.heading}" was moved to Session Notes.`);
    const notes = ensureSection(sections, "notes");
    if (notes.body.length > 0 && !isBlank(notes.body[notes.body.length - 1])) notes.body.push("");
    notes.body.push(...s.stray);
  }

  return sections;
}

function ensureSection(sections: RawSection[], kind: SectionKind): RawSection {
  let s = sections.find((x) => x.kind === kind);
  if (!s) {
    s = { kind, heading: SECTION_TITLES[kind], entries: [], items: [], body: [], stray: [] };
    sections.push(s);
  }
  return s;
}

function isKnownLabel(section: RawSection, label: string): boolean {
  const n = norm(label);
  switch (section.kind) {
    case "preferences":
      return n in PREFERENCE_ALIASES;
    case "skills":
      return n in SKILL_ALIASES;
    case "cards":
      return n in CARD_ALIASES;
    case "fields":
      return n in FIELD_ALIASES;
    case "roles":
      return n in ROLE_ALIASES;
    case "queries":
      return n in QUERY_ALIASES;
    default:
      return false;
  }
}

/** Joins continuation lines into one text value; blank lines are dropped. */
function textValue(lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join("\n");
}

/**
 * Splits a list value. The first line is comma-separated; continuation lines
 * that start with `- ` are one item each (so URLs with commas survive),
 * other continuation lines are comma-separated too.
 */
function listValue(lines: string[]): string[] {
  const items: string[] = [];
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (l === "") return;
    const bullet = /^[-*+]\s+(.*)$/.exec(l);
    if (bullet && i > 0) {
      items.push(bullet[1].trim());
    } else {
      for (const part of l.split(",")) {
        const p = part.trim();
        if (p !== "") items.push(p);
      }
    }
  });
  return items;
}

function boolValue(lines: string[], where: string, warnings: string[]): boolean {
  const v = textValue(lines).toLowerCase();
  if (["yes", "y", "true", "x", "✓", "excluded", "explored"].includes(v)) return true;
  if (["no", "n", "false", "", "not yet"].includes(v)) return false;
  warnings.push(`${where}: could not read "${textValue(lines)}" as yes/no; using "no".`);
  return false;
}

function enumValue<T extends string>(
  lines: string[],
  aliases: Record<string, T>,
  where: string,
  warnings: string[],
): T | undefined {
  const raw = textValue(lines);
  const hit = aliases[norm(raw)];
  if (hit !== undefined) return hit;
  if (raw !== "") warnings.push(`${where}: unknown value "${raw}".`);
  return undefined;
}

function splitSource(value: string): { value: string; source: PreferenceSource } {
  const m = SOURCE_TAG_RE.exec(value);
  if (!m) return { value: value.trim(), source: "stated" };
  return {
    value: value.slice(0, m.index).trim(),
    source: m[1].toLowerCase() as PreferenceSource,
  };
}

function addExtra(extra: Extra, label: string, value: string, where: string, warnings: string[]): void {
  if (label in extra) {
    warnings.push(`${where}: duplicate key "${label}"; values were joined.`);
    extra[label] = textValue([extra[label], value]);
  } else {
    extra[label] = value;
  }
}

function nextFreeId(prefix: string, used: Set<string>): string {
  let max = 0;
  for (const id of used) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

/** Assigns IDs to items that lack one or collide, keeping declared IDs stable. */
function assignIds(items: RawItem[], prefix: string, warnings: string[]): void {
  const used = new Set<string>();
  for (const it of items) {
    if (it.id && !used.has(it.id)) {
      used.add(it.id);
    } else {
      const id = nextFreeId(prefix, used);
      warnings.push(
        it.id
          ? `Line ${it.line}: duplicate ID ${it.id}; renamed to ${id}.`
          : `Line ${it.line}: "### ${it.title}" had no ID; assigned ${id}.`,
      );
      it.id = id;
      used.add(id);
    }
  }
}

function parsePreferences(section: RawSection | undefined, warnings: string[]): Preferences {
  const prefs: Preferences = { other: [] };
  if (!section) return prefs;
  for (const { label, lines } of section.entries) {
    const key = PREFERENCE_ALIASES[norm(label)];
    const { value, source } = splitSource(textValue(lines));
    if (key === "climateInterests") {
      const values = listValue([value]);
      if (prefs.climateInterests) {
        warnings.push(`Preferences: duplicate "${label}"; values were merged.`);
        prefs.climateInterests.values.push(...values);
      } else {
        prefs.climateInterests = { values, source };
      }
    } else if (key) {
      if (prefs[key]) warnings.push(`Preferences: duplicate "${label}"; the last one wins.`);
      prefs[key] = { value, source };
    } else {
      prefs.other.push({ key: label, value, source });
    }
  }
  return prefs;
}

function parseSkills(section: RawSection | undefined, warnings: string[]): Skills {
  const skills: Skills = { confirmed: [], inferred: [], excluded: [], extra: {} };
  if (!section) return skills;
  for (const { label, lines } of section.entries) {
    const bucket = SKILL_ALIASES[norm(label)];
    if (bucket) skills[bucket].push(...listValue(lines));
    else addExtra(skills.extra, label, textValue(lines), "Skills", warnings);
  }
  return skills;
}

function parseCards(section: RawSection | undefined, warnings: string[]): Card[] {
  if (!section) return [];
  assignIds(section.items, ID_PREFIX.cards, warnings);
  return section.items.map((it) => {
    const card: Card = {
      id: it.id as string,
      title: it.title,
      situation: "",
      actions: "",
      results: "",
      skills: [],
      excluded: false,
      extra: {},
    };
    for (const { label, lines } of it.entries) {
      const key = CARD_ALIASES[norm(label)];
      switch (key) {
        case "situation":
        case "actions":
        case "results":
          card[key] = textValue(lines);
          break;
        case "skills":
          card.skills.push(...listValue(lines));
          break;
        case "excluded":
          card.excluded = boolValue(lines, `${card.id} ${label}`, warnings);
          break;
        default:
          addExtra(card.extra, label, textValue(lines), card.id, warnings);
      }
    }
    return card;
  });
}

function parseFields(section: RawSection | undefined, warnings: string[]): Field[] {
  if (!section) return [];
  assignIds(section.items, ID_PREFIX.fields, warnings);
  return section.items.map((it) => {
    const field: Field = {
      id: it.id as string,
      name: it.title,
      status: "candidate",
      explored: false,
      fit: "",
      uncertain: "",
      sources: [],
      extra: {},
    };
    for (const { label, lines } of it.entries) {
      const key = FIELD_ALIASES[norm(label)];
      const where = `${field.id} ${label}`;
      switch (key) {
        case "status":
          field.status = enumValue(lines, FIELD_STATUS_ALIASES, where, warnings) ?? "candidate";
          break;
        case "explored":
          field.explored = boolValue(lines, where, warnings);
          break;
        case "move": {
          const move = enumValue(lines, MOVE_ALIASES, where, warnings);
          if (move) field.move = move;
          break;
        }
        case "fit":
        case "uncertain":
          field[key] = textValue(lines);
          break;
        case "sources":
          field.sources.push(...listValue(lines));
          break;
        default:
          addExtra(field.extra, label, textValue(lines), field.id, warnings);
      }
    }
    return field;
  });
}

function parseRoles(section: RawSection | undefined, warnings: string[]): Role[] {
  if (!section) return [];
  assignIds(section.items, ID_PREFIX.roles, warnings);
  return section.items.map((it) => {
    const role: Role = {
      id: it.id as string,
      title: it.title,
      fieldId: "",
      companies: [],
      why: "",
      sources: [],
      extra: {},
    };
    for (const { label, lines } of it.entries) {
      const key = ROLE_ALIASES[norm(label)];
      switch (key) {
        case "field":
          role.fieldId = textValue(lines).toUpperCase();
          break;
        case "companies":
          role.companies.push(...listValue(lines));
          break;
        case "why":
          role.why = textValue(lines);
          break;
        case "sources":
          role.sources.push(...listValue(lines));
          break;
        default:
          addExtra(role.extra, label, textValue(lines), role.id, warnings);
      }
    }
    return role;
  });
}

function parseQueries(section: RawSection | undefined, warnings: string[]): Query[] {
  if (!section) return [];
  assignIds(section.items, ID_PREFIX.queries, warnings);
  return section.items.map((it) => {
    const query: Query = {
      id: it.id as string,
      board: "other",
      query: it.title,
      fieldIds: [],
      status: "untried",
      reason: "",
      extra: {},
    };
    for (const { label, lines } of it.entries) {
      const key = QUERY_ALIASES[norm(label)];
      const where = `${query.id} ${label}`;
      switch (key) {
        case "board":
          query.board = enumValue(lines, BOARD_ALIASES, where, warnings) ?? "other";
          break;
        case "fields":
          query.fieldIds.push(...listValue(lines).map((f) => f.toUpperCase()));
          break;
        case "status":
          query.status = enumValue(lines, QUERY_STATUS_ALIASES, where, warnings) ?? "untried";
          break;
        case "reason":
          query.reason = textValue(lines);
          break;
        case "changed": {
          const v = textValue(lines);
          if (v) query.changedAt = v;
          break;
        }
        case "query":
          if (query.query === "") query.query = textValue(lines);
          else addExtra(query.extra, label, textValue(lines), query.id, warnings);
          break;
        default:
          addExtra(query.extra, label, textValue(lines), query.id, warnings);
      }
    }
    return query;
  });
}

function bodyText(lines: string[]): string {
  return lines.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

/**
 * Parses `profile.md`. Never throws on a string; problems are reported in
 * `warnings` and the closest sensible value is used instead.
 */
export function parseProfile(md: string): ParseResult {
  const warnings: string[] = [];
  const sections = tokenize(typeof md === "string" ? md : "", warnings);
  const byKind = (kind: SectionKind) => sections.find((s) => s.kind === kind);

  const profile: Profile = {
    preferences: parsePreferences(byKind("preferences"), warnings),
    cards: parseCards(byKind("cards"), warnings),
    skills: parseSkills(byKind("skills"), warnings),
    fields: parseFields(byKind("fields"), warnings),
    roles: parseRoles(byKind("roles"), warnings),
    queries: parseQueries(byKind("queries"), warnings),
    sessionNotes: bodyText(byKind("notes")?.body ?? []),
    extraSections: sections
      .filter((s) => s.kind === null)
      .map((s) => ({ heading: s.heading, body: bodyText(s.body) })),
  };
  return { profile, warnings };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/** One value line; continuation lines are indented by two spaces. */
function keyLine(label: string, value: string): string {
  const lines = textValue([value].flatMap((v) => v.split("\n")));
  if (lines === "") return `- **${label}:**`;
  const [first, ...rest] = lines.split("\n");
  return [`- **${label}:** ${first}`, ...rest.map((l) => `  ${l}`)].join("\n");
}

/** Inline comma list, unless an item contains a comma (then one per line). */
function inlineListLine(label: string, items: string[]): string {
  const clean = items.map((s) => s.trim()).filter((s) => s !== "");
  if (clean.some((s) => s.includes(","))) return bulletListLine(label, clean);
  return keyLine(label, clean.join(", "));
}

/** One item per indented bullet line (used for sources). */
function bulletListLine(label: string, items: string[]): string {
  const clean = items.map((s) => s.trim()).filter((s) => s !== "");
  if (clean.length === 0) return `- **${label}:**`;
  return [`- **${label}:**`, ...clean.map((s) => `  - ${s}`)].join("\n");
}

/** Item heading: `### C1: Title` on one line. */
function itemHeading(id: string, title: string): string {
  const oneLine = title.replace(/\s+/g, " ").trim();
  return oneLine === "" ? `### ${id}:` : `### ${id}: ${oneLine}`;
}

function extraLines(extra: Extra): string[] {
  return Object.keys(extra)
    .sort()
    .map((k) => keyLine(k, extra[k]));
}

function yesNo(b: boolean): string {
  return b ? "yes" : "no";
}

function withSource(value: string, source: PreferenceSource): string {
  return source === "inferred" ? `${value} (inferred)` : value;
}

/** Escapes lines that would otherwise read as headings when parsed back. */
function verbatimBody(body: string): string {
  return normalizeNewlines(body)
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .map((l) => (l.startsWith("#") ? ` ${l}` : l))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

function serializePreferences(p: Preferences): string[] {
  const out: string[] = [];
  for (const key of KNOWN_PREFERENCE_KEYS) {
    if (key === "climateInterests") {
      const pref = p.climateInterests;
      if (pref) out.push(keyLine(LABELS[key], withSource(pref.values.join(", "), pref.source)));
    } else {
      const pref = p[key];
      if (pref) out.push(keyLine(LABELS[key], withSource(pref.value, pref.source)));
    }
  }
  for (const o of p.other) out.push(keyLine(o.key, withSource(o.value, o.source)));
  return out;
}

function serializeCard(c: Card): string[] {
  return [
    itemHeading(c.id, c.title),
    keyLine(LABELS.situation, c.situation),
    keyLine(LABELS.actions, c.actions),
    keyLine(LABELS.results, c.results),
    inlineListLine(LABELS.skills, c.skills),
    keyLine(LABELS.excluded, yesNo(c.excluded)),
    ...extraLines(c.extra),
  ];
}

function serializeSkills(s: Skills): string[] {
  return [
    inlineListLine(LABELS.confirmed, s.confirmed),
    inlineListLine(LABELS.inferred, s.inferred),
    inlineListLine(LABELS.excludedSkills, s.excluded),
    ...extraLines(s.extra),
  ];
}

function serializeField(f: Field): string[] {
  return [
    itemHeading(f.id, f.name),
    keyLine(LABELS.status, f.status),
    keyLine(LABELS.explored, yesNo(f.explored)),
    keyLine(LABELS.move, f.move ?? ""),
    keyLine(LABELS.fit, f.fit),
    keyLine(LABELS.uncertain, f.uncertain),
    bulletListLine(LABELS.sources, f.sources),
    ...extraLines(f.extra),
  ];
}

function serializeRole(r: Role): string[] {
  return [
    itemHeading(r.id, r.title),
    keyLine(LABELS.field, r.fieldId),
    inlineListLine(LABELS.companies, r.companies),
    keyLine(LABELS.why, r.why),
    bulletListLine(LABELS.sources, r.sources),
    ...extraLines(r.extra),
  ];
}

function serializeQuery(q: Query): string[] {
  return [
    itemHeading(q.id, q.query),
    keyLine(LABELS.board, q.board),
    inlineListLine(LABELS.fields, q.fieldIds),
    keyLine(LABELS.status, q.status),
    keyLine(LABELS.reason, q.reason),
    keyLine(LABELS.changed, q.changedAt ?? ""),
    ...extraLines(q.extra),
  ];
}

function joinItems(blocks: string[][]): string[] {
  return blocks.flatMap((b, i) => (i === 0 ? b : ["", ...b]));
}

/** Writes the canonical `profile.md` text. Always ends with a single newline. */
export function serializeProfile(profile: Profile): string {
  const bodies: Record<SectionKind, string[]> = {
    preferences: serializePreferences(profile.preferences),
    cards: joinItems(profile.cards.map(serializeCard)),
    skills: serializeSkills(profile.skills),
    fields: joinItems(profile.fields.map(serializeField)),
    roles: joinItems(profile.roles.map(serializeRole)),
    queries: joinItems(profile.queries.map(serializeQuery)),
    notes: profile.sessionNotes.trim() === "" ? [] : [verbatimBody(profile.sessionNotes)],
  };

  const out: string[] = ["# Profile"];
  for (const kind of SECTION_ORDER) {
    out.push("", `## ${SECTION_TITLES[kind]}`);
    if (bodies[kind].length > 0) out.push("", ...bodies[kind]);
  }
  for (const s of profile.extraSections) {
    out.push("", `## ${s.heading.trim()}`);
    const body = verbatimBody(s.body);
    if (body !== "") out.push("", body);
  }
  return out.join("\n") + "\n";
}

/** `parseProfile(serializeProfile(p))` — the canonical form of any profile. */
export function normalizeProfile(profile: Profile): Profile {
  return parseProfile(serializeProfile(profile)).profile;
}

// ---------------------------------------------------------------------------
// Pure helpers for later modules
// ---------------------------------------------------------------------------

function nextIdIn(prefix: string, items: Array<{ id: string }>): string {
  return nextFreeId(prefix, new Set(items.map((i) => i.id)));
}

/** Next unused card ID: highest existing number + 1, never reused. */
export function nextCardId(p: Profile): string {
  return nextIdIn(ID_PREFIX.cards, p.cards);
}
export function nextFieldId(p: Profile): string {
  return nextIdIn(ID_PREFIX.fields, p.fields);
}
export function nextRoleId(p: Profile): string {
  return nextIdIn(ID_PREFIX.roles, p.roles);
}
export function nextQueryId(p: Profile): string {
  return nextIdIn(ID_PREFIX.queries, p.queries);
}

/** Card IDs cited in free text, e.g. "… (C1, C3)" → ["C1", "C3"], deduplicated in order. */
export function citedCardIds(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(/\bC(\d+)\b/g)) seen.add(`C${Number(m[1])}`);
  return [...seen];
}

/** Cards the assistant may use: everything not excluded. */
export function activeCards(p: Profile): Card[] {
  return p.cards.filter((c) => !c.excluded);
}

/** Typed preferences that are not yet set (for elicitation). */
export function missingPreferences(p: Profile): PreferenceKey[] {
  return KNOWN_PREFERENCE_KEYS.filter((k) => {
    const v = p.preferences[k];
    if (!v) return true;
    return "values" in v ? v.values.length === 0 : v.value.trim() === "";
  });
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const i = items.findIndex((x) => x.id === item.id);
  if (i === -1) return [...items, item];
  return items.map((x, j) => (j === i ? item : x));
}

type WithOptionalId<T extends { id: string }> = Omit<T, "id"> & { id?: string };

/** Inserts or replaces a card; a card without an ID gets the next free one. */
export function upsertCard(p: Profile, card: WithOptionalId<Card>): Profile {
  const full: Card = { ...card, id: card.id ?? nextCardId(p) };
  return { ...p, cards: upsertById(p.cards, full) };
}

export function upsertField(p: Profile, field: WithOptionalId<Field>): Profile {
  const full: Field = { ...field, id: field.id ?? nextFieldId(p) };
  return { ...p, fields: upsertById(p.fields, full) };
}

export function upsertRole(p: Profile, role: WithOptionalId<Role>): Profile {
  const full: Role = { ...role, id: role.id ?? nextRoleId(p) };
  return { ...p, roles: upsertById(p.roles, full) };
}

export function upsertQuery(p: Profile, query: WithOptionalId<Query>): Profile {
  const full: Query = { ...query, id: query.id ?? nextQueryId(p) };
  return { ...p, queries: upsertById(p.queries, full) };
}

/** Marks a card excluded (or not). Unknown IDs leave the profile unchanged. */
export function setCardExcluded(p: Profile, id: string, excluded: boolean): Profile {
  return { ...p, cards: p.cards.map((c) => (c.id === id ? { ...c, excluded } : c)) };
}

export function setFieldStatus(p: Profile, id: string, status: FieldStatus): Profile {
  return { ...p, fields: p.fields.map((f) => (f.id === id ? { ...f, status } : f)) };
}

export function setFieldExplored(p: Profile, id: string, explored = true): Profile {
  return { ...p, fields: p.fields.map((f) => (f.id === id ? { ...f, explored } : f)) };
}

/**
 * Records "Tried it" feedback on a query. `changedAt` defaults to today's
 * date (UTC, `YYYY-MM-DD`); pass it explicitly for deterministic output.
 */
export function setQueryStatus(
  p: Profile,
  id: string,
  status: QueryStatus,
  reason = "",
  changedAt: string = new Date().toISOString().slice(0, 10),
): Profile {
  return {
    ...p,
    queries: p.queries.map((q) => {
      if (q.id !== id) return q;
      const next: Query = { ...q, status, reason, changedAt };
      if (status === "untried") delete next.changedAt;
      return next;
    }),
  };
}

/** Sets (or clears, with `undefined`) one of the typed text preferences. */
export function setPreference(
  p: Profile,
  key: Exclude<PreferenceKey, "climateInterests">,
  value: string | undefined,
  source: PreferenceSource = "stated",
): Profile {
  const preferences = { ...p.preferences };
  if (value === undefined || value.trim() === "") delete preferences[key];
  else preferences[key] = { value: value.trim(), source };
  return { ...p, preferences };
}

export function setClimateInterests(
  p: Profile,
  values: string[],
  source: PreferenceSource = "stated",
): Profile {
  const preferences = { ...p.preferences };
  const clean = values.map((v) => v.trim()).filter((v) => v !== "");
  if (clean.length === 0) delete preferences.climateInterests;
  else preferences.climateInterests = { values: clean, source };
  return { ...p, preferences };
}

/** Moves a skill into one bucket, removing it from the others (case-insensitive match). */
export function moveSkill(p: Profile, skill: string, to: SkillBucket): Profile {
  const key = skill.trim().toLowerCase();
  const without = (list: string[]) => list.filter((s) => s.trim().toLowerCase() !== key);
  const skills: Skills = {
    confirmed: without(p.skills.confirmed),
    inferred: without(p.skills.inferred),
    excluded: without(p.skills.excluded),
    extra: p.skills.extra,
  };
  skills[to] = [...skills[to], skill.trim()];
  return { ...p, skills };
}

/** Replaces the session notes. */
export function setSessionNotes(p: Profile, notes: string): Profile {
  return { ...p, sessionNotes: notes };
}
