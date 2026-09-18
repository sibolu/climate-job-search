# Climate Career Exploration Tool

A website that helps people move their existing skills into climate work.
Paste a resume, answer a few questions, get climate fields and roles with
evidence for the fit, then job-board queries you run yourself. Report what
you found and the assistant revises. Built as a Climatebase fellowship
capstone.

- [PRD.md](PRD.md): problem, hypothesis, scope, hard constraints, evaluation.
- [PLAN.md](PLAN.md): architecture, phased roadmap, decisions log (§7), and
  how Claude Code sessions execute phases autonomously.
- [CLAUDE.md](CLAUDE.md): conventions for Claude Code sessions in this repo.

## Development

Next.js (App Router) + TypeScript, Node 24, pnpm 12.

```bash
pnpm install
cp .env.example .env.local   # set APP_PASSCODE and PASSCODE_COOKIE_SECRET
pnpm dev                     # http://localhost:3000
```

The app is behind a shared passcode: the first request redirects to `/enter`.

```bash
pnpm test        # vitest
pnpm lint        # eslint
pnpm typecheck   # next typegen && tsc --noEmit
pnpm build       # production build
```

The reference collection lives in Supabase and is run locally through the
Supabase CLI (Docker must be running):

```bash
pnpm db:start      # local stack; copy its URL and keys into .env.local
pnpm db:reset      # apply supabase/migrations/
pnpm seed          # data/*.yaml -> the reference tables (mirror, not append)
pnpm db:check-rls  # assert anon can read reference data and nothing else
```

Every model call goes through `src/lib/llm.ts` — one wrapper that owns the
model, effort per step, the web tools and their blocked domains, refusal
handling, and the anonymous usage row. `pnpm smoke:llm` makes one live call and
reads its `llm_usage` row back; without `ANTHROPIC_API_KEY` it skips and exits
0. That read-back needs `SUPABASE_SERVICE_ROLE_KEY`, so the service-role key
belongs to three scripts — `seed.ts`, `check-rls.ts` and `smoke-llm.ts` — and
to no app code.

See [CLAUDE.md](CLAUDE.md) for the full command list, the environment
variables and which are server-only, the passcode gate, the Supabase
workflow, and the repo layout.

## How the pipeline works

[docs/data-flow.md](docs/data-flow.md) is a one-diagram, high-level map of
how a pasted resume becomes cards, climate fields, roles and search queries,
and where data is stored and grounded.

## Key decisions and constraints (summary; PLAN.md §2 and §7 are canonical)

- **Stack:** Next.js + TypeScript on Vercel. Supabase Postgres holds only
  the reference collection (climate fields, role profiles, example job
  posts) plus anonymous usage rows. The reference collection is edited as
  `data/*.yaml` in this repo and mirrored into Supabase by `pnpm seed`, so
  every row in production is reviewable in a pull request.
- **No user data server-side.** Profile, chat, and query feedback live in
  the browser's localStorage and are resent each turn. No accounts; access
  is a shared passcode.
- **No scraping** of LinkedIn, Indeed, or Climatebase. Enforced in code via
  blocked domains on the web tools, and again by a CHECK constraint that
  refuses to store a URL from those hosts as a source.
- **No job index, no model training.** The reference collection explains
  roles; it does not power search.
- **LLM:** Claude Opus 5 via the Anthropic TypeScript SDK, with web search
  and web fetch for sourcing — all of it behind `src/lib/llm.ts`, which is
  also where the blocked-domain rule is enforced.
- **One endpoint:** the browser POSTs its whole session (profile.md, recent
  chat, the new input) to `/api/turn` and gets NDJSON back: progress lines,
  then the assistant message plus the full replacement profile.md. The
  browser decides which step runs (`src/lib/workspace.ts`); the server
  dispatches in `src/lib/turn.ts` and stores nothing.
- **Users:** fellows of any technical level, desktop Chrome.

Decisions are recorded in PLAN.md §7, not in any individual's notes or
Claude memory, so every contributor can see them.
