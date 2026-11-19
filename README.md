# Climate Career Exploration Tool

A website that helps people move their existing skills into climate work.

Most people who want to work on climate do not know which fields and roles
are interesting and attainable given what they already do. Job boards index
on your current title, so searching for "climate" returns more of the job you
have. This tool works the other way round: it starts from your experience,
proposes climate fields and roles where those skills transfer, shows the
evidence for each, and then writes the job-board searches for you to run.

Built as a [Climatebase](https://climatebase.org) fellowship capstone. It is
an alpha, being piloted with a small group of fellows.

## What it does

1. **Paste your resume or a short bio.** It becomes a handful of editable
   experience cards: situation, what you did, results, skills shown. You
   correct anything it got wrong and exclude anything you do not want used.
2. **Answer a few questions**, one at a time, about your climate interests,
   seniority, and appetite for retraining. Click an answer or type.
3. **See climate fields and roles that fit.** Each one says which of your
   cards support the fit, whether it is a sector move, an adjacent role or a
   retraining move, what is uncertain, and where the evidence came from.
4. **Explore a field.** Concrete job titles, employers, example job posts,
   what the work is day to day, and guidance for browsing LinkedIn yourself.
5. **Get search queries** for LinkedIn, Indeed and Climatebase, with copy
   buttons and steps to turn each search into an email alert.
6. **Report back.** Mark a query as a good or bad fit and say why. The
   assistant revises the queries, the fields and your profile in response.

Everything it knows about you lives in one plain-text profile you can read,
edit, export and delete.

[docs/data-flow.html](docs/data-flow.html) is a one-page diagram of how a pasted
resume becomes cards, fields, roles and queries, and where each piece of
evidence comes from.

## What it will not do

- **Store anything about you on a server.** Your profile, chat and feedback
  stay in your browser and are sent to the model only for the turn you are
  on. The only server-side record is an anonymous count of tokens and cost.
- **Scrape LinkedIn, Indeed or Climatebase.** The model's web tools block
  those domains, and the database refuses to store a link to them as a
  source. Searching those boards is something you do yourself.
- **Run your job search.** No alert ingestion, no application tracking, no
  outreach. It gets you to good queries; the boards do the rest.
- **Train a model on you.** No fine-tuning, no trained transition models.
  The bet is that a frontier model plus a small, curated reference collection
  of climate fields, role profiles and example job posts is enough.

## How it works, briefly

Next.js and TypeScript on Vercel. Claude Opus 5 through the Anthropic SDK,
with web search and fetch for sourcing. Supabase Postgres holds only the
reference collection, which is edited as YAML in this repo and mirrored into
the database, so every row in production is reviewable in a pull request.
Access is by a shared passcode; there are no accounts.

## Run it locally

Node 24 and pnpm 12 (pinned in `package.json`). Docker for the local
Supabase stack. An Anthropic API key for model calls.

```bash
pnpm install
cp .env.example .env.local   # set APP_PASSCODE, PASSCODE_COOKIE_SECRET, ANTHROPIC_API_KEY
pnpm db:start                # local Supabase; copy its URL and keys into .env.local
pnpm db:reset && pnpm seed   # apply migrations, load data/*.yaml
pnpm dev                     # http://localhost:3000, then enter the passcode
```

Checks: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`. The
full command list, environment variables and repo conventions are in
[CLAUDE.md](CLAUDE.md).

## Documents

- [PRD.md](PRD.md): the problem, the hypothesis, hard constraints, how
  success is judged.
- [PLAN.md](PLAN.md): phases, status, and the backlog.
- [docs/technical-plan.md](docs/technical-plan.md): architecture, the
  numbered design decisions, and what each review gate verified.
- [docs/data-flow.html](docs/data-flow.html): the data-flow diagrams (one box per API call).
- [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md): conventions and
  working rules for Claude Code sessions in this repo.
