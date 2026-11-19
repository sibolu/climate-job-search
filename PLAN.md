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

1. **G2b.4** — second browser run on the revised UI, with the profile check
   (open "Your profile" after every step).
2. Then **G2b.2** (fresh session for the reviews) and **G2b.3** (merge PR #5).

## Goal

An alpha that 5–8 Climatebase fellows can try on a hosted URL. **Alpha done**
means: a fellow pastes a resume, sees their expertise and highlights, answers
two questions, picks roles from the climate fields offered, reaches a search
list, and runs two searches on LinkedIn, all in one sitting. Cost per session
is logged anonymously. (Decided 2026-11-18 after the first browser run: the
feedback loop — rating a search and seeing it revised — is its own later
milestone, `docs/backlog.md` §4, not part of the alpha.)

**In:** paste resume → areas of expertise and editable experience cards;
two preference questions with answer pills; climate fields as headings with
roles beneath, each role with fit reasoning and example companies; tick roles
→ one LinkedIn search per role, with open, copy and alert steps; everything
about the user stored only in the browser; an evaluation harness with a
plain-model baseline.

**Out (per the PRD):** scraping, a job index, model training, alert
ingestion, application tracking, accounts, any server-side user data.
**Out of the alpha by decision:** query feedback and revision (kept in code,
no UI path), Indeed and Climatebase searches, marking fields, seniority.

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
Steps 2b.8–2b.13 revise that after the first browser run (2026-11-17):
one column, no rail, roles rather than fields as the unit of choice, one
LinkedIn search per role, no feedback loop yet.

| Step | What | Who | Done when | Status |
|---|---|---|---|---|
| 2b.1 | `profile.ts`: new known keys (`Sector`, `Fit level`, `Summary`, `Chips`, `Evidence`, `Ask` on fields; `Selected` on roles; `Years` on cards), helpers (`setRoleSelected`, `setQueryText`, `addOtherPreference`), fixtures regenerated | Claude (Fable) | Round-trip tests pass with every new key; fixture diff reviewed by hand | `[DONE]` |
| 2b.2 | `discover.ts` and `cards.ts`: fit level, sector, summary, chips, evidence lines and an ask per field; years per card; first-run notes read into preferences | Claude (Fable) | `pnpm try:discover` prints every field with a fit level, sector, one evidence line per cited card and an ask | `[DONE]` |
| 2b.3 | `queries.ts`, `session.ts`, `turn.ts`: per-field, role-driven generation via a field-id turn input; the twelve-query batch and the `GENERATE_QUERIES_TEXT` convention retired | Claude (Fable) | `pnpm try:queries` on a field with two selected roles prints exactly three queries, one per board, each naming that field only | `[DONE]` |
| 2b.4 | Shell, tokens and fonts, header nav, read-only profile drawer, rail (questions with pills, asks, log, errors, "Change an answer"), First run, Highlights (Edit form, Exclude), Pending | Claude (Opus) | A paste reaches Highlights, the three questions answer by pills, "Match fields" runs discovery behind the pending screen | `[DONE]` |
| 2b.5 | Field board, expanded card, Searches and Feedback screens, with accept / keep-the-old-one on the revised query | Claude (Opus) | In the browser: mark, expand, tick roles, get searches, copy, give feedback, see the revision and keep or accept it | `[DONE]` |
| 2b.6 | Integration: remove the tabs and `ChatPane`, end-to-end run, CLAUDE.md conventions and `docs/data-flow.md` verified against the code | Claude (Fable) | Full loop runs locally; `pnpm test`, `pnpm lint`, `pnpm build` pass | `[DONE]` |
| 2b.7 | Discovery fix after your first gate run: Opus 5.5 at `medium`, no web tools in discovery (D44); every call streamed, 3-minute deadline, cancelled on browser disconnect (D45) | Claude | Discovery finishes on the videographer fixture (226s → 65s, $0.69 → $0.20); tests, lint, build pass | `[DONE]` |
| G2b.1 | Browser run of the whole loop on your own resume: paste → Highlights → questions → field board → expand, tick roles → searches → run two on a real board → feedback → revision | **`YOU`** | You reach a revised query with no error and report anything that felt off | `[DONE]` (2026-11-17: loop worked, LinkedIn returned accurate results; UX findings in `docs/ux-review-2026-11-17.md` and your notes → 2b.8–2b.13) |
| 2b.8 | `profile.ts`, `queries.ts`, `session.ts`, `turn.ts`, `workspace.ts`: one LinkedIn query per selected role. Queries get a `Role` key (`- **Role:** R3`, the role it was written for; `Fields` keeps the role's field). `QUERY_BOARDS` becomes `["linkedin"]`; the generate schema returns exactly one draft per selected role (keyed by role id, like the per-board schema today). The `queries` turn takes no field: the server writes for every role with `Selected: yes` across all fields, replacing each role's untried query (same supersede/retire rules). `canWriteQueriesFor` becomes `canWriteQueries(profile)`: at least one selected role. `revise` stays dispatchable but nothing in the browser sends it. Fixtures regenerated, round-trip tests, `pnpm try:queries <profile.md>` prints one LinkedIn query per selected role | Claude (Fable) | `pnpm try:queries` on a profile with three selected roles in two fields prints exactly three LinkedIn queries, each naming its role id; tests pass | `[DONE]` |
| 2b.9 | Prompts: `cards.ts` skills become areas of expertise (3–6 words, domain level: "recommendation systems", "fairness evaluation", "two-sided marketplace design", not tool names or STAR verbs); `discover.ts` role titles carry no seniority ("data scientist", never "Director of Data Science"; a post-check strips a fixed list of level words and dedupes) and the word "companies" replaces "employers" in prompt and `Role.companies` stays; `elicit.ts` drops `seniority` from `ELICIT_ORDER` (key kept on the profile, filled only when the cards infer it from the resume; nothing reads it) and rewrites the two remaining questions for pills only (no "type your own"). Prompts cite cards by id as before; the UI converts ids to titles (2b.11) | Claude (Fable) | `pnpm try:cards` on `userdata/` resume prints expertise-level skills; `pnpm try:discover` prints no title containing a level word; `elicit.test.ts` covers the two-question order | `[TODO]` |
| 2b.10 | `llm.ts`: model per step. `MODEL` becomes `MODEL_BY_STEP: Record<StepName, string>` (`queries` and `revise` on `claude-sonnet-5-5` at `medium`, every other step unchanged on `claude-opus-5-5`), `PRICE_PER_MTOK` keyed by model (Sonnet 5.5: $2 in, $10 out, cache read $0.10, cache write 1.25× in), the usage row's existing `model` column records which ran, `EFFORT_BY_STEP.queries = "medium"`. Adaptive thinking, structured outputs and the deadline are unchanged on Sonnet 5.5 (it defaults to `high` effort, so effort must stay explicit). Technical plan §1 table and D44 wording updated; new decision appended | Claude (Opus) | `llm.test.ts` asserts the model and price per step; `pnpm smoke:llm` row shows `claude-sonnet-5-5` for a `queries` call | `[DONE]` |
| 2b.11 | Shell, part 1 — one column, no rail. Remove `Rail.tsx` and `showRail`; `Header.tsx` gets "Your profile" (opens the drawer) and "Start over" (confirm dialog → clears local storage → first run) next to the nav, which reads 1 Highlights · 2 Roles · 3 Searches. Highlights: a "Your expertise" block first (the Skills section: confirmed and inferred, inferred ones with confirm / remove); cards below collapsed to title, years, one-line result, skills, with S/A/R behind "Details" and Edit / Exclude kept; then the two preference questions inline with pills (the per-field ask moves into the role group in 2b.12); then the one button, "Find climate roles" (the `GO_PILL` label), gated as today but with the note naming what is missing on this screen, not "the assistant rail". Pending shows status, elapsed and the log in the main column. Errors and parser warnings are a banner at the top of the main column; the post-turn assistant message is dropped. `ProfileDrawer.tsx` renders a readable summary (preferences, expertise, highlight titles with excluded ones struck, selected roles, searches) with Export (raw `profile.md` and the JSON) and Import behind it. Copy pass across every string per `docs/ux-review-2026-11-17.md` §3: nothing the user cannot see on screen is named ("Hold tight…", "Examine", "Matching fields · 5 of 5 in", "Add info in chat", "Sector move", "Adjacent role" all go). Every input gets an info icon whose tooltip says what the input changes (exclude a card → not matched on; remove a skill → not matched on; a question answer → used to rank roles). `screens.ts` logic and tests updated; `AppShell.tsx` owned by this step | Claude (Opus) | In the browser: paste → Highlights shows expertise, collapsed cards, two questions, one button; "Start over" returns to first run; the drawer reads as prose; `grep` finds none of the listed strings; tests, lint, build pass | `[TODO]` |
| 2b.12 | Shell, part 2 — Roles and Searches screens. `FieldBoard.tsx` + `FieldCard.tsx` → `RoleBoard.tsx` + `RoleGroup.tsx`: one centred column, one group per discovered field in rank order (name, sector, fit label, one-line summary, "draws on: <card titles>"), its uncertainty and optional ask inline; under it one row per role: checkbox, title, one-line why with card ids rendered as card titles (pure helper `citationsToTitles` in `screens.ts`), "Example companies: …", source links. No Interesting / Unsure / Not for me, no rank numbers, no per-card "Write searches" button. One sticky footer button, "Write LinkedIn searches for N roles" (disabled with a note until one role is ticked, info icon: "each ticked role becomes one LinkedIn search"). `Searches.tsx` + `QueryCard.tsx`: one card per selected role (role title, field name, the query), "Open on LinkedIn" primary, "Copy" secondary, the LinkedIn alert steps in a disclosure; no verdict buttons, no `F1` badge; a "Change roles" link back. `Feedback.tsx` deleted; `boards.ts` keeps all four boards' steps (data) but the UI reaches only LinkedIn. `screens.ts`: `View` loses `feedback`, group/order helpers for roles, tests | Claude (Opus) | In the browser: tick three roles in two fields → one turn → three LinkedIn cards, each opening LinkedIn with the query; the Roles screen shows no rating row and the row text stays inside its card; tests, lint, build pass | `[TODO]` |
| 2b.13 | Integration: full loop live on the `userdata/` resume and the videographer fixture; `docs/technical-plan.md` §2 rewritten for the one-column flow, decisions appended (one column no rail; roles not fields as the unit of choice; one LinkedIn query per role on Sonnet 5.5; feedback loop out of the UI, `revise` kept like `explore`; seniority out of questions and titles), §6 verification entry; `docs/data-flow.html` updated (queries box: one per role, LinkedIn; revise arrow marked "no UI path" like explore); CLAUDE.md "turn endpoint" and "LLM calls" paragraphs checked against the code; `docs/backlog.md` cross-checked against what 2b.8–2b.12 left out | Claude (Fable) | Loop runs locally end to end; every doc named here agrees with the code; tests, lint, build pass | `[TODO]` |
| G2b.4 | Second browser run on the revised UI with your resume: paste → expertise and cards → two questions → Roles → tick → Searches → open two on LinkedIn. **TODO (yours):** open "Your profile" after each step and check how the profile changes — what cards wrote, what the questions wrote, what discovery wrote, what the searches wrote — and note anything that looks wrong or surprising | **`YOU`** | You reach the Searches screen with no error, two LinkedIn runs return relevant results, and the profile check is written up (a few lines is enough) | `[TODO]` |
| G2b.2 | `/code-review` and `/security-review` (the turn input shape, the abort path and the model-per-step table changed) | **`YOU`** open a fresh session; Claude (Opus) reviews and fixes | Findings fixed and committed on `phase-2b` | `[TODO]` |
| G2b.3 | Merge PR #5 | **`YOU`** | `phase-2b` merged to `main` | `[TODO]` |
Order: 2b.1 first; 2b.2, 2b.3 and 2b.4 in parallel (2b.4 builds against the
2b.1 fixtures); 2b.5 after 2b.3 and 2b.4; 2b.6 last. 2b.1–2b.6 landed
2026-09-20 and the loop ran live through the try scripts (about $0.90,
docs/technical-plan.md §6). Your first browser run then found discovery
never finishing (one non-streamed call hitting the 300s request timeout);
2b.7 fixed it 2026-09-24 and was committed 2026-11-15.

Order for the 2026-11-17 revision: 2b.8, 2b.9 and 2b.10 in parallel
(disjoint files: 2b.8 owns `profile.ts`, `queries.ts`, `session.ts`,
`turn.ts`, `workspace.ts`; 2b.9 owns `cards.ts`, `discover.ts`, `elicit.ts`;
2b.10 owns `llm.ts`); 2b.11 after 2b.8 (it needs the new query shape and
the field-less `queries` input); 2b.12 after 2b.11 (both touch
`screens.ts` and `AppShell.tsx`, so they run in sequence); 2b.13 last. Each
step is one commit on `phase-2b`; PR #5 grows. Unit tests cover the pure
logic (`screens.ts`, `queries.ts` validation, `profile.ts` round trips);
prompt behaviour is checked by the try scripts and G2b.4, not by tests.

Not in 2b, by decision: a composer (D42), explore and example posts (D39),
an editable profile drawer (D42), re-ranking on a per-field answer (D43),
a layout below ~900px, a dark scheme; and after the 2026-11-17 run: query
feedback and revision in the UI, Indeed and Climatebase queries, marking
fields, the seniority question, file upload. All of these are in
`docs/backlog.md`.

Decided 2026-11-18 (your answers to the three open points): fields are
headings only on the Roles screen, with no marking; the alpha ends at the
LinkedIn runs; the seniority question is dropped, not just seniority in
titles. **Revisit later:** how the user tells us whether a field interests
them at all, now that the Interesting / Unsure / Not for me row is gone
(`docs/backlog.md` §2).

### Phase 3 — Evaluation and pilot readiness `[TODO]`

| Step | What | Who | Done when | Status |
|---|---|---|---|---|
| 3.1 | `evals/`: four synthetic profiles, structural checks, an LLM-judge rubric (grounded, sources real, non-generic, titles level-free, one search per role). The feedback-loop eval and the "revision responsive" criterion return with the feedback milestone (`docs/backlog.md` §4). The result decides whether discovery needs a larger catalogue or bounded search (D44) | Claude (Fable) | `pnpm eval` prints a scored table and cost per run | `[TODO]` |
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

The backlog lives in [docs/backlog.md](docs/backlog.md): unordered, unsized,
uncommitted. Promote an item into a phase above (and record the design
decision in the technical plan) before building it.
