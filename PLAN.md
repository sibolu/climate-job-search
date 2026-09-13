# Alpha Build Plan — Climate Career Exploration Tool

Companion to [PRD.md](PRD.md). This is the execution plan for an alpha that
5–8 Climatebase fellows can try. It is written so that a Claude Code session
can execute a phase autonomously with the prompt
`Execute Phase N per PLAN.md`.

Status legend: `[TODO]` `[IN PROGRESS]` `[DONE]` `[SKIPPED: reason]`

---

## 1. Alpha scope

**Users:** fellows of varying technical skill. Everything happens in a website
on desktop Chrome. No Python, no Claude Code, no files to manage.

**In (the three PRD stages, thin end to end, plus the iteration loop):**
- Paste resume or profile as plain text → editable experience cards
  (situation / actions / results / skills).
- Progressive preference elicitation in chat, one question at a time.
- Field and role discovery: candidate climate fields and roles, each with fit
  reasoning tied to specific cards, what is uncertain, and sourced examples.
- Exploration: drill into a field → concrete titles, companies, example
  job posts from the reference collection and web search, guidance for
  manual LinkedIn exploration.
- Queries for LinkedIn / Indeed / Climatebase shown in the website with copy
  buttons and alert instructions.
- **Iteration loop (first-class):** the user runs a query on a job board,
  comes back, marks it good fit / bad fit with a reason, and the assistant
  revises queries, fields, and the profile in response.
- Session memory in the browser only. Nothing about the user is stored
  server-side.
- Evaluation harness: synthetic profiles, structural checks, a scripted
  feedback-loop eval, and a "plain frontier model + web search" baseline arm.

**Out (per PRD):** scraping, job index, model training, alert ingestion,
application tracking, accounts, any server-side user data.

**Definition of "alpha done":** a fellow can paste a resume, reach ≥3
explored fields and a query list, run two queries on a job board, report
fit, and see the queries change, all in one sitting on a hosted URL. Cost
per session is logged anonymously.

---

## 2. Architecture (defaults; override in §7)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, Next.js (App Router), `pnpm` | Vercel is built for Next.js. Evals also in TS so prompts have one home |
| Hosting | Vercel for app and route handlers. Supabase Postgres for the reference collection only | Existing subscriptions |
| Access | Shared passcode (env var) checked in middleware, cookie after entry. No accounts | Gates the pilot without identifying anyone |
| LLM | Anthropic TS SDK, `claude-opus-5`, adaptive thinking, streaming route handlers (`maxDuration` 800s) | Skill default; effort per call (chat `medium`, discovery `high`) |
| Grounding | Supabase reference collection first, then server-side `web_search_20260209` and `web_fetch_20260209` with `blocked_domains` for linkedin.com, indeed.com, climatebase.org | Sources without scraping; hard constraint enforced in code |
| Session state | `profile.md` text + chat messages + query feedback, in `localStorage`. Sent to the route handler on every turn. Export, import, and "start over" buttons | PRD's "single .md the user keeps"; server is stateless |
| Reference data | Supabase tables `climate_fields`, `example_roles`, `example_job_posts`, seeded from `data/*.yaml` in the repo. Anon key with select-only RLS | The PRD's one allowed collection, reproducible from the repo |
| Cost telemetry | `llm_usage` table: random per-browser session id, model, tokens, cost, duration, step name. No content, no identity | Per-session spend cap and evidence for a later Sonnet 5 decision. See §7 |
| Resume input | Plain-text paste (textarea). PDF upload deferred | User asked for text; removes a parsing surface |
| Structured steps | `output_config.format` structured outputs for cards, fields, queries | Deterministic shapes for the UI |
| Tests | `vitest`; prompt behaviors covered by evals, not unit tests | Unit tests for parsers and pure logic only |

**UI shape (desktop Chrome, ~1280px+):**
- Left two thirds: chat. Assistant questions can render answer pills
  (e.g. seniority levels, "browse industries" chips drawn from
  `climate_fields`) so nontechnical users click rather than type, with free
  text always available.
- Right third: workspace with three tabs. **Profile** (paste/edit text,
  cards list, export/import/start over). **Fields** (candidate fields with
  accept / reject / unsure, click to explore). **Queries** (cards per board
  with copy button, alert steps, and a "Tried it" control: good fit / bad
  fit + why, which posts a feedback turn into the chat).

Repo layout target:

```
src/
  lib/
    profile.ts      # profile.md schema, parse/serialize  (the contract)
    session.ts      # what the browser sends each turn: profile + messages + feedback
    llm.ts          # client wrapper, model config, usage logging, web tools
    reference.ts    # typed reads from the Supabase reference tables
    cards.ts        # pasted text → experience cards
    elicit.ts       # preference elicitation policy and answer pills
    discover.ts     # fields/roles discovery
    explore.ts      # field drill-down, example posts, LinkedIn guidance
    queries.ts      # query generation and revision from feedback
  app/
    api/            # streaming route handlers, one per lib module
    (app)/          # the single-page workspace
  proxy.ts          # passcode gate (Next 16's name for middleware.ts; see §7.7)
supabase/migrations/   # reference tables, llm_usage, RLS (select-only anon)
data/                  # climate_fields.yaml, example_roles.yaml, example_job_posts.yaml
scripts/seed.ts        # data/*.yaml → Supabase
evals/                 # synthetic profiles, structural checks, feedback-loop eval, baseline arm
```

---

## 3. Phases and steps

Each step lists: owner model, parallelism, and the acceptance check the
orchestrator runs before marking `[DONE]`. Every step ends in one commit.

### Phase 0 — Foundations (sequential; everything else depends on these)

| # | Step | Model | Acceptance |
|---|---|---|---|
| 0.1 `[DONE]` | Scaffold: Next.js + TypeScript, `pnpm`, `eslint`, `vitest`, `.env.example`, passcode middleware, repo `CLAUDE.md` with conventions and the PRD's hard constraints | Opus | `pnpm test`, `pnpm lint`, `pnpm build` pass; wrong passcode is refused |
| 0.2 `[DONE]` | `profile.ts` and `session.ts`: the `profile.md` schema (Preferences, Experience Cards, Skills confirmed/inferred/excluded, Fields with status, Role Shortlist, Queries with status untried/good/bad + reason, Session Notes) with parse/serialize; the per-turn payload shape | Fable | Round-trip tests on 3 fixture profiles; hand-editing a card in markdown survives reload |
| 0.3 `[DONE]` | `llm.ts`: client wrapper (streaming, structured outputs helper, web tools with blocked domains, effort per call type, anonymous usage logging, refusal handling) | Opus + `claude-api` skill | One live smoke call writes a usage row; blocked-domain config unit-tested |
| 0.4 `[DONE]` | Supabase: migrations for `climate_fields`, `example_roles`, `example_job_posts`, `llm_usage`; select-only RLS for anon on reference tables, insert-only on `llm_usage`; `scripts/seed.ts`; `reference.ts` typed reads; local dev via Supabase CLI | Opus | Seed runs from an empty YAML fixture; anon key cannot read `llm_usage` or write reference tables |

Gate 0: orchestrator runs tests, `/code-review` at medium (Opus workers, §4), commits. User skims
the `profile.md` schema (the one design decision worth a human look).

### Phase 1 — Stage 1: discovery (1.1–1.3 in parallel worktrees, then 1.4)

| # | Step | Model | Acceptance |
|---|---|---|---|
| 1.1 `[DONE]` | `cards.ts`: pasted text → 3–6 experience cards with candidate skills; confirm/correct flow | Opus | Runs on 3 synthetic resumes; every card has S/A/R and ≥1 skill |
| 1.2 `[DONE]` | `elicit.ts`: progressive preference policy (what is missing, what to ask next, one question per turn, skip when inferable) and the answer-pill schema | Fable | Scripted 5-turn transcript never asks two things at once; stops once enough is known |
| 1.3 `[DONE]` | Reference collection: 3 Sonnet 5 agents at `effort: low` each cover ~10 sectors (energy/grid/storage; built environment/transport/industry; nature/food/finance/policy/software). Per sector: description, climate link, transferable functions, example roles per function, example companies, 2–3 example job posts as title + company + requirements summary + source URL + date (company career pages and boards that permit access only), source URLs. Fable consolidates and seeds | 3× Sonnet 5 (low), 1× Fable | Seed validates; every field has ≥2 sources and ≥2 example posts; no LinkedIn/Indeed/Climatebase URLs; no personal profiles |
| 1.4 `[DONE]` | `discover.ts`: profile + reference data + web search → ranked fields and roles, each with fit reasoning citing card IDs, sector-move vs adjacent vs retraining label, uncertainties, sourced examples | Fable | On 3 synthetic profiles: every recommendation cites ≥1 card and ≥1 source; the videographer profile gets non-generic fields |

**Phase 1 status (2026-09-12).** The first session ran out mid-phase (§7.28)
leaving 1.1 and 1.2 in orphaned worktrees; the second session salvaged them,
ran 1.3 and 1.4, and committed all four steps on `phase-1`. The worktrees are
removed.

**Gate 1 run (2026-09-12).** `pnpm test` (199), `pnpm lint`, `pnpm typecheck`
and `pnpm build` all pass. `/code-review` at medium over `main...phase-1`
returned four confirmed correctness findings, all in the apply-back paths, all
since fixed with one regression test each: `cards.ts:430` (a draft card rejected by `normalizeDrafts` silently
excludes the user's existing card), `cards.ts:404` (case-sensitive card-id
match duplicates *and* excludes a card when the model returns `c3`),
`discover.ts:443` (dedupe by ref-or-name vs. apply by ref-then-name collapses
two same-named fields and reports a stale id), `discover.ts:385` (refs stored
untrimmed in `extra.Ref` but compared trimmed, so `" CF12 "` fails to match on
a later run). They were profile-corruption bugs, not prompt-quality bugs, and
were fixed before the 2.1/2.4 UI starts writing to the same paths. Validation
now dedupes on the same ref-then-name keys `findExistingField` /
`findExistingRole` match on, so a dedupe key and a match key can no longer
disagree (§7.30). Still outstanding: the user's own trial run of
`pnpm try:cards` / `pnpm try:discover` on a real resume.

Gate 1: same as Gate 0. User tries the flow via a `tsx` script on their own resume.

### Phase 2 — Stages 2 and 3, the feedback loop, and the UI

| # | Step | Model | Parallel | Acceptance |
|---|---|---|---|---|
| 2.1 `[TODO]` | Workspace shell: passcode screen, chat with streaming and answer pills, Profile tab (paste, cards, export/import/start over), `localStorage` persistence via `session.ts` | Opus | ∥ 2.2, 2.3 | Reload restores state; export file round-trips; "start over" clears everything |
| 2.2 `[TODO]` | `explore.ts`: field drill-down → titles, companies, example posts (reference collection first, then web), day-to-day description, LinkedIn guidance links built from keywords | Fable | ∥ | Output cites URLs; blocked domains never fetched (assert on usage log) |
| 2.3 `[TODO]` | `queries.ts`: keyword and boolean queries per board with alert steps; **revise** function that takes query feedback (good/bad + why) and returns updated queries, field status changes, and profile edits with a one-paragraph explanation | Fable | ∥ | Scripted feedback "bad fit: all roles need PE license" removes or narrows those queries and says why |
| 2.4 `[TODO]` | Fields and Queries tabs: field board with accept/reject/unsure and explore; query cards with copy, alert steps, "Tried it" feedback that posts a feedback turn and updates the Queries section of the profile | Opus | after 2.1 | Feedback on a query changes the profile text and triggers a revision turn |
| 2.5 `[TODO]` | Integration: wire 1.x and 2.x into route handlers and the page; end-to-end run on a Vercel preview deploy; fix seams | Orchestrator (Fable) | after all | Full loop on the builder's own resume, on a preview URL |

Gate 2: `/code-review` high and `/security-review` on Opus workers (§4) — passcode, input handling,
RLS, no user content reaching Supabase). User does one full run including two
real job-board searches and files feedback as issues.

### Phase 3 — Evaluation and pilot readiness (3.1 ∥ 3.2 ∥ 3.3, then 3.4)

| # | Step | Model | Acceptance |
|---|---|---|---|
| 3.1 `[TODO]` | `evals/`: 4 synthetic profiles (videographer, web designer, ML/causal, nontechnical ops/marketing); structural checks; scripted feedback-loop eval; LLM-judge rubric (grounded? sources real? non-generic? revision responsive to the stated reason?) built per the `claude-api build-eval` guide | Fable | `pnpm eval` produces a scored table and cost per run |
| 3.2 `[TODO]` | Baseline arm: same profile, plain "help me explore climate careers" prompt to Opus 5 with web search; transcripts saved for side-by-side | Opus | Transcripts for the 4 profiles under `evals/baseline/` |
| 3.3 `[TODO]` | Deploy: Vercel production project, Supabase production project seeded, env vars, passcode, per-session spend cap from `llm_usage`, feedback form link | Opus | Production URL works from a clean browser with the passcode; cap stops calls |
| 3.4 `[TODO]` | Pilot kit: fellow-facing intro page in the app (what it does, what stays in your browser, how to export), feedback template, known limitations | Opus | Reviewed by user |

Gate 3: user invites fellows.

---

## 4. How the orchestrator coordinates subagents

The session you talk to is the orchestrator. It does not write feature code
itself; it writes briefs, spawns workers, checks their acceptance criteria,
integrates, and commits.

**Brief template for every worker:**
1. Goal in two sentences and the acceptance check verbatim from §3.
2. Files it owns (it may not touch others) and the interfaces it must respect
   (`profile.ts`, `session.ts`, `llm.ts`, `reference.ts` signatures pasted in
   after Phase 0).
3. The hard constraints from the PRD and the "no user data server-side" rule,
   verbatim.
4. "Run the acceptance check yourself. Report in ≤10 lines: what you did,
   what the check showed, anything you could not do."

**Mechanics used:**
- `Agent` tool with `model` override per the tables above, `run_in_background`
  for parallel steps, `isolation: worktree` whenever two workers run at once.
  Parallel only when file ownership is disjoint; the orchestrator merges.
- Sequential steps run on the phase branch with no worktree.
- `/code-review` at each gate; `/security-review` at Gate 2.
- The `Workflow` tool (deterministic fan-out with schemas) is the better fit
  for the 1.3 and 3.1 fan-outs. It needs an explicit opt-in: say
  "use a workflow for step 1.3" and the orchestrator will author one.
- Memory: decisions not in the repo get saved to the orchestrator's project
  memory so future sessions do not relitigate them.

**Model policy (revised 2026-09-12 after the Gate 0 measurement, §7.28):**
- **Fable** orchestrates, and owns the steps where prompt quality *is* the
  product — the ones whose Model column in §3 says Fable: the profile schema,
  elicitation, discovery, exploration, query revision, reference-collection
  consolidation, evaluation, and integration. Nothing else.
- **Opus** does the coding *and every gate review*: scaffold, wrappers,
  Supabase, UI, seed scripts, deployment, docs, `/code-review` fan-out,
  `/security-review`. Gate reviews were on Fable and cost 28% of a whole
  session window for findings Opus produces just as well.
- **Sonnet 5 at `effort: low`** for data-gathering workers that read the web
  and report facts back — the §3 step 1.3 sector research. They summarise
  sources; they do not write product prose or code.
- **Escalate to Fable** when a worker reports a blocker or a bug it could not
  fix in one attempt. The orchestrator re-briefs the same task to a Fable
  worker rather than retrying at the same tier.
- Cost shape per token: Fable $10/$50 per MTok, Opus $5/$25, Sonnet 5 $2/$10.
  Fable is 2× Opus and 5× Sonnet, so a Fable worker has to be earning it.

**Worker budget (the cost is context × turns, not tool calls):**

Cache reads were 93% of the input tokens in the measured window: every turn
re-bills the whole accumulated context, so a worker's cost grows with the
square of how long it runs. Brief accordingly.

- **Scope every worker to finish in ≤20 turns and stay under ~80K context.**
  Past that the tail turns dominate: one Phase 0 worker spent 40 turns at a
  median 144K context — 5.5M input tokens for a single file. If a step cannot
  fit, split it into two workers with disjoint file ownership rather than
  letting one run long.
- **The orchestrator states the turn budget in the brief** ("this should take
  under 20 tool calls; if it will not, stop and report why") and treats a
  worker that blows through it as a briefing bug, not a worker failure.
- **Never read a whole file into context.** No `cat file.ts`, no `Read`
  without `offset`/`limit` on anything over ~200 lines, no multi-file
  `cat -n a.ts b.ts c.ts`. Use `grep -n -C5`, `sed -n 'A,Bp'`, or a
  ranged `Read`. In the measured window 480K tokens of tool results were
  almost entirely whole-file dumps, several of the same file 5× over.
- **Do not send workers to PLAN.md.** The orchestrator pastes the step row,
  the acceptance check and the relevant §7 decisions into the brief. PLAN.md
  is 30KB and was read in full four times in one window.
- **One verification pass per step, filtered:**
  `pnpm test && pnpm lint && pnpm typecheck 2>&1 | tail -30`, then `pnpm build`
  once before the commit — not a full run after every edit.
- **Do not run a gate review and a phase execution in the same session
  window.** The Gate 0 review fan-out alone was 80% of a five-hour budget,
  which is why the Phase 1 session ran out with three steps left.

---

## 5. Operating agreement for autonomous runs

- **Kickoff prompt:** `Execute Phase N per PLAN.md. Commit each step on branch
  phase-N. Stop at the gate.` Nothing else is needed.
- **The orchestrator will not ask mid-phase.** Ambiguities get resolved by the
  defaults in §2 and §7 and stated in the gate report.
- **You review at gates, not steps.** Each gate produces a short report in the
  format from your global CLAUDE.md (action line, 1–3 sentences, FYI).
- **Branch per phase, PR per phase** via `gh`. Merge is your call.
- **Plan file is the source of truth.** Step statuses are updated here as
  steps finish, so a fresh session resumes where the last one ended.
- **Decisions and constraints live in this file and README.md, never in
  Claude's private memory.** Other contributors must be able to read them.
  When a decision is made mid-phase, the orchestrator records it in §7 and,
  if it affects contributors, in README.md, in the same commit.
- **Standing conventions go in the repo's CLAUDE.md** (Phase 0.1 expands
  the first version), not in chat.
- **Optional hardening:** a post-edit hook that runs lint and unit tests
  automatically (via the `update-config` skill). Worth adding after Phase 0.

---

## 6. Risks specific to this project

- **Grounding quality is the hypothesis under test.** Web search returns
  plenty of low-quality career content. Step 1.4's check counts citations,
  not their quality; the LLM judge in 3.1 is where quality gets measured.
  Do not skip 3.1.
- **Terms-of-use compliance is code, not policy.** `blocked_domains` in
  `llm.ts` is the enforcement point; 2.2's acceptance check asserts on the
  usage log. Any new fetch path must go through `llm.ts`.
- **No user data server-side is also code.** Route handlers are stateless;
  the only Supabase write is the anonymous `llm_usage` row. Gate 2's security
  review checks that no request body content is persisted or logged.
- **Browser-only state can be lost.** Clearing site data wipes the session.
  Export is one click and the intro page says so. Acceptable for a pilot.
- **Per-turn payload grows.** Profile plus full chat history is resent each
  turn. Keep the profile as the compressed memory: after each discovery or
  revision turn the assistant updates profile.md and the UI trims chat
  history to the last N turns.
- **Vercel function duration.** Discovery and exploration calls with web
  search can run 1–3 minutes. Route handlers stream and set `maxDuration`
  to 800s. If a step still times out, split it into search then synthesize.
- **Builder is a data scientist, app is TypeScript.** Prompts live as plain
  template strings in `src/lib/*.ts`, one per module, so editing a prompt
  never requires touching React.

---

## 7. Decisions taken by default (say so to change them)

1. Next.js + TypeScript on Vercel. Supabase holds only the reference
   collection and anonymous usage rows. Python-on-Vercel rejected (weak
   streaming, cold starts).
2. App model `claude-opus-5` everywhere, effort tuned per call. Re-evaluate
   Sonnet 5 for chat turns after Phase 3 using `llm_usage`.
3. All user state lives in the browser (`localStorage`) and is resent each
   turn. No accounts, no server-side profiles or transcripts. Consequence: the
   PRD's baseline comparison uses synthetic profiles and the builder's own,
   not fellows' transcripts, unless a fellow exports and shares one.
4. Anonymous usage rows (random session id, model, tokens, cost, duration,
   step) are written to Supabase for spend caps and model-choice evidence. Nothing else leaves
   the browser except the API request itself. If even this is too much, the
   cap moves client-side and the table is dropped.
5. Access by a single shared passcode given to invited fellows.
6. "Example profiles" in the reference collection means role profiles (what
   someone in the role does day to day), never personal profiles, per the
   PRD's consent rule.
7. The passcode gate lives in `src/proxy.ts`, not `src/middleware.ts`:
   Next.js 16 deprecated and renamed the `middleware` file convention to
   `proxy` (the exported function is `proxy` too). Same feature, current
   spelling. Unauthenticated `/api/*` requests get a `401` JSON body instead
   of a redirect, so `fetch()` callers see the failure rather than silently
   re-POSTing to an HTML page.
8. The session cookie is an HMAC-SHA-256 token `v1.<expiry>.<sig>` signed with
   `PASSCODE_COOKIE_SECRET` and carrying no user data — only a format version
   and an expiry. Signing and verification use the Web Crypto API so the gate
   stays portable to the Edge runtime.
9. **`profile.md` format is "labeled-bullet markdown"**, defined once in the
   header comment of `src/lib/profile.ts`: seven `##` sections in fixed order
   (Preferences, Experience Cards, Skills, Fields, Role Shortlist, Queries,
   Session Notes); items are `### <ID>: <title>` headings with
   `- **Key:** value` lines; lists are comma-separated inline except Sources
   (one URL per indented `-` line). No YAML or JSON blocks, so a nontechnical
   user can read and edit it in a textarea. Preferences are stated unless
   tagged `(inferred)`. Field `explored` is a boolean separate from `status`.
10. **ID stability rule.** Card/field/role/query IDs (`C1`, `F1`, `R1`, `Q1`)
    are never renumbered on edit; a new item gets the highest existing number
    plus one (gaps are never reused). Items that a user adds by hand without
    an ID, or with a duplicate ID, are assigned the next free one with a
    warning. Excluded cards stay in the file with `Excluded: yes` rather than
    being deleted, so fit reasoning that cites them keeps resolving.
11. **Tolerance rule.** `parseProfile` never throws on a string. Unknown
    `##` sections and unknown `- **Key:**` lines are preserved and written
    back by `serializeProfile`; unlabeled text is moved to the nearest
    free-text slot (`Notes` on the item, else Session Notes) and reported in
    `warnings`; invalid enum values fall back to the default with a warning.
    Serialization is canonical (fixed order, every known key present) so
    `parse(serialize(p))` deep-equals `p` and `serialize(parse(md))` is
    idempotent, which keeps per-turn diffs small. The fixtures under
    `src/lib/__fixtures__/` are stored in canonical form and the tests assert
    that byte-for-byte.
12. **zod is the shared schema layer.** `profile.ts` and `session.ts` export
    zod schemas alongside the inferred TS types; route handlers validate
    request bodies with them (`parseTurnRequest`) and 0.3's structured-outputs
    helper and the 1.x modules pass the same schemas to the Anthropic SDK.
    The `profile.md` text, not the parsed object, is the source of truth in
    `localStorage`; `SessionState` carries only `version`, a random
    `sessionId`, `profileMd`, and `messages` — no identity fields by design.
13. **Blocked domains are enforced in SQL, not only in TypeScript.** A CHECK
    constraint on `climate_fields.sources`, `example_roles.sources` and
    `example_job_posts.source_url` calls `private.is_blocked_source_host()`,
    so no code path — seed script, psql, a future admin tool — can store a
    linkedin.com / indeed.com / climatebase.org URL (or a subdomain) as a
    source. The host-matching logic is one SQL function so it is testable,
    and it is mirrored by `isBlockedSourceHost()` in
    `src/lib/reference-schema.ts` so the seed fails with a readable message
    before it reaches the database. Look-alikes (`notlinkedin.com`) are not
    blocked. The same three domains are the `blocked_domains` list the web
    tools get in `llm.ts`; the three lists must stay in step.
14. **`pnpm seed` mirrors the repo.** `scripts/seed.ts` upserts every entry in
    `data/*.yaml` by id and deletes any row whose id is no longer listed, so
    the tables always equal the files and `git diff data/` is the full
    changelog of what production contains. Validation of all three files
    happens first: one bad URL, dangling `field_id` or duplicate id aborts the
    run with a non-zero exit and nothing written.
15. **`src/lib/database.types.ts` is generated and committed.**
    `supabase gen types typescript --local` (wrapped as `pnpm db:types`) is the
    source of the `Database` type; regenerate and commit it in the same commit
    as any migration. Hand-writing it would let the types drift from the
    schema silently.
16. **The RLS shape has an executable test.** `pnpm db:check-rls` runs against
    a live stack and asserts, with the anon key, that the three reference
    tables are readable and not writable, that `llm_usage` is insertable and
    not readable, and that the blocked-domain CHECK rejects a LinkedIn source
    even for the service role. It insists on Postgres `42501` rather than "any
    error", because a write merely filtered by a policy returns a silent
    success affecting zero rows; the table grants revoked in the RLS migration
    are what make the refusal unconditional. Run it after every migration.
17. **Supabase local development only.** `supabase/config.toml` is committed
    and the CLI stack runs in Docker (`pnpm db:start`). No `supabase link` to a
    remote project from a development machine; the production project is set
    up in Phase 3.3 and seeded from the same `data/*.yaml`.
18. **`@anthropic-ai/sdk` 0.125.0, non-beta endpoints only.** Structured
    outputs use `client.messages.create()` with
    `output_config.format = zodOutputFormat(schema)` from
    `@anthropic-ai/sdk/helpers/zod` (which targets `zod/v4`, matching the
    repo's zod 4) — and streaming uses `client.messages.stream()` +
    `finalMessage()`. No beta header is needed for structured outputs, effort,
    adaptive thinking, prompt caching or the web tools, so `llm.ts` never
    touches `client.beta.*`; that keeps the app off surfaces that can change
    shape under us. `structured()` deliberately does not use
    `client.messages.parse()`: the SDK parser throws before usage can be
    recorded when a response is truncated at `max_tokens`, and its error
    message quotes the model's text. The wrapper instead records usage, maps
    the stop reason (`LlmTruncatedError`, `LlmRefusalError`), then parses the
    final text block with the caller's zod schema; a failure is
    `LlmOutputError` carrying only issue paths and codes.
19. **Web tool type strings are `web_search_20260209` and
    `web_fetch_20260209`** (the dynamic-filtering variants; `claude-opus-5`
    supports them, confirmed against the `claude-api` skill's server-tool
    table on 2026-09-12). Web fetch is configured with citations on, because
    every recommendation has to cite a real source. Because those tools run
    code execution under the hood, `code_execution` is never declared
    separately. `webTools()` in `llm.ts` is the only factory, and every call
    passes its tools through `assertToolsAllowed()`, which throws unless each
    web tool blocks all three domains — the belt to §7.13's braces.
20. **Pricing lives in `PRICE_PER_MTOK` in `llm.ts`**, from the `claude-api`
    skill's model table and prompt-caching economics, checked 2026-09-12:
    `claude-opus-5` input $5/MTok, output $25/MTok, cache read 0.1× input
    ($0.50), 5-minute cache write 1.25× input ($6.25). The comment carries the
    date; re-check it whenever the skill's numbers move, because `cost_usd` in
    `llm_usage` is computed here and nowhere else.
21. **One `llm_usage` row per logical call.** A `pause_turn` continuation is
    part of the same logical call: the wrapper resumes it (up to
    `MAX_PAUSE_TURN_CONTINUATIONS = 5`, then `LlmPauseLimitError`), sums the
    token counters across every continuation, and writes a single row. Rows
    are written fire-and-forget through the anon key, and a failure is a
    `console.warn` carrying the error *code* only — telemetry must never cost
    the user their turn, and must never be a channel through which content
    leaks. Refused and truncated turns are logged before the error is thrown,
    so the cost telemetry stays complete. `UsageRow`'s key set is fixed by
    `USAGE_ROW_KEYS` and guarded both at compile time and in `llm.test.ts`, so
    adding a content field fails the build. `streamText` starts the call
    eagerly and lets it complete even if the consumer stops reading deltas
    (the API reports output tokens only in the final `message_delta`), so
    `final` always settles and the row is exact.
22. **`llm_usage`'s shape is a CHECK constraint, not a comment.** The anon key
    is public and INSERT on that table is open by design, so "counters and
    identifiers only" has to be something the database enforces rather than
    something the app promises: `session_id` must match `^[0-9a-f]{32}$` (the
    exact shape `newSessionId()` produces) and `step` must be one of the six
    `StepName` values. Neither column can then carry a name, an email, a
    resume line or any other free text, whatever calls the endpoint.
    `pnpm db:check-rls` asserts both rejections (`23514`) with the service
    role, so the constraints cannot be quietly dropped. Changing `StepName` in
    `session.ts` means changing the CHECK in the same commit.
23. **Supabase auth signs nobody up.** `enable_signup` is `false` in both
    `[auth]` and `[auth.email]` in `supabase/config.toml`, and
    `enable_anonymous_sign_ins` stays `false`. There are no accounts (§7.5):
    access is the shared passcode checked in `src/proxy.ts`, and Supabase auth
    must not be a second, open door that creates users in a project whose anon
    key ships to the browser. **The hosted project in Phase 3.3 must mirror
    this** — a Supabase project is created with signups enabled, so turning
    them off is an explicit setup step there, not something the committed
    `config.toml` does for us.
24. **`profile.ts` parses in linear time.** `profile.md` is user-controlled
    input, re-parsed on every turn in a route handler, so a parser that
    backtracks is a denial-of-service hole with a friendly face. The original
    bold-key regex took 55 seconds on `"**" + " ".repeat(800) + "x"`; the
    trailing-whitespace strips (`/\s+$/`) and the `(inferred)` tag regex were
    quadratic on a long run of spaces. They are now a hand-written scan,
    `trimEnd()`, and an unanchored-head regex respectively, and
    `profile.test.ts` parses a hostile document (5 KB of unterminated `**`,
    80 KB of trailing spaces) with an assertion that it finishes in under
    500 ms. Any new pattern in this module gets the same treatment: no nested
    quantifier that can match the same text two ways.
25. **The blocked-domain list has one TypeScript owner and a pinned SQL copy.**
    `BLOCKED_SOURCE_DOMAINS` in `reference-schema.ts` is the list; `llm.ts`
    re-exports it as `BLOCKED_DOMAINS`. The only other copy is
    `private.blocked_source_domains()` in the reference-tables migration, and
    `reference-schema.test.ts` reads the migration file, extracts the SQL
    array literal and asserts it equals `BLOCKED_SOURCE_DOMAINS`. So the SQL
    copy cannot drift without a test failing (§7.13, §7.19). Prose alone was not enough: the list is the PRD's
    no-scraping rule, and it has to fail loudly rather than silently.
26. **Session ids are `^[0-9a-f]{32}$` end to end.** `newSessionId()` mints
    them, `SessionStateSchema` and `TurnRequestSchema` accept nothing else,
    `llm.ts` throws `LlmSessionIdError` before any request if the id is
    malformed, and the `llm_usage` CHECK (§7.22) is the last line. An
    imported session file with a malformed id gets a fresh id and keeps the
    profile, so a tampered export cannot smuggle an identifier into
    telemetry.
27. **Request timeout × retries stays under `maxDuration`.**
    `REQUEST_TIMEOUT_MS = 300_000` and `MAX_RETRIES = 1`, and `llm.test.ts`
    asserts `(MAX_RETRIES + 1) × REQUEST_TIMEOUT_MS < MAX_DURATION_SECONDS ×
    1000`, so a stalled attempt plus its retry cannot outlive the Vercel
    function and lose the usage row for tokens already billed.
28. **Worker model and worker budget are set by measurement, not by taste
    (2026-09-12).** The Gate 0 session and the Phase 1 session shared one
    five-hour limit window; Phase 1 ran out with steps 1.3 and 1.4 unfinished.
    Reconstructing both transcripts: 35.9M input tokens over 391 model
    messages, ~$52 cost-weighted. The Gate 0 session was 80.6% of it and the
    Phase 1 session 18.6%. Within that, the `/code-review` fan-out — eight
    Fable workers — was 28%, long-lived coding workers ~33%, and web research
    2.5%. 93% of all input was cache reads, i.e. re-billed context, so cost
    tracks context × turns rather than tool-call count; the worst worker ran
    40 turns at a median 144K context. Whole-file `cat`s were ~480K tokens of
    that context, the same file re-dumped up to 5×. The three changes in §4 —
    gate reviews and research off Fable, a ≤20-turn / ~80K budget per worker,
    and no whole-file reads — target 1, 2 and 3 in that order. Web-search
    volume was *not* the problem and is not capped; the research fan-out moved
    to Sonnet 5 because it summarises sources rather than writing product
    prose, not to save the 2.5%.

29. **Reference-collection function vocabulary.** `example_roles.function`
    and `climate_fields.transferable_functions` take values only from a fixed
    list (software, data, product, design, marketing, communications, sales,
    business-development, customer-success, operations, project-management,
    finance, accounting, legal, policy, people, research, engineering,
    field-technician, video-media, education, supply-chain) so `discover.ts`
    can match a person's function to fields without fuzzy matching. It is a
    review rule in `data/*.yaml` and CLAUDE.md, not a CHECK constraint, so a
    new function is one edit to both.

30. **Discovery is one structured call with server web tools, and re-runs
    are stable.** `discover.ts` calls `structured({ step: "discover" })` with
    `webTools()` in the same request (the API accepts both together); a 400
    falls back to a two-call design (research via `streamText`, then shape
    via `structured`) inside the same module. Every field and role written to
    the profile carries the reference-collection id in `extra.Ref`
    (`- **Ref:** offshore-wind`), which is how a re-run updates in place
    rather than adding an `F7` duplicate, and a re-run never moves a field the
    user set to accepted/rejected/unsure back to candidate. Recommendations
    that cite no active card or carry no non-blocked source are dropped and
    counted, never silently kept. Measured cost: ~$0.50 and ~3 minutes per
    profile at `high` effort, roughly half of it the cached catalogue block.

    **An identity key is one thing.** Whatever key an apply-back path dedupes
    on must be the key it matches existing rows on, or two drafts survive
    validation and then collapse onto one profile row (Gate 1 finding).
    `identityKeys()` in `discover.ts` is the single owner of that key for
    fields and roles — ref first, then lowercased name, matching
    `findExistingField` / `findExistingRole`; `cardKey()` in `cards.ts` is the
    equivalent for card ids and is case-insensitive, so a model answering `c3`
    revises `C3` rather than both duplicating and excluding it. Refs are
    stored trimmed and compared trimmed on both sides. A draft that
    normalization *rejects* is a malformed answer, never a decision to
    exclude the card it addressed.
