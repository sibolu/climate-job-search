# Claude Code conventions for this repo

@AGENTS.md

- **Read PLAN.md first.** It is the roadmap, the decisions log (§7), and the
  operating agreement for autonomous phase execution (§5). Update step
  statuses there as work completes.
- **Record decisions in the repo, not in memory.** New architectural
  decisions or constraints go into PLAN.md §7 (and README.md if they affect
  contributors) in the same commit as the change. Do not rely on Claude's
  private memory for anything another contributor would need.
- **Model policy** (PLAN.md §4): Fable orchestrates and owns quality-critical
  steps; Opus does the coding; escalate a blocked Opus task to Fable.
- **Prompts** live as plain template strings in `src/lib/*.ts`, one module
  each, so they can be edited without touching React.
- **Reporting** follows the user's global CLAUDE.md: action line first, 1–3
  sentence summary, gotchas under `FYI (no action needed):`.

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
- **No user data stored server-side.** Route handlers are stateless. Profile,
  chat, and query feedback live in the browser's `localStorage` and are resent
  each turn. The only server-side write is the anonymous `llm_usage` row
  (random session id, model, tokens, cost, duration, step name — no content,
  no identity). Never log request bodies or the passcode.

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
| `pnpm db:check-rls` | Assert the RLS shape against a live stack; non-zero on any violation |
| `pnpm smoke:llm` | One live Claude call + read back its `llm_usage` row; skips without an API key |

`pnpm test`, `pnpm lint`, and `pnpm build` must all pass before a step is
committed. `next typegen` runs first in `typecheck` because Next generates the
`LayoutProps` / `PageProps` globals into `.next/types`.

Unit tests cover parsers and pure logic only (PLAN.md §2). Prompt behaviour is
covered by the evals in `evals/` (Phase 3), not by unit tests. Test files are
`src/**/*.test.ts`; `vitest.config.ts` excludes `.next/` so build output is
never collected.

## Environment variables

Copy `.env.example` to `.env.local`. `.env*` is gitignored except
`.env.example`. Anything without the `NEXT_PUBLIC_` prefix is **server-only**
and must never be imported into a client component.

| Variable | Scope | Purpose |
|---|---|---|
| `APP_PASSCODE` | server-only | The shared passcode given to invited fellows |
| `PASSCODE_COOKIE_SECRET` | server-only | HMAC key that signs the session cookie |
| `ANTHROPIC_API_KEY` | server-only | Claude API calls from route handlers (Phase 0.3) |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL (local stack: `supabase status -o env`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Anon key: select-only on reference tables, insert-only on `llm_usage` |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only | Scripts only (`pnpm seed`, `pnpm db:check-rls`, `pnpm smoke:llm`); bypasses RLS |

## Supabase: the reference collection and `llm_usage`

Local development runs the whole stack in Docker through the Supabase CLI —
nothing here is ever pointed at a remote project.

```bash
pnpm db:start        # first run pulls images; takes a few minutes
pnpm db:reset        # recreate the db and apply supabase/migrations/
pnpm seed            # data/*.yaml -> the three reference tables
pnpm db:check-rls    # prove anon can read reference data and nothing else
```

`pnpm db:start` prints the local URL and keys (`supabase status -o env` prints
them again): copy `API_URL`, `ANON_KEY` and `SERVICE_ROLE_KEY` into
`.env.local` as `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
and `SUPABASE_SERVICE_ROLE_KEY`. They are fixed local-only dev keys, so they
are not secrets, but `.env.local` stays gitignored anyway.

**The only server-side write is the anonymous `llm_usage` row.** The reference
tables are written only by `scripts/seed.ts` from `data/*.yaml`. No other code
path writes anything to Supabase, ever. Concretely:

- `src/lib/supabase.ts` exports exactly two clients. `anonClient()` is the only
  one app code may use; `serviceClient()` bypasses RLS, throws in the browser,
  and belongs to the three scripts that need it: `seed.ts`, `check-rls.ts` and
  `smoke-llm.ts` (which reads its own usage row back — anon cannot). Both
  clients read `NEXT_PUBLIC_SUPABASE_URL`, so a script and the app can never be
  pointed at different databases.
- `src/lib/reference.ts` is read-only and throws `ReferenceReadError` rather
  than swallowing a Supabase error into an empty list.
- `llm_usage` has no content columns and none may be added — no prompts, no
  completions, no resume or chat text, no identifiers. CHECK constraints keep
  it that way: `session_id` must be exactly the 32 hex chars `newSessionId()`
  produces and `step` must be one of the six `StepName` values, so neither
  column can carry free text (PLAN.md §7.22).

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

`example_roles` holds **role profiles, never personal profiles**: what someone
in the role does day to day, with no real individual described, named or
linked (PLAN.md §7.6). No schema can check that — it is a review rule.

## LLM calls (`src/lib/llm.ts`)

**Every model call in this app goes through `src/lib/llm.ts`.** No other module
constructs an Anthropic client, builds a web tool, or writes an `llm_usage`
row, and **any new fetch path must go through this module too** (PLAN.md §6) —
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

- **`createLlm({ client, usageSink, now })`** is the injectable form used by
  tests; `llm()` is the memoized default for route handlers. Both are
  server-only and throw in the browser — `ANTHROPIC_API_KEY` is server-only.
- **Model and thinking**: `claude-opus-5` with adaptive thinking on every call
  (PLAN.md §7.2). `budget_tokens` is rejected by this model; depth is
  `output_config.effort`.
- **Effort per step** (`EFFORT_BY_STEP`, PLAN.md §2): chat-like steps `cards`
  and `elicit` are `medium`; `discover`, `explore`, `queries` and `revise` are
  `high`. Change the table, not the call sites.
- **Structured outputs** use `client.messages.create()` with
  `output_config.format = zodOutputFormat(schema)` — pass the same zod schemas
  the rest of the app uses (PLAN.md §7.12). The wrapper records usage and
  checks the stop reason first, then parses the final text block with the
  schema; a parse failure is `LlmOutputError` carrying issue paths only,
  never model text (PLAN.md §7.18).
- **Web tools**: `webTools()` is the only factory, and every call runs its
  tools through `assertToolsAllowed()`, which throws `LlmToolPolicyError` on
  any web tool that does not block all of `BLOCKED_DOMAINS`
  (linkedin.com, indeed.com, climatebase.org). The list lives in two places —
  `BLOCKED_SOURCE_DOMAINS` in `reference-schema.ts` (re-exported here as
  `BLOCKED_DOMAINS`) and `private.blocked_source_domains()` in the
  reference-tables migration — and `reference-schema.test.ts` reads the
  migration and asserts the SQL array matches (PLAN.md §7.13, §7.25).
- **Stop reasons**: `refusal` → `LlmRefusalError` (category only, never the
  text), `max_tokens` → `LlmTruncatedError`, `pause_turn` → resumed
  automatically up to `MAX_PAUSE_TURN_CONTINUATIONS`, then
  `LlmPauseLimitError`. SDK errors (`Anthropic.RateLimitError`, …) pass
  through untouched — catch the typed classes, never match on message text.
- **Route handlers** that call this module set
  `export const maxDuration = MAX_DURATION_SECONDS` (800s, PLAN.md §6).
- **Never log content.** The module logs no prompt or completion text
  anywhere, error messages included; a failed usage insert is a
  `console.warn` with the error *code* only. Keep it that way.
- **Usage rows** are one per logical call (a `pause_turn` continuation is part
  of the same call and its tokens are summed), priced from `PRICE_PER_MTOK`,
  written fire-and-forget through the anon key. `UsageRow` has a fixed key
  list (`USAGE_ROW_KEYS`) guarded at compile time and in the tests: it holds
  counters only, and no content field may ever be added.

```bash
pnpm smoke:llm   # one live structured call, then reads its llm_usage row back
```

Without `ANTHROPIC_API_KEY` the smoke script prints a skip message and exits 0.
With a key it needs the local Supabase stack running and
`SUPABASE_SERVICE_ROLE_KEY` set, because the read-back uses the service role —
the anon key deliberately cannot read `llm_usage`.

## Passcode gate

One shared passcode, no accounts (PLAN.md §2 "Access", §7 decision 5).

- **`src/proxy.ts`** is the gate. Next.js 16 renamed the `middleware` file
  convention to `proxy`, so the file is `src/proxy.ts` and it exports `proxy`,
  not `middleware`. PLAN.md §2's layout still says `middleware.ts`; `proxy.ts`
  is the current spelling of the same thing.
- Every path is gated except `/enter`, `/api/enter`, `_next/static`,
  `_next/image`, `favicon.ico`, and static asset extensions. `/api/*` is gated
  too — those are stateless LLM calls the pilot pays for. Unauthenticated
  `/api/*` requests get a `401` JSON body rather than a redirect, because a
  redirect would be re-POSTed to an HTML page and swallowed by `fetch()`;
  everything else is redirected to `/enter`.
- **`src/lib/passcode.ts`** holds the pure logic: `isValidPasscode` (constant
  time), `signSession` / `verifySession` (HMAC-SHA-256 via the Web Crypto API,
  so the code is portable to the Edge runtime). No Node-only imports — nothing
  the gate touches may import `node:*`.
- The session token is `v1.<expiryUnixSeconds>.<hmac>`. It encodes **no user
  data**, only a format version and an expiry. Bump `SESSION_VERSION` to
  invalidate every live session.
- **`src/app/api/enter/route.ts`** checks the passcode and sets an `HttpOnly`,
  `SameSite=Lax`, `Secure`-in-production cookie valid 30 days, then redirects
  to `/`. A wrong passcode returns `401` and sets no cookie. The submitted
  passcode is never logged.

## `profile.md` is the contract (PLAN.md §7 decisions 9–12)

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

## Repo layout (target, PLAN.md §2)

```
src/
  lib/
    passcode.ts     # shared-passcode logic (done, 0.1)
    profile.ts      # profile.md schema, parse/serialize  (the contract; done, 0.2)
    session.ts      # browser session state + per-turn payload (done, 0.2)
    __fixtures__/   # canonical profile.md fixtures used by the round-trip tests
    llm.ts          # client wrapper, model config, usage logging, web tools (done, 0.3)
    supabase.ts     # anonClient() / serviceClient()  (done, 0.4)
    database.types.ts  # GENERATED by `pnpm db:types`; do not hand-edit (0.4)
    reference-schema.ts # data/*.yaml shapes + blocked-source rules (done, 0.4)
    reference.ts    # typed reads from the Supabase reference tables (done, 0.4)
    cards.ts        # pasted text → experience cards
    elicit.ts       # preference elicitation policy and answer pills
    discover.ts     # fields/roles discovery
    explore.ts      # field drill-down, example posts, LinkedIn guidance
    queries.ts      # query generation and revision from feedback
  app/
    api/            # streaming route handlers, one per lib module
    (app)/          # the single-page workspace
  proxy.ts          # passcode gate (Next 16 name for middleware.ts)
supabase/
  config.toml          # local stack config (supabase init)
  migrations/          # reference tables, llm_usage, blocked-source CHECK, RLS
data/                  # climate_fields.yaml, example_roles.yaml, example_job_posts.yaml
scripts/
  seed.ts              # data/*.yaml → Supabase (mirror; service role)
  check-rls.ts         # asserts the RLS shape against a live stack
  smoke-llm.ts         # one live Claude call; proves the usage row lands (0.3)
evals/                 # synthetic profiles, structural checks, feedback-loop eval, baseline arm
```

Each module is owned by the step that creates it; do not create a later
step's file early.
