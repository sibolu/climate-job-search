/**
 * Progressive preference elicitation (PRD stage 1.2, PLAN.md step 1.2).
 *
 * A nontechnical fellow should get value before finishing anything that feels
 * like a form. So this module asks **one** optional question — which of six
 * fixed climate areas interest the person, any number of them — and fills the
 * other preferences from what the cards or the person's own words say
 * (technical-plan.md D54).
 *
 * Two halves, kept apart on purpose:
 *
 *   * **The policy is pure.** {@link nextQuestion}, {@link applyPillAnswer},
 *     {@link toggleClimateInterest} and {@link isElicitationComplete} are
 *     deterministic functions of a {@link Profile}. No I/O, no model call, no
 *     Supabase: the six areas are a constant ({@link CLIMATE_AREAS}). That is
 *     what makes the question order and the toggle unit tests, and it lets
 *     the browser record a pick without a round trip.
 *   * **The model does the reading.** {@link inferPreferences} makes one
 *     structured call after cards exist and fills in what the cards support
 *     with high confidence, tagged `inferred` (the "skip when inferable"
 *     rule). {@link interpretAnswer} turns a free-text reply into a stated
 *     preference and picks up anything else the person volunteered in the same
 *     breath. Both go through `llm.ts` (the only door to the API) and neither
 *     ever overwrites a value the user stated. Neither is how a pill pick is
 *     recorded, and `inferPreferences` never writes climate interests: a pick
 *     is always the person's own (technical-plan.md D54).
 *
 * Every write goes through the pure helpers in `profile.ts`; nothing here
 * string-edits markdown. Pills reuse `AnswerPillSchema` from `session.ts`,
 * the one pill shape the chat renders.
 *
 * ## Climate interests rank, they never filter
 *
 * The interest question is multi-select and optional: zero picks is a valid
 * answer and nothing downstream waits for one. Discovery uses the picks to
 * order the fields it lists, never to decide which fields are listed
 * (technical-plan.md D54). The six pills are {@link CLIMATE_AREAS}; anything
 * else in the list came from the person's notes and is kept as written.
 *
 * {@link OPEN_TO_SUGGESTIONS} (`open to suggestions`) is what "not sure" or
 * "show me options" typed in the notes box normalises to. Downstream modules
 * read it as "no area named" via {@link isOpenToSuggestions}, and picking an
 * area drops it.
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
  serializeProfileForPrompt,
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
 * The questions asked, in order: one, answered by tapping pills
 * (technical-plan.md D48, D54).
 *
 * `climateInterests` is the axis discovery orders fields on. The question is
 * multi-select and optional, so it never blocks: with nothing picked,
 * discovery ranks on fit alone.
 *
 * `retrainingAppetite` is deliberately **not** asked (technical-plan.md D54).
 * It remains a {@link PreferenceKey}: the person can state it in their notes,
 * {@link inferPreferences} may fill it from the cards, and discovery still
 * reads it.
 *
 * `seniority` is deliberately **not** asked (technical-plan.md D48). Role
 * titles carry no level, so no later step reads it. It remains a
 * {@link PreferenceKey} and {@link inferPreferences} may still fill it from
 * the cards.
 *
 * `location` and `workMode` are deliberately **not** asked (technical-plan.md D36).
 * They are native filters on every major job board, so the app guides the
 * person to the board's own location and remote/hybrid filter
 * (`ALERT_STEPS` in `boards.ts`) rather than spending a conversational turn
 * on them. Both remain {@link PreferenceKey}s: still inferred from the cards
 * by {@link inferPreferences}, still shown in the profile drawer, still
 * settable from query feedback — only the asking stops.
 */
export const ELICIT_ORDER: readonly PreferenceKey[] = ["climateInterests"];

/**
 * Display order for the closing summary: every known preference, asked or
 * not, so an inferred location or work mode is still shown back for
 * correction. {@link displayValue} drops the ones with no value.
 */
export const SUMMARY_ORDER: readonly PreferenceKey[] = [
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
 * The value that records "no particular climate area — show me options". It
 * is what such a phrase typed in the notes box normalises to: a single list
 * item that {@link isOpenToSuggestions} reads as "no area named".
 */
export const OPEN_TO_SUGGESTIONS = "open to suggestions";

/** True when climate interests are recorded as {@link OPEN_TO_SUGGESTIONS} only. */
export function isOpenToSuggestions(p: Profile): boolean {
  const values = p.preferences.climateInterests?.values ?? [];
  return values.length > 0 && values.every((v) => normalizeInterest(v) === OPEN_TO_SUGGESTIONS);
}

/** The preferences still missing that the conversation actually asks for. */
function missingAskedPreferences(p: Profile): PreferenceKey[] {
  const missing = new Set(missingPreferences(p));
  return ELICIT_ORDER.filter((key) => missing.has(key));
}

/**
 * The one asked preference has a value (stated or inferred). The question is
 * optional, so this gates nothing; `retrainingAppetite`, `seniority`,
 * `location` and `workMode` are not asked and never hold it back.
 */
export function isElicitationComplete(p: Profile): boolean {
  return missingAskedPreferences(p).length === 0;
}

/** The first missing preference in {@link ELICIT_ORDER}, or `undefined` when none is. */
export function nextMissingPreference(p: Profile): PreferenceKey | undefined {
  return missingAskedPreferences(p)[0];
}

// ---------------------------------------------------------------------------
// Questions and pills
// ---------------------------------------------------------------------------

/**
 * One question per key. Each is exactly one question sentence — the
 * acceptance test counts question marks.
 *
 * The one asked key ({@link ELICIT_ORDER}) sits inline on a form above its
 * pills, with no chat and no assistant voice (technical-plan.md D48, D49,
 * D54): a plain question, then one short sentence saying any number may be
 * picked. No "I", no instruction to tap or type. The other four are never
 * asked; their wording stays for {@link interpretAnswer}, which quotes the
 * question a reply was given to.
 */
export const QUESTIONS: Record<PreferenceKey, string> = {
  climateInterests:
    "Which area of climate work interests you most? " +
    "Pick as many as you like.",
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
    "How much retraining are you open to? " +
    "The answer sets how far the listed roles can be from the work you do now.",
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

/** Fixed pills for the single-value keys. The climate-interest pills are {@link CLIMATE_AREAS}. */
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
    // With no text box, "it depends" needs a pill of its own (technical-plan.md D48).
    { label: "Not sure yet — it depends on the role", value: "not sure yet, depends on the role" },
  ],
};

/**
 * The six climate areas offered as interest pills, in display order
 * (technical-plan.md D54). Fixed here rather than read from the reference
 * collection, whose `sector_group` is coarser than these.
 */
export const CLIMATE_AREAS: readonly string[] = [
  "Circular Economy",
  "Built Environment",
  "Transportation",
  "Energy",
  "Food & Agriculture",
  "Carbon Removal",
];

/**
 * The pills offered for a key; wire shape only (`label`, `value`). The
 * climate-interest pills are exactly {@link CLIMATE_AREAS}, label and value
 * the same.
 */
export function pillsFor(key: PreferenceKey): AnswerPill[] {
  if (key === "climateInterests") return CLIMATE_AREAS.map((area) => ({ label: area, value: area }));
  return PILLS[key].map(({ label, value }) => ({ label, value }));
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export interface ElicitAsk {
  kind: "ask";
  key: PreferenceKey;
  /** Exactly one question sentence, with a line of framing. */
  question: string;
  /** Every asked question can be answered from these alone (technical-plan.md D48). */
  pills: AnswerPill[];
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
export function nextQuestion(p: Profile): ElicitDecision {
  const key = nextMissingPreference(p);
  if (key === undefined) return { kind: "done", summary: doneSummary(p) };
  return { kind: "ask", key, question: QUESTIONS[key], pills: pillsFor(key) };
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
  for (const key of SUMMARY_ORDER) {
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
 * Records a pill click as a stated preference, no model call. The
 * climate-interest question is multi-select, so a click there toggles the
 * pill ({@link toggleClimateInterest}); every other key holds one value and
 * the click replaces it. A pill with a side effect (`also`) settles that
 * second preference too — but only where it is still missing, so a stated
 * value is never overwritten by a shortcut. An unknown pill value is
 * recorded as typed.
 */
export function applyPillAnswer(p: Profile, key: PreferenceKey, pill: AnswerPill): Profile {
  if (key === "climateInterests") return toggleClimateInterest(p, pill.value);
  let next = setPreference(p, key, cleanValue(pill.value), "stated");
  const definition = PILLS[key].find((d) => d.value === pill.value);
  const missing = new Set(missingPreferences(next));
  for (const [alsoKey, alsoValue] of Object.entries(definition?.also ?? {})) {
    const k = alsoKey as Exclude<PreferenceKey, "climateInterests">;
    if (missing.has(k)) next = setPreference(next, k, alsoValue, "stated");
  }
  return next;
}

/**
 * One click on a climate-interest pill: adds the value when it is absent and
 * removes it when it is present (case-insensitive), so any number of areas
 * can be picked and unpicked (technical-plan.md D54). The result is always
 * `stated`: the person touched the list. Adding an area drops
 * {@link OPEN_TO_SUGGESTIONS}, which only ever means "none named"; values
 * that are not one of {@link CLIMATE_AREAS} (typed in the notes box) are
 * kept. Removing the last value removes the preference, which is a valid
 * answer: the question is optional.
 */
export function toggleClimateInterest(p: Profile, value: string): Profile {
  const picked = cleanInterest(value);
  if (picked === "") return p;
  const k = picked.toLowerCase();
  const current = p.preferences.climateInterests?.values ?? [];
  const present = current.some((v) => cleanInterest(v).toLowerCase() === k);
  // A pill value is written in the pill's own spelling, however it was typed.
  const area = CLIMATE_AREAS.find((a) => a.toLowerCase() === k);
  const next = present
    ? current.filter((v) => cleanInterest(v).toLowerCase() !== k)
    : [...current, area ?? picked];
  return setClimateInterests(p, cleanInterests(next), "stated");
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
 * own serializer, so the model reads the same format the user edits, minus
 * the `## Inputs` section: what the person typed is never sent
 * (technical-plan.md D56).
 */
function profileForModel(p: Profile, { withCards }: { withCards: boolean }): string {
  const reduced: Profile = {
    ...emptyProfile(),
    preferences: p.preferences,
    cards: withCards ? activeCards(p) : [],
    skills: withCards ? p.skills : emptyProfile().skills,
  };
  return serializeProfileForPrompt(reduced);
}

type TextKey = Exclude<PreferenceKey, "climateInterests">;
const TEXT_KEYS: readonly TextKey[] = ["location", "workMode", "seniority", "retrainingAppetite"];

// ---------------------------------------------------------------------------
// inferPreferences — the "skip when inferable" rule
// ---------------------------------------------------------------------------

export const INFER_SYSTEM = `You read the experience cards of someone exploring a move into climate work and infer only the work preferences the cards clearly support. Leaving a preference open is always safe, because the person can state it themselves; a wrong inference costs them trust.

Preferences and what counts as evidence:
- location: the city, region or country the person is based in, only when the cards state it plainly (an employer's location is not the person's).
- workMode: remote / hybrid / on-site, only when the cards say the person sought or chose that arrangement. That a past job happened to be remote or on-site is not a preference.
- seniority: the level a hiring manager would read from the cards: years, scope, titles, team size, budget. This is usually inferable; describe the level, not a job title.
- retrainingAppetite: only with direct evidence, such as a degree, certificate or long course the person undertook to change direction. Rarely inferable.

Rules:
- confidence "high" means a careful reader of the cards would agree without hesitation. Anything less is "medium", "low" or "none". Only "high" is used.
- value is a short phrase the person could have written themselves, for example "senior, 12 years, led teams of 8". Never a name, an email or an employer's name.
- evidence cites card IDs (C1, C3) and says what in them supports the value, in one sentence. Use an empty string when confidence is "none".
- When nothing supports a preference: value null, confidence "none".`;

const InferenceSchema = z.object({
  value: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low", "none"]),
  evidence: z.string(),
});

/** What {@link inferPreferences} asks the model for. Every key present; nulls mean "nothing to infer". */
export const InferredPreferencesSchema = z.object({
  location: InferenceSchema,
  workMode: InferenceSchema,
  seniority: InferenceSchema,
  retrainingAppetite: InferenceSchema,
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
 * value — or an earlier inference — is never overwritten. Climate interests
 * are never inferred: a pick is always the person's own
 * (technical-plan.md D54). With no active cards, or no text preference
 * missing, there is nothing to read, so no call is made.
 */
export async function inferPreferences(llm: Llm, args: ElicitLlmArgs): Promise<InferPreferencesResult> {
  const { profile } = args;
  const missing = new Set(missingPreferences(profile));
  // Climate interests are never inferred (technical-plan.md D54), so only a missing text key needs a call.
  if (activeCards(profile).length === 0 || TEXT_KEYS.every((key) => !missing.has(key))) {
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
