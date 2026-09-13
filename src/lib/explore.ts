/**
 * Stage 2.2 — field drill-down.
 *
 * Given the profile and one field id (`F3`), one `explore` call (through
 * `src/lib/llm.ts`, with web tools) produces: a day-to-day description of the
 * work, example job titles and employers, example posts, search keywords,
 * sources, and up to {@link MAX_ROLES_PER_FIELD} roles. The reference
 * collection in Supabase (the catalogue field, its example roles and posts)
 * is rendered into the prompt as the primary evidence; web search fills gaps
 * and confirms currency.
 *
 * What is written back to the profile is small and single-line so it round
 * trips through `profile.ts`: the field is marked explored, a short day-to-day
 * summary, the keywords and the titles go into the field's `extra`, sources
 * are merged, and roles are upserted by case-insensitive title within the
 * field. The rich text goes into the returned `message`, which the app puts
 * straight into the assistant bubble.
 *
 * LinkedIn guidance is a list of search URLs the *user* opens themselves —
 * this module never fetches linkedin.com, indeed.com or climatebase.org
 * (PRD hard constraint). `assertNoBlockedFetches` checks every response's
 * tool-result and citation URLs after the fact; `webTools()` blocks the hosts
 * before the call.
 */

import { z } from "zod";

import { REF_KEY, cleanSources, renderCardsForDiscover, renderPreferencesForDiscover } from "./discover";
import type { CallMetrics, Llm, LlmTool } from "./llm";
import {
  type Field,
  type Profile,
  type Role,
  activeCards,
  setFieldExplored,
  upsertField,
  upsertRole,
} from "./profile";
import { isBlockedSourceHost, sourceHost } from "./reference-schema";

// ---------------------------------------------------------------------------
// Bounds and profile keys
// ---------------------------------------------------------------------------

export const MAX_TITLES = 8;
export const MAX_EMPLOYERS = 8;
export const MAX_POSTS = 5;
export const MAX_KEYWORDS = 6;
export const MAX_SOURCES = 6;
export const MAX_ROLES_PER_FIELD = 4;
export const MAX_UNCERTAINTIES = 3;
/** Longest single-line value stored on the field for the day-to-day summary. */
export const MAX_EXTRA_CHARS = 400;

/** Field `extra` keys written by explore (single-line values). */
export const DAY_TO_DAY_KEY = "Day-to-day";
export const KEYWORDS_KEY = "Keywords";
export const TITLES_KEY = "Titles";

// ---------------------------------------------------------------------------
// Reference reader (narrow so tests can fake it)
// ---------------------------------------------------------------------------

export interface ReferenceField {
  id: string;
  name: string;
  description: string;
  climate_link: string;
  transferable_functions: string[];
  sources: string[];
}

export interface ReferenceRole {
  id: string;
  title: string;
  function: string;
  day_to_day: string;
  example_companies: string[];
  sources: string[];
}

export interface ReferencePost {
  id: string;
  title: string;
  company: string;
  requirements_summary: string;
  source_url: string;
  posted_date: string | null;
}

export interface ExploreReferenceReader {
  getField(id: string): Promise<ReferenceField | null>;
  listRoles(fieldId: string): Promise<ReferenceRole[]>;
  listJobPosts(fieldId: string): Promise<ReferencePost[]>;
  searchFields(terms: string[]): Promise<ReferenceField[]>;
}

async function defaultReference(): Promise<ExploreReferenceReader> {
  const ref = await import("./reference");
  return {
    getField: (id) => ref.getField(id),
    listRoles: (fieldId) => ref.listRoles(fieldId),
    listJobPosts: (fieldId) => ref.listJobPosts(fieldId),
    searchFields: (terms) => ref.searchFields(terms),
  };
}

// ---------------------------------------------------------------------------
// Model output schema
// ---------------------------------------------------------------------------

export const ExamplePostSchema = z.object({
  title: z.string(),
  company: z.string(),
  /** What the post asks for, in one or two sentences. */
  summary: z.string(),
  /** The exact URL seen (employer career page or a board that permits access). */
  sourceUrl: z.string(),
});
export type ExamplePost = z.infer<typeof ExamplePostSchema>;

export const ExploreRoleSchema = z.object({
  title: z.string(),
  companies: z.array(z.string()),
  /** Why this role fits; names the card IDs (C1, C2, …) it draws on. */
  why: z.string(),
  sources: z.array(z.string()),
});
export type ExploreRole = z.infer<typeof ExploreRoleSchema>;

export const ExploreOutputSchema = z.object({
  /** What someone in this field does day to day: a paragraph, role profile only. */
  dayToDay: z.string(),
  titles: z.array(z.string()),
  employers: z.array(z.string()),
  examplePosts: z.array(ExamplePostSchema),
  /** Short search keywords the person can use on any job board. */
  keywords: z.array(z.string()),
  sources: z.array(z.string()),
  roles: z.array(ExploreRoleSchema),
  /** What is uncertain or could not be confirmed. */
  uncertain: z.array(z.string()),
});
export type ExploreOutput = z.infer<typeof ExploreOutputSchema>;

// ---------------------------------------------------------------------------
// Prompts (byte-stable: sent as cached blocks)
// ---------------------------------------------------------------------------

export const EXPLORE_SYSTEM_PROMPT = `You help one career switcher understand a single climate field they are considering. You get their experience cards, their preferences, the field with the fit reasoning already recorded, and reference material about the field: a catalogue entry, example roles, and example job posts. You return JSON describing the field concretely.

Use the reference material as the primary evidence; use web search to fill gaps and to confirm it is current. Cite the exact URLs you saw.

Rules:
- Never search, fetch or cite linkedin.com, indeed.com or climatebase.org, or any of their subdomains. Do not name them as sources.
- Example posts come only from employer career pages or job boards that permit access. Each needs the exact URL you saw; omit a post rather than invent a URL.
- dayToDay describes what someone in this kind of role does in a typical week: the recurring tasks, who they work with, the tools and outputs. It is a role profile, never a real individual: do not name or describe any real person, and do not draw on personal profiles.
- titles: 4-8 job titles employers actually use for this work; employers: 4-8 organisations that hire for it (companies, utilities, agencies, nonprofits); keywords: 3-6 short search phrases (2-4 words each) that surface these roles on any job board.
- roles: 2-4 roles for this person specifically. Each why names the card IDs (C1, C2, ...) it draws on and has at least one source URL.
- sources: up to 6 URLs backing the day-to-day description, titles and employers.
- uncertain: 1-3 short items you could not confirm (e.g. whether the role exists at their seniority, whether it is hiring in their location).
- Return only the JSON.`;

export const EXPLORE_RESEARCH_SYSTEM_PROMPT = `You research one climate field for one career switcher. You get their experience cards, their preferences, the field with its fit reasoning, and reference material: a catalogue entry, example roles and example job posts. Use web search to confirm what the work involves day to day, which titles employers use, who hires, and to find current example posts on employer career pages or job boards that permit access. Never search, fetch or cite linkedin.com, indeed.com or climatebase.org. Describe roles, never real individuals. Write concise research notes: day-to-day work, titles, employers, example posts (title, company, what it asks for, exact URL), search keywords, sources, roles that fit this person (naming card IDs), and open questions. Notes only — no JSON.`;

export const EXPLORE_SHAPE_SYSTEM_PROMPT = `${EXPLORE_SYSTEM_PROMPT}

You are given research notes gathered with web search. Shape them into the JSON. Do not add URLs that are not in the notes or the reference material.`;

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

export interface ReferenceBundle {
  field: ReferenceField | null;
  roles: ReferenceRole[];
  posts: ReferencePost[];
  /** Catalogue fields matched by name when the profile field has no ref. */
  related: ReferenceField[];
}

function renderRefField(f: ReferenceField): string {
  return (
    `- ${f.name} (id: ${f.id})\n` +
    `  - Description: ${f.description}\n` +
    `  - Climate link: ${f.climate_link}\n` +
    `  - Transferable functions: ${f.transferable_functions.join(", ") || "(none)"}\n` +
    `  - Sources: ${f.sources.join(", ") || "(none)"}`
  );
}

/** The profile field plus the reference material, in a fixed layout. */
export function renderFieldForExplore(field: Field, ref: ReferenceBundle): string {
  const lines: string[] = [
    `## Field to explore: ${field.id}: ${field.name}`,
    `- Move: ${field.move ?? "(unknown)"}`,
    `- Fit so far: ${field.fit || "(none recorded)"}`,
    `- Uncertain so far: ${field.uncertain || "(none recorded)"}`,
    `- Sources so far: ${field.sources.join(", ") || "(none)"}`,
    "",
    "## Reference material",
  ];
  if (ref.field !== null) {
    lines.push("### Catalogue entry", renderRefField(ref.field));
  } else if (ref.related.length > 0) {
    lines.push("### Related catalogue entries (no exact match)", ...ref.related.map(renderRefField));
  } else {
    lines.push("(no catalogue entry for this field; rely on web search)");
  }
  lines.push("", "### Example roles from the catalogue");
  if (ref.roles.length === 0) lines.push("(none)");
  for (const r of ref.roles) {
    lines.push(
      `- ${r.title} (id: ${r.id}, function: ${r.function})\n` +
        `  - Day to day: ${r.day_to_day}\n` +
        `  - Example companies: ${r.example_companies.join(", ") || "(none)"}\n` +
        `  - Sources: ${r.sources.join(", ") || "(none)"}`,
    );
  }
  lines.push("", "### Example job posts from the catalogue");
  if (ref.posts.length === 0) lines.push("(none)");
  for (const p of ref.posts) {
    lines.push(
      `- ${p.title} at ${p.company}${p.posted_date === null ? "" : ` (posted ${p.posted_date})`}\n` +
        `  - Asks for: ${p.requirements_summary}\n` +
        `  - URL: ${p.source_url}`,
    );
  }
  return lines.join("\n");
}

export function buildExploreMessage(profile: Profile, field: Field, ref: ReferenceBundle): string {
  return [
    "# Experience cards",
    "",
    renderCardsForDiscover(profile),
    "",
    "# Preferences",
    "",
    renderPreferencesForDiscover(profile),
    "",
    renderFieldForExplore(field, ref),
    "",
    "# Task",
    "",
    `Describe ${field.name} concretely for this person and return the JSON.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Validation (never silently keep a blocked or malformed URL)
// ---------------------------------------------------------------------------

export interface ExploreDropped {
  /** Example posts dropped: blocked or malformed URL, or beyond MAX_POSTS. */
  postsRemoved: number;
  /** Individual source URLs removed (field and role sources). */
  sourcesRemoved: number;
  /** Roles dropped for having no usable source. */
  rolesUnsourced: number;
  /** Roles beyond MAX_ROLES_PER_FIELD or duplicating an earlier title. */
  rolesSurplus: number;
}

export interface ValidatedExplore {
  dayToDay: string;
  titles: string[];
  employers: string[];
  posts: ExamplePost[];
  keywords: string[];
  sources: string[];
  roles: { title: string; companies: string[]; why: string; sources: string[] }[];
  uncertain: string[];
  dropped: ExploreDropped;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function dedupeStrings(items: readonly string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const s = oneLine(raw);
    const key = s.toLowerCase();
    if (s === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, limit);
}

function isUsableUrl(url: string): boolean {
  const s = url.trim();
  return s !== "" && /^https?:\/\//i.test(s) && sourceHost(s) !== null && !isBlockedSourceHost(s);
}

export function validateExploreOutput(output: ExploreOutput): ValidatedExplore {
  const dropped: ExploreDropped = { postsRemoved: 0, sourcesRemoved: 0, rolesUnsourced: 0, rolesSurplus: 0 };

  const posts: ExamplePost[] = [];
  const seenPostUrls = new Set<string>();
  for (const p of output.examplePosts) {
    const sourceUrl = p.sourceUrl.trim();
    if (!isUsableUrl(sourceUrl) || seenPostUrls.has(sourceUrl)) {
      dropped.postsRemoved += 1;
      continue;
    }
    seenPostUrls.add(sourceUrl);
    posts.push({ title: oneLine(p.title), company: oneLine(p.company), summary: oneLine(p.summary), sourceUrl });
  }
  dropped.postsRemoved += Math.max(0, posts.length - MAX_POSTS);

  const sources = cleanSources(output.sources, MAX_SOURCES);
  dropped.sourcesRemoved += sources.removed;

  const roles: ValidatedExplore["roles"] = [];
  const seenTitles = new Set<string>();
  for (const r of output.roles) {
    const title = oneLine(r.title);
    const key = title.toLowerCase();
    if (title === "" || seenTitles.has(key) || roles.length >= MAX_ROLES_PER_FIELD) {
      dropped.rolesSurplus += 1;
      continue;
    }
    const rs = cleanSources(r.sources, MAX_SOURCES);
    dropped.sourcesRemoved += rs.removed;
    if (rs.kept.length === 0) {
      dropped.rolesUnsourced += 1;
      continue;
    }
    seenTitles.add(key);
    roles.push({ title, companies: dedupeStrings(r.companies, MAX_EMPLOYERS), why: oneLine(r.why), sources: rs.kept });
  }

  return {
    dayToDay: output.dayToDay.trim(),
    titles: dedupeStrings(output.titles, MAX_TITLES),
    employers: dedupeStrings(output.employers, MAX_EMPLOYERS),
    posts: posts.slice(0, MAX_POSTS),
    keywords: dedupeStrings(output.keywords, MAX_KEYWORDS),
    sources: sources.kept,
    roles,
    uncertain: dedupeStrings(output.uncertain, MAX_UNCERTAINTIES),
    dropped,
  };
}

// ---------------------------------------------------------------------------
// LinkedIn guidance: links the user opens themselves; never fetched here
// ---------------------------------------------------------------------------

export interface GuidanceLink {
  label: string;
  url: string;
}

export const LINKEDIN_JOBS_SEARCH = "https://www.linkedin.com/jobs/search/";

/** One LinkedIn job-search URL per keyword (plus one combining the first two). */
export function linkedinGuidanceLinks(keywords: readonly string[], location?: string): GuidanceLink[] {
  const loc = location === undefined ? "" : oneLine(location);
  const build = (kw: string): string => {
    const params = [`keywords=${encodeURIComponent(kw)}`];
    if (loc !== "") params.push(`location=${encodeURIComponent(loc)}`);
    return `${LINKEDIN_JOBS_SEARCH}?${params.join("&")}`;
  };
  const kws = dedupeStrings(keywords, MAX_KEYWORDS);
  const links = kws.map((kw) => ({ label: `LinkedIn jobs: ${kw}`, url: build(kw) }));
  if (kws.length >= 2) {
    const combined = `${kws[0]!} ${kws[1]!}`;
    links.push({ label: `LinkedIn jobs: ${combined}`, url: build(combined) });
  }
  return links;
}

// ---------------------------------------------------------------------------
// The acceptance check: no blocked host in anything the model fetched or cited
// ---------------------------------------------------------------------------

export class ExploreBlockedFetchError extends Error {
  readonly hosts: readonly string[];
  constructor(hosts: readonly string[]) {
    super(`The model fetched or cited a blocked host: ${hosts.join(", ")}`);
    this.name = "ExploreBlockedFetchError";
    this.hosts = hosts;
  }
}

/** A response message as far as this check cares: a list of content blocks. */
export interface MessageLike {
  content: readonly unknown[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function urlOf(v: unknown): string | null {
  return isRecord(v) && typeof v.url === "string" ? v.url : null;
}

/**
 * Every URL the response shows as searched, fetched or cited: web_search
 * results, web_fetch results, `server_tool_use` fetch inputs, and
 * `web_search_result_location` citations on text blocks.
 */
export function collectFetchedUrls(message: MessageLike): string[] {
  const urls: string[] = [];
  const push = (u: string | null) => {
    if (u !== null) urls.push(u);
  };
  for (const block of message.content) {
    if (!isRecord(block)) continue;
    switch (block.type) {
      case "web_search_tool_result":
        if (Array.isArray(block.content)) for (const r of block.content) push(urlOf(r));
        break;
      case "web_fetch_tool_result":
        push(urlOf(block.content));
        break;
      case "server_tool_use":
        push(urlOf(block.input));
        break;
      case "text":
        if (Array.isArray(block.citations)) for (const c of block.citations) push(urlOf(c));
        break;
      default:
        break;
    }
  }
  return urls;
}

/**
 * Throws {@link ExploreBlockedFetchError} if any searched, fetched or cited
 * URL has a blocked host (linkedin.com, indeed.com, climatebase.org or a
 * subdomain). Returns how many URLs it checked. Pure; safe on any message.
 */
export function assertNoBlockedFetches(message: MessageLike): { checked: number } {
  const urls = collectFetchedUrls(message);
  const blocked = [...new Set(urls.filter((u) => isBlockedSourceHost(u)).map((u) => sourceHost(u) ?? u))];
  if (blocked.length > 0) throw new ExploreBlockedFetchError(blocked);
  return { checked: urls.length };
}

// ---------------------------------------------------------------------------
// Apply back to the profile
// ---------------------------------------------------------------------------

export interface ApplyExploreResult {
  profile: Profile;
  field: Field;
  /** Roles written this run, in output order, with their (possibly reused) IDs. */
  roles: Role[];
}

function clip(s: string, max: number): string {
  const t = oneLine(s);
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export function applyExplore(profile: Profile, fieldId: string, v: ValidatedExplore): ApplyExploreResult {
  const existing = profile.fields.find((f) => f.id === fieldId);
  if (existing === undefined) throw new ExploreInputError(`No field ${fieldId} in the profile.`);
  const extra = { ...existing.extra };
  if (v.dayToDay !== "") extra[DAY_TO_DAY_KEY] = clip(v.dayToDay, MAX_EXTRA_CHARS);
  if (v.keywords.length > 0) extra[KEYWORDS_KEY] = v.keywords.join(", ");
  if (v.titles.length > 0) extra[TITLES_KEY] = v.titles.join(", ");
  const sources = cleanSources([...existing.sources, ...v.sources], MAX_SOURCES).kept;
  let next = upsertField(profile, { ...existing, sources, extra });
  next = setFieldExplored(next, fieldId);

  const roles: Role[] = [];
  for (const r of v.roles) {
    const match = next.roles.find((x) => x.fieldId === fieldId && x.title.toLowerCase() === r.title.toLowerCase());
    next = upsertRole(next, {
      ...(match === undefined ? {} : { id: match.id }),
      title: r.title,
      fieldId,
      companies: r.companies,
      why: r.why,
      sources: r.sources,
      extra: match?.extra ?? {},
    });
    const role = match === undefined ? next.roles.at(-1) : next.roles.find((x) => x.id === match.id);
    if (role !== undefined) roles.push(role);
  }
  const field = next.fields.find((f) => f.id === fieldId) ?? existing;
  return { profile: next, field, roles };
}

// ---------------------------------------------------------------------------
// The chat message
// ---------------------------------------------------------------------------

/** Markdown for the assistant bubble: the rich version of what was stored. */
export function renderExploreMessage(field: Field, v: ValidatedExplore, links: readonly GuidanceLink[]): string {
  const lines: string[] = [`## ${field.name}`, "", "**Day to day.** " + (v.dayToDay || "(nothing confirmed)"), ""];
  lines.push("**Job titles to look for:** " + (v.titles.join(", ") || "(none confirmed)"), "");
  lines.push("**Who hires:** " + (v.employers.join(", ") || "(none confirmed)"), "");
  lines.push("**Example posts:**");
  if (v.posts.length === 0) lines.push("- (none with a usable source this run)");
  for (const p of v.posts) lines.push(`- ${p.title} — ${p.company}: ${p.summary} (${p.sourceUrl})`);
  lines.push("");
  if (v.roles.length > 0) {
    lines.push("**Roles that fit you:**");
    for (const r of v.roles) {
      const co = r.companies.length === 0 ? "" : ` (${r.companies.join(", ")})`;
      lines.push(`- ${r.title}${co}: ${r.why} — ${r.sources.join(", ")}`);
    }
    lines.push("");
  }
  lines.push("**Search these yourself** (I never search LinkedIn for you; these open in your browser):");
  if (links.length === 0) lines.push("- (no keywords this run)");
  for (const l of links) lines.push(`- [${l.label}](${l.url})`);
  if (v.keywords.length > 0) lines.push(`- Keywords for any board: ${v.keywords.join(" · ")}`);
  lines.push("");
  lines.push("**Sources:**");
  if (v.sources.length === 0) lines.push("- (none)");
  for (const s of v.sources) lines.push(`- ${s}`);
  lines.push("");
  lines.push("**What I'm unsure about:**");
  if (v.uncertain.length === 0) lines.push("- Nothing flagged this run.");
  for (const u of v.uncertain) lines.push(`- ${u}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export class ExploreInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExploreInputError";
  }
}

export interface ExploreRequest {
  sessionId: string;
  profile: Profile;
  fieldId: string;
}

export interface ExploreOptions {
  llm?: Llm;
  reference?: ExploreReferenceReader;
  /** Web tools from `webTools()`; pass `[]` to run without search (tests). */
  tools?: readonly LlmTool[];
  /** "single" tries structured + tools in one call and falls back on a 400. */
  strategy?: "single" | "two-call";
}

export interface ExploreResult extends ApplyExploreResult {
  /** Markdown for the assistant bubble. */
  message: string;
  links: GuidanceLink[];
  validated: ValidatedExplore;
  dropped: ExploreDropped;
  /** Per-call metrics, one entry per model call made (1 or 2). */
  calls: CallMetrics[];
  strategy: "single" | "two-call";
  /** URLs seen in tool results and citations across all calls; none blocked. */
  fetchedUrls: number;
}

/** An API 400 means the request shape was refused (e.g. tools + format). */
function isBadRequest(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 400;
}

async function loadTools(): Promise<readonly LlmTool[]> {
  const { webTools } = await import("./llm");
  return webTools({ searchMaxUses: 8, fetchMaxUses: 4 });
}

/** Words of the field name worth matching against the catalogue. */
function searchTerms(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
}

async function loadReference(reference: ExploreReferenceReader, field: Field): Promise<ReferenceBundle> {
  const refId = field.extra[REF_KEY];
  if (refId !== undefined && refId.trim() !== "") {
    const [f, roles, posts] = await Promise.all([
      reference.getField(refId.trim()),
      reference.listRoles(refId.trim()),
      reference.listJobPosts(refId.trim()),
    ]);
    if (f !== null) return { field: f, roles, posts, related: [] };
  }
  const terms = searchTerms(field.name);
  const related = terms.length === 0 ? [] : (await reference.searchFields(terms)).slice(0, 3);
  return { field: null, roles: [], posts: [], related };
}

const metricsOf = ({ usage, costUsd, durationMs, continuations, stopReason }: CallMetrics): CallMetrics => ({
  usage,
  costUsd,
  durationMs,
  continuations,
  stopReason,
});

/** Profile + one field + reference + web → the field explored, roles written, chat text. */
export async function exploreField(
  { sessionId, profile, fieldId }: ExploreRequest,
  options: ExploreOptions = {},
): Promise<ExploreResult> {
  const field = profile.fields.find((f) => f.id === fieldId);
  if (field === undefined) throw new ExploreInputError(`No field ${fieldId} in the profile.`);
  if (activeCards(profile).length === 0) {
    throw new ExploreInputError("The profile has no active experience cards to explore from.");
  }
  const llmClient = options.llm ?? (await import("./llm")).llm();
  const reference = options.reference ?? (await defaultReference());
  const tools = options.tools ?? (await loadTools());
  const bundle = await loadReference(reference, field);
  const message = buildExploreMessage(profile, field, bundle);
  const calls: CallMetrics[] = [];
  let fetchedUrls = 0;
  const check = (m: MessageLike) => {
    fetchedUrls += assertNoBlockedFetches(m).checked;
  };

  let strategy = options.strategy ?? "single";
  let value: ExploreOutput | undefined;
  if (strategy === "single") {
    try {
      const result = await llmClient.structured({
        step: "explore",
        sessionId,
        system: EXPLORE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: message }],
        schema: ExploreOutputSchema,
        ...(tools.length === 0 ? {} : { tools }),
      });
      calls.push(metricsOf(result));
      check(result.message);
      value = result.value;
    } catch (error: unknown) {
      if (tools.length === 0 || !isBadRequest(error)) throw error;
      strategy = "two-call";
    }
  }
  if (value === undefined) {
    const research = await llmClient.streamText({
      step: "explore",
      sessionId,
      system: EXPLORE_RESEARCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: message }],
      ...(tools.length === 0 ? {} : { tools }),
    }).final;
    calls.push(metricsOf(research));
    check(research.message);
    const shaped = await llmClient.structured({
      step: "explore",
      sessionId,
      system: EXPLORE_SHAPE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `${message}\n\n# Research notes\n\n${research.text}` }],
      schema: ExploreOutputSchema,
    });
    calls.push(metricsOf(shaped));
    check(shaped.message);
    value = shaped.value;
  }

  const validated = validateExploreOutput(value);
  const applied = applyExplore(profile, fieldId, validated);
  const links = linkedinGuidanceLinks(validated.keywords, profile.preferences.location?.value);
  return {
    ...applied,
    message: renderExploreMessage(applied.field, validated, links),
    links,
    validated,
    dropped: validated.dropped,
    calls,
    strategy,
    fetchedUrls,
  };
}

/** One line for logs and the CLI: counts only, never content. */
export function exploreDroppedSummary(d: ExploreDropped): string {
  return (
    `dropped: ${String(d.postsRemoved)} posts, ${String(d.sourcesRemoved)} sources, ` +
    `${String(d.rolesUnsourced)} unsourced roles, ${String(d.rolesSurplus)} surplus roles`
  );
}
