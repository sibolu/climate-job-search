/**
 * Query generation and revision (Phase 2.3, reworked in 2b.8).
 *
 * `generateQueries` writes ONE LinkedIn search per selected role, for every
 * role with `Selected: yes` across all fields, in one model call
 * (technical-plan.md D47, which supersedes the per-field, three-board design
 * of D40). Each query carries its role's id (`Role: R3`) and that role's
 * field. The person pastes it into LinkedIn's job search box and follows the
 * static instructions for saving it as an email alert ({@link ALERT_STEPS}).
 * `reviseQueries` takes one piece of "Tried it" feedback and returns updated
 * queries, field status changes, profile edits and a one-paragraph
 * explanation; it stays dispatchable, but nothing in the browser sends it.
 *
 * Rules this module enforces:
 * - Every model call goes through `src/lib/llm.ts` (`structured`, no web
 *   tools). This module fetches nothing; LinkedIn is never contacted, and
 *   telling the user where to search is not scraping.
 * - LinkedIn only: generation and revision write `board: linkedin` and
 *   nothing else. Queries on other boards written before D47 stay in the
 *   file untouched.
 * - IDs are stable: a query is never deleted or renumbered. A query is
 *   retired only while `untried`, by setting `extra["Retired"] = "yes"` and
 *   `extra["Retired reason"]`; a `good`/`bad` status is the user speaking and
 *   is never rewritten.
 * - Generating replaces each selected role's first untried, unretired
 *   LinkedIn query in place (same `Q` id, text swapped, status stays
 *   untried); any further untried one for that role is retired as
 *   superseded; a role with none gets a new id. Judged queries, queries of
 *   roles that are no longer selected, and queries with no `Role` are left
 *   alone.
 * - The output schema is built per call from the selected role ids
 *   ({@link generateOutputSchema}), so the model cannot skip a role or write
 *   two for one. A draft with empty text, or one that repeats a judged query
 *   ({@link queryKey}), leaves its role without a query and the run fails
 *   with {@link QueriesOutputError} rather than re-asking the model. Two
 *   roles receiving the same text is not an error; the prompt steers away
 *   from it.
 * - No seniority words and no location or work-mode wording in a query: the
 *   prompt forbids both, and neither preference is rendered into the
 *   generation message (LinkedIn filters on them itself, technical-plan.md
 *   D36). {@link levelPhrasesIn} reports level words for the CLI check.
 * - Revision: a `narrow` rewrites an untried, unretired query in place; a
 *   narrow aimed at a judged query becomes an added LinkedIn query under a
 *   new id that keeps the judged query's fields and `Role`. An added query
 *   that serves the judged query's field takes its `Role` too.
 * - Field statuses: the model may move `candidate`/`unsure` freely; it may
 *   move `accepted` only to `unsure`, and only for a field the feedback's
 *   query serves; `rejected` is never touched. The model's reason lands in
 *   the field's `extra["Status note"]`.
 * - The user's verdict is applied first ({@link applyFeedback}), before the
 *   model runs, so it lands even if the call fails; the UI can call it too.
 */

import { z } from "zod";

import { LEADING_LEVEL_MODIFIERS, LEVEL_HEADS, LEVEL_MODIFIERS, hasLevelWord } from "./discover";
import type { CallMetrics, Llm } from "./llm";
import {
  type Board,
  BoardSchema,
  type Field,
  type FieldStatus,
  FieldStatusSchema,
  type Profile,
  type Query,
  type Role,
  rolesForField,
  selectedRoles,
  setFieldStatus,
  setPreference,
  setQueryStatus,
  setSessionNotes,
  upsertField,
  upsertQuery,
  activeSkills,
} from "./profile";
import type { QueryFeedback } from "./session";
import {
  ALERT_STEPS,
  BOARD_LABELS,
  BOARD_NAME_KEY,
  RETIRED_KEY,
  RETIRED_REASON_KEY,
  isRetiredQuery,
} from "./boards";

/** Re-exported for callers of this module; `boards.ts` is the client-safe owner. */
export { ALERT_STEPS, BOARD_NAME_KEY, RETIRED_KEY, RETIRED_REASON_KEY };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BOARDS: readonly Board[] = BoardSchema.options;
/** The boards this module writes for: LinkedIn only (technical-plan.md D47). */
export const QUERY_BOARDS = ["linkedin"] as const;
export type QueryBoard = (typeof QUERY_BOARDS)[number];
/** The one board every query written here is on. */
const WRITE_BOARD: QueryBoard = QUERY_BOARDS[0];
/** A revision may add this many queries at most, so a run cannot flood the list. */
const MAX_REVISION_ADDS = 4;
/**
 * Fields a revision reads and its added queries may serve: every field but
 * a rejected one. Since D50 no screen marks a field, so discovered fields
 * stay `candidate` and must count (technical-plan.md D58).
 */
const FIELDS_IN_PLAY: readonly FieldStatus[] = ["candidate", "accepted", "unsure"];

/** `extra` keys this module writes on queries and fields. */
export const WHY_KEY = "Rationale";
export const STATUS_NOTE_KEY = "Status note";

/**
 * The phrases of a query that carry a level word, lowercased and
 * deduplicated: each quoted phrase and each run of bare words between
 * operators and brackets is checked as a title would be. What counts as a
 * level word is defined once, in `discover.ts` (technical-plan.md D48), and
 * the prompts below list the same words. A check for the CLI and tests, never
 * a reason to fail a turn.
 */
export function levelPhrasesIn(query: string): string[] {
  const phrases: string[] = [];
  const bare = query.replace(/"([^"]*)"/g, (_match, phrase: string) => {
    phrases.push(phrase);
    return " ( ";
  });
  phrases.push(...bare.split(/[()]|\b(?:AND|OR|NOT)\b/));
  const found = phrases
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p !== "" && hasLevelWord(p))
    .map((p) => p.toLowerCase());
  return [...new Set(found)];
}

// ---------------------------------------------------------------------------
// Output schemas (passed to `structured`)
// ---------------------------------------------------------------------------

/** One added query in a revision. Always LinkedIn, so it names no board. */
export const QueryDraftSchema = z.object({
  query: z.string(),
  fieldIds: z.array(z.string()),
  rationale: z.string(),
});
export type QueryDraft = z.infer<typeof QueryDraftSchema>;

/** One LinkedIn search for one role; the role id is the key it sits under. */
export const RoleQueryDraftSchema = z.object({
  query: z.string(),
  rationale: z.string(),
});
export type RoleQueryDraft = z.infer<typeof RoleQueryDraftSchema>;

/** What generation returns: one draft under each selected role's id. */
export type GenerateOutput = Record<string, RoleQueryDraft>;

/**
 * The generation schema for one call: an object with exactly one required
 * draft per selected role id, e.g. `{ R3: draft, R5: draft }`. The schema
 * itself keeps the model from skipping a role or writing two for one
 * (technical-plan.md D47).
 */
export function generateOutputSchema(roleIds: readonly string[]) {
  return z.object(Object.fromEntries(roleIds.map((id) => [id, RoleQueryDraftSchema])));
}

export const PreferenceEditKeySchema = z.enum(["location", "workMode", "seniority", "retrainingAppetite"]);

export const ReviseOutputSchema = z.object({
  explanation: z.string(),
  retire: z.array(z.object({ id: z.string(), reason: z.string() })),
  add: z.array(QueryDraftSchema),
  narrow: z.array(z.object({ id: z.string(), query: z.string() })),
  fieldStatus: z.array(z.object({ id: z.string(), status: FieldStatusSchema, reason: z.string() })),
  notes: z.string().nullable(),
  preferenceEdits: z.array(z.object({ key: PreferenceEditKeySchema, value: z.string() })),
});
export type ReviseOutput = z.infer<typeof ReviseOutputSchema>;

// ---------------------------------------------------------------------------
// Prompts (byte-stable: sent as cached blocks)
// ---------------------------------------------------------------------------

const LINKEDIN_SYNTAX = `LinkedIn syntax. Every query must paste straight into the keyword box of LinkedIn's job search and work as typed:
- Double quotes make an exact phrase: "program manager". Quote every term of two or more words. A single word needs no quotes.
- AND, OR and NOT are the only operators, always in capitals. Parentheses group alternatives: ("a b" OR c) AND (d OR "e f").
- LinkedIn's job search supports nothing else. No wildcards (*), no + or - prefixes, no brackets or braces, no field operators such as title: or company:, no site:.
- Stay under about 200 characters. Every extra AND group removes real jobs from the results, so a short query that finds twenty relevant postings beats a precise one that finds none.`;

const NO_LEVEL_WORDS = `No seniority or level words anywhere in a query. A level word says how senior the job is, not what the job is. That covers a level modifier wherever it appears (${LEVEL_MODIFIERS.join(", ")}), one of these in front of a job title (${LEADING_LEVEL_MODIFIERS.join(", ")}), a rank (${LEVEL_HEADS.join(", ")}), and grade numerals such as II or III. When a role title carries one, drop it and keep the function: "Senior Mechanical Engineer" becomes "mechanical engineer". If dropping it leaves no job title ("Head of Partnerships"), use the titles employers post for that work ("partnerships manager" OR "business development manager"). Words that name the job itself stay: "project manager", "program manager", "account executive", and a word from the second list when it closes the title as the job's own noun ("research associate", "maintenance lead"). LinkedIn has its own experience-level filter, and a level word in the keyword box hides every posting that words the level differently.`;

const NO_LOCATION = `No location or work-mode wording in a query: no city, state, region or country, and no "remote", "hybrid" or "on-site". The person sets those with LinkedIn's own filters beside the search box.`;

export const QUERIES_SYSTEM_PROMPT = `You write LinkedIn job searches for one career switcher moving into climate work. The person has ticked the roles they want to look for. You get their areas of expertise and climate interests, then every ticked role under the climate field it belongs to, with what that field is and any searches the person has already judged. Return JSON with exactly one entry for each role id listed at the end of the message, keyed by that id, each holding a query and a rationale. One search per role, written for that role alone.

${LINKEDIN_SYNTAX}

Build each query in this order:
1. Title group. Start from the role's title as employers post it: keep the job function and drop anything after a comma or in brackets, which describes the focus and belongs in step 2 if anywhere. Add one or two alternate titles that employers use for the same job, joined with OR. Do not add titles for different jobs.
2. Field group. AND the title group with two to four terms that postings in the role's field actually contain: the technology, product, sector or programme names found in the field's name, summary and fit, and in the role's focus. Join them with OR. Every field term names what the employer works on, so that the group on its own would pick out employers in this field. A term that only describes the job's craft, medium or setting (for a video role: documentary, newsroom, broadcast) repeats the title group and returns the same job at any employer. Never use a generic word such as climate, sustainability, green or "clean energy" as a field term on its own; those words sit in every employer's boilerplate and narrow nothing. When the field's subject is climate or the environment itself, as in climate journalism or climate policy, do not leave the subject out: use the specific phrases such postings carry, such as "climate change", "climate policy", "environmental justice" or "energy transition".
3. Expertise group, optional. Add a third AND group drawn from the person's areas of expertise only when the first two groups would still return mostly jobs outside what they do, and only with terms a posting for this role would plausibly contain. When in doubt, leave it out.
4. NOT, rarely. Use NOT only to remove one specific wrong kind of result that the person named when judging an earlier search.
The shape, shown with made-up vocabulary: ("video producer" OR videographer OR "multimedia producer") AND (solar OR "community solar" OR "energy storage"). Take the shape from this, never the words.

Rules for every query:
- ${NO_LEVEL_WORDS}
- ${NO_LOCATION}
- No employer names. The companies listed with a role are examples of who hires for it, not a filter.
- Every query in your answer differs from every other. Two roles in the same field share field terms, so their title groups must differ; two roles with similar titles in different fields must differ in their field terms.
- Earlier searches: never return the text of a search listed as judged. If one was judged good, keep what made it good and vary the terms; if one was judged bad, the person's reason says what to avoid. A search marked as the current untried one is the one you are replacing: improve on it rather than restating it.
- The person's answer to a field's question, when shown, is a hard constraint on that field's searches.
- rationale is one plain sentence saying which titles and field terms the search combines and why those were chosen.
- Use nothing about the person beyond what the message states; invent no personal detail.`;

export const REVISE_SYSTEM_PROMPT = `You revise LinkedIn job searches for one career switcher moving into climate work. You get their preferences, skills, the fields they have not rejected, the example roles, every query with its status and the role it was written for, and one piece of feedback the person just gave on one query: a verdict (good or bad) and a reason in their own words. The verdict is already recorded on that query; never change that query and never rewrite any query the person has judged. Every query you write is a LinkedIn search. Return JSON:
- explanation: one paragraph for the chat. Quote or closely paraphrase the person's reason, name exactly which query ids you retired or narrowed and why, describe each added query by its terms (added queries get their ids later; never invent ids), and mention any field status change or note.
- retire: untried query ids the reason also invalidates (same field, same problem), each with a reason.
- narrow: untried LinkedIn query ids rewritten in place to sidestep the problem, with the full new query text. To replace the judged query itself, name its id here with the new text; it is saved as a new query for the same role and the judged one keeps its record.
- add: further queries, each with query, fieldIds and rationale. Add one only when the reason calls for a search the existing ones do not cover.
- fieldStatus: only when the reason is about a field itself, such as a hard requirement (license, degree, clearance) the person lacks or will not pursue. You may move candidate or unsure fields, and move an accepted field the query serves to unsure. Never reject an accepted field; the person decides that.
- notes: one short line for the session notes, or null.
- preferenceEdits: only when the reason states a preference about location, work mode, seniority or retraining appetite.
For a good verdict retire nothing, narrow nothing and add nothing unless the reason asks for a variation.

${LINKEDIN_SYNTAX}

Rules for every query:
- fieldIds lists only ids from the Fields section, and every query serves at least one. Build the query from role titles and the field's own terms as they appear in the roles and fit reasoning; never a bare generic word such as "climate" or "sustainability".
- ${NO_LEVEL_WORDS}
- ${NO_LOCATION} Use the stated location and work mode only as context for which fields and role titles are realistic.
- Learn from tried queries: never repeat a listed query, keep what made a good query good, avoid what made a bad one bad.
- rationale is one sentence naming the field ids and terms the query targets and why those terms were chosen.
- Use nothing about the person beyond what the profile states; invent no personal detail.`;

// ---------------------------------------------------------------------------
// Rendering the profile for the model
// ---------------------------------------------------------------------------

function fieldsInPlay(p: Profile): Field[] {
  return p.fields.filter((f) => FIELDS_IN_PLAY.includes(f.status));
}

/** Revision context. Seniority is deliberately absent: no query may carry a level word. */
function renderPreferences(p: Profile): string {
  const pr = p.preferences;
  const text = (v: { value: string } | undefined) => v?.value ?? "(not stated)";
  return [
    `- Location (context for what is realistic; never a query term): ${text(pr.location)}`,
    `- Work mode (context for what is realistic; never a query term): ${text(pr.workMode)}`,
    `- Retraining appetite: ${text(pr.retrainingAppetite)}`,
    `- Climate interests: ${pr.climateInterests?.values.join(", ") ?? "(not stated)"}`,
    ...pr.other.map((o) => `- ${o.key}: ${o.value}`),
  ].join("\n");
}

function renderRole(r: Role): string {
  const companies = r.companies.length === 0 ? "" : ` (${r.companies.join(", ")})`;
  return `  - ${r.id}: ${r.title}${companies}`;
}

function renderFields(p: Profile): string {
  return fieldsInPlay(p)
    .map((f) => {
      const roles = rolesForField(p, f.id).map((r) => renderRole(r));
      return [
        `### ${f.id}: ${f.name} (${f.status})`,
        `- Fit: ${f.fit}`,
        `- Uncertain: ${f.uncertain}`,
        ...(roles.length === 0 ? [] : ["- Roles:", ...roles]),
      ].join("\n");
    })
    .join("\n\n");
}

function renderQueries(p: Profile): string {
  if (p.queries.length === 0) return "(none yet)";
  return p.queries
    .map((q) => {
      const name = q.extra[BOARD_NAME_KEY] === undefined ? q.board : `${q.board}: ${q.extra[BOARD_NAME_KEY]}`;
      const role = q.roleId === "" ? "" : ` role ${q.roleId};`;
      const retired = isRetiredQuery(q) ? `; retired: ${q.extra[RETIRED_REASON_KEY] ?? ""}` : "";
      const reason = q.reason === "" ? "" : `; reason: ${q.reason}`;
      return `- ${q.id} [${name}]${role} fields ${q.fieldIds.join(", ")}; status ${q.status}${reason}${retired}\n  ${q.query}`;
    })
    .join("\n");
}

function renderProfileContext(p: Profile): string {
  // Accepted unless removed (technical-plan.md D53).
  const skills = activeSkills(p);
  return [
    "# Preferences",
    renderPreferences(p),
    "",
    "# Skills",
    skills.length === 0 ? "(none)" : skills.join(", "),
    "",
    "# Fields (not rejected) and their roles",
    renderFields(p),
    "",
    "# Queries so far",
    renderQueries(p),
  ].join("\n");
}

/** The role's untried, unretired LinkedIn queries, oldest first: the ones a generation run may replace. */
function untriedQueriesForRole(p: Profile, roleId: string): Query[] {
  return p.queries.filter(
    (q) => q.roleId === roleId && q.board === WRITE_BOARD && q.status === "untried" && !isRetiredQuery(q),
  );
}

/** One ticked role as the generation prompt sees it. */
function renderRoleForQueries(p: Profile, role: Role): string {
  const current = untriedQueriesForRole(p, role.id)[0];
  return [
    `### ${role.id}: ${role.title}`,
    ...(role.companies.length === 0
      ? []
      : [`- Companies that hire for it (examples only, never query terms): ${role.companies.join(", ")}`]),
    ...(role.why === "" ? [] : [`- Why this role: ${role.why}`]),
    ...(current === undefined ? [] : [`- Current untried search (you are replacing it): ${current.query}`]),
  ].join("\n");
}

/** One field with its ticked roles and the searches the person has judged on it (technical-plan.md D47). */
function renderFieldForQueries(p: Profile, field: Field, roles: readonly Role[]): string {
  const ask = field.ask;
  const answer = ask === undefined ? undefined : p.preferences.other.find((o) => o.key === ask.key);
  const optional = (label: string, value: string | undefined) =>
    value === undefined || value === "" ? [] : [`- ${label}: ${value}`];
  const judged = p.queries.filter((q) => q.status !== "untried" && q.fieldIds.includes(field.id));
  return [
    `## ${field.id}: ${field.name}`,
    ...optional("Sector", field.sector),
    ...optional("Summary", field.summary),
    ...optional("Why it fits the person", field.fit),
    ...optional("Transferable skills", field.chips.join(", ")),
    ...(ask === undefined || answer === undefined ? [] : [`- Asked "${ask.question}"; the person answered: ${answer.value}`]),
    ...(judged.length === 0
      ? []
      : [
          "- Searches the person already judged in this field (never return one of these):",
          ...judged.map((q) => {
            const role = q.roleId === "" ? "" : ` for ${q.roleId}`;
            const reason = q.reason === "" ? "" : `; their reason: ${q.reason}`;
            return `  - ${q.id}${role} on ${BOARD_LABELS[q.board]}, judged ${q.status}${reason}\n    ${q.query}`;
          }),
        ]),
    "",
    ...roles.map((r) => renderRoleForQueries(p, r)),
  ].join("\n");
}

/**
 * The per-call half of the generation prompt. Location, work mode and
 * seniority are left out on purpose: none may appear in a query, and what is
 * not in the message cannot leak into one (technical-plan.md D36, D47).
 */
export function buildGenerateMessage(p: Profile, roles: readonly Role[]): string {
  const fields = p.fields.filter((f) => roles.some((r) => r.fieldId === f.id));
  const interests = p.preferences.climateInterests?.values ?? [];
  // Accepted unless removed (technical-plan.md D53).
  const skills = activeSkills(p);
  return [
    "# The person",
    `- Areas of expertise: ${skills.length === 0 ? "(none stated)" : skills.join(", ")}`,
    `- Climate interests: ${interests.length === 0 ? "(none stated)" : interests.join(", ")}`,
    "",
    "# Ticked roles, grouped by field",
    "",
    fields
      .map((f) => renderFieldForQueries(p, f, roles.filter((r) => r.fieldId === f.id)))
      .join("\n\n"),
    "",
    `Write one LinkedIn search for each of these role ids: ${roles.map((r) => r.id).join(", ")}.`,
  ].join("\n");
}

export function buildReviseMessage(p: Profile, feedback: QueryFeedback): string {
  const q = p.queries.find((x) => x.id === feedback.queryId);
  const about =
    q === undefined
      ? feedback.queryId
      : `${q.id} [${q.board}]${q.roleId === "" ? "" : ` role ${q.roleId};`} fields ${q.fieldIds.join(", ")}\n  ${q.query}`;
  return [
    renderProfileContext(p),
    "",
    "# Feedback just given",
    `- Query: ${about}`,
    `- Verdict: ${feedback.verdict}`,
    `- Reason (the person's own words): ${feedback.reason}`,
    "",
    "Revise the queries.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Validation and apply-back
// ---------------------------------------------------------------------------

export interface QueriesDropped {
  /** Drafts with an empty (or absent) query text. */
  emptyQuery: number;
  /** Revision drafts whose fieldIds named no field in play (any but rejected). */
  unfielded: number;
  /** Revision drafts repeating an earlier draft's `(board, normalized query)` key. */
  duplicate: number;
  /** Revision drafts beyond the cap. */
  surplus: number;
  /** Drafts or edits aimed at a query the user has already judged good/bad. */
  judgedQueries: number;
  /** Retire/narrow entries naming a query id not in the profile. */
  unknownQueryIds: number;
  /** Field ids not in the profile (in drafts, counted per id; in fieldStatus, per entry). */
  unknownFieldIds: number;
  /** fieldStatus entries refused by the status rule in the module header. */
  fieldsProtected: number;
}

export function zeroDropped(): QueriesDropped {
  return {
    emptyQuery: 0,
    unfielded: 0,
    duplicate: 0,
    surplus: 0,
    judgedQueries: 0,
    unknownQueryIds: 0,
    unknownFieldIds: 0,
    fieldsProtected: 0,
  };
}

/** One line for logs and the CLI: counts only, never content. */
export function droppedSummary(d: QueriesDropped): string {
  return Object.entries(d)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

export function normalizeQueryText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Dedupe key: board plus case- and whitespace-insensitive query text. */
export function queryKey(board: Board, query: string): string {
  return `${board} ${normalizeQueryText(query).toLowerCase()}`;
}

/** A revision's added query plus the role it is for (empty when it replaces no role's query). */
export interface RevisionDraft extends QueryDraft {
  roleId: string;
}

export interface ValidatedDraft {
  query: string;
  fieldIds: string[];
  roleId: string;
  rationale: string;
}

/** Drops malformed, unfielded, duplicate and surplus revision drafts, counting each. */
export function validateDrafts(
  drafts: readonly RevisionDraft[],
  profile: Profile,
  dropped: QueriesDropped,
): ValidatedDraft[] {
  const eligible = new Set(fieldsInPlay(profile).map((f) => f.id));
  const inProfile = new Set(profile.fields.map((f) => f.id));
  const seen = new Set<string>();
  const kept: ValidatedDraft[] = [];
  for (const d of drafts) {
    const query = normalizeQueryText(d.query);
    if (query === "") {
      dropped.emptyQuery += 1;
      continue;
    }
    const fieldIds = [...new Set(d.fieldIds.map((id) => id.trim()))];
    // Ids of ineligible (candidate/rejected) fields are filtered silently; unknown ids are counted.
    const known = fieldIds.filter((id) => eligible.has(id));
    dropped.unknownFieldIds += fieldIds.filter((id) => !inProfile.has(id)).length;
    if (known.length === 0) {
      dropped.unfielded += 1;
      continue;
    }
    const key = queryKey(WRITE_BOARD, query);
    if (seen.has(key)) {
      dropped.duplicate += 1;
      continue;
    }
    if (kept.length >= MAX_REVISION_ADDS) {
      dropped.surplus += 1;
      continue;
    }
    seen.add(key);
    kept.push({ query, fieldIds: known, roleId: d.roleId, rationale: d.rationale.trim() });
  }
  return kept;
}

export interface ApplyDraftsResult {
  profile: Profile;
  /** Queries created this run, in draft order. */
  added: Query[];
  /** Existing untried queries refreshed in place, in draft order. */
  updated: Query[];
}

export interface ValidatedRoleDraft {
  roleId: string;
  /** The role's field; empty when the role names none. */
  fieldId: string;
  query: string;
  rationale: string;
}

/**
 * Thrown when the model's answer, once validated, leaves a selected role
 * without a query. The run fails rather than re-asking the model (one call
 * per turn is the contract; the person just presses the button again).
 * Carries role ids and counters only, never model text.
 */
export class QueriesOutputError extends Error {
  constructor(
    readonly missingRoles: readonly string[],
    readonly dropped: QueriesDropped,
  ) {
    super(`No usable query came back for ${missingRoles.join(", ")}.`);
    this.name = "QueriesOutputError";
  }
}

/**
 * One validated draft per role, in the order of `roles`. A draft is dropped
 * (and counted) when its text is empty or absent, or its key repeats a query
 * the person has judged; any drop is a role without a query, so this throws
 * {@link QueriesOutputError}. Two roles with the same text both pass.
 */
export function validateRoleDrafts(
  output: GenerateOutput,
  profile: Profile,
  roles: readonly Role[],
  dropped: QueriesDropped,
): ValidatedRoleDraft[] {
  const judged = new Set(
    profile.queries.filter((q) => q.status !== "untried").map((q) => queryKey(q.board, q.query)),
  );
  const kept: ValidatedRoleDraft[] = [];
  const missing: string[] = [];
  for (const role of roles) {
    const d = output[role.id];
    const query = d === undefined ? "" : normalizeQueryText(d.query);
    if (d === undefined || query === "") {
      dropped.emptyQuery += 1;
      missing.push(role.id);
      continue;
    }
    if (judged.has(queryKey(WRITE_BOARD, query))) {
      dropped.judgedQueries += 1;
      missing.push(role.id);
      continue;
    }
    kept.push({ roleId: role.id, fieldId: role.fieldId, query, rationale: d.rationale.trim() });
  }
  if (missing.length > 0) throw new QueriesOutputError(missing, dropped);
  return kept;
}

export interface ApplyRoleDraftsResult extends ApplyDraftsResult {
  /** The query written for each draft, in draft (selected-role) order. */
  written: Query[];
  /** Further untried LinkedIn queries of the same role, retired as superseded. */
  superseded: string[];
}

/**
 * Writes one LinkedIn query per role draft: the role's first untried,
 * unretired LinkedIn query is replaced in place (id kept), any other untried
 * one for that role is retired as superseded, and a role with none gets a new
 * id. Judged queries, other roles' queries and queries with no `Role` are
 * never touched (technical-plan.md D47).
 */
export function applyRoleDrafts(profile: Profile, drafts: readonly ValidatedRoleDraft[]): ApplyRoleDraftsResult {
  let next = profile;
  const written: Query[] = [];
  const added: Query[] = [];
  const updated: Query[] = [];
  const superseded: string[] = [];
  for (const d of drafts) {
    const [existing, ...rest] = untriedQueriesForRole(next, d.roleId);
    const extra = { ...(existing?.extra ?? {}) };
    delete extra[BOARD_NAME_KEY];
    if (d.rationale === "") delete extra[WHY_KEY];
    else extra[WHY_KEY] = d.rationale;
    next = upsertQuery(next, {
      ...(existing === undefined ? {} : { id: existing.id }),
      board: WRITE_BOARD,
      query: d.query,
      fieldIds: d.fieldId === "" ? [] : [d.fieldId],
      roleId: d.roleId,
      status: "untried",
      reason: "",
      extra,
    });
    const query = existing === undefined ? next.queries.at(-1) : next.queries.find((q) => q.id === existing.id);
    if (query === undefined) continue; // unreachable: upsertQuery always writes
    written.push(query);
    (existing === undefined ? added : updated).push(query);
    for (const stale of rest) {
      next = upsertQuery(next, {
        ...stale,
        extra: { ...stale.extra, [RETIRED_KEY]: "yes", [RETIRED_REASON_KEY]: `Superseded by ${query.id}` },
      });
      superseded.push(stale.id);
    }
  }
  return { profile: next, written, added, updated, superseded };
}

/** Upserts revision drafts as LinkedIn queries by normalized text; never touches a judged query. */
export function applyDrafts(
  profile: Profile,
  drafts: readonly ValidatedDraft[],
  dropped: QueriesDropped,
): ApplyDraftsResult {
  let next = profile;
  const added: Query[] = [];
  const updated: Query[] = [];
  for (const d of drafts) {
    const key = queryKey(WRITE_BOARD, d.query);
    const existing = next.queries.find((q) => queryKey(q.board, q.query) === key);
    if (existing !== undefined && existing.status !== "untried") {
      dropped.judgedQueries += 1;
      continue;
    }
    const extra = { ...(existing?.extra ?? {}) };
    delete extra[RETIRED_KEY];
    delete extra[RETIRED_REASON_KEY];
    delete extra[BOARD_NAME_KEY];
    if (d.rationale === "") delete extra[WHY_KEY];
    else extra[WHY_KEY] = d.rationale;
    next = upsertQuery(next, {
      ...(existing === undefined ? {} : { id: existing.id }),
      board: WRITE_BOARD,
      query: d.query,
      fieldIds: d.fieldIds,
      roleId: d.roleId !== "" ? d.roleId : (existing?.roleId ?? ""),
      status: "untried",
      reason: "",
      extra,
    });
    const written = existing === undefined ? next.queries.at(-1) : next.queries.find((q) => q.id === existing.id);
    if (written === undefined) continue; // unreachable: upsertQuery always writes
    (existing === undefined ? added : updated).push(written);
  }
  return { profile: next, added, updated };
}

export interface FieldChange {
  id: string;
  from: FieldStatus;
  to: FieldStatus;
}

/** Applies the model's field status changes under the rule in the module header. */
function applyFieldChanges(
  profile: Profile,
  changes: ReviseOutput["fieldStatus"],
  servedByFeedback: ReadonlySet<string>,
  dropped: QueriesDropped,
): { profile: Profile; fieldChanges: FieldChange[] } {
  let next = profile;
  const fieldChanges: FieldChange[] = [];
  for (const c of changes) {
    const field = next.fields.find((f) => f.id === c.id.trim());
    if (field === undefined) {
      dropped.unknownFieldIds += 1;
      continue;
    }
    if (field.status === c.status) continue;
    const allowed =
      field.status === "candidate" ||
      field.status === "unsure" ||
      (field.status === "accepted" && c.status === "unsure" && servedByFeedback.has(field.id));
    if (!allowed) {
      dropped.fieldsProtected += 1;
      continue;
    }
    next = setFieldStatus(next, field.id, c.status);
    const reason = c.reason.trim();
    if (reason !== "") {
      const current = next.fields.find((f) => f.id === field.id) ?? field;
      next = upsertField(next, { ...current, extra: { ...current.extra, [STATUS_NOTE_KEY]: reason } });
    }
    fieldChanges.push({ id: field.id, from: field.status, to: c.status });
  }
  return { profile: next, fieldChanges };
}

export interface ApplyRevisionResult {
  profile: Profile;
  explanation: string;
  /** Untried query ids marked retired this run. */
  retired: string[];
  added: Query[];
  /** Untried query ids rewritten in place. */
  narrowed: string[];
  fieldChanges: FieldChange[];
  dropped: QueriesDropped;
}

/**
 * Applies a revision to a profile on which {@link applyFeedback} has already
 * run. Order: retire, narrow, add, field statuses, notes, preferences.
 */
export function applyRevision(
  profile: Profile,
  output: ReviseOutput,
  feedback: QueryFeedback,
  dropped: QueriesDropped = zeroDropped(),
): ApplyRevisionResult {
  let next = profile;
  const retired: string[] = [];
  const narrowed: string[] = [];
  const extraDrafts: RevisionDraft[] = [];

  for (const r of output.retire) {
    const q = next.queries.find((x) => x.id === r.id.trim());
    if (q === undefined) {
      dropped.unknownQueryIds += 1;
      continue;
    }
    if (q.id === feedback.queryId) continue; // the verdict already covers it
    if (q.status !== "untried") {
      dropped.judgedQueries += 1;
      continue;
    }
    if (isRetiredQuery(q)) continue;
    next = upsertQuery(next, {
      ...q,
      extra: { ...q.extra, [RETIRED_KEY]: "yes", [RETIRED_REASON_KEY]: r.reason.trim() },
    });
    retired.push(q.id);
  }

  for (const n of output.narrow) {
    const q = next.queries.find((x) => x.id === n.id.trim());
    if (q === undefined) {
      dropped.unknownQueryIds += 1;
      continue;
    }
    const query = normalizeQueryText(n.query);
    if (query === "") {
      dropped.emptyQuery += 1;
      continue;
    }
    if (q.status !== "untried" || isRetiredQuery(q)) {
      // A judged (or retired) query keeps its record; the rewrite becomes a
      // LinkedIn add that keeps the fields and the role of the query it replaces.
      extraDrafts.push({ query, fieldIds: q.fieldIds, roleId: q.roleId, rationale: `Narrowed from ${q.id}` });
      continue;
    }
    const key = queryKey(q.board, query);
    if (next.queries.some((x) => x.id !== q.id && queryKey(x.board, x.query) === key)) {
      dropped.duplicate += 1;
      continue;
    }
    next = upsertQuery(next, { ...q, query });
    narrowed.push(q.id);
  }

  // An added query that serves the judged query's field stands in for it, so it takes that query's role.
  const judged = next.queries.find((q) => q.id === feedback.queryId);
  const roleFor = (fieldIds: readonly string[]) =>
    judged !== undefined && fieldIds.some((id) => judged.fieldIds.includes(id.trim())) ? judged.roleId : "";
  const modelDrafts = output.add.map((d) => ({ ...d, roleId: roleFor(d.fieldIds) }));
  const drafts = validateDrafts([...extraDrafts, ...modelDrafts], next, dropped);
  const applied = applyDrafts(next, drafts, dropped);
  next = applied.profile;

  const served = new Set(judged?.fieldIds ?? []);
  const fields = applyFieldChanges(next, output.fieldStatus, served, dropped);
  next = fields.profile;

  const notes = output.notes?.trim() ?? "";
  if (notes !== "") {
    const current = next.sessionNotes.trim();
    next = setSessionNotes(next, current === "" ? notes : `${current}\n\n${notes}`);
  }
  for (const e of output.preferenceEdits) {
    if (e.value.trim() === "") continue;
    next = setPreference(next, e.key, e.value, "inferred");
  }

  return {
    profile: next,
    explanation: output.explanation.trim(),
    retired,
    added: applied.added,
    narrowed,
    fieldChanges: fields.fieldChanges,
    dropped,
  };
}

// ---------------------------------------------------------------------------
// The calls
// ---------------------------------------------------------------------------

export class QueriesInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueriesInputError";
  }
}

export interface QueriesOptions {
  llm?: Llm;
  /** ISO date stamped on the feedback's query; defaults to today. */
  changedAt?: string;
}

/** No field: generation writes for every selected role in the profile (technical-plan.md D47). */
export interface GenerateQueriesRequest {
  sessionId: string;
  profile: Profile;
}

export interface GenerateQueriesResult extends ApplyRoleDraftsResult {
  /** The selected roles written for, in field order then role order. */
  roles: Role[];
  dropped: QueriesDropped;
  metrics: CallMetrics;
}

export interface ReviseQueriesRequest {
  sessionId: string;
  profile: Profile;
  feedback: QueryFeedback;
}

export interface ReviseQueriesResult extends ApplyRevisionResult {
  metrics: CallMetrics;
}

function metricsOf({ usage, costUsd, durationMs, continuations, stopReason }: CallMetrics): CallMetrics {
  return { usage, costUsd, durationMs, continuations, stopReason };
}

async function resolveLlm(options: QueriesOptions): Promise<Llm> {
  return options.llm ?? (await import("./llm")).llm();
}

/**
 * Every selected role, with its field, the person's expertise and interests →
 * one LinkedIn query per role, written in one call (technical-plan.md D47).
 */
export async function generateQueries(
  { sessionId, profile }: GenerateQueriesRequest,
  options: QueriesOptions = {},
): Promise<GenerateQueriesResult> {
  const roles = selectedRoles(profile);
  if (roles.length === 0) {
    throw new QueriesInputError("Select at least one role before writing searches.");
  }
  const llmClient = await resolveLlm(options);
  const result = await llmClient.structured({
    step: "queries",
    sessionId,
    system: QUERIES_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildGenerateMessage(profile, roles) }],
    schema: generateOutputSchema(roles.map((r) => r.id)),
  });
  const dropped = zeroDropped();
  const drafts = validateRoleDrafts(result.value, profile, roles, dropped);
  const applied = applyRoleDrafts(profile, drafts);
  return { ...applied, roles, dropped, metrics: metricsOf(result) };
}

/**
 * Records the user's verdict on a query. Pure; the UI may call it directly
 * and persist the result before (or without) `reviseQueries`.
 */
export function applyFeedback(profile: Profile, feedback: QueryFeedback, changedAt?: string): Profile {
  if (!profile.queries.some((q) => q.id === feedback.queryId)) {
    throw new QueriesInputError(`No query with id ${feedback.queryId} in the profile.`);
  }
  return setQueryStatus(profile, feedback.queryId, feedback.verdict, feedback.reason, changedAt);
}

/** One piece of feedback → verdict recorded, then the model's revision applied. */
export async function reviseQueries(
  { sessionId, profile, feedback }: ReviseQueriesRequest,
  options: QueriesOptions = {},
): Promise<ReviseQueriesResult> {
  const withFeedback = applyFeedback(profile, feedback, options.changedAt);
  const llmClient = await resolveLlm(options);
  const result = await llmClient.structured({
    step: "revise",
    sessionId,
    system: REVISE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildReviseMessage(withFeedback, feedback) }],
    schema: ReviseOutputSchema,
  });
  const applied = applyRevision(withFeedback, result.value, feedback);
  return { ...applied, metrics: metricsOf(result) };
}
