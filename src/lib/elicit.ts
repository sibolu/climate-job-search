/**
 * Progressive preference elicitation (PRD stage 1.2, PLAN.md §3 step 1.2).
 *
 * A nontechnical fellow should get value before finishing anything that feels
 * like a form. So this module asks for **one** preference per turn, in the
 * order that matters most for discovery, skips anything already stated or
 * already inferable from the experience cards, and stops as soon as every
 * typed preference in the `profile.md` contract is known.
 *
 * Two halves, kept apart on purpose:
 *
 *   * **The policy is pure.** {@link nextQuestion}, {@link applyPillAnswer} and
 *     {@link isElicitationComplete} are deterministic functions of a
 *     {@link Profile}. No I/O, no model call, no Supabase: the caller passes
 *     the "browse industries" chips in as `sectorGroups` (from
 *     `listSectorGroups()` in `reference.ts`). That is what makes the
 *     acceptance check — a scripted transcript that never asks two things at
 *     once and stops once enough is known — a unit test, and it lets the
 *     browser render pills without a round trip.
 *   * **The model does the reading.** {@link inferPreferences} makes one
 *     structured call after cards exist and fills in what the cards support
 *     with high confidence, tagged `inferred` (the "skip when inferable"
 *     rule). {@link interpretAnswer} turns a free-text reply into a stated
 *     preference and picks up anything else the person volunteered in the same
 *     breath. Both go through `llm.ts` (the only door to the API) and neither
 *     ever overwrites a value the user stated.
 *
 * Every write goes through the pure helpers in `profile.ts`; nothing here
 * string-edits markdown. Pills reuse `AnswerPillSchema` from `session.ts`,
 * the one pill shape the chat renders.
 *
 * ## Representing "I don't know yet"
 *
 * The climate-interests question offers a "Not sure yet — show me options"
 * pill. Its answer is recorded as the single stated value
 * {@link OPEN_TO_SUGGESTIONS} (`open to suggestions`): the contract's
 * `climateInterests` is a plain list, so an *empty* list would read as
 * "unknown" and the loop would ask again. Downstream modules treat that value
 * as "no constraint" via {@link isOpenToSuggestions}. Any other interest that
 * equals a `climate_fields.sector_group` is a direct pointer into the
 * reference collection, which is why chip values are the raw group strings.
 *
 * Prompts live here as plain template strings so they can be edited without
 * touching React (CLAUDE.md). The system prompts are byte-stable — the
 * profile and the answer travel in the user message — because `llm.ts` sends
 * the system prompt as a cached block.
 */

import { z } from "zod";

import type { CallMetrics, Llm } from "./llm";
import {
  activeCards,
  emptyProfile,
  KNOWN_PREFERENCE_KEYS,
  missingPreferences,
  serializeProfile,
  setClimateInterests,
  setPreference,
  type PreferenceKey,
  type Profile,
} from "./profile";
import type { AnswerPill } from "./session";

// ---------------------------------------------------------------------------
// The policy: what to ask, in what order
// ---------------------------------------------------------------------------

/**
 * The order questions are asked in. Rationale, most decision-relevant first:
 *
 *   1. `climateInterests` — it is the axis discovery ranks fields on; without
 *      it every other answer only filters an unknown set. It is also the one
 *      question where "not sure yet" is a good answer (see
 *      {@link OPEN_TO_SUGGESTIONS}), so it never blocks.
 *   2. `location` — geography decides which employers are in reach at all
 *      (offshore wind, utilities and manufacturing are regional).
 *   3. `workMode` — remote/hybrid/on-site is the second reachability filter,
 *      and one location pill ("remote only") answers it for free.
 *   4. `seniority` — calibrates the role level; the cards usually make this
 *      inferable, so it is often skipped.
 *   5. `retrainingAppetite` — decides between a sector move, an adjacent role
 *      and a retrain. It is most useful once fields are on the table, so it
 *      goes last; it is rarely inferable, so it is still asked.
 */
export const ELICIT_ORDER: readonly PreferenceKey[] = [
  "climateInterests",
  "location",
  "workMode",
  "seniority",
  "retrainingAppetite",
];

/** Human labels, matching the `profile.md` key labels. */
export const PREFERENCE_LABELS: Record<PreferenceKey, string> = {
  location: "Location",
  workMode: "Work mode",
  seniority: "Seniority",
  retrainingAppetite: "Retraining appetite",
  climateInterests: "Climate interests",
};

/**
 * The stated value that records "no particular climate area yet — show me
 * options". A single list item, so the contract's `climateInterests` counts
 * as known and the loop moves on.
 */
export const OPEN_TO_SUGGESTIONS = "open to suggestions";

/** True when climate interests are recorded as {@link OPEN_TO_SUGGESTIONS} only. */
export function isOpenToSuggestions(p: Profile): boolean {
  const values = p.preferences.climateInterests?.values ?? [];
  return values.length > 0 && values.every((v) => normalizeInterest(v) === OPEN_TO_SUGGESTIONS);
}

/** Every typed preference is known (stated or inferred). */
export function isElicitationComplete(p: Profile): boolean {
  return missingPreferences(p).length === 0;
}

/** The first missing preference in {@link ELICIT_ORDER}, or `undefined` when none is. */
export function nextMissingPreference(p: Profile): PreferenceKey | undefined {
  const missing = new Set(missingPreferences(p));
  return ELICIT_ORDER.find((key) => missing.has(key));
}

// ---------------------------------------------------------------------------
// Questions and pills
// ---------------------------------------------------------------------------

/**
 * One question per key. Each is exactly one question sentence — the
 * acceptance test counts question marks — framed by a sentence on why it
 * matters, the way a career coach would ask rather than a form.
 */
export const QUESTIONS: Record<PreferenceKey, string> = {
  climateInterests:
    "Let's start with what draws you to climate work, since it shapes everything else I suggest. " +
    "Is there a part of the climate picture you already lean toward? " +
    "Tap one below to start, or type your own — a few words is plenty, and \"not sure yet\" " +
    "is a perfectly good answer.",
  location:
    "Now, geography, because it changes which employers are even in reach. " +
    "Where do you want to be based? " +
    "If you're staying put, type your city or region so I can weigh what's nearby; " +
    "if you're flexible, pick an option below.",
  workMode:
    "How do you want to work day to day — remote, hybrid, or on-site? " +
    "Some climate roles are hands-on and local, others are fully remote, so this helps me " +
    "rule things in and out early.",
  seniority:
    "Where would you place yourself in terms of seniority? " +
    "Pick the closest level below — I'll use it to aim at roles at the right level, " +
    "not a step down just because the sector is new to you.",
  retrainingAppetite:
    "Last one: how much retraining are you up for? " +
    "Some moves reuse what you already do, others need a certificate or a longer course, " +
    "and I'd rather show you options that match the time you actually want to spend.",
};

/**
 * A pill as this module defines it: what the chat shows, what gets recorded,
 * and any second preference the choice settles at the same time (a "remote
 * only" location also answers work mode). `AnswerPill` is the wire shape;
 * `also` stays here.
 */
interface PillDefinition extends AnswerPill {
  also?: Partial<Record<Exclude<PreferenceKey, "climateInterests">, string>>;
}

/** Fixed pills per key. The climate-interests chips are built from `sectorGroups`. */
const PILLS: Record<Exclude<PreferenceKey, "climateInterests">, readonly PillDefinition[]> = {
  location: [
    { label: "Open to relocating within my country", value: "open to relocating within my country" },
    { label: "Open to relocating anywhere", value: "open to relocating anywhere" },
    {
      label: "Location doesn't matter — remote only",
      value: "anywhere, remote only",
      also: { workMode: "remote" },
    },
  ],
  workMode: [
    { label: "Remote", value: "remote" },
    { label: "Hybrid", value: "hybrid" },
    { label: "On-site", value: "on-site" },
    { label: "Remote or hybrid", value: "remote or hybrid" },
    { label: "No strong preference", value: "no strong preference" },
  ],
  seniority: [
    { label: "Early career (0–3 years)", value: "early career" },
    { label: "Mid-level (3–8 years)", value: "mid-level" },
    { label: "Senior (8+ years)", value: "senior" },
    { label: "Manager or team lead", value: "manager or team lead" },
    { label: "Director or above", value: "director or above" },
  ],
  retrainingAppetite: [
    { label: "None — I want to use what I already know", value: "none, use existing skills" },
    { label: "A short course or certificate (weeks)", value: "low, a short course or certificate" },
    { label: "A few months of serious study", value: "medium, a few months of study" },
    {
      label: "Open to a degree or a full retrain (a year or more)",
      value: "high, open to a degree or full retrain",
    },
  ],
};

/** The pill that records {@link OPEN_TO_SUGGESTIONS}. */
export const NOT_SURE_PILL: AnswerPill = {
  label: "Not sure yet — show me options",
  value: OPEN_TO_SUGGESTIONS,
};

/**
 * Chips shown when the reference collection has no sector groups yet (it is
 * filled in Phase 1.3). Broad enough to be honest, few enough to scan.
 */
export const DEFAULT_CLIMATE_AREAS: readonly string[] = [
  "clean energy & grid",
  "buildings & transport",
  "industry & materials",
  "food & nature",
  "climate finance & policy",
  "climate software & data",
];

/** At most this many industry chips, plus {@link NOT_SURE_PILL}. */
export const MAX_INTEREST_CHIPS = 7;

/** `energy/grid/storage` → `Energy / grid / storage`. */
function humanizeSectorGroup(group: string): string {
  const parts = group
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const joined = parts.join(" / ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

function interestPills(sectorGroups: readonly string[]): AnswerPill[] {
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const raw of sectorGroups) {
    const group = raw.trim();
    if (group === "" || seen.has(group)) continue;
    seen.add(group);
    groups.push(group);
    if (groups.length === MAX_INTEREST_CHIPS) break;
  }
  const chips = groups.length > 0 ? groups : DEFAULT_CLIMATE_AREAS;
  return [...chips.map((g) => ({ label: humanizeSectorGroup(g), value: g })), NOT_SURE_PILL];
}

/** The pills offered for a key; wire shape only (`label`, `value`). */
export function pillsFor(key: PreferenceKey, ctx: ElicitContext): AnswerPill[] {
  if (key === "climateInterests") return interestPills(ctx.sectorGroups);
  return PILLS[key].map(({ label, value }) => ({ label, value }));
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export interface ElicitContext {
  /** Distinct `climate_fields.sector_group` values, from `listSectorGroups()`. May be empty. */
  sectorGroups: readonly string[];
}

export interface ElicitAsk {
  kind: "ask";
  key: PreferenceKey;
  /** Exactly one question sentence, with a line of framing. */
  question: string;
  pills: AnswerPill[];
  /** The chat input stays open; a pill is a shortcut, never the only way. */
  allowFreeText: true;
}

export interface ElicitDone {
  kind: "done";
  /** What is on file, with inferred values tagged so the user can correct them. */
  summary: string;
}

export type ElicitDecision = ElicitAsk | ElicitDone;

/**
 * Pure and deterministic: the one question to ask now, or `done` with a
 * summary. A preference already stated or inferred is never asked.
 */
export function nextQuestion(p: Profile, ctx: ElicitContext): ElicitDecision {
  const key = nextMissingPreference(p);
  if (key === undefined) return { kind: "done", summary: doneSummary(p) };
  return { kind: "ask", key, question: QUESTIONS[key], pills: pillsFor(key, ctx), allowFreeText: true };
}

/** The inferred tag as the summary shows it; the test looks for it. */
export const INFERRED_TAG = "(inferred from your experience — tell me if that's off)";

function displayValue(p: Profile, key: PreferenceKey): { text: string; inferred: boolean } | undefined {
  if (key === "climateInterests") {
    const pref = p.preferences.climateInterests;
    if (pref === undefined || pref.values.length === 0) return undefined;
    const text = isOpenToSuggestions(p) ? "open to suggestions — I'll propose areas" : pref.values.join(", ");
    return { text, inferred: pref.source === "inferred" };
  }
  const pref = p.preferences[key];
  if (pref === undefined || pref.value.trim() === "") return undefined;
  return { text: pref.value, inferred: pref.source === "inferred" };
}

function doneSummary(p: Profile): string {
  const lines: string[] = [];
  for (const key of ELICIT_ORDER) {
    const shown = displayValue(p, key);
    if (shown === undefined) continue;
    lines.push(`- ${PREFERENCE_LABELS[key]}: ${shown.text}${shown.inferred ? ` ${INFERRED_TAG}` : ""}`);
  }
  const cards = activeCards(p).length;
  const opening =
    cards > 0
      ? `That's everything I need to start. I'm working from ${cards} experience card${cards === 1 ? "" : "s"} and these preferences:`
      : "That's everything I need to start. Here is what I have on file:";
  return [
    opening,
    ...lines,
    "Correct anything above in a word or two, or say \"go\" and I'll pull together climate fields worth a look.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Pure answers: pills
// ---------------------------------------------------------------------------

/**
 * Records a pill click as a stated preference, no model call. A pill with a
 * side effect (`also`) settles that second preference too — but only where it
 * is still missing, so a stated value is never overwritten by a shortcut.
 * An unknown pill value is recorded as typed.
 */
export function applyPillAnswer(p: Profile, key: PreferenceKey, pill: AnswerPill): Profile {
  if (key === "climateInterests") {
    return setClimateInterests(p, [cleanInterest(pill.value)], "stated");
  }
  let next = setPreference(p, key, cleanValue(pill.value), "stated");
  const definition = PILLS[key].find((d) => d.value === pill.value);
  const missing = new Set(missingPreferences(next));
  for (const [alsoKey, alsoValue] of Object.entries(definition?.also ?? {})) {
    const k = alsoKey as Exclude<PreferenceKey, "climateInterests">;
    if (missing.has(k)) next = setPreference(next, k, alsoValue, "stated");
  }
  return next;
}

// ---------------------------------------------------------------------------
// Value hygiene (shared by pills and model output)
// ---------------------------------------------------------------------------

/** Longest value written into a preference; the file is meant to be read in a textarea. */
export const MAX_PREFERENCE_VALUE_CHARS = 200;

/** Collapses whitespace, strips a `(inferred)`/`(stated)` tag a model might add, caps length. */
function cleanValue(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\((?:inferred|stated)\)\s*$/i, "")
    .trim()
    .slice(0, MAX_PREFERENCE_VALUE_CHARS)
    .trimEnd();
}

/** Phrases that mean "no particular area yet", normalized to {@link OPEN_TO_SUGGESTIONS}. */
const OPEN_PHRASES = new Set([
  "open to suggestions",
  "open",
  "open to anything",
  "not sure",
  "not sure yet",
  "unsure",
  "no idea",
  "anything",
  "show me options",
  "no preference",
]);

function normalizeInterest(raw: string): string {
  const v = cleanValue(raw).toLowerCase().replace(/[.!]+$/, "").trim();
  return OPEN_PHRASES.has(v) ? OPEN_TO_SUGGESTIONS : v;
}

function cleanInterest(raw: string): string {
  const normalized = normalizeInterest(raw);
  return normalized === OPEN_TO_SUGGESTIONS ? OPEN_TO_SUGGESTIONS : cleanValue(raw);
}

/**
 * A list of interests from the model or the user. "Open" phrases collapse to
 * the one constant, and if it is present alongside real interests the real
 * ones win.
 */
function cleanInterests(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let open = false;
  for (const raw of values) {
    const value = cleanInterest(raw);
    if (value === "") continue;
    if (value === OPEN_TO_SUGGESTIONS) {
      open = true;
      continue;
    }
    const k = value.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(value);
  }
  return out.length > 0 ? out : open ? [OPEN_TO_SUGGESTIONS] : [];
}

/** A label for `preferences.other`: letters, digits, spaces and hyphens only, since it becomes `- **Key:**`. */
function cleanOtherKey(raw: string): string {
  return raw
    .replace(/[^A-Za-z0-9 -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

const TYPED_LABELS_NORMALIZED = new Set(
  KNOWN_PREFERENCE_KEYS.map((k) => PREFERENCE_LABELS[k].toLowerCase().replace(/[^a-z]/g, "")),
);

/** A typed preference must never be smuggled in through `other`. */
function isTypedLabel(key: string): boolean {
  return TYPED_LABELS_NORMALIZED.has(key.toLowerCase().replace(/[^a-z]/g, ""));
}

// ---------------------------------------------------------------------------
// Model half: shared plumbing
// ---------------------------------------------------------------------------

export interface ElicitLlmArgs {
  /** Random, anonymous; from `session.ts`. */
  sessionId: string;
  profile: Profile;
}

export interface ElicitLlmResult {
  profile: Profile;
  metrics: CallMetrics;
  /** Which typed preferences this call set. */
  updatedKeys: PreferenceKey[];
}

/**
 * The profile as the model sees it: preferences, active cards and skills.
 * Fields, roles and queries are noise for this job. Built with the contract's
 * own serializer, so the model reads the same format the user edits.
 */
function profileForModel(p: Profile, { withCards }: { withCards: boolean }): string {
  const reduced: Profile = {
    ...emptyProfile(),
    preferences: p.preferences,
    cards: withCards ? activeCards(p) : [],
    skills: withCards ? p.skills : emptyProfile().skills,
  };
  return serializeProfile(reduced);
}

type TextKey = Exclude<PreferenceKey, "climateInterests">;
const TEXT_KEYS: readonly TextKey[] = ["location", "workMode", "seniority", "retrainingAppetite"];

// ---------------------------------------------------------------------------
// inferPreferences — the "skip when inferable" rule
// ---------------------------------------------------------------------------

export const INFER_SYSTEM = `You read the experience cards of someone exploring a move into climate work and infer only the work preferences the cards clearly support. The person will be asked about anything you leave open, so leaving a preference open is always safe; a wrong inference costs them trust.

Preferences and what counts as evidence:
- location: the city, region or country the person is based in, only when the cards state it plainly (an employer's location is not the person's).
- workMode: remote / hybrid / on-site, only when the cards say the person sought or chose that arrangement. That a past job happened to be remote or on-site is not a preference.
- seniority: the level a hiring manager would read from the cards: years, scope, titles, team size, budget. This is usually inferable; describe the level, not a job title.
- retrainingAppetite: only with direct evidence, such as a degree, certificate or long course the person undertook to change direction. Rarely inferable.
- climateInterests: only when several cards show sustained climate-adjacent work in a named area. A single project is not enough.

Rules:
- confidence "high" means a careful reader of the cards would agree without hesitation. Anything less is "medium", "low" or "none". Only "high" is used.
- value is a short phrase the person could have written themselves, for example "senior, 12 years, led teams of 8". Never a name, an email or an employer's name.
- evidence cites card IDs (C1, C3) and says what in them supports the value, in one sentence. Use an empty string when confidence is "none".
- When nothing supports a preference: value null (or an empty list), confidence "none".`;

const InferenceSchema = z.object({
  value: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low", "none"]),
  evidence: z.string(),
});

const ListInferenceSchema = z.object({
  values: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low", "none"]),
  evidence: z.string(),
});

/** What {@link inferPreferences} asks the model for. Every key present; nulls mean "nothing to infer". */
export const InferredPreferencesSchema = z.object({
  location: InferenceSchema,
  workMode: InferenceSchema,
  seniority: InferenceSchema,
  retrainingAppetite: InferenceSchema,
  climateInterests: ListInferenceSchema,
});
export type InferredPreferences = z.infer<typeof InferredPreferencesSchema>;

export interface Inference {
  key: PreferenceKey;
  value: string;
  /** The model's one-sentence justification, citing card IDs. For the UI, never for the profile. */
  evidence: string;
}

export interface InferPreferencesResult extends ElicitLlmResult {
  inferred: Inference[];
}

/**
 * One structured call: what the cards support with high confidence is written
 * as `inferred`, and only where the preference is still missing. A stated
 * value — or an earlier inference — is never overwritten. With no active cards
 * there is nothing to read, so no call is made.
 */
export async function inferPreferences(llm: Llm, args: ElicitLlmArgs): Promise<InferPreferencesResult> {
  const { profile } = args;
  const missing = new Set(missingPreferences(profile));
  if (activeCards(profile).length === 0 || missing.size === 0) {
    return { profile, metrics: noCall(), updatedKeys: [], inferred: [] };
  }

  const { value, ...metrics } = await llm.structured({
    step: "elicit",
    sessionId: args.sessionId,
    system: INFER_SYSTEM,
    messages: [
      {
        role: "user",
        content:
          "Infer what the experience cards below clearly support. Preferences already listed " +
          "under ## Preferences are known; do not repeat them.\n\n" +
          profileForModel(profile, { withCards: true }),
      },
    ],
    schema: InferredPreferencesSchema,
  });

  let next = profile;
  const updatedKeys: PreferenceKey[] = [];
  const inferred: Inference[] = [];

  for (const key of TEXT_KEYS) {
    const inference = value[key];
    if (!missing.has(key) || inference.confidence !== "high" || inference.value === null) continue;
    const text = cleanValue(inference.value);
    if (text === "") continue;
    next = setPreference(next, key, text, "inferred");
    updatedKeys.push(key);
    inferred.push({ key, value: text, evidence: cleanValue(inference.evidence) });
  }

  const interests = value.climateInterests;
  if (missing.has("climateInterests") && interests.confidence === "high") {
    const values = cleanInterests(interests.values).filter((v) => v !== OPEN_TO_SUGGESTIONS);
    if (values.length > 0) {
      next = setClimateInterests(next, values, "inferred");
      updatedKeys.push("climateInterests");
      inferred.push({ key: "climateInterests", value: values.join(", "), evidence: cleanValue(interests.evidence) });
    }
  }

  return { profile: next, metrics, updatedKeys, inferred };
}

// ---------------------------------------------------------------------------
// interpretAnswer — free text → stated preference(s)
// ---------------------------------------------------------------------------

export const INTERPRET_SYSTEM = `You turn one chat reply from a person exploring climate careers into structured work preferences. You are given the question the assistant just asked (it is about one preference), the preferences already on file, and the person's reply.

For each preference, return the value the reply states, or null when the reply says nothing about it:
- location: where they want to be based, or how flexible they are ("open to relocating", "anywhere, remote only").
- workMode: remote / hybrid / on-site, or a combination, or "no strong preference".
- seniority: the level they describe.
- retrainingAppetite: how much time they are willing to spend retraining.
- climateInterests: a list of the climate areas they name. If they say they are unsure, open, or want to see options, return exactly ["open to suggestions"].

Rules:
- Fill the asked preference whenever the reply answers it, even loosely or in passing. A reply that changes the subject leaves it null.
- Capture anything else the reply volunteers about the five preferences above, and put any other constraint (salary, travel, hours, visa, industries to avoid) in "other" as a short key and value, for example {"key": "Salary floor", "value": "75k"}. Never use one of the five preference names as an "other" key.
- Values are short phrases in the person's own terms. Do not add anything they did not say, and never include a name, email or employer name.
- A reply may correct something already on file; return the corrected value.`;

/** What {@link interpretAnswer} asks the model for. `null` means "the reply did not say". */
export const InterpretedAnswerSchema = z.object({
  location: z.string().nullable(),
  workMode: z.string().nullable(),
  seniority: z.string().nullable(),
  retrainingAppetite: z.string().nullable(),
  climateInterests: z.array(z.string()).nullable(),
  other: z.array(z.object({ key: z.string(), value: z.string() })),
});
export type InterpretedAnswer = z.infer<typeof InterpretedAnswerSchema>;

export interface InterpretAnswerArgs extends ElicitLlmArgs {
  /** The preference the last question was about. */
  key: PreferenceKey;
  /** The user's free-text reply. */
  answer: string;
}

export interface InterpretAnswerResult extends ElicitLlmResult {
  /** True when the reply answered the question that was asked. */
  answered: boolean;
}

/**
 * One structured call. The asked preference and anything else the reply
 * states become stated values (a reply may correct what is on file, so stated
 * values are replaced here — this is the user speaking). Extra constraints
 * land in `preferences.other`. Only ONE question is asked next turn regardless
 * of how much was volunteered: that is {@link nextQuestion}'s job.
 */
export async function interpretAnswer(llm: Llm, args: InterpretAnswerArgs): Promise<InterpretAnswerResult> {
  const { profile, key } = args;
  const { value, ...metrics } = await llm.structured({
    step: "elicit",
    sessionId: args.sessionId,
    system: INTERPRET_SYSTEM,
    messages: [
      {
        role: "user",
        content:
          `The assistant asked about: ${PREFERENCE_LABELS[key]}.\n` +
          `The question was: ${QUESTIONS[key]}\n\n` +
          `Preferences on file:\n\n${profileForModel(profile, { withCards: false })}\n` +
          `The person replied:\n\n${args.answer}`,
      },
    ],
    schema: InterpretedAnswerSchema,
  });

  let next = profile;
  const updatedKeys: PreferenceKey[] = [];

  for (const textKey of TEXT_KEYS) {
    const raw = value[textKey];
    if (raw === null) continue;
    const text = cleanValue(raw);
    if (text === "") continue;
    next = setPreference(next, textKey, text, "stated");
    updatedKeys.push(textKey);
  }

  if (value.climateInterests !== null) {
    const values = cleanInterests(value.climateInterests);
    if (values.length > 0) {
      next = setClimateInterests(next, values, "stated");
      updatedKeys.push("climateInterests");
    }
  }

  if (value.other.length > 0) {
    let other = [...next.preferences.other];
    for (const entry of value.other) {
      const otherKey = cleanOtherKey(entry.key);
      const otherValue = cleanValue(entry.value);
      if (otherKey === "" || otherValue === "" || isTypedLabel(otherKey)) continue;
      const i = other.findIndex((o) => o.key.toLowerCase() === otherKey.toLowerCase());
      const record = { key: i === -1 ? otherKey : other[i].key, value: otherValue, source: "stated" as const };
      other = i === -1 ? [...other, record] : other.map((o, j) => (j === i ? record : o));
    }
    next = { ...next, preferences: { ...next.preferences, other } };
  }

  return { profile: next, metrics, updatedKeys, answered: updatedKeys.includes(key) };
}

/** Metrics for a call that was skipped: nothing sent, nothing spent. */
function noCall(): CallMetrics {
  return {
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0,
    durationMs: 0,
    continuations: 0,
    stopReason: null,
  };
}
