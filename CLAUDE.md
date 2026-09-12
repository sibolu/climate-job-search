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
  (random session id, model, tokens, cost, step name — no content, no
  identity). Never log request bodies or the passcode.

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
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL (Phase 0.4) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Anon key, select-only RLS on reference tables |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only | Seeding only (`scripts/seed.ts`); bypasses RLS |

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

## Repo layout (target, PLAN.md §2)

```
src/
  lib/
    passcode.ts     # shared-passcode logic (done, 0.1)
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
  proxy.ts          # passcode gate (Next 16 name for middleware.ts)
supabase/migrations/   # reference tables, llm_usage, RLS (select-only anon)
data/                  # climate_fields.yaml, example_roles.yaml, example_job_posts.yaml
scripts/seed.ts        # data/*.yaml → Supabase
evals/                 # synthetic profiles, structural checks, feedback-loop eval, baseline arm
```

Each module is owned by the step that creates it; do not create a later
step's file early.
