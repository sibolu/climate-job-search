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

See [CLAUDE.md](CLAUDE.md) for the full command list, the environment
variables and which are server-only, the passcode gate, and the repo layout.

## Key decisions and constraints (summary; PLAN.md §2 and §7 are canonical)

- **Stack:** Next.js + TypeScript on Vercel. Supabase Postgres holds only
  the reference collection (climate fields, role profiles, example job
  posts) plus anonymous usage rows.
- **No user data server-side.** Profile, chat, and query feedback live in
  the browser's localStorage and are resent each turn. No accounts; access
  is a shared passcode.
- **No scraping** of LinkedIn, Indeed, or Climatebase. Enforced in code via
  blocked domains on the web tools.
- **No job index, no model training.** The reference collection explains
  roles; it does not power search.
- **LLM:** Claude Opus 5 via the Anthropic TypeScript SDK, with web search
  and web fetch for sourcing.
- **Users:** fellows of any technical level, desktop Chrome.

Decisions are recorded in PLAN.md §7, not in any individual's notes or
Claude memory, so every contributor can see them.
