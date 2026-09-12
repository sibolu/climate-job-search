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
| Cost telemetry | `llm_usage` table: random per-browser session id, model, tokens, cost, step name. No content, no identity | Per-session spend cap and evidence for a later Sonnet 5 decision. See §7 |
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
| 0.2 `[TODO]` | `profile.ts` and `session.ts`: the `profile.md` schema (Preferences, Experience Cards, Skills confirmed/inferred/excluded, Fields with status, Role Shortlist, Queries with status untried/good/bad + reason, Session Notes) with parse/serialize; the per-turn payload shape | Fable | Round-trip tests on 3 fixture profiles; hand-editing a card in markdown survives reload |
| 0.3 `[TODO]` | `llm.ts`: client wrapper (streaming, structured outputs helper, web tools with blocked domains, effort per call type, anonymous usage logging, refusal handling) | Opus + `claude-api` skill | One live smoke call writes a usage row; blocked-domain config unit-tested |
| 0.4 `[TODO]` | Supabase: migrations for `climate_fields`, `example_roles`, `example_job_posts`, `llm_usage`; select-only RLS for anon on reference tables, insert-only on `llm_usage`; `scripts/seed.ts`; `reference.ts` typed reads; local dev via Supabase CLI | Opus | Seed runs from an empty YAML fixture; anon key cannot read `llm_usage` or write reference tables |

Gate 0: orchestrator runs tests, `/code-review` at medium, commits. User skims
the `profile.md` schema (the one design decision worth a human look).

### Phase 1 — Stage 1: discovery (1.1–1.3 in parallel worktrees, then 1.4)

| # | Step | Model | Acceptance |
|---|---|---|---|
| 1.1 `[TODO]` | `cards.ts`: pasted text → 3–6 experience cards with candidate skills; confirm/correct flow | Opus | Runs on 3 synthetic resumes; every card has S/A/R and ≥1 skill |
| 1.2 `[TODO]` | `elicit.ts`: progressive preference policy (what is missing, what to ask next, one question per turn, skip when inferable) and the answer-pill schema | Fable | Scripted 5-turn transcript never asks two things at once; stops once enough is known |
| 1.3 `[TODO]` | Reference collection: 3 Opus agents each cover ~10 sectors (energy/grid/storage; built environment/transport/industry; nature/food/finance/policy/software). Per sector: description, climate link, transferable functions, example roles per function, example companies, 2–3 example job posts as title + company + requirements summary + source URL + date (company career pages and boards that permit access only), source URLs. Fable consolidates and seeds | 3× Opus, 1× Fable | Seed validates; every field has ≥2 sources and ≥2 example posts; no LinkedIn/Indeed/Climatebase URLs; no personal profiles |
| 1.4 `[TODO]` | `discover.ts`: profile + reference data + web search → ranked fields and roles, each with fit reasoning citing card IDs, sector-move vs adjacent vs retraining label, uncertainties, sourced examples | Fable | On 3 synthetic profiles: every recommendation cites ≥1 card and ≥1 source; the videographer profile gets non-generic fields |

Gate 1: same as Gate 0. User tries the flow via a `tsx` script on their own resume.

### Phase 2 — Stages 2 and 3, the feedback loop, and the UI

| # | Step | Model | Parallel | Acceptance |
|---|---|---|---|---|
| 2.1 `[TODO]` | Workspace shell: passcode screen, chat with streaming and answer pills, Profile tab (paste, cards, export/import/start over), `localStorage` persistence via `session.ts` | Opus | ∥ 2.2, 2.3 | Reload restores state; export file round-trips; "start over" clears everything |
| 2.2 `[TODO]` | `explore.ts`: field drill-down → titles, companies, example posts (reference collection first, then web), day-to-day description, LinkedIn guidance links built from keywords | Fable | ∥ | Output cites URLs; blocked domains never fetched (assert on usage log) |
| 2.3 `[TODO]` | `queries.ts`: keyword and boolean queries per board with alert steps; **revise** function that takes query feedback (good/bad + why) and returns updated queries, field status changes, and profile edits with a one-paragraph explanation | Fable | ∥ | Scripted feedback "bad fit: all roles need PE license" removes or narrows those queries and says why |
| 2.4 `[TODO]` | Fields and Queries tabs: field board with accept/reject/unsure and explore; query cards with copy, alert steps, "Tried it" feedback that posts a feedback turn and updates the Queries section of the profile | Opus | after 2.1 | Feedback on a query changes the profile text and triggers a revision turn |
| 2.5 `[TODO]` | Integration: wire 1.x and 2.x into route handlers and the page; end-to-end run on a Vercel preview deploy; fix seams | Orchestrator (Fable) | after all | Full loop on the builder's own resume, on a preview URL |

Gate 2: `/code-review` high, `/security-review` (passcode, input handling,
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

**Model policy (quality over tokens; adjust only if limits are hit):**
- **Fable** orchestrates, and owns every step where quality is the product:
  the profile schema, elicitation, discovery, exploration, query revision,
  reference-collection consolidation, evaluation, integration, and gate
  reviews.
- **Opus** does the coding: scaffold, wrappers, Supabase, UI, seed scripts,
  research fan-out, deployment, docs.
- **Escalate to Fable** when an Opus worker reports a blocker or a bug it
  could not fix in one attempt. The orchestrator re-briefs the same task to
  a Fable worker rather than retrying Opus.
- Sonnet and Haiku are not used unless the user asks to cut cost.
- Rough cost shape: Fable ~2× Opus per token. Worker reports flow back
  through the orchestrator, so short reports still matter.

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
4. Anonymous usage rows (random session id, tokens, cost, step) are written
   to Supabase for spend caps and model-choice evidence. Nothing else leaves
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
