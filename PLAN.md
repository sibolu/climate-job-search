# Plan — Climate Career Exploration Tool

The roadmap for the alpha: what is built, what is next, what is parked.
[PRD.md](PRD.md) says why; [docs/technical-plan.md](docs/technical-plan.md)
says how (architecture, the numbered decisions, what each gate verified).
Claude Code sessions execute phases by the rules in [AGENTS.md](AGENTS.md).

Status legend: `[TODO]` `[IN PROGRESS]` `[DONE]` `[SKIPPED: reason]`

## Goal

An alpha that 5–8 Climatebase fellows can try on a hosted URL. **Alpha done**
means: a fellow pastes a resume, expands at least three fields and reaches a
query list, runs two queries on a job board, reports fit, and sees the
queries change, all in one sitting. Cost per session is logged anonymously.

**In:** paste resume → editable experience cards; preference questions one at
a time; a ranked field board with fit reasoning, evidence and sources; expand
a field for roles, employers and an uncertainty; per-field queries for
LinkedIn, Indeed and Climatebase from the roles ticked, with copy buttons and
alert steps; a feedback loop where rating a query as good or bad fit revises
the queries, fields and profile; everything about the user stored only in
the browser; an evaluation harness with a plain-model baseline.

**Out (per the PRD):** scraping, a job index, model training, alert
ingestion, application tracking, accounts, any server-side user data.

## Phases

### Phase 0 — Foundations `[DONE]`

| Step | What | Status |
|---|---|---|
| 0.1 | Next.js + TypeScript scaffold, lint, tests, passcode gate, repo conventions | `[DONE]` |
| 0.2 | `profile.md` contract (`profile.ts`) and the per-turn session payload (`session.ts`) | `[DONE]` |
| 0.3 | `llm.ts`: the one Claude wrapper — streaming, structured outputs, web tools with blocked domains, usage logging | `[DONE]` |
| 0.4 | Supabase: reference tables, `llm_usage`, RLS, seed script, typed reads, local stack | `[DONE]` |

Gate 0 passed 2026-09-12 (tests, code review, fixes applied).

### Phase 1 — Discovery `[DONE]`

| Step | What | Status |
|---|---|---|
| 1.1 | `cards.ts`: pasted text → experience cards with candidate skills, confirm/correct flow | `[DONE]` |
| 1.2 | `elicit.ts`: progressive preference questions, one per turn, with answer pills | `[DONE]` |
| 1.3 | Reference collection: 30 climate fields, 89 role profiles, 65 example posts in `data/*.yaml` | `[DONE]` |
| 1.4 | `discover.ts`: profile + reference data + web search → ranked fields and roles with cited fit reasoning | `[DONE]` |

Gate 1 passed 2026-09-12; four profile-corruption bugs found in review and
fixed with tests. **Still outstanding for the user:** a trial run of
`pnpm try:cards` and `pnpm try:discover` on your own resume.

### Phase 2 — Exploration, queries, the feedback loop, and the UI `[DONE]`

| Step | What | Status |
|---|---|---|
| 2.1 | Workspace shell: chat with streaming and pills, Profile tab, browser persistence | `[DONE]` |
| 2.2 | `explore.ts`: field drill-down with reference-first evidence and LinkedIn guidance links | `[DONE]` |
| 2.3 | `queries.ts`: per-board queries, alert steps, and revision from good/bad-fit feedback | `[DONE]` |
| 2.4 | Fields and Queries tabs with accept/reject/unsure, copy, and "Tried it" feedback | `[DONE]` |
| 2.5 | Integration: one `POST /api/turn` endpoint, end-to-end run of the full loop | `[DONE]` |

Gate 2 passed 2026-09-12: full loop ran locally (about 7 minutes and $1.00
per session), security review found nothing at high or medium. **Still
outstanding for the user:** a browser run with two real job-board searches,
and a Vercel preview deploy (needs a linked project).

Post-phase changes so far: location and work mode became board filters
rather than chat questions (D36); the chat stays readable during slow turns.

### Phase 2b — Exploration-first UI `[TODO]`

Rebuild the UI on the Claude Design handoff in
`docs/design_handoff_climate_career_exploration/` (D37–D43). The field board
is the spine, the rail is the assistant, there is no free-text composer.

| Step | What | Owner | Done when | Status |
|---|---|---|---|---|
| 2b.1 | `profile.ts`: new known keys (`Sector`, `Fit level`, `Summary`, `Chips`, `Evidence`, `Ask` on fields; `Selected` on roles; `Years` on cards), helpers (`setRoleSelected`, `setQueryText`, `addOtherPreference`), fixtures regenerated | Fable | Round-trip tests pass with every new key; fixture diff reviewed by hand | `[TODO]` |
| 2b.2 | `discover.ts` and `cards.ts`: fit level, sector, summary, chips, evidence lines and an ask per field; years per card; first-run notes read into preferences | Fable | `pnpm try:discover` prints every field with a fit level, sector, one evidence line per cited card and an ask | `[TODO]` |
| 2b.3 | `queries.ts`, `session.ts`, `turn.ts`: per-field, role-driven generation via a field-id turn input; the twelve-query batch and the `GENERATE_QUERIES_TEXT` convention retired | Fable | `pnpm try:queries` on a field with two selected roles prints exactly three queries, one per board, each naming that field only | `[TODO]` |
| 2b.4 | Shell, tokens and fonts, header nav, read-only profile drawer, rail (questions with pills, asks, log, errors, "Change an answer"), First run, Highlights (Edit form, Exclude), Pending | Opus | A paste reaches Highlights, the three questions answer by pills, "Match fields" runs discovery behind the pending screen | `[TODO]` |
| 2b.5 | Field board, expanded card, Searches and Feedback screens, with accept / keep-the-old-one on the revised query | Opus | In the browser: mark, expand, tick roles, get searches, copy, give feedback, see the revision and keep or accept it | `[TODO]` |
| 2b.6 | Integration: remove the tabs and `ChatPane`, end-to-end run, CLAUDE.md conventions and `docs/data-flow.md` verified against the code | Fable | Full loop runs locally; `pnpm test`, `pnpm lint`, `pnpm build` pass | `[TODO]` |

2b.1 first. 2b.2, 2b.3 and 2b.4 in parallel (2b.4 builds against the
2b.1 fixtures). 2b.5 after 2b.3 and 2b.4; 2b.6 last. Gate 2b: the user's
browser run of the whole loop, `/code-review`, and `/security-review`
because the turn input shape changes.

Not in 2b, by decision: a composer (D42), explore and example posts (D39),
an editable profile drawer (D42), re-ranking on a per-field answer (D43),
a layout below ~900px, a dark scheme.

### Phase 3 — Evaluation and pilot readiness `[TODO]`

| Step | What | Owner | Done when | Status |
|---|---|---|---|---|
| 3.1 | `evals/`: four synthetic profiles, structural checks, a scripted feedback-loop eval, an LLM-judge rubric (grounded, sources real, non-generic, revision responsive) | Fable | `pnpm eval` prints a scored table and cost per run | `[TODO]` |
| 3.2 | Baseline arm: the same profiles given to plain Opus 5 with web search, transcripts saved side by side | Opus | Transcripts under `evals/baseline/` | `[TODO]` |
| 3.3 | Deploy: Vercel production, Supabase production seeded, env vars, passcode, per-session spend cap, feedback form link | Opus | Production URL works from a clean browser; the cap stops calls | `[TODO]` |
| 3.4 | Pilot kit: in-app intro (what it does, what stays in your browser, how to export), feedback template, known limitations | Opus | Reviewed by the user | `[TODO]` |

Phase 3 runs after Gate 2b so the pilot uses the new UI. 3.1, 3.2 and 3.3
can run in parallel; 3.4 after them. Gate 3: the user invites fellows.

## Backlog

Unordered, unsized, uncommitted. Promote an item into a phase above (and
record the design decision in the technical plan) before building it.

1. **Resume file upload** (PDF, .docx) alongside paste. Extraction must be
   in-browser or a stateless pass-through, and must land in the same
   paste → cards path.
2. **Rail composer.** Promoted candidates after the pilot starts, in
   order: (B) "ask about the open field", a read-only step grounded in that
   field's profile entry and reference row, no tools, no profile writes;
   (C) the same step over the whole profile, always present, capped per
   session. Both need a new `StepName`, the `llm_usage` CHECK migration and
   a prompt module (D42).
3. **Show session cost in the UI** (wanted first), then spend control:
   per-session budget, cheaper effort or model past a threshold, or a hard
   stop. Cost is already computed per call; it just is not returned to the
   browser yet.
4. **Ask location and work mode early for some fields?** Removed from
   elicitation in D36. Revisit once usage data or BLS employment-by-region
   evidence shows it changes which fields are realistic, not just filters.
5. **Post-edit hook that runs lint and unit tests.** Cheap, but needs a scope
   narrower than "every edit" to fit the one-verification-pass-per-step rule.
6. **"Dig deeper" on an expanded field.** Re-attach `explore.ts` as an
   optional fourth block on the card: day-to-day, titles, example posts,
   keywords (D39).
7. **Responsive layout below ~900px** (the rail as a drawer or bottom
   sheet) and a dark scheme, once the design covers them (D37).
8. **Editable profile drawer**, scoped to a section that cannot break what
   the app writes (D42).
