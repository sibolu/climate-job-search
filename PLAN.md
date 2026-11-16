# Plan — Climate Career Exploration Tool

The roadmap for the alpha: what is built, what is next, what is parked.
[PRD.md](PRD.md) says why; [docs/technical-plan.md](docs/technical-plan.md)
says how (architecture, the numbered decisions, what each gate verified).
Claude Code sessions execute phases by the rules in [AGENTS.md](AGENTS.md).

Status legend: `[TODO]` `[IN PROGRESS]` `[DONE]` `[SKIPPED: reason]`

**Who** column: `Claude` is done by Claude Code sessions (the model in
brackets is the worker tier from AGENTS.md); **`YOU`** means the step needs
your hands or your decision and nothing moves until you act. Gates are rows
in each phase's table. Every phase also starts with your kickoff prompt
(AGENTS.md); that is not listed per phase.

## Waiting on you

Keep this list in step with the **`YOU`** rows below.

1. **G2b.1** — browser run of the whole loop on the fixed discovery.
2. Then **G2b.2** (fresh session for the reviews) and **G2b.3** (merge PR #5).

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

| Step | What | Who | Status |
|---|---|---|---|
| 0.1 | Next.js + TypeScript scaffold, lint, tests, passcode gate, repo conventions | Claude | `[DONE]` |
| 0.2 | `profile.md` contract (`profile.ts`) and the per-turn session payload (`session.ts`) | Claude | `[DONE]` |
| 0.3 | `llm.ts`: the one Claude wrapper — streaming, structured outputs, web tools with blocked domains, usage logging | Claude | `[DONE]` |
| 0.4 | Supabase: reference tables, `llm_usage`, RLS, seed script, typed reads, local stack | Claude | `[DONE]` |
| G0 | Gate: tests, `/code-review`, fixes applied (2026-09-12) | Claude | `[DONE]` |

### Phase 1 — Discovery `[DONE]`

| Step | What | Who | Status |
|---|---|---|---|
| 1.1 | `cards.ts`: pasted text → experience cards with candidate skills, confirm/correct flow | Claude | `[DONE]` |
| 1.2 | `elicit.ts`: progressive preference questions, one per turn, with answer pills | Claude | `[DONE]` |
| 1.3 | Reference collection: 30 climate fields, 89 role profiles, 65 example posts in `data/*.yaml` | Claude | `[DONE]` |
| 1.4 | `discover.ts`: profile + reference data + web search → ranked fields and roles with cited fit reasoning (web search removed by D44) | Claude | `[DONE]` |
| G1 | Gate: `/code-review`; four profile-corruption bugs found and fixed with tests (2026-09-12) | Claude | `[DONE]` |
| G1.u | Trial run of `pnpm try:cards` and `pnpm try:discover` on your own resume | **`YOU`** | `[SKIPPED: covered by G2b.1, which runs both on your resume in the browser]` |

### Phase 2a — Exploration, queries, the feedback loop, and the first UI `[DONE]`

Steps 2a.1–2a.5 are called 2.1–2.5 ("Phase 2", branch `phase-2`) in
commits, code comments and the technical plan; the `a` was added once
Phase 2b existed.

| Step | What | Who | Status |
|---|---|---|---|
| 2a.1 | Workspace shell: chat with streaming and pills, Profile tab, browser persistence | Claude | `[DONE]` |
| 2a.2 | `explore.ts`: field drill-down with reference-first evidence and LinkedIn guidance links | Claude | `[DONE]` |
| 2a.3 | `queries.ts`: per-board queries, alert steps, and revision from good/bad-fit feedback | Claude | `[DONE]` |
| 2a.4 | Fields and Queries tabs with accept/reject/unsure, copy, and "Tried it" feedback | Claude | `[DONE]` |
| 2a.5 | Integration: one `POST /api/turn` endpoint, end-to-end run of the full loop | Claude | `[DONE]` |
| G2a | Gate: full loop ran locally (about 7 minutes and $1.00 per session); `/security-review` found nothing at high or medium (2026-09-12) | Claude | `[DONE]` |
| G2a.u1 | Browser run with two real job-board searches | **`YOU`** | `[SKIPPED: folded into G2b.1; the 2a UI it would test is gone]` |
| G2a.u2 | Vercel preview deploy (needs a linked project) | **`YOU`** | `[SKIPPED: folded into 3.3]` |

Post-phase changes: location and work mode became board filters rather
than chat questions (D36); the chat stays readable during slow turns.

### Phase 2b — Exploration-first UI `[IN PROGRESS]`

Rebuild the UI on the Claude Design handoff in
`docs/design_handoff_climate_career_exploration/` (D37–D43). The field board
is the spine, the rail is the assistant, there is no free-text composer.

| Step | What | Who | Done when | Status |
|---|---|---|---|---|
| 2b.1 | `profile.ts`: new known keys (`Sector`, `Fit level`, `Summary`, `Chips`, `Evidence`, `Ask` on fields; `Selected` on roles; `Years` on cards), helpers (`setRoleSelected`, `setQueryText`, `addOtherPreference`), fixtures regenerated | Claude (Fable) | Round-trip tests pass with every new key; fixture diff reviewed by hand | `[DONE]` |
| 2b.2 | `discover.ts` and `cards.ts`: fit level, sector, summary, chips, evidence lines and an ask per field; years per card; first-run notes read into preferences | Claude (Fable) | `pnpm try:discover` prints every field with a fit level, sector, one evidence line per cited card and an ask | `[DONE]` |
| 2b.3 | `queries.ts`, `session.ts`, `turn.ts`: per-field, role-driven generation via a field-id turn input; the twelve-query batch and the `GENERATE_QUERIES_TEXT` convention retired | Claude (Fable) | `pnpm try:queries` on a field with two selected roles prints exactly three queries, one per board, each naming that field only | `[DONE]` |
| 2b.4 | Shell, tokens and fonts, header nav, read-only profile drawer, rail (questions with pills, asks, log, errors, "Change an answer"), First run, Highlights (Edit form, Exclude), Pending | Claude (Opus) | A paste reaches Highlights, the three questions answer by pills, "Match fields" runs discovery behind the pending screen | `[DONE]` |
| 2b.5 | Field board, expanded card, Searches and Feedback screens, with accept / keep-the-old-one on the revised query | Claude (Opus) | In the browser: mark, expand, tick roles, get searches, copy, give feedback, see the revision and keep or accept it | `[DONE]` |
| 2b.6 | Integration: remove the tabs and `ChatPane`, end-to-end run, CLAUDE.md conventions and `docs/data-flow.md` verified against the code | Claude (Fable) | Full loop runs locally; `pnpm test`, `pnpm lint`, `pnpm build` pass | `[DONE]` |
| 2b.7 | Discovery fix after your first gate run: Opus 5.5 at `medium`, no web tools in discovery (D44); every call streamed, 3-minute deadline, cancelled on browser disconnect (D45) | Claude | Discovery finishes on the videographer fixture (226s → 65s, $0.69 → $0.20); tests, lint, build pass | `[DONE]` |
| G2b.1 | Browser run of the whole loop on your own resume: paste → Highlights → questions → field board → expand, tick roles → searches → run two on a real board → feedback → revision | **`YOU`** | You reach a revised query with no error and report anything that felt off | `[TODO]` |
| G2b.2 | `/code-review` and `/security-review` (the turn input shape and the abort path changed) | **`YOU`** open a fresh session; Claude (Opus) reviews and fixes | Findings fixed and committed on `phase-2b` | `[TODO]` |
| G2b.3 | Merge PR #5 | **`YOU`** | `phase-2b` merged to `main` | `[TODO]` |

Order: 2b.1 first; 2b.2, 2b.3 and 2b.4 in parallel (2b.4 builds against the
2b.1 fixtures); 2b.5 after 2b.3 and 2b.4; 2b.6 last. 2b.1–2b.6 landed
2026-09-20 and the loop ran live through the try scripts (about $0.90,
docs/technical-plan.md §6). Your first browser run then found discovery
never finishing (one non-streamed call hitting the 300s request timeout);
2b.7 fixed it 2026-09-24 and was committed 2026-11-15.

Not in 2b, by decision: a composer (D42), explore and example posts (D39),
an editable profile drawer (D42), re-ranking on a per-field answer (D43),
a layout below ~900px, a dark scheme.

### Phase 3 — Evaluation and pilot readiness `[TODO]`

| Step | What | Who | Done when | Status |
|---|---|---|---|---|
| 3.1 | `evals/`: four synthetic profiles, structural checks, a scripted feedback-loop eval, an LLM-judge rubric (grounded, sources real, non-generic, revision responsive). The result decides whether discovery needs a larger catalogue or bounded search (D44) | Claude (Fable) | `pnpm eval` prints a scored table and cost per run | `[TODO]` |
| 3.2 | Baseline arm: the same profiles given to plain Opus 5.5 (the app's model) with web search, transcripts saved side by side | Claude (Opus) | Transcripts under `evals/baseline/` | `[TODO]` |
| 3.3 | Deploy: Vercel production, Supabase production seeded, env vars, passcode, per-session spend cap, feedback form link | **`YOU`** create and link the Vercel and Supabase projects, set the secrets and choose the passcode; Claude (Opus) does the rest | Production URL works from a clean browser; the cap stops calls | `[TODO]` |
| 3.4 | Pilot kit: in-app intro (what it does, what stays in your browser, how to export), feedback template, known limitations | Claude (Opus) drafts; **`YOU`** review | You approve the intro, template and limitations | `[TODO]` |
| G3.1 | `/code-review` and `/security-review` (3.3 touches auth and Supabase) | **`YOU`** open a fresh session; Claude (Opus) reviews and fixes | Findings fixed and committed | `[TODO]` |
| G3.2 | Invite the fellows | **`YOU`** | Invitations sent with the URL and passcode | `[TODO]` |

Phase 3 runs after Gate 2b so the pilot uses the new UI. 3.1, 3.2 and 3.3
can run in parallel; 3.4 after them. 3.1 can use a multi-agent workflow
only if you opt in ("use a workflow for step 3.1"); otherwise it runs as
ordinary workers.

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
