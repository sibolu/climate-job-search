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

- **2c.2:** set up dataset access in a separate session (O*NET first;
  then BLS, ILOSTAT and the OECD data API; ESCO is a proposed addition for
  the EU side, strike it if you disagree). Then kick off 2c.3 in a fresh
  session
  (`Execute Phase 2c per PLAN.md. Commit each step on branch phase-2c. Stop
  at the gate.`); it stops at G2c.2.
- **2c.6 (before it runs, not urgent):** decide how the Climatebase job
  list reaches the repo. The PRD forbids scraping Climatebase, so no worker
  may fetch it; the step is written for a list you supply.

## Goal

An alpha that 5–8 Climatebase fellows can try on a hosted URL. **Alpha done**
means: a fellow pastes a resume, sees their skills and highlights, picks the
climate areas that interest them, picks roles from the climate fields
offered, reaches a search list, and runs two searches on LinkedIn, all in one
sitting. Cost per session is logged anonymously. (Decided 2026-11-18 after
the first browser run: the feedback loop — rating a search and seeing it
revised — is its own later milestone, `docs/backlog.md` §4, not part of the
alpha.)

**In:** paste resume → skills (accepted unless removed) and editable
experience cards; one optional interest question with multi-select pills;
climate fields as headings with roles beneath, each role with fit reasoning
and example companies; tick roles → one LinkedIn search per role, with open
and copy; everything about the user, the pasted resume included, stored
only in the browser, in the profile; an evaluation harness with a
plain-model baseline.

**Out (per the PRD):** scraping, a job index, model training, alert
ingestion, application tracking, accounts, any server-side user data.
**Out of the alpha by decision:** query feedback and revision (kept in code,
no UI path), Indeed and Climatebase searches, marking fields, seniority, the
retraining question, per-field follow-up questions, job-alert steps.

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

### Phase 2b — Exploration-first UI `[DONE]`

Rebuild the UI on the Claude Design handoff in
`docs/design_handoff_climate_career_exploration/` (D37–D43). The field board
is the spine, the rail is the assistant, there is no free-text composer.
Steps 2b.8–2b.13 revise that after the first browser run (2026-11-17):
one column, no rail, roles rather than fields as the unit of choice, one
LinkedIn search per role, no feedback loop yet. Steps 2b.14–2b.19 apply the
second walkthrough (2026-11-19): less on every screen, by the principles in
`docs/design-language.md`, and searches back on Opus 5.5.

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
| 2b.9 | Prompts: `cards.ts` skills become areas of expertise (3–6 words, domain level: "recommendation systems", "fairness evaluation", "two-sided marketplace design", not tool names or STAR verbs); `discover.ts` role titles carry no seniority ("data scientist", never "Director of Data Science"; a post-check strips a fixed list of level words and dedupes) and the word "companies" replaces "employers" in prompt and `Role.companies` stays; `elicit.ts` drops `seniority` from `ELICIT_ORDER` (key kept on the profile, filled only when the cards infer it from the resume; nothing reads it) and rewrites the two remaining questions for pills only (no "type your own"). Prompts cite cards by id as before; the UI converts ids to titles (2b.11) | Claude (Fable) | `pnpm try:cards` on `userdata/` resume prints expertise-level skills; `pnpm try:discover` prints no title containing a level word; `elicit.test.ts` covers the two-question order | `[DONE]` |
| 2b.10 | `llm.ts`: model per step. `MODEL` becomes `MODEL_BY_STEP: Record<StepName, string>` (`queries` and `revise` on `claude-sonnet-5-5` at `medium`, every other step unchanged on `claude-opus-5-5`), `PRICE_PER_MTOK` keyed by model (Sonnet 5.5: $2 in, $10 out, cache read $0.10, cache write 1.25× in), the usage row's existing `model` column records which ran, `EFFORT_BY_STEP.queries = "medium"`. Adaptive thinking, structured outputs and the deadline are unchanged on Sonnet 5.5 (it defaults to `high` effort, so effort must stay explicit). Technical plan §1 table and D44 wording updated; new decision appended | Claude (Opus) | `llm.test.ts` asserts the model and price per step; `pnpm smoke:llm` row shows `claude-sonnet-5-5` for a `queries` call | `[DONE]` |
| 2b.11 | Shell, part 1 — one column, no rail. Remove `Rail.tsx` and `showRail`; `Header.tsx` gets "Your profile" (opens the drawer) and "Start over" (confirm dialog → clears local storage → first run) next to the nav, which reads 1 Highlights · 2 Roles · 3 Searches. Highlights: a "Your expertise" block first (the Skills section: confirmed and inferred, inferred ones with confirm / remove); cards below collapsed to title, years, one-line result, skills, with S/A/R behind "Details" and Edit / Exclude kept; then the two preference questions inline with pills (the per-field ask moves into the role group in 2b.12); then the one button, "Find climate roles" (the `GO_PILL` label), gated as today but with the note naming what is missing on this screen, not "the assistant rail". Pending shows status, elapsed and the log in the main column. Errors and parser warnings are a banner at the top of the main column; the post-turn assistant message is dropped. `ProfileDrawer.tsx` renders a readable summary (preferences, expertise, highlight titles with excluded ones struck, selected roles, searches) with Export (raw `profile.md` and the JSON) and Import behind it. Copy pass across every string per `docs/ux-review-2026-11-17.md` §3: nothing the user cannot see on screen is named ("Hold tight…", "Examine", "Matching fields · 5 of 5 in", "Add info in chat", "Sector move", "Adjacent role" all go). Every input gets an info icon whose tooltip says what the input changes (exclude a card → not matched on; remove a skill → not matched on; a question answer → used to rank roles). `screens.ts` logic and tests updated; `AppShell.tsx` owned by this step | Claude (Opus) | In the browser: paste → Highlights shows expertise, collapsed cards, two questions, one button; "Start over" returns to first run; the drawer reads as prose; `grep` finds none of the listed strings; tests, lint, build pass | `[DONE]` |
| 2b.12 | Shell, part 2 — Roles and Searches screens. `FieldBoard.tsx` + `FieldCard.tsx` → `RoleBoard.tsx` + `RoleGroup.tsx`: one centred column, one group per discovered field in rank order (name, sector, fit label, one-line summary, "draws on: <card titles>"), its uncertainty and optional ask inline; under it one row per role: checkbox, title, one-line why with card ids rendered as card titles (pure helper `citationsToTitles` in `screens.ts`), "Example companies: …", source links. No Interesting / Unsure / Not for me, no rank numbers, no per-card "Write searches" button. One sticky footer button, "Write LinkedIn searches for N roles" (disabled with a note until one role is ticked, info icon: "each ticked role becomes one LinkedIn search"). `Searches.tsx` + `QueryCard.tsx`: one card per selected role (role title, field name, the query), "Open on LinkedIn" primary, "Copy" secondary, the LinkedIn alert steps in a disclosure; no verdict buttons, no `F1` badge; a "Change roles" link back. `Feedback.tsx` deleted; `boards.ts` keeps all four boards' steps (data) but the UI reaches only LinkedIn. `screens.ts`: `View` loses `feedback`, group/order helpers for roles, tests | Claude (Opus) | In the browser: tick three roles in two fields → one turn → three LinkedIn cards, each opening LinkedIn with the query; the Roles screen shows no rating row and the row text stays inside its card; tests, lint, build pass | `[DONE]` |
| 2b.13 | Integration: full loop live on the `userdata/` resume and the videographer fixture; `docs/technical-plan.md` §2 rewritten for the one-column flow, decisions appended (one column no rail; roles not fields as the unit of choice; one LinkedIn query per role on Sonnet 5.5; feedback loop out of the UI, `revise` kept like `explore`; seniority out of questions and titles), §6 verification entry; `docs/data-flow.html` updated (queries box: one per role, LinkedIn; revise arrow marked "no UI path" like explore); CLAUDE.md "turn endpoint" and "LLM calls" paragraphs checked against the code; `docs/backlog.md` cross-checked against what 2b.8–2b.12 left out | Claude (Fable) | Loop runs locally end to end; every doc named here agrees with the code; tests, lint, build pass | `[DONE]` |
| G2b.4 | Second browser run on the revised UI with your resume: paste → expertise and cards → two questions → Roles → tick → Searches → open two on LinkedIn. **TODO (yours):** open "Your profile" after each step and check how the profile changes — what cards wrote, what the questions wrote, what discovery wrote, what the searches wrote — and note anything that looks wrong or surprising | **`YOU`** | You reach the Searches screen with no error, two LinkedIn runs return relevant results, and the profile check is written up (a few lines is enough) | `[DONE]` (2026-11-19: loop worked and reads much better; searches from Sonnet 5.5 were too general; change list → 2b.14–2b.19, principles in `docs/design-language.md`. The profile check was not done and moves to G2b.5) |
| 2b.14 | `llm.ts`: searches back on Opus 5.5 (D52, reverses D46). `MODEL_BY_STEP.queries` and `.revise` become `claude-opus-5-5`; `EFFORT_BY_STEP` stays `medium` for both. Keep the `ModelId` union and the Sonnet 5.5 row in `PRICE_PER_MTOK` so a later switch is a one-line table change; rewrite the two table comments. Update `llm.test.ts` (and `scripts/smoke-llm.ts` if it asserts the model). Docs in the same commit: append D52 to `docs/technical-plan.md` §5 and add "(Superseded by D52)" to D46 and to the D2 note; fix the §1 LLM table row, the CLAUDE.md "Model per step" and "Effort per step" bullets, and the model named in `docs/data-flow.html` (the intro list and the API 4 box). Also commit the already-written `docs/design-language.md` and the CLAUDE.md lines that point to it | Claude (Opus) | `llm.test.ts` asserts all six steps run on `claude-opus-5-5` at their listed effort; `grep -rn sonnet src/lib/llm.ts` shows only the type union and the price row; tests, lint, build pass | `[DONE]` |
| 2b.15 | Skills are accepted unless removed (D53). **Lib:** `profile.ts` gets a pure `activeSkills(p)`: `confirmed` then `inferred`, deduplicated case-insensitively, minus anything in `excluded`. The file format does not change (the three buckets stay, no fixture regeneration). Every prompt reads `activeSkills`, not `skills.confirmed`: `renderPreferencesForDiscover` in `discover.ts` (line label `- Skills:`), and in `queries.ts` the `# Confirmed skills` block (heading becomes `# Skills`, empty text `(none)`), the `Areas of expertise` line, and the words "confirmed skills" in `REVISE_SYSTEM_PROMPT` (becomes "skills"). Today an untouched skill reaches neither prompt, so this changes what discovery and the searches see. `cards.ts`: delete `confirmSkill` (nothing calls it after this step), add `restoreSkill` (`moveSkill(p, skill, "inferred")`), fix the header comment. `workspace.ts`: delete `confirmProfileSkill`, add `restoreProfileSkill`. `profile-summary.ts`: one skills list with no "inferred" marker, removed ones struck; rename the `expertise` section key to `skills` and its title to "Skills". **UI:** in `Highlights.tsx` the block is headed "Skills" with the one note "Inferred from your resume."; one row of tiles from `activeSkills`, each with a single × (`aria-label="Remove <skill>"`); removed skills follow as muted, struck tiles with a + (`aria-label="Add <skill> back"`) so a mis-click is not final. No ✓, no info icon; `INFO_TIPS.removeSkill` deleted; `onConfirmSkill` replaced by `onRestoreSkill` through `AppShell.tsx` and `ProfileDrawer.tsx` updated for the summary change. Append D53 | Claude (Fable) lib, then Claude (Opus) UI | Unit tests: `activeSkills` (order, dedupe, removal); the discover and queries render tests show an untouched inferred skill in the prompt text and a removed one absent; a `grep -rn` over `src` finds none of `confirmSkill`, `Your expertise`, `Keep or remove`, `Confirmed skills`; tests, lint, build pass | `[DONE]` |
| 2b.16 | One interest question, multi-select, optional; no retraining question (D54). **`elicit.ts`:** `CLIMATE_AREAS = ["Circular Economy", "Built Environment", "Transportation", "Energy", "Food & Agriculture", "Carbon Removal"]` in this order; `pillsFor("climateInterests")` returns exactly these six (label and value the same) and takes no context. Delete `NOT_SURE_PILL`, `DEFAULT_CLIMATE_AREAS`, `MAX_INTEREST_CHIPS`, `humanizeSectorGroup` and `sectorGroups` on `ElicitContext`; keep `OPEN_TO_SUGGESTIONS` and `isOpenToSuggestions`, which still normalise a value typed in the notes box. `ELICIT_ORDER = ["climateInterests"]`; `retrainingAppetite` joins the never-asked keys (still a `PreferenceKey`, still filled from the notes box, still read by discovery). New pure `toggleClimateInterest(p, value)`: adds the value when absent, removes it when present (case-insensitive), source `stated`, adding one drops `open to suggestions`, values that are not one of the six (from notes) are kept. `QUESTIONS.climateInterests` = "Which area of climate work interests you most? Pick as many as you like." `inferPreferences` stops writing climate interests: remove `climateInterests` from `InferredPreferencesSchema`, its bullet from `INFER_SYSTEM`, and the block that applies it. **`discover.ts`:** rule 5 of `DISCOVER_SYSTEM_PROMPT` is replaced with exactly: "5. Respect preferences. Location, work mode and retraining appetite are constraints when stated. Climate interests set the order, never the list: when the person names areas, rank fields in those areas first where the fit is comparable, and still include a strong fit outside them. With no interests stated, rank on fit alone. Do not use excluded cards; they are not shown to you." Rule 7 and the `summary` schema description gain one clause: the summary is shown directly under the field's name, so it says what the name does not and never repeats or paraphrases it (the Roles screen keeps the summary, 2b.18). The prompt wording in this row is the default; the Fable worker may sharpen it but not change what it asks for. **`turn.ts`, `reference.ts`:** drop the `sectorGroups` dependency and delete `listSectorGroups` if nothing else calls it. **`screens.ts`:** `QUESTION_LABELS.climateInterests` = "Which area of climate work interests you most?"; new `INTEREST_NOTE` = "Pick as many as you like. Your picks decide which roles are listed first; roles in other areas still appear."; `findRolesGate` is enabled with one active highlight whatever the answer, its enabled note is "You can come back and change any of this." (no time estimate) and its only disabled note is "Include at least one highlight above first."; `QuestionContext`, `QuestionView.answer` and `INFO_TIPS.answer` deleted. **UI:** `Highlights.tsx` shows the one question as a heading, `INTEREST_NOTE`, and six `aria-pressed` toggle pills; no info icon and no "Your answer: …" line. `AppShell.tsx` loses the `sectorGroups` state and calls `toggleClimateInterest`. **Script:** `scripts/try-discover.ts` drops `--retraining`, and `--interest` takes a comma-separated list of area names; CLAUDE.md commands row updated. Append D54 | Claude (Fable) lib and the live check, then Claude (Opus) UI | `elicit.test.ts` covers the six pills in order, toggle on / off / several at once and the one-question order; `screens.test.ts` covers the gate with and without an answer; `pnpm try:discover <profile.md> --interest="Energy,Carbon Removal"` passes its existing checks and the worker reports the field order (picked areas first, at least one field outside them still listed); a `grep -rn` over `src` finds none of `retraining you're open to`, `Not sure yet — show`, `sectorGroups`; tests, lint, build pass | `[DONE]` |
| 2b.17 | Top bar, the Resume page, "Start over" (D55) and inputs kept in the profile (D56). **Inputs (lib):** `profile.ts` gets an eighth section, `## Inputs`, between `## Queries` and `## Session Notes`, holding what the person typed, as typed: `### Resume` and `### Notes`, every line written as a `> ` quote so pasted markdown (`## Skills`, `- **Key:** value`) can never be read as profile structure; an unknown `###` block under it survives a round trip, so a later input gets a place without a format change. `Profile.inputs = { resume, notes }`, a pure `setInputs(p, { resume, notes })`, the header comment and its example updated, fixtures regenerated, round-trip tests. `workspace.ts`: `recordStartInputs(state, resume, notes)`, which the browser calls when Start is pressed, before the turn is sent, so a failed read keeps what was typed. The cards turn still takes its text from the message and returns `inputs` unchanged. **No prompt reads `inputs`:** the raw resume carries contact details, and the cards are what every later step reasons from; tests put a marker string in `inputs` and assert it is absent from the elicit, discover, explore, queries and revise prompt text. `scripts/try-cards.ts` records the inputs the way Start does. The drawer's readable summary does not repeat the resume (the Resume page shows it, the export carries it). Any decision in `docs/technical-plan.md` that says the pasted text is not kept gets "(Superseded by D56)". **`screens.ts`:** `Screen` value `firstRun` is renamed `resume`; `NAV_STEPS = ["resume", "highlights", "roles", "searches"]` with labels "Resume", "Highlights", "Roles", "Searches" (no numbers); `View` becomes the same four values. `currentScreen`: busy → `pending` when cards exist, else `resume`; no cards → `resume`; otherwise the navigated view when `navStepEnabled` allows it, defaulting to `highlights` before fields exist and `roles` after. `navStepEnabled("resume")` is always true, the other three as today. Delete `showNav` (the nav is always shown, steps not yet reached are disabled) and `START_OVER_CONFIRM`. This fixes the Highlights item, which today lands on Roles once fields exist. **`AppShell.tsx`:** `onNavigate` sets the view to the step; a successful cards turn sets the view to `highlights`, discovery to `roles`, searches to `searches`. On Highlights with fields already present the button still reads "Find climate roles" and its note reads "Running this again updates your roles." **`Header.tsx`:** remove the green `cc-mark` box (and its CSS) and the "Start over" button; "Your profile" stays. **`FirstRun.tsx` → `ResumeScreen.tsx`** (`git mv`), two states. *Nothing pasted yet* (both boxes start from `profile.inputs`, which is empty unless an earlier Start failed): headline "Your experience already fits climate work. Find out where."; lead "Explore the climate fields that could most use your skills, pick the ones that interest you, and get searches to run on job boards."; the resume box has one visible label, "Paste your resume or bio", and no placeholder; the notes box has one visible label, "What else should shape your results? Where you want to work, what you care about, anything you want to avoid.", marked "Optional", and no placeholder (the `cc-visually-hidden` class these labels use has no CSS rule, which is why label and placeholder both showed; delete the class name); beside Start, "You can change anything later."; the link under the card, "No account, nothing stored.", becomes "No account. Your resume and profile are saved only in this browser." *Resume already read (cards exist):* heading "Your resume"; the stored resume in a read-only box (`aria-label="Your resume or bio"`); the stored notes, when there are any, in a second read-only box labelled "Your notes"; a profile saved before this step has no stored resume and shows the one line "This profile was saved without its resume text." in place of the boxes; then "To use a different resume, start over." with a "Start over" button, the only one in the app. Editing the resume and reading it again is not built (`docs/backlog.md` §1). **`StartOverDialog.tsx`** (new, a native `<dialog>` opened with `showModal()`, no `window.confirm`): title "Start over?"; body "This clears your resume, highlights, answers, roles and searches from this browser. Download your profile first if you want to pick up where you left off."; buttons "Download profile" (the same JSON the drawer's Export writes, which Import reads back; move `saveFile` out of `ProfileDrawer.tsx` into a small shared module), "Start over" (the existing `onStartOver`) and "Cancel". Update the `docs/design-language.md` reference block to the lead above ("could most use"). Append D55 and D56 | Claude (Fable) lib, then Claude (Opus) UI | `profile.test.ts` round-trips a resume containing `## Skills`, `### C1: x`, `- **Key:** v`, a `> quoted` line, blank lines and CRLF, and the text comes back as typed; the prompt tests show the marker absent from all five prompts; `screens.test.ts` covers: Highlights reachable after fields exist, Resume always enabled, steps ahead disabled, each view resolved; a `grep -rn` over `src` finds none of `1 Highlights`, `cc-mark`, `window.confirm`, `not from the word`, `About a minute`, `visually-hidden`, `FirstRun`, `nothing stored`; tests, lint, build pass | `[DONE]` |
| 2b.18 | Highlights, Roles and Searches: say each thing once (D57). **Highlights:** the line under "Your highlights" becomes "Every suggested field and role is tied to at least one highlight. Skills sum up what you know across them and shape your searches."; delete `highlightsCountNote` and the exclude info icon; cards no longer show `years`, the editor loses its "Years" input (an existing value is kept on save), and `profile-summary.ts` drops years from highlight lines. `Years` stays on the card in `profile.md` and the cards prompt still fills it. The S/A/R "Details" disclosure is unchanged (`docs/backlog.md` §1). **Roles:** in `RoleGroup.tsx` the head is the field name, then one row: the fit label ("Strong overlap"), the move label, and a "Based on" disclosure button (`aria-expanded`). Expanded, it lists one line per cited highlight: its title and, where the field has an evidence line for that card, that sentence run through `citationsToTitles`. Under that row the two-sentence summary stays: it says what the work is and why the person fits, which the title does not (2b.16 tells discovery not to restate the name in it). Removed from the head: the sector line, which restates the title, and the whole follow-up question (question, textarea, "Save answer", "Change"). The "Not sure yet:" line stays. In `screens.ts`, `RoleGroupView.drawsOn: string[]` becomes `basedOn: { title: string; evidence: string }[]`; `summary` stays; `ask`, `askAnswer`, the `askAnswer` helper and `INFO_TIPS.fieldAsk` are deleted; the `onAnswerAsk` prop chain goes from `RoleBoard.tsx` and `AppShell.tsx`. Discovery still writes `Sector` and `Ask` to the profile and `addOtherPreference` stays in `profile.ts`; no screen shows them (`docs/backlog.md` §2, §4). In `docs/design-language.md`, the field example under principle 3 and the list under principle 12 are reworded to match: the sector line went, the summary stayed. **Footer button:** `writeSearchesLabel(0)` is "Write LinkedIn searches" and `selectedRolesNote` returns "Tick at least one role first." at zero and nothing otherwise, so "N roles ticked" is gone; no info icon. The same in the "no search yet" block of `Searches.tsx`. **Searches:** delete the "Get new matches by email" disclosure from `QueryCard.tsx`; `ALERT_STEPS` stays in `boards.ts` as data. **Info icons:** with the last caller gone, delete `InfoTip.tsx`, `INFO_TIPS` and their CSS. Append D57 | Claude (Opus) | `screens.test.ts` covers `basedOn` (titles, evidence, deduplication) and both button states; `RoleGroup.tsx` no longer reads `field.sector`; a `grep -rn` over `src` finds none of `Draws on`, `Get new matches`, `roles ticked`, `InfoTip`, `Save answer`, `cc-years`, `used to match roles`; tests, lint, build pass | `[DONE]` |
| 2b.19 | Integration. Live loop through the try scripts on the `userdata/` resume and the videographer fixture: `try:cards` → `try:discover --interest=…` → `try:queries --tick`. **Search quality check:** every query pairs the role's title variants with terms specific to its field; a query whose climate half is only generic terms ("green jobs", "climate careers", "sustainability") fails the check. The reference failure, from Sonnet 5.5, for the field "climate talent and job matching platforms": `("data science manager" OR "manager of data science" OR "analytics manager") AND ("green jobs" OR "climate careers" OR "workforce development" OR "talent marketplace")`. If Opus 5.5 with the skills now in the prompt (2b.15) still writes queries like it, the worker reports three examples and patches nothing; the orchestrator then briefs a separate Fable worker on the `queries.ts` prompt (its own commit and decision, before this step's) and the check is run again. **Docs:** `docs/technical-plan.md` §2 rewritten for the four-item nav, the Resume page, the one question and the simplified Roles and Searches screens, plus a §6 verification entry with cost per run; `docs/data-flow.html` (profile-writing clicks: skill remove / add back and interest toggle added, the per-field answer click removed; `inferPreferences` no longer writes climate interests; Start writes `Inputs`, which no call reads); CLAUDE.md "turn endpoint" paragraph (one question, the shell description, the browser-safe module list), the `profile.md` section and the sentence on what lives in `localStorage` checked against the code; each example in `docs/design-language.md` checked against the screen it describes; `docs/backlog.md` cross-checked against what 2b.14–2b.18 left out | Claude (Fable) runs the loop and the search check, then Claude (Opus) reconciles the docs | Loop runs locally end to end on both inputs; every query passes the search quality check, after a prompt fix if one was needed; every doc named here agrees with the code; tests, lint, build pass | `[DONE]` |
| G2b.5 | Third browser run with your resume: Resume → Highlights (remove a skill, add it back, exclude a highlight, pick two areas) → Roles (open a "Based on", tick roles) → Searches → open two on LinkedIn; use each top-bar item to go back, and try "Start over" with the download. **Carried from G2b.4:** open "Your profile" after each step and note what the cards, the interest picks, discovery and the searches each wrote, and anything that looks wrong | **`YOU`** | You reach the Searches screen with no error, two LinkedIn runs return specific, relevant results, and the profile check is written up (a few lines is enough) | `[DONE]` (2026-11-21: third run found no issues) |
| G2b.2 | `/code-review` and `/security-review` (the turn input shape, the abort path and the model-per-step table changed) | **`YOU`** open a fresh session; Claude (Opus) reviews and fixes | Findings fixed and committed on `phase-2b` | `[DONE]` |
| G2b.3 | Merge PR #5 | **`YOU`** | `phase-2b` merged to `main` | `[DONE]` |
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

Order for the 2026-11-19 revision: 2b.14 and 2b.15 may run in parallel
(2b.14 owns `llm.ts` and its docs; 2b.15 touches neither), then 2b.16,
2b.17 and 2b.18 strictly in sequence because all three edit `screens.ts`,
`AppShell.tsx` and `Highlights.tsx`; 2b.19 last. Each step is one commit on
`phase-2b` and appends its own decision (D52–D57; 2b.17 has two) to
`docs/technical-plan.md` §5 in that commit. Where the Who column names two
workers, the Fable worker goes first on the `src/lib` part (the profile
format, prompts and what they read), the Opus worker follows on screens and
components, and the step is still one commit. The on-screen copy in each row
is final: workers use it verbatim and read `docs/design-language.md` before
touching a string the row does not spell out. Prompt wording in a row is the
default, and the Fable worker may sharpen it. Two live calls are needed before the
gate, both through the try scripts with the local Supabase stack up: 2b.16
(discovery, about $0.20) and 2b.19 (the loop on two inputs, about $1).
2b.14–2b.19 landed 2026-11-20 and the loop ran live on two inputs for $0.64
(docs/technical-plan.md §6).

Four gaps the walkthrough notes left open, as you settled them
(2026-11-20):

1. **The resume is kept in the profile.** What the person types (the resume
   and the notes box today, any later input after that) goes into its own
   `## Inputs` section of `profile.md`, next to the selections already kept
   there, so the Resume page can show it back and every earlier page can be
   revisited. It stays in the browser like the rest of the profile, and no
   prompt reads it (2b.17, D56).
2. **The interest question is optional, with no "Not sure yet" pill.** With
   multi-select and "interests rank, never filter", picking nothing means
   "rank on fit alone", so the button no longer waits for an answer.
3. **Under a field title: "Strong overlap", the move label, "Based on" and
   the two-sentence summary.** The one-line sector goes because it restates
   the title. The summary stays, and discovery is told not to repeat the
   field's name in it (2b.16, 2b.18).
4. **The AGENTS.md model policy applies unchanged.** Fable workers take the
   profile format, the prompts and what they read, and integration; Opus
   workers take `llm.ts`, screens, components and docs. Steps that need both
   name both in the Who column.

Not in 2b, by decision: a composer (D42), explore and example posts (D39),
an editable profile drawer (D42), re-ranking on a per-field answer (D43),
a layout below ~900px, a dark scheme; after the 2026-11-17 run: query
feedback and revision in the UI, Indeed and Climatebase queries, marking
fields, the seniority question, file upload; and after the 2026-11-19
walkthrough: the retraining question, per-field follow-up questions, the
sector line under a field, job-alert steps, re-reading an edited resume, and
a rethink of the STAR layout of highlights. All of these are in `docs/backlog.md`.

Decided 2026-11-18 (your answers to the three open points): fields are
headings only on the Roles screen, with no marking; the alpha ends at the
LinkedIn runs; the seniority question is dropped, not just seniority in
titles. **Revisit later:** how the user tells us whether a field interests
them at all, now that the Interesting / Unsure / Not for me row is gone
(`docs/backlog.md` §2).

### Phase 2c — Reference data research `[IN PROGRESS]`

Replaces the placeholder reference collection in `data/*.yaml` with
researched industry and occupation data. The placeholder files are ignored
throughout: no worker reads them as a starting point. Agreed 2026-11-23.

**Scope.** US plus EU. Professional career switchers only (trades are in
`docs/backlog.md` §2). Adaptation and resilience are tagged inside each
area, not an area of their own.

**Areas (ten).** The six `CLIMATE_AREAS` (Circular Economy, Built
Environment, Transportation, Energy, Food & Agriculture, Carbon Removal)
plus four added for the research: Climate Finance (including climate risk,
insurance and carbon markets); Industry & Materials (steel, cement,
chemicals, hydrogen, industrial heat); Nature & Water (conservation,
forestry, oceans, water systems); Corporate Sustainability & Climate
Services (carbon accounting, disclosure, climate data and software, policy
and advocacy). No area was cut at G2c.1; whether Climate Finance and
Corporate Sustainability stay is decided at G2c.2, once the dataset
exploration shows whether occupation data can see them. Which of the four
become pills in the UI is decided outside this phase.

**Rules for every worker.**
- Research output goes to `docs/research/`, never straight into `data/`.
- The 2c.1 source survey is archived in `docs/archive/2c.1-source-survey/`
  (gitignored, local only; the committed copy is in git history at
  `9bad65f`). It surveyed reports, which D60 set aside, so no worker reads
  it as a starting point. What later steps need from it is written into
  their rows below.
- Datasets, not reports (D60). Fields and roles come from datasets read
  through their API or an MCP server. No worker extracts figures or lists
  from an analysis page or a report; a report is named only as how a
  dataset was found.
- Every row carries its geography (US, EU or both) and a retrieval date.
- Every claim carries a URL. A script checks that each URL resolves and is
  not on a blocked domain before a gate; an Opus worker spot-checks a
  sample of claims against their sources.
- Company career pages may be read in a bounded way: at most 10 companies
  per field, recording title, function and URL only, no posting text.
- Companies are chosen by fixed criteria, set in the 2c.4 brief and reused
  unchanged in 2c.5: US and EU; a mix of startups, scale-ups, incumbents
  and nonprofits; a public careers page; named on at least one published
  list.
- LinkedIn's Green Skills Report is not used.

**Sequencing.** 2c runs before 3.1, so the evaluation judges discovery on
the researched data.

| Step | What | Who | Done when | Status |
|---|---|---|---|---|
| 2c.1 | Source survey: one worker per source family (US federal; EU; international bodies; NGO and academic; climate-tech taxonomies and company lists). Each fills the same scorecard per source: coverage of the areas, granularity, last update and cadence, format and licence, geography, trades-versus-professional skew, and whether an official US–EU occupation crosswalk exists | Claude (Sonnet, low effort) | Scorecards under `docs/archive/2c.1-source-survey/`; every URL resolves and none is on a blocked domain (checked by script) | `[DONE]` (2026-11-23: 31 scorecards in five files; `pnpm research:check-links` passes with 10 sites refusing automated checks (D59); 10 claims spot-checked, 4 corrected; recommendation in `docs/archive/2c.1-source-survey/recommendation.md`) |
| G2c.1 | Pick the backbone source per area and cut any area the survey showed to be thin | **`YOU`** with the orchestrator's recommendation (`docs/archive/2c.1-source-survey/recommendation.md`) | Choices recorded here | `[DONE]` (2026-11-23: datasets first, read through their APIs; the O*NET database is the main starting point, extending to BLS and ILOSTAT, with the OECD's derived datasets explored as a separate step (D60). This replaces the per-area report backbone in the recommendation. No area cut; the Climate Finance and Corporate Sustainability choice moves to G2c.2) |
| 2c.2 | Dataset access, by API or an MCP server. First the O*NET database (https://www.onetcenter.org/database.html) through O*NET Web Services: it is the main starting point. Then the BLS public data API, ILOSTAT, and the OECD data API for 2c.3b. Proposed addition: the ESCO API, the EU counterpart joined to O*NET by the official crosswalk. Keys live in `.env.local`, never committed | **`YOU`**, in a separate session | Each source answers one test query from this repo; O*NET alone is enough to start 2c.3 | `[TODO]` |
| 2c.3 | Dataset exploration, starting from O*NET: catalogue the tables that matter (occupations, tasks, alternate and reported titles, the green tags as a hint only), then what BLS and ILOSTAT add (employment by occupation and industry) and, if connected, ESCO (its O*NET crosswalk is a CSV at https://esco.ec.europa.eu/en/use-esco/other-crosswalks). The green tags are a hint only because the survey found them unchanged since about 2012. For each source: the finest industry and occupation level, geography and latest year. Answers two questions: can the data name roles at the level the app shows, and can it tie a role to a climate field, since O*NET is keyed by occupation, not by field. Ends in a proposed pull spec (which tables, which codes, which filters). If no dataset can name fields, the spec says so and proposes a taxonomy dataset (the EU Taxonomy) for that layer | Claude (Sonnet explores, Opus writes the spec) | Catalogue and pull spec under `docs/research/datasets/` | `[TODO]` |
| 2c.3b | OECD derived datasets, explored on their own: what the OECD data API offers beyond the O*NET and BLS data it is built from (for example green-task measures by country or region), and whether any of it is worth adding to the pull spec. A side step: it can run alongside 2c.3 and does not hold up G2c.2 | Claude (Sonnet, low effort) | A short note under `docs/research/datasets/` saying "add these tables" or "nothing to add" | `[TODO]` |
| G2c.2 | Finalise the data to pull; decide whether Climate Finance and Corporate Sustainability stay | **`YOU`** with the orchestrator's pull spec | Spec approved or corrected, recorded here | `[TODO]` |
| 2c.4 | Pilot two areas end to end, Energy (best data) and Carbon Removal (worst), from data pulled under the approved spec: fields, a field × function matrix of roles, top companies, real titles from a bounded career-page read. Appends the career-page decision to `docs/technical-plan.md` §5 | Claude (Sonnet gathers, Opus reconciles) | Both areas written up under `docs/research/areas/` in one agreed format; empty matrix cells say "none found" or "not looked" | `[TODO]` |
| G2c.3 | Review the pilot format before the fan-out | **`YOU`** | Format approved or corrected | `[TODO]` |
| 2c.5 | Remaining areas in the approved format, one worker per area | Claude (Sonnet gathers, Opus reconciles) | Every area written up; link check passes | `[TODO]` |
| 2c.6 | Verification against Climatebase jobs: check whether each posted job fits one of the researched roles, to catch what the datasets missed. The list is pre-filtered for fellows and not comprehensive, so it tests for gaps, not for coverage. **No worker fetches climatebase.org** (PRD hard constraint; it is a blocked domain). You supply a bounded list of titles and employers, kept in gitignored `userdata/` and never committed, seeded or cited. A role found only this way is sourced elsewhere before it enters the reference set. Appends the decision to `docs/technical-plan.md` §5 | **`YOU`** supply the list; Claude (Sonnet matches, Opus reviews the misses) | `docs/research/verification.md`: the share of jobs that fit a role, and each miss marked "add a role", "add a field" or "out of scope" | `[TODO]` |
| 2c.7 | Synthesis: one consolidated reference set, the 2c.6 misses resolved, and a schema recommendation (occupation codes on roles, a companies table, or the current three files unchanged) | Claude (Fable) | `docs/research/synthesis.md` | `[TODO]` |
| G2c.4 | Approve the reference set and decide the schema | **`YOU`** | Decision recorded in `docs/technical-plan.md` §5 | `[TODO]` |
| 2c.8 | Implement the first round of research into `data/*.yaml` (and the schema, if it changes) | Claude (Opus) | `pnpm seed` and `pnpm db:check-rls` pass; `try:discover` cites only catalogue URLs | `[TODO]` |

2c.8 is a fit for the `Workflow` tool (a deterministic fan-out with a
schema per area); it runs that way only if you opt in ("use a workflow for
step 2c.8"). The schema decision is deliberately left to G2c.4. Steps after
G2c.1 were renumbered on 2026-11-23 when the dataset steps (2c.2, 2c.3) and
the verification step (2c.6) were added; none had started.

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
