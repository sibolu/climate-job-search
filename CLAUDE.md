# Claude Code conventions for this repo

@AGENTS.md

How work is run (phases, orchestration, model policy, context budget,
reporting) is in AGENTS.md above. This file is the code: commands,
environment, the hard constraints, and the rules each module enforces.

- **Read PLAN.md first** for what is done and what is next; update step
  statuses there as work completes.
- **Decisions are numbered `D<n>` in `docs/technical-plan.md` §5.** Code
  comments cite them as `technical-plan.md D31`. Append a new decision there
  in the same commit as the change; never renumber. Do not rely on Claude's
  private memory for anything another contributor would need.
- **Read `docs/design-language.md` before changing anything in
  `src/components/shell/` or any user-facing string.** It holds the copy and
  layout principles with the examples that produced them; add a principle in
  the same commit as the decision that produced it.
- **Keep `docs/data-flow.html` current.** Two flows (paste → fields and
  roles, ticked roles → LinkedIn searches): one box per Anthropic API call with links to its
  prompt, and which `profile.md` sections each call or click reads and
  writes. Update it when an API call, a profile-writing click, a data store
  or a source of ground truth is added or removed, or a prompt moves.
- **Prompts** live as plain template strings in `src/lib/*.ts`, one module
  each, so they can be edited without touching React.
- **Never read a whole file** (`profile.ts` is 49KB, `docs/technical-plan.md`
  37KB): `grep -n -C5`, `sed -n 'A,Bp'`, or a ranged `Read`. The full budget
  rules are in AGENTS.md.

## Hard constraints (PRD.md — these bind every change)

- **No scraping LinkedIn, Indeed, or Climatebase.** No login automation or
  bypassing access restrictions. For other sites, any automated collection
  must comply with their terms and access rules. Enforced in code via
  `blocked_domains` on the web tools in `src/lib/llm.ts` (Phase 0.3); every
  new fetch path goes through that module.
- **No self-built live job index or broad job corpus.** The small, bounded
  reference collection in Supabase is the only exception; it explains roles,
  it does not power search.
- **No custom model training.** No fine-tuning, no trained transition models.
- **User control over the profile.** Users can correct inferred skills and
  exclude experiences. One person's information is never used as an example
  for another without consent.
- **No user data stored server-side.** Route handlers are stateless. The
  profile (the pasted resume and notes included, kept under `## Inputs`),
  chat, and query feedback live in the browser's `localStorage` and are resent
  each turn. There are two server-side writes: the anonymous `llm_usage` row
  (random session id, model, tokens, cost, duration, step name — no content,
  no identity), and one running dollar total per access code
  (`access_codes.spent_usd`). Neither holds content or identity. An
  access-code row is a derived key, a cap, a total, a disabled flag and a
  creation time (docs/technical-plan.md D67). Never log request bodies, the
  passcode, an access code or its key.

## Commands

Node 24, pnpm 12 (pinned via `packageManager` in `package.json`).

| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm dev` | Dev server on http://localhost:3000 |
| `pnpm build` | Production build (`next build`) |
| `pnpm start` | Serve the production build |
| `pnpm test` | Unit tests (`vitest run`) |
| `pnpm lint` | ESLint flat config (`eslint`) — Next 16 removed `next lint` |
| `pnpm typecheck` | `next typegen && tsc --noEmit` |
| `pnpm db:start` | Local Supabase stack via the CLI (Docker must be running) |
| `pnpm db:stop` | Stop the local stack |
| `pnpm db:reset` | Recreate the local database and apply `supabase/migrations/` |
| `pnpm db:types` | Regenerate `src/lib/database.types.ts` from the local schema |
| `pnpm seed` | `data/*.yaml` → Supabase reference tables (mirror, service role) |
| `pnpm db:check-rls` | Assert the RLS shape against a live stack (reference tables, `llm_usage`, and `access_codes` closed to the browser with only its two budget functions callable); non-zero on any violation |
| `pnpm smoke:llm` | One live Claude call + read back its `llm_usage` row, and fail unless the `ACCESS_CODE` code's total rose; skips without an API key |
| `pnpm codes:add --cap <usd> [--count <n>]` | Issue access codes (service role, D67). Prints each new code once, beside the first 8 characters of its key; stores only the key. `--cap` is required: no default cap exists in code (the pilot uses `--cap 5`) |
| `pnpm codes:list` | Every code's key prefix, cap, running total, disabled flag and creation time |
| `pnpm codes:set <key-prefix> [--cap <usd>] [--disable\|--enable]` | Change one code's cap or switch it off/on, found by key prefix. Each `codes:*` command prints the database host it is talking to first |
| `pnpm try:*` (all four below) | Each needs `ACCESS_CODE` and the local Supabase stack, which holds the code's budget: every call is charged to that code (D71). Each exits non-zero with a plain sentence when `ACCESS_CODE` is missing or malformed, and never prints the code, its key, cap or total |
| `pnpm try:cards <resume.txt> [out.md]` | Stage 1.1 live: pasted text → experience cards; prints profile.md (the pasted text kept under `## Inputs`, D56), non-zero if a card lacks S/A/R or an area of expertise, or any expertise phrase runs over six words (D48) |
| `pnpm try:discover <profile.md> [out.md] [--catalogue] [--interest=<area>[,<area>…]]` | Stage 1.4 live, no web (D44) → ranked fields and roles. By default memory mode, as the app runs it (D61): no reference tables read (the stack is still needed for the code's budget); non-zero if any field or role lacks a card citation, carries a `Ref` or a source, has a URL in its text, or a role title carries a level word (D48). `--catalogue` runs the evaluation's catalogue arm instead, reading the local Supabase stack; non-zero if any lacks a card citation, cites a URL the catalogue does not list, has a URL in its text (D66), or carries a level word. A cited card with no evidence line is a warning. `--interest` takes a comma-separated list of the six climate areas (`CLIMATE_AREAS`) and sets the picks the way the pills do (D54) |
| `pnpm try:explore <profile.md> <fieldId> [out.md]` | Stage 2.2 live: field drill-down; non-zero if any blocked host was fetched or cited |
| `pnpm try:queries <profile.md> [out.md] [--tick R1,R4] [--revise]` | Stage 2b.8 live: one LinkedIn query per selected role across all fields (technical-plan.md D47); non-zero unless every selected role has one live query naming it. `--tick` ticks those roles first, as the Roles screen would; `--revise` then revises from a scripted "bad fit" feedback |
| `pnpm research:check-links [path…]` | Phase 2c: every URL in `docs/research/**/*.md` (or the paths given) is requested once; non-zero if one is on a blocked domain or does not resolve; 401/403/429 are reported as refused, not failed (technical-plan.md D59) |

`pnpm test`, `pnpm lint`, and `pnpm build` must all pass before a step is
committed. `next typegen` runs first in `typecheck` because Next generates the
`LayoutProps` / `PageProps` globals into `.next/types`.

Unit tests cover parsers and pure logic only (docs/technical-plan.md §1). Prompt behaviour is
covered by the evals in `evals/` (Phase 3), not by unit tests. Test files are
`src/**/*.test.ts`; `vitest.config.ts` excludes `.next/` so build output is
never collected.

## Looking at the UI (Playwright MCP)

Agents can see the running app through the Playwright MCP server in a
throwaway browser. **Use it only when the user explicitly asks** (AGENTS.md,
"Context and turn budget"). Each contributor registers it once, local scope
(private, not committed). Run it from the repo root so `$PWD` expands to
the repo:

```bash
claude mcp add playwright --scope local -- \
  npx -y @playwright/mcp@latest --isolated --headless \
  --allowed-origins "http://localhost:3000" \
  --output-dir "$PWD/.playwright-mcp"
```

- `--isolated` is required: the profile lives in memory and is discarded,
  so no cookies or sign-ins persist. Without it the profile is saved under
  `~/Library/Caches/ms-playwright/`. Never drive the user's own Chrome
  (Claude in Chrome) for this app.
- `--allowed-origins` keeps the browser on the dev server. Playwright says it
  is not a security boundary; the isolation comes from `--isolated`.
- `--output-dir` keeps every artifact (screenshots, snapshots, console logs)
  in `.playwright-mcp/` in the repo, which is gitignored: local only, never
  scattered outside the repo. Pass screenshot `filename`s as bare names so
  they land there too; delete the folder whenever you like.
- Use the local `ACCESS_CODE` in `.env.local` (a code from
  `pnpm codes:add --cap 5` on the local stack, D71): the agent types it into
  the gate's "Access code" field and it lands in the transcript, so it must
  never be a production code. There is no operator passcode.
- Flow: `pnpm db:start` → `pnpm dev` → `/enter` → the local access code
  (metered against its $5 cap) → screen. Prefer
  `browser_snapshot` (text) for structure and repeated labels;
  take a screenshot only to judge layout. Close the browser and stop
  `pnpm dev` afterwards. Any turn the browser triggers is a live, billed
  Claude call.
- `/ux-review [resume]` (`.claude/skills/ux-review/`) runs the full visual
  review: a test profile built from a gitignored resume in `userdata/`,
  one screenshot per screen, and a dated `docs/ux-review-<date>.md`. It
  only runs when a user types it.

## Environment variables

Copy `.env.example` to `.env.local`. `.env*` is gitignored except
`.env.example`. Anything without the `NEXT_PUBLIC_` prefix is **server-only**
and must never be imported into a client component.

| Variable | Scope | Purpose |
|---|---|---|
| `PASSCODE_COOKIE_SECRET` | server-only | HMAC key that signs the session cookie |
| `ANTHROPIC_API_KEY` | server-only | Claude API calls from route handlers (Phase 0.3) |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL (local stack: `supabase status -o env`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Publishable key: select-only on reference tables, insert-only on `llm_usage`, execute-only on the two access-code budget functions |
| `SUPABASE_SECRET_KEY` | server-only | Scripts only (`pnpm seed`, `pnpm db:check-rls`, `pnpm smoke:llm`, `pnpm codes:*`); bypasses RLS |
| `ACCESS_CODE` | server-only | Scripts only: the access code the `try:*` scripts and `smoke:llm` charge their calls to, read through `scripts/script-access-code.ts` (D71). Locally, one code from `pnpm codes:add --cap 5`, the same one you type at `/enter`. Never printed. There is no operator passcode: neither `OPERATOR_PASSCODE` nor `APP_PASSCODE` is read |

## Supabase: the reference collection, `llm_usage` and `access_codes`

At run time the app writes `llm_usage` and calls the two access-code budget
functions (read a code's budget, add a call's cost to it; docs/technical-plan.md
D67); it reads no table directly: since docs/technical-plan.md D61 discovery
works from the model's knowledge alone.
The three reference tables, `pnpm seed` and `pnpm db:check-rls` stay, for the
evaluation's catalogue arm (`pnpm try:discover --catalogue`); Phase 2c's
researched data still lands in `data/*.yaml`. Hosted setup is in
`docs/deploy.md`.

Local development runs the whole stack in Docker through the Supabase CLI —
nothing here is ever pointed at a remote project.

```bash
pnpm db:start        # first run pulls images; takes a few minutes
pnpm db:reset        # recreate the db and apply supabase/migrations/
pnpm seed            # data/*.yaml -> the three reference tables
pnpm db:check-rls    # prove anon can read reference data, insert usage rows and call the budget functions, and nothing else
```

`pnpm db:start` prints the local URL and keys (`supabase status -o env` prints
them again): copy `API_URL`, `PUBLISHABLE_KEY` and `SECRET_KEY` into
`.env.local` as `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
and `SUPABASE_SECRET_KEY`. They are fixed local-only dev keys, so they
are not secrets, but `.env.local` stays gitignored anyway.

**There are two server-side writes: the anonymous `llm_usage` row, and one
running dollar total per access code (`access_codes.spent_usd`). Neither holds
content or identity. An access-code row is a derived key, a cap, a total, a
disabled flag and a creation time.** The reference tables are written only by
`scripts/seed.ts` from `data/*.yaml`, and access codes are issued and changed
only by `scripts/access-codes.ts`. No other code path writes anything to
Supabase, ever. Concretely:

- `src/lib/supabase.ts` exports exactly two clients. `anonClient()` is the only
  one app code may use; `serviceClient()` bypasses RLS, throws in the browser,
  and belongs to the four scripts that need it: `seed.ts`, `check-rls.ts`,
  `smoke-llm.ts` (which reads its own usage row back — anon cannot) and
  `access-codes.ts` (the only writer of codes). Both
  clients read `NEXT_PUBLIC_SUPABASE_URL`, so a script and the app can never be
  pointed at different databases.
- `src/lib/reference.ts` is read-only and throws `ReferenceReadError` rather
  than swallowing a Supabase error into an empty list.
- `llm_usage` has no content columns and none may be added — no prompts, no
  completions, no resume or chat text, no identifiers. CHECK constraints keep
  it that way: `session_id` must be exactly the 32 hex chars `newSessionId()`
  produces and `step` must be one of the six `StepName` values, so neither
  column can carry free text (docs/technical-plan.md D22).
- `access_codes` (migration `20261126090000_access_codes.sql`,
  docs/technical-plan.md D67) has `code_key` (exactly 32 hex chars, CHECK),
  `cap_usd`, `spent_usd`, `disabled` and `created_at`. No label, name or any
  free-text column, and no content or identity column may be added; who holds
  which code is known only to the operator. RLS is on with no policies and no
  grants to anon or authenticated. The app reaches it only through two
  `SECURITY DEFINER` functions the publishable key may execute:
  `access_code_budget(key)` (cap, total, disabled; no row for an unknown key)
  and `access_code_add_spend(key, usd)` (adds a finite non-negative amount,
  raises otherwise, no-op for an unknown key). `pnpm db:check-rls` asserts
  that shape in its own group.
- `src/lib/budget.ts` (server-side: it imports `supabase.ts`) wraps them:
  `BudgetLedger` (`read(codeKey)` → `BudgetState | null`,
  `addSpend(codeKey, usd)`), `supabaseBudgetLedger()` over `anonClient().rpc`,
  `memoryBudgetLedger()` for tests, `budgetVerdict` (`allowed` | `exhausted` |
  `inactive`), and `BudgetLedgerError`, which carries the error code only.

### Changing the schema

1. Add a new timestamped file under `supabase/migrations/` — never edit an
   applied one.
2. `pnpm db:reset && pnpm db:types` and commit the regenerated
   `src/lib/database.types.ts`.
3. `pnpm db:check-rls` — new tables need their RLS shape asserted there too.

### Changing the reference data

`data/*.yaml` is the source of truth; `pnpm seed` mirrors it (upsert by id,
delete anything no longer listed), so `git diff data/` is the full changelog
of what production contains. Each file's header comment documents its schema.
`src/lib/reference-schema.ts` validates all three together before a single row
is written, and a failure aborts the whole run with nothing written.

Blocked domains — linkedin.com, indeed.com, climatebase.org and their
subdomains — are rejected in **two** places on purpose: by the zod schemas at
seed time, and by a CHECK constraint calling
`private.is_blocked_source_host()` in SQL. Adding one means editing both
copies (`llm.ts` re-exports `BLOCKED_SOURCE_DOMAINS` as `BLOCKED_DOMAINS`, so
there is one TypeScript owner); `reference-schema.test.ts` asserts the SQL
array equals `BLOCKED_SOURCE_DOMAINS`, so a half-done edit fails a test. Look-alike hosts such as
`notlinkedin.com` are deliberately unaffected.

`function` on roles and `transferable_functions` on fields use a fixed
vocabulary so discovery can match a person's function to a field (docs/technical-plan.md
D29): software, data, product, design, marketing, communications, sales,
business-development, customer-success, operations, project-management,
finance, accounting, legal, policy, people, research, engineering,
field-technician, video-media, education, supply-chain.

`example_roles` holds **role profiles, never personal profiles**: what someone
in the role does day to day, with no real individual described, named or
linked (docs/technical-plan.md D6). No schema can check that — it is a review rule.

## LLM calls (`src/lib/llm.ts`)

**Every model call in this app goes through `src/lib/llm.ts`.** No other module
constructs an Anthropic client, builds a web tool, or writes an `llm_usage`
row, and **any new fetch path must go through this module too** (docs/technical-plan.md §4) —
that is what makes the PRD's no-scraping rule enforceable in code rather than
in prose.

```ts
import { createLlm, llm, webTools } from "@/lib/llm";

const { textDeltas, final } = llm().streamText({
  step: "explore",              // picks the effort level and labels the usage row
  sessionId,                    // random, anonymous; from session.ts
  system: EXPLORE_SYSTEM,       // keep byte-stable: it is sent as a cached block
  messages,
  tools: webTools(),            // the only way to build a web tool
});
for await (const delta of textDeltas) { /* pipe to the client */ }
const { text, usage, costUsd } = await final;   // settles once the call ends, whether or not deltas are read

const { value } = await llm().structured({ step: "cards", sessionId, system, messages, schema });
```

- **`createLlm({ client, usageSink, now, callTimeoutMs, budget, budgetReadTimeoutMs })`**
  is the injectable form used by tests (`budget` defaults to
  `supabaseBudgetLedger()`, `budgetReadTimeoutMs` to `BUDGET_READ_TIMEOUT_MS`,
  5s); `llm()` is the memoized default for route handlers. Both are
  server-only and throw in the browser — `ANTHROPIC_API_KEY` is server-only.
- **Per-code budget** (docs/technical-plan.md D69, D71): every call must
  carry `codeKey` (set by `withCallContext`, never by a step module); a call
  without one throws `LlmBudgetError` `inactive` before any request. A call
  reads its budget once per logical call, after the
  session-id and tool checks and before any request, and throws
  `LlmBudgetError` with `reason` `exhausted`, `inactive` (missing, disabled, unknown or
  malformed key) or `unavailable` (the read failed or hung): it fails closed,
  and nothing is billed. Where the usage row is recorded, the call adds
  its `costUsd` through the ledger — an aborted call too (D45) — tracked in
  the same pending set as the usage row; a failed charge is a `console.warn`
  with the error code and undercounts. No call is unmetered: the `try:*`
  scripts and `smoke:llm` charge `ACCESS_CODE`. The check is before a call
  and the charge after it, so a code can overshoot its cap by the calls in
  flight when it crosses it, and the turn in which it crosses can be refused
  between its calls (a `cards` turn makes two) with that turn's output lost;
  keep an organisation-level spend limit in the Claude Console as the
  backstop. `llm_usage` is untouched: no column added, no row linked to a
  code (D22).
- **Model per step** (`MODEL_BY_STEP`, docs/technical-plan.md D2, D44, D52,
  D62): `discover` runs on `claude-fable-5-2` (D62); the other five steps
  (`cards`, `elicit`, `explore`, `queries`, `revise`) run on
  `claude-opus-5-5` (D52). `ModelId` and `PRICE_PER_MTOK` carry all three
  ids, `claude-sonnet-5-5` included, so a later switch is a one-line table
  change. Adaptive thinking on every call (`budget_tokens` and disabled
  thinking are rejected by Opus 5.5 and Fable 5.2). `PRICE_PER_MTOK` is keyed by model id and `costUsd` prices each
  call by the model that ran; an unpriced id throws `LlmConfigError`. The
  usage row's `model` column records which model ran.
- **Effort per step** (`EFFORT_BY_STEP`, docs/technical-plan.md D44, D52,
  D62): `explore` is `high`; every other step is `medium`. Effort is always
  sent explicitly: defaults differ by model (Sonnet 5.5 and Fable 5.2
  `high`, Opus 5.5 `medium`), so no default is relied on. Change the tables, not the call sites.
- **Every call streams** (`client.messages.stream()` + `finalMessage()`), both
  shapes, with a 32K output cap. **One deadline bounds a logical call**:
  `CALL_TIMEOUT_MS` (3 min, every retry and continuation included) aborts it
  with `LlmTimeoutError`. A request's `signal` aborts it with
  `LlmCancelledError`; `runTurn` wraps every step's `Llm` with
  `withCallContext` (the signal and the code key), and the turn route fires it when the browser disconnects. An aborted call
  still writes its usage row with the input it was billed (docs/technical-plan.md D45).
- **Discovery has no web tools** (docs/technical-plan.md D44) **and, in the
  app, no catalogue** (D61): `turn.ts` calls `discoverFields` without
  `DiscoverOptions.catalogue`, so it runs `DISCOVER_SYSTEM_PROMPT_MEMORY` on
  the cards, skills and preferences alone. The memory schema has no `ref` and
  no `sources`, and example companies are plain text. The catalogue path
  (`DISCOVER_SYSTEM_PROMPT_CATALOGUE`, sources restricted to URLs the
  catalogue lists) is an evaluation arm reached only by
  `pnpm try:discover --catalogue`. In both modes the validator strips any
  URL from field and role text, with or without a scheme (D66).
- **Structured outputs** send
  `output_config.format = zodOutputFormat(schema)` — pass the same zod schemas
  the rest of the app uses (docs/technical-plan.md D12). The wrapper records usage and
  checks the stop reason first, then parses the final text block with the
  schema; a parse failure is `LlmOutputError` carrying issue paths only,
  never model text (docs/technical-plan.md D18).
- **Web tools**: `webTools()` is the only factory, and every call runs its
  tools through `assertToolsAllowed()`, which throws `LlmToolPolicyError` on
  any web tool that does not block all of `BLOCKED_DOMAINS`
  (linkedin.com, indeed.com, climatebase.org). The list lives in two places —
  `BLOCKED_SOURCE_DOMAINS` in `reference-schema.ts` (re-exported here as
  `BLOCKED_DOMAINS`) and `private.blocked_source_domains()` in the
  reference-tables migration — and `reference-schema.test.ts` reads the
  migration and asserts the SQL array matches (docs/technical-plan.md D13, D25).
- **Stop reasons**: `refusal` → `LlmRefusalError` (category only, never the
  text), `max_tokens` → `LlmTruncatedError`, `pause_turn` → resumed
  automatically up to `MAX_PAUSE_TURN_CONTINUATIONS`, then
  `LlmPauseLimitError`. A refused budget is `LlmBudgetError` (step and
  reason only, never the key, cap or total). SDK errors (`Anthropic.RateLimitError`, …) pass
  through untouched — catch the typed classes, never match on message text.
- **Route handlers** that call this module set
  `export const maxDuration = MAX_DURATION_SECONDS` (800s, docs/technical-plan.md §4).
- **Never log content.** The module logs no prompt or completion text
  anywhere, error messages included; a failed usage insert is a
  `console.warn` with the error *code* only, and so is a failed access-code
  charge; no code or key is ever logged. Keep it that way.
- **Usage rows** are one per logical call (a `pause_turn` continuation is part
  of the same call and its tokens are summed), priced from `PRICE_PER_MTOK`,
  written through the publishable key without blocking the call; each write is
  tracked until it settles, and `/api/turn` awaits
  `usageWritesSettled(abort.signal)` (bounded by `USAGE_FLUSH_TIMEOUT_MS`,
  5s) inside `after()` so the function is not suspended before the last row
  and the last access-code charge land (both are in one pending set); the
  signal scopes the wait to that turn's own writes
  (docs/technical-plan.md D64, D65, D69).
  `UsageRow` has a fixed key
  list (`USAGE_ROW_KEYS`) guarded at compile time and in the tests: it holds
  counters only, and no content field may ever be added.

```bash
pnpm smoke:llm   # one live structured call, then reads its llm_usage row back
```

Without `ANTHROPIC_API_KEY` the smoke script prints a skip message and exits 0.
With a key it needs the local Supabase stack running, `ACCESS_CODE` (the call
is charged to it, and the script fails unless the code's total rose) and
`SUPABASE_SECRET_KEY` set, because the read-back uses the service role —
the publishable key deliberately cannot read `llm_usage`.

## The turn endpoint (`src/lib/turn.ts`, `src/app/api/turn/route.ts`)

One `POST /api/turn` for every step (docs/technical-plan.md D31). The browser sends a
`TurnRequest` and chooses the `step` in `src/lib/workspace.ts`; `turn.ts`
dispatches and returns the assistant message, pills, and the **whole**
canonical `profile.md`. The reply is NDJSON via `turn-stream.ts`: progress
`delta`s, a heartbeat every 15s, then one `final` or one `error`. No step the
browser sends reads Supabase: discovery runs memory-only (technical-plan.md
D61). `explore`, which only scripts send (D39), is still dispatched and still
reads the reference tables, so `turnErrorMessage` keeps its
`ReferenceReadError` sentence. The only writes are the `llm_usage` row and,
for a call made under an access code, that code's running total (D69).

- The route reads the session from the cookie with `readSession` and answers
  `401` without one, then passes `{ signal, codeKey }` as the `CallContext` to
  `runTurn(request, deps, onProgress, context)`. **The code key reaches
  `llm.ts` only from the signed cookie; `TurnRequest` carries no key.** Every
  session has a key (D71), so every call is metered.

- The browser names what it wants through `TurnInput`: `message` (the
  pasted text on Start, and "Find climate roles"; the interest pills are
  local edits and send no turn, D54), `selectedRoles` (write one LinkedIn search per selected role; no
  payload, the server reads `Selected: yes` from the profile it is sent,
  technical-plan.md D47) and `feedback` (revise; still dispatched, but
  nothing in the browser sends it). The one remaining text convention, `exploreChatText`
  in `workspace.ts`, serves the `explore` step that only scripts reach (D39);
  the "Find climate roles" pill is `FIND_ROLES_PILL` in `screens.ts`, which
  `turn.ts` re-exports as `GO_PILL`. Change text there, never inline.
- User-facing error text comes only from `turnErrorMessage`; the route logs
  the error class and step, never the message or the body. It has one
  sentence per `LlmBudgetError` reason, each saying that what the person has
  is still in their browser.
- `maxDuration` in a route file must be a numeric literal and the file may
  export nothing but segment config and handlers (Next 16 build check);
  `route.test.ts` pins the literal to `MAX_DURATION_SECONDS`.
- Client components import only browser-safe modules: `profile.ts`,
  `session.ts`, `workspace.ts`, `turn-stream.ts`, `boards.ts`, `elicit.ts`
  (its `llm` import is type-only), `screens.ts`, `profile-summary.ts` and
  `access-code.ts` (Web Crypto only, no imports). `cards.ts` and `budget.ts`
  are server-only.
- The UI is `src/components/shell/` (technical-plan.md §2, D37, D42, D43,
  D47–D51, D53–D57): one centred column under a four-item nav (Resume,
  Highlights, Roles, Searches), no rail, no tabs, no composer, and no
  feedback screen; the only "Start over" is on the Resume page, behind
  `StartOverDialog.tsx`. `save-file.ts` in that folder is the component-side
  download helper (profile and session JSON). Pure screen logic (which
  screen, nav gating, the Start text and Resume page view, the one interest
  question's label, note and pills, the "Find climate roles" gate, log
  lines, role groups, card ids rendered as titles, the write-searches label,
  search cards) is in `src/lib/screens.ts`, and the drawer's readable summary
  in `src/lib/profile-summary.ts`, both with unit tests; components hold no
  policy.

## Access gate: access codes

One access code per person, each with its own spend cap, the operator's
included; no operator passcode and no accounts (docs/technical-plan.md §1
"Access", D5, D68, D71).

- **`src/proxy.ts`** is the gate. Next.js 16 renamed the `middleware` file
  convention to `proxy`, so the file is `src/proxy.ts` and it exports `proxy`,
  not `middleware`. It checks the cookie with `readSession`.
- Every path is gated except `/enter`, `/api/enter`, `_next/static`,
  `_next/image`, `favicon.ico`, and static asset extensions. `/api/*` is gated
  too — those are stateless LLM calls the pilot pays for. Unauthenticated
  `/api/*` requests get a `401` JSON body ("Access code required.") rather
  than a redirect, because a redirect would be re-POSTed to an HTML page and
  swallowed by `fetch()`; everything else is redirected to `/enter`.
- **`src/lib/access-code.ts`** (Web Crypto only, browser- and Edge-safe):
  `generateAccessCode()` (16 random characters, 80 bits, shown
  `XXXX-XXXX-XXXX-XXXX`), `normalizeAccessCode()` (trim, upper-case, drop
  dashes and spaces), `isAccessCodeShape()`, `accessCodeKey()` (SHA-256,
  first 32 hex; no server secret, D68) and `isAccessCodeKey()`. Only the key
  is ever stored; the code itself is printed once by `pnpm codes:add`.
- **`src/lib/passcode.ts`** holds the session logic:
  `signSession(secret, { codeKey })` (`codeKey: string`, required; it throws
  without a valid key) and `readSession`, which returns a `Session`
  (`{ codeKey: string }`) or `null` (HMAC-SHA-256 via the Web Crypto
  API, so the code is portable to the Edge runtime). No Node-only imports —
  nothing the gate touches may import `node:*`.
- The session token is `v2.<expiryUnixSeconds>.<scope>.<hmac>`, where scope
  is the code's key and nothing else (a pre-D71 `operator` scope is refused). It encodes **no user
  data**: a derived key, not the code. Bump `SESSION_VERSION` to invalidate
  every live session; v1 cookies are refused, so the v2 deploy signs
  everyone out once.
- **`src/app/api/enter/route.ts`** reads the field `code`; it reads no
  passcode variable (neither `OPERATOR_PASSCODE` nor `APP_PASSCODE`, D71). The text
  is normalised, refused if not code-shaped, its key derived and
  `supabaseBudgetLedger().read` asked. A known, not-disabled code enters,
  **including one that has reached its cap**: the profile is in the browser
  and must stay readable and exportable, and it is the next model call that
  is refused. Unknown, disabled and malformed codes all get the same `401`;
  an unreadable ledger is a `503` with a plain sentence. Entering sets an
  `HttpOnly`, `SameSite=Lax`, `Secure`-in-production cookie valid 30 days,
  then redirects to `/`; a refusal sets no cookie. Nothing typed — the code
  or its key — is ever logged.

## `profile.md` is the contract (docs/technical-plan.md D9–D12)

- The format is defined once, in the header comment of `src/lib/profile.ts`,
  with a complete example. Change the format only there, in the same commit
  as the fixtures under `src/lib/__fixtures__/` and the round-trip tests.
- Every module reads and writes the profile through `parseProfile` /
  `serializeProfile` and the pure helpers (`upsertCard`, `setFieldStatus`,
  `setQueryStatus`, …). Never string-edit the markdown elsewhere.
- IDs (`C1`, `F1`, `R1`, `Q1`) are stable: never renumber; use `nextCardId`
  etc. for new items. Exclude cards, do not delete them.
- `parseProfile` never throws; surface its `warnings` to the user rather than
  discarding them. Unknown sections and keys must survive a round trip.
- Fixtures are stored in canonical form (`serializeProfile(parseProfile(md))
  === md`). After changing the serializer, regenerate them and review the
  diff by hand.
- `session.ts` owns what the browser stores and sends: the profile text is
  the source of truth, `sessionId` is random and anonymous, and no field may
  carry identity. Route handlers validate bodies with `parseTurnRequest`.
- The profile has eight sections; the eighth, `## Inputs` (D56), holds the
  pasted resume and notes as typed. It is written only through `setInputs`,
  which the browser calls via `recordStartInputs` in `workspace.ts` on Start,
  before the cards turn is sent. No prompt reads it:
  `serializeProfileForPrompt` leaves the section out, and the cards step
  reads its text from the turn's message.

## Repo layout

The module map, with the step that owns each file, is `docs/technical-plan.md`
§3. Each module is owned by the step that created it; do not create a later
step's file early.
