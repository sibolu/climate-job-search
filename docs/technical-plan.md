# Technical plan — Climate Career Exploration Tool

The implementation reference for this repo. [PLAN.md](../PLAN.md) is the
roadmap (phases, status, backlog); [PRD.md](../PRD.md) is the why; this file is
the how. It is written for contributors and for Claude Code workers who need
the detail behind a step, and it is long on purpose — read the section you
need, not the whole file (AGENTS.md's context budget applies).

Contents:

1. [Architecture](#1-architecture)
2. [UI shape](#2-ui-shape)
3. [Repo layout](#3-repo-layout)
4. [Risks specific to this project](#4-risks-specific-to-this-project)
5. [Decisions](#5-decisions) — numbered D1–D70, cited from code as
   `technical-plan.md D31`. Numbers are stable: never renumber, append.
6. [Verification log](#6-verification-log) — what each gate checked and
   found, so a later change that breaks one of these is a regression, not a
   new opinion.

**Adding a decision.** Append it to §5 with the next number, in the same
commit as the change it describes. If it changes what a contributor has to
do, update CLAUDE.md too. Decisions live here, never in Claude's private
memory.

---

## 1. Architecture

Defaults; a decision in §5 overrides a row here.

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, Next.js (App Router), `pnpm` | Vercel is built for Next.js. Evals also in TS so prompts have one home |
| Hosting | Vercel for app and route handlers. Supabase Postgres for the `llm_usage` table, the `access_codes` table (D67) and the reference tables (seeded, not read by the app since D61). Setup in `docs/deploy.md` | Existing subscriptions |
| Access | One generated access code per invited person, each with a dollar cap; `/api/enter` checks it and sets a signed cookie carrying the code's derived key, checked in `src/proxy.ts`. An optional operator passcode (`OPERATOR_PASSCODE`) enters without a key and is not metered. No accounts (D68) | Gates the pilot and caps each person's spend without identifying anyone |
| LLM | Anthropic TS SDK, model per step: `claude-fable-5-2` for `discover`, `claude-opus-5-5` for every other step, `queries` and `revise` included. Adaptive thinking, every call streamed, 3-minute deadline per call, cancelled when the browser disconnects (`maxDuration` 800s) | Effort per call (chat, discovery and queries `medium`, `explore` `high`), set explicitly on every model. See D44, D45, D52, D62 |
| Grounding | In the app, the model's own knowledge only: discovery gets the cards, skills and preferences, no catalogue, no URLs (D61). The reference catalogue is kept as an evaluation arm behind `DiscoverOptions.catalogue`, reached only by `pnpm try:discover --catalogue`. No web tools in any step the UI reaches (D44); `explore.ts` keeps `web_search_20260209` / `web_fetch_20260209` with `blocked_domains` for linkedin.com, indeed.com, climatebase.org | Memory-only is the baseline arm; the app switches to the catalogue only if the evaluation says so (D61); hard constraint still enforced in code |
| Session state | `profile.md` text + chat messages, in `localStorage`. Sent to the route handler on every turn. Export and import in the profile drawer, "Start over" on the Resume page (D55). The resume and notes as typed are kept in `profile.md` under `## Inputs` (D56) | PRD's "single .md the user keeps"; server is stateless |
| Reference data | Supabase tables `climate_fields`, `example_roles`, `example_job_posts`, seeded from `data/*.yaml` in the repo. Publishable key with select-only RLS. Not read by the app since D61; the catalogue arm of the evaluation reads it | The PRD's one allowed collection, reproducible from the repo |
| Cost telemetry | `llm_usage` table: random per-browser session id, model, tokens, cost, duration, step name. No content, no identity, not linked to a code. Separately, `access_codes` keeps one running dollar total and a cap per code: every call made under a code is checked against it before it runs and adds its cost after (D67, D69) | Cost per session and per step, the evidence behind model choices (D46 moved `queries` and `revise` to Sonnet 5.5; D52 moved them back). See D4. The per-code total is what stops spend |
| Resume input | Plain-text paste (textarea). PDF upload deferred | User asked for text; removes a parsing surface |
| Structured steps | `output_config.format` structured outputs for cards, fields, queries | Deterministic shapes for the UI |
| Tests | `vitest`; prompt behaviors covered by evals, not unit tests | Unit tests for parsers and pure logic only |

---

## 2. UI shape

One centred column. The visual spec is still the Claude Design handoff in
`docs/design_handoff_climate_career_exploration/` (D37): colours, type,
spacing and interaction states come from its README. Its layout (assistant
rail, field board, feedback screen) was replaced after the first browser
run (D49, D50, D51). Desktop Chrome, ~1280px+, light-only.

- **Header:** a four-item nav (Resume, Highlights, Roles, Searches; no
  numbers, steps not yet reached disabled, every reached step a link back)
  and "Your profile", which opens the drawer. No product mark, no rail, no
  tabs, no composer (D42, D49, D55).
- **Resume:** before a paste, paste a resume or bio, optional notes, Start;
  the two are kept in the profile (D56), then `cards` runs. After, the
  stored text read-only and the app's only "Start over", behind a dialog
  that offers the profile download first (D55).
- **Highlights:** "Skills" first: one row of tiles, accepted unless
  removed, each with a single remove control; removed skills stay visible,
  struck, with a control to add them back (D53). Then the experience cards,
  collapsed to title, one-line result and skills (years stay in
  `profile.md`, not on screen: D57), with Situation /
  Action / Result behind "Details" and Edit / Exclude per card. Then one
  optional question, "Which area of climate work interests you most?",
  answered by toggling any of six area pills with no model call; the picks
  rank roles, never filter them (D54). Then one button, "Find climate
  roles", which runs `discover` and never starts on its own (D38); it needs
  only one included highlight, and while it is disabled its note says so.
- **Pending:** the status line, elapsed time and the live log in the main
  column while a turn runs. Real phases, no estimates.
- **Roles:** one group per discovered field, in rank order. The field is a
  heading, not a choice: name; one row with the fit label, the move type
  and a "Based on" disclosure listing each cited highlight's title with
  its evidence line; the two-sentence summary; the uncertainty (D57). The
  sector line and the per-field question are not shown. Under it, one
  row per role: checkbox, title, the one-line why with card ids rendered as
  card titles, example companies and source links. No field marks, no rank
  numbers (D50). One sticky button, "Write LinkedIn searches" ("… for N
  roles" once any is ticked, with "Tick at least one role first." beside
  it at zero), runs `queries` for every ticked role (D47).
- **Searches:** one card per ticked role: role title, field name, the
  query, "Open on LinkedIn" (a link the person clicks; the app never
  fetches LinkedIn), "Copy", and
  "Change roles" back to the Roles screen. No verdicts and no feedback
  screen (D51). A role ticked after the last write shows a note and the
  write button instead of a card.
- **Errors and parser warnings** render as a banner at the top of the main
  column. The assistant message a turn returns is not shown.
- **Profile drawer:** a read-only summary in plain language (preferences,
  skills and highlight titles with removed or excluded ones struck through, selected
  roles, searches). Behind an "Export" disclosure: download `profile.md`,
  download the session JSON, import, and the raw file (D49).

Policy lives in pure, unit-tested modules, and the components in
`src/components/shell/` only render: `screens.ts` decides which screen
shows, nav gating, the Start text and the Resume page's view, the
interest question's label, note and pressed pills, the "Find climate
roles" gate, log lines, role groups, `citationsToTitles`, the write-searches
label and the search cards;
`profile-summary.ts` decides what the drawer shows; `workspace.ts` holds
the profile edits and the turn inputs.

---

## 3. Repo layout

Each module is owned by the step that created it (PLAN.md step number in
parentheses). Do not create a later step's file early.

```
src/
  lib/
    passcode.ts     # operator-passcode check, v2 session cookie sign/read (0.1; 2e.3, D68)
    access-code.ts  # generate/normalise access codes, derive their key; Web Crypto only (2e.2; D68)
    budget.ts       # BudgetLedger over access_code_budget / access_code_add_spend (2e.1; D67)
    profile.ts      # profile.md schema, parse/serialize — the contract (0.2)
    session.ts      # browser session state + per-turn payload (0.2)
    __fixtures__/   # canonical profile.md fixtures used by the round-trip tests
    llm.ts          # client wrapper, model config, usage logging, web tools (0.3);
                    # per-code budget check before a call, charge after (2e.4; D69)
    supabase.ts     # anonClient() / serviceClient() (0.4)
    database.types.ts  # GENERATED by `pnpm db:types`; do not hand-edit (0.4)
    reference-schema.ts # data/*.yaml shapes + blocked-source rules (0.4)
    reference.ts    # typed reads from the Supabase reference tables (0.4)
    cards.ts        # pasted text → experience cards (1.1)
    elicit.ts       # preference elicitation policy and answer pills (1.2)
    discover.ts     # fields/roles discovery, no web tools, memory-only in the app (1.4; D44, D61)
    explore.ts      # field drill-down, example posts, LinkedIn guidance; no UI path (2.2; D39)
    queries.ts      # one LinkedIn query per selected role, and revision from feedback (2.3/2b.8; D47)
    boards.ts       # client-safe board labels, alert steps, query extra keys (2.4; D32)
    workspace.ts    # browser-side step policy, profile edits and turn inputs for the UI (2.1/2.4/2b.8)
    screens.ts      # pure screen state for the shell: gates, role groups, search cards (2b.4/2b.11/2b.12)
    profile-summary.ts # readable profile summary for the drawer (2b.11; D49)
    turn-stream.ts  # NDJSON wire codec + sendTurn (2.1)
    turn.ts         # server dispatcher: TurnRequest → TurnResponse; passes the cookie's code key on (2.5; D31; 2e.5)
  components/shell/ # AppShell, Header, ProfileDrawer, ResumeScreen, StartOverDialog,
                    # Highlights, Pending, RoleBoard, RoleGroup, Searches, QueryCard
                    # (2b.4/2b.11/2b.12/2b.17); save-file.ts, the browser download
                    # helper the drawer and the Start over dialog share (2b.17; D55)
  app/
    api/turn/       # the one turn endpoint (NDJSON stream; 2.5)
    api/enter/      # access-code (or operator-passcode) check, sets the session cookie (2e.3; D68)
    page.tsx        # the single-page workspace
  proxy.ts          # session-cookie gate (Next 16's name for middleware.ts; D7)
supabase/
  config.toml          # local stack config (supabase init)
  migrations/          # reference tables, llm_usage, blocked-source CHECK, RLS;
                       # access_codes + its two functions (20261126090000_access_codes.sql, 2e.1; D67)
data/                  # climate_fields.yaml, example_roles.yaml, example_job_posts.yaml (1.3)
scripts/
  seed.ts              # data/*.yaml → Supabase (mirror; service role)
  try-cards.ts         # stage 1.1 live check
  try-discover.ts      # stage 1.4 live check (catalogue-only sources)
  try-explore.ts       # stage 2.2 live check (blocked-host assertion)
  try-queries.ts       # stage 2b.8 live check (one LinkedIn query per selected role; optional scripted revise)
  check-rls.ts         # asserts the RLS shape against a live stack
  access-codes.ts      # codes:add / codes:list / codes:set; the only writer of codes (service role; 2e.2)
  smoke-llm.ts         # one live Claude call; proves the usage row lands (0.3)
docs/
  data-flow.html       # API calls and profile.md reads/writes (keep current)
  technical-plan.md    # this file
evals/                 # synthetic profiles, structural checks, LLM-judge rubric, baseline arm (3.1, not started)
```

---

## 4. Risks specific to this project

- **Grounding quality is the hypothesis under test.** Discovery now runs on
  the model's own knowledge alone (D61), with no source for any field; the
  reference catalogue is an evaluation arm. Step 1.4's check counts
  citations, not their quality; the LLM judge in 3.1 is where quality gets
  measured, and it is what decides whether a larger catalogue or bounded
  search comes back. Do not skip 3.1.
- **Terms-of-use compliance is code, not policy.** `blocked_domains` in
  `llm.ts` is the enforcement point; 2.2's acceptance check asserts on the
  usage log. Any new fetch path must go through `llm.ts`.
- **No user data server-side is also code.** Route handlers are stateless;
  the only Supabase write is the anonymous `llm_usage` row. Gate 2's security
  review checks that no request body content is persisted or logged.
- **Browser-only state can be lost.** Clearing site data wipes the session.
  Export is one click and the intro page says so. Acceptable for a pilot.
- **Per-turn payload grows.** Profile plus full chat history is resent each
  turn. Keep the profile as the compressed memory: after each discovery or
  revision turn the assistant updates profile.md and the UI trims chat
  history to the last N turns.
- **Vercel function duration.** Discovery runs about 1–2 minutes without
  web tools. Every model call has a 3-minute deadline (D45), route handlers
  stream and set `maxDuration` to 800s, and a turn makes at most a few
  sequential calls.
- **Builder is a data scientist, app is TypeScript.** Prompts live as plain
  template strings in `src/lib/*.ts`, one per module, so editing a prompt
  never requires touching React.

---

## 5. Decisions

Taken by default; say so to change one. Cited from code and CLAUDE.md as `D<n>`.

1. Next.js + TypeScript on Vercel. Supabase holds only the reference
   collection and anonymous usage rows. Python-on-Vercel rejected (weak
   streaming, cold starts).
   (2026-11-26: Supabase now also holds one `access_codes` row per access
   code: a derived key, never the code, a dollar cap, a running total, a
   disabled flag and a creation time; no user data, D67–D69.)
2. App model `claude-opus-5` everywhere, effort tuned per call. Re-evaluate
   Sonnet 5 for chat turns after Phase 3 using `llm_usage`. (Model now
   `claude-opus-5-5`: D44; `queries` and `revise` on `claude-sonnet-5-5`:
   D46. Superseded by D52: every step on `claude-opus-5-5` again; then
   D62: `discover` on `claude-fable-5-2`.)
3. All user state lives in the browser (`localStorage`) and is resent each
   turn. No accounts, no server-side profiles or transcripts. Consequence: the
   PRD's baseline comparison uses synthetic profiles and the builder's own,
   not fellows' transcripts, unless a fellow exports and shares one.
4. Anonymous usage rows (random session id, model, tokens, cost, duration,
   step) are written to Supabase for spend caps and model-choice evidence. Nothing else leaves
   the browser except the API request itself. If even this is too much, the
   cap moves client-side and the table is dropped.
   (2026-11-26: the per-session spend cap planned here is dropped. The
   session id is made in the browser, so a cap keyed on it stops nobody;
   the cap is per access code instead, D67, D69. `llm_usage` itself stands,
   for model-choice evidence.)
5. Access by a single shared passcode given to invited fellows.
   (2026-11-26: superseded for invited people by one access code each,
   D68. The shared passcode survives only as the optional operator
   passcode, `OPERATOR_PASSCODE` (renamed from `APP_PASSCODE` by D70), whose
   sessions are not metered.)
6. "Example profiles" in the reference collection means role profiles (what
   someone in the role does day to day), never personal profiles, per the
   PRD's consent rule.
7. The passcode gate lives in `src/proxy.ts`, not `src/middleware.ts`:
   Next.js 16 deprecated and renamed the `middleware` file convention to
   `proxy` (the exported function is `proxy` too). Same feature, current
   spelling. Unauthenticated `/api/*` requests get a `401` JSON body instead
   of a redirect, so `fetch()` callers see the failure rather than silently
   re-POSTing to an HTML page.
8. The session cookie is an HMAC-SHA-256 token `v1.<expiry>.<sig>` signed with
   `PASSCODE_COOKIE_SECRET` and carrying no user data — only a format version
   and an expiry. Signing and verification use the Web Crypto API so the gate
   stays portable to the Edge runtime.
   (2026-11-26: now `v2.<expiry>.<scope>.<hmac>`, the scope being the access
   code's derived key or `operator`; v1 is refused, D68.)
9. **`profile.md` format is "labeled-bullet markdown"**, defined once in the
   header comment of `src/lib/profile.ts`: eight `##` sections in fixed order
   (Preferences, Experience Cards, Skills, Fields, Role Shortlist, Queries,
   Inputs, Session Notes; Inputs added by D56); items are `### <ID>: <title>` headings with
   `- **Key:** value` lines; lists are comma-separated inline except Sources
   (one URL per indented `-` line). No YAML or JSON blocks, so a nontechnical
   user can read and edit it in a textarea. Preferences are stated unless
   tagged `(inferred)`. Field `explored` is a boolean separate from `status`.
10. **ID stability rule.** Card/field/role/query IDs (`C1`, `F1`, `R1`, `Q1`)
    are never renumbered on edit; a new item gets the highest existing number
    plus one (gaps are never reused). Items that a user adds by hand without
    an ID, or with a duplicate ID, are assigned the next free one with a
    warning. Excluded cards stay in the file with `Excluded: yes` rather than
    being deleted, so fit reasoning that cites them keeps resolving.
11. **Tolerance rule.** `parseProfile` never throws on a string. Unknown
    `##` sections and unknown `- **Key:**` lines are preserved and written
    back by `serializeProfile`; unlabeled text is moved to the nearest
    free-text slot (`Notes` on the item, else Session Notes) and reported in
    `warnings`; invalid enum values fall back to the default with a warning.
    Serialization is canonical (fixed order, every known key present) so
    `parse(serialize(p))` deep-equals `p` and `serialize(parse(md))` is
    idempotent, which keeps per-turn diffs small. The fixtures under
    `src/lib/__fixtures__/` are stored in canonical form and the tests assert
    that byte-for-byte.
12. **zod is the shared schema layer.** `profile.ts` and `session.ts` export
    zod schemas alongside the inferred TS types; route handlers validate
    request bodies with them (`parseTurnRequest`) and 0.3's structured-outputs
    helper and the 1.x modules pass the same schemas to the Anthropic SDK.
    The `profile.md` text, not the parsed object, is the source of truth in
    `localStorage`; `SessionState` carries only `version`, a random
    `sessionId`, `profileMd`, and `messages` — no identity fields by design.
13. **Blocked domains are enforced in SQL, not only in TypeScript.** A CHECK
    constraint on `climate_fields.sources`, `example_roles.sources` and
    `example_job_posts.source_url` calls `private.is_blocked_source_host()`,
    so no code path — seed script, psql, a future admin tool — can store a
    linkedin.com / indeed.com / climatebase.org URL (or a subdomain) as a
    source. The host-matching logic is one SQL function so it is testable,
    and it is mirrored by `isBlockedSourceHost()` in
    `src/lib/reference-schema.ts` so the seed fails with a readable message
    before it reaches the database. Look-alikes (`notlinkedin.com`) are not
    blocked. The same three domains are the `blocked_domains` list the web
    tools get in `llm.ts`; the three lists must stay in step.
14. **`pnpm seed` mirrors the repo.** `scripts/seed.ts` upserts every entry in
    `data/*.yaml` by id and deletes any row whose id is no longer listed, so
    the tables always equal the files and `git diff data/` is the full
    changelog of what production contains. Validation of all three files
    happens first: one bad URL, dangling `field_id` or duplicate id aborts the
    run with a non-zero exit and nothing written.
15. **`src/lib/database.types.ts` is generated and committed.**
    `supabase gen types typescript --local` (wrapped as `pnpm db:types`) is the
    source of the `Database` type; regenerate and commit it in the same commit
    as any migration. Hand-writing it would let the types drift from the
    schema silently.
16. **The RLS shape has an executable test.** `pnpm db:check-rls` runs against
    a live stack and asserts, with the publishable key, that the three reference
    tables are readable and not writable, that `llm_usage` is insertable and
    not readable, and that the blocked-domain CHECK rejects a LinkedIn source
    even for the service role. It insists on Postgres `42501` rather than "any
    error", because a write merely filtered by a policy returns a silent
    success affecting zero rows; the table grants revoked in the RLS migration
    are what make the refusal unconditional. Run it after every migration.
17. **Supabase local development only.** `supabase/config.toml` is committed
    and the CLI stack runs in Docker (`pnpm db:start`). No `supabase link` to a
    remote project from a development machine; the production project is set
    up in Phase 3 step 3.3 and seeded from the same `data/*.yaml`.
18. **`@anthropic-ai/sdk` 0.125.0, non-beta endpoints only.** Structured
    outputs use `client.messages.create()` with
    `output_config.format = zodOutputFormat(schema)` from
    `@anthropic-ai/sdk/helpers/zod` (which targets `zod/v4`, matching the
    repo's zod 4) — and streaming uses `client.messages.stream()` +
    `finalMessage()`. No beta header is needed for structured outputs, effort,
    adaptive thinking, prompt caching or the web tools, so `llm.ts` never
    touches `client.beta.*`; that keeps the app off surfaces that can change
    shape under us. `structured()` deliberately does not use
    `client.messages.parse()`: the SDK parser throws before usage can be
    recorded when a response is truncated at `max_tokens`, and its error
    message quotes the model's text. The wrapper instead records usage, maps
    the stop reason (`LlmTruncatedError`, `LlmRefusalError`), then parses the
    final text block with the caller's zod schema; a failure is
    `LlmOutputError` carrying only issue paths and codes.
19. **Web tool type strings are `web_search_20260209` and
    `web_fetch_20260209`** (the dynamic-filtering variants; `claude-opus-5`
    supports them, confirmed against the `claude-api` skill's server-tool
    table on 2026-09-12). Web fetch is configured with citations on, because
    every recommendation has to cite a real source. Because those tools run
    code execution under the hood, `code_execution` is never declared
    separately. `webTools()` in `llm.ts` is the only factory, and every call
    passes its tools through `assertToolsAllowed()`, which throws unless each
    web tool blocks all three domains — the belt to D13's braces.
20. **Pricing lives in `PRICE_PER_MTOK` in `llm.ts`**, from the `claude-api`
    skill's model table and prompt-caching economics, checked 2026-09-12:
    `claude-opus-5` input $5/MTok, output $25/MTok, cache read 0.1× input
    ($0.50), 5-minute cache write 1.25× input ($6.25). The comment carries the
    date; re-check it whenever the skill's numbers move, because `cost_usd` in
    `llm_usage` is computed here and nowhere else.
21. **One `llm_usage` row per logical call.** A `pause_turn` continuation is
    part of the same logical call: the wrapper resumes it (up to
    `MAX_PAUSE_TURN_CONTINUATIONS = 5`, then `LlmPauseLimitError`), sums the
    token counters across every continuation, and writes a single row. Rows
    are written fire-and-forget through the publishable key, and a failure is a
    `console.warn` carrying the error *code* only — telemetry must never cost
    the user their turn, and must never be a channel through which content
    leaks. Refused and truncated turns are logged before the error is thrown,
    so the cost telemetry stays complete. `UsageRow`'s key set is fixed by
    `USAGE_ROW_KEYS` and guarded both at compile time and in `llm.test.ts`, so
    adding a content field fails the build. `streamText` starts the call
    eagerly and lets it complete even if the consumer stops reading deltas
    (the API reports output tokens only in the final `message_delta`), so
    `final` always settles and the row is exact.
22. **`llm_usage`'s shape is a CHECK constraint, not a comment.** The publishable key
    is public and INSERT on that table is open by design, so "counters and
    identifiers only" has to be something the database enforces rather than
    something the app promises: `session_id` must match `^[0-9a-f]{32}$` (the
    exact shape `newSessionId()` produces) and `step` must be one of the six
    `StepName` values. Neither column can then carry a name, an email, a
    resume line or any other free text, whatever calls the endpoint.
    `pnpm db:check-rls` asserts both rejections (`23514`) with the service
    role, so the constraints cannot be quietly dropped. Changing `StepName` in
    `session.ts` means changing the CHECK in the same commit.
23. **Supabase auth signs nobody up.** `enable_signup` is `false` in both
    `[auth]` and `[auth.email]` in `supabase/config.toml`, and
    `enable_anonymous_sign_ins` stays `false`. There are no accounts (D5):
    access is the shared passcode checked in `src/proxy.ts`, and Supabase auth
    must not be a second, open door that creates users in a project whose anon
    key ships to the browser. **The hosted project in Phase 3 step 3.3 must mirror
    this** — a Supabase project is created with signups enabled, so turning
    them off is an explicit setup step there, not something the committed
    `config.toml` does for us.
24. **`profile.ts` parses in linear time.** `profile.md` is user-controlled
    input, re-parsed on every turn in a route handler, so a parser that
    backtracks is a denial-of-service hole with a friendly face. The original
    bold-key regex took 55 seconds on `"**" + " ".repeat(800) + "x"`; the
    trailing-whitespace strips (`/\s+$/`) and the `(inferred)` tag regex were
    quadratic on a long run of spaces. They are now a hand-written scan,
    `trimEnd()`, and an unanchored-head regex respectively, and
    `profile.test.ts` parses a hostile document (5 KB of unterminated `**`,
    80 KB of trailing spaces) with an assertion that it finishes in under
    500 ms. Any new pattern in this module gets the same treatment: no nested
    quantifier that can match the same text two ways.
25. **The blocked-domain list has one TypeScript owner and a pinned SQL copy.**
    `BLOCKED_SOURCE_DOMAINS` in `reference-schema.ts` is the list; `llm.ts`
    re-exports it as `BLOCKED_DOMAINS`. The only other copy is
    `private.blocked_source_domains()` in the reference-tables migration, and
    `reference-schema.test.ts` reads the migration file, extracts the SQL
    array literal and asserts it equals `BLOCKED_SOURCE_DOMAINS`. So the SQL
    copy cannot drift without a test failing (D13, D19). Prose alone was not enough: the list is the PRD's
    no-scraping rule, and it has to fail loudly rather than silently.
26. **Session ids are `^[0-9a-f]{32}$` end to end.** `newSessionId()` mints
    them, `SessionStateSchema` and `TurnRequestSchema` accept nothing else,
    `llm.ts` throws `LlmSessionIdError` before any request if the id is
    malformed, and the `llm_usage` CHECK (D22) is the last line. An
    imported session file with a malformed id gets a fresh id and keeps the
    profile, so a tampered export cannot smuggle an identifier into
    telemetry.
27. **Request timeout × retries stays under `maxDuration`.**
    `REQUEST_TIMEOUT_MS = 300_000` and `MAX_RETRIES = 1`, and `llm.test.ts`
    asserts `(MAX_RETRIES + 1) × REQUEST_TIMEOUT_MS < MAX_DURATION_SECONDS ×
    1000`, so a stalled attempt plus its retry cannot outlive the Vercel
    function and lose the usage row for tokens already billed. (Now bounded
    by a per-call deadline: D45.)
28. **Worker model and worker budget are set by measurement, not by taste
    (2026-09-12).** The Gate 0 session and the Phase 1 session shared one
    five-hour limit window; Phase 1 ran out with steps 1.3 and 1.4 unfinished.
    Reconstructing both transcripts: 35.9M input tokens over 391 model
    messages, ~$52 cost-weighted. The Gate 0 session was 80.6% of it and the
    Phase 1 session 18.6%. Within that, the `/code-review` fan-out — eight
    Fable workers — was 28%, long-lived coding workers ~33%, and web research
    2.5%. 93% of all input was cache reads, i.e. re-billed context, so cost
    tracks context × turns rather than tool-call count; the worst worker ran
    40 turns at a median 144K context. Whole-file `cat`s were ~480K tokens of
    that context, the same file re-dumped up to 5×. The three changes in AGENTS.md —
    gate reviews and research off Fable, a ≤20-turn / ~80K budget per worker,
    and no whole-file reads — target 1, 2 and 3 in that order. Web-search
    volume was *not* the problem and is not capped; the research fan-out moved
    to Sonnet 5 because it summarises sources rather than writing product
    prose, not to save the 2.5%.

29. **Reference-collection function vocabulary.** `example_roles.function`
    and `climate_fields.transferable_functions` take values only from a fixed
    list (software, data, product, design, marketing, communications, sales,
    business-development, customer-success, operations, project-management,
    finance, accounting, legal, policy, people, research, engineering,
    field-technician, video-media, education, supply-chain) so `discover.ts`
    can match a person's function to fields without fuzzy matching. It is a
    review rule in `data/*.yaml` and CLAUDE.md, not a CHECK constraint, so a
    new function is one edit to both.

30. **Discovery is one structured call with server web tools, and re-runs
    are stable.** `discover.ts` calls `structured({ step: "discover" })` with
    `webTools()` in the same request (the API accepts both together); a 400
    falls back to a two-call design (research via `streamText`, then shape
    via `structured`) inside the same module. Every field and role written to
    the profile carries the reference-collection id in `extra.Ref`
    (`- **Ref:** offshore-wind`), which is how a re-run updates in place
    rather than adding an `F7` duplicate, and a re-run never moves a field the
    user set to accepted/rejected/unsure back to candidate. Recommendations
    that cite no active card or carry no non-blocked source are dropped and
    counted, never silently kept. Measured cost: ~$0.50 and ~3 minutes per
    profile at `high` effort, roughly half of it the cached catalogue block.
    (Web tools, the two-call fallback and the "no source → dropped" rule are
    retired by D44.)

    **An identity key is one thing.** Whatever key an apply-back path dedupes
    on must be the key it matches existing rows on, or two drafts survive
    validation and then collapse onto one profile row (Gate 1 finding).
    `identityKeys()` in `discover.ts` is the single owner of that key for
    fields and roles — ref first, then lowercased name, matching
    `findExistingField` / `findExistingRole`; `cardKey()` in `cards.ts` is the
    equivalent for card ids and is case-insensitive, so a model answering `c3`
    revises `C3` rather than both duplicating and excluding it. Refs are
    stored trimmed and compared trimmed on both sides. A draft that
    normalization *rejects* is a malformed answer, never a decision to
    exclude the card it addressed.

31. **One turn endpoint; the browser picks the step; NDJSON back.**
    `POST /api/turn` takes a `TurnRequest` (`session.ts`); `src/lib/turn.ts`
    dispatches on `step` and returns `{ message, profileMd, pills }` with the
    *whole* canonical `profile.md` every turn — the server keeps nothing. The
    wire format is NDJSON (`turn-stream.ts`): progress `delta`s while a slow
    step runs, an empty heartbeat delta every 15s so proxies never see an
    idle stream, then exactly one `final` or one `error`. The browser picks
    the step in `workspace.ts` (`nextStep`): paste → `cards`; a missing
    preference → `elicit`; no fields → `discover`; otherwise `explore`, and
    the Fields/Queries tabs force `explore`, `queries` and `revise`. Message
    conventions the server parses: `Explore F3: <name>` (first `F\d+` wins;
    no id → a "which field?" reply with pills, no model call), the
    `GENERATE_QUERIES_TEXT` sentence (routed to `queries` even on the
    `explore` step so the pill works after discovery), and "go". An
    elicitation pill click is applied by `applyPillAnswer` without a model
    call; free text goes through `interpretAnswer`. Errors reach the user
    only through `turnErrorMessage`: our own input errors verbatim, every
    model/SDK error as a fixed sentence, and the route logs the error *class*
    and step only. Gotcha: Next 16 refuses a route file whose `maxDuration`
    is an imported constant or that exports anything but segment config and
    handlers, so `route.ts` says `800` and `route.test.ts` pins it to
    `MAX_DURATION_SECONDS`.

32. **`boards.ts` is the client-safe owner of job-board text.**
    `BOARD_LABELS`, `ALERT_STEPS`, `BOARD_NAME_KEY`, `RETIRED_KEY` and
    `RETIRED_REASON_KEY` live in `src/lib/boards.ts` with no server imports,
    because client components cannot import `queries.ts`; `queries.ts`
    re-exports them. Steps 2.3 and 2.4 each wrote an `ALERT_STEPS`; the 2.4
    copy survived because it is phrased "look for…" so a board's UI change
    does not make it wrong. A revision never deletes a query: an untried one
    it retires keeps its id and gets `Retired: yes` plus a reason, and the
    Queries tab shows it struck through.

33. **Worker worktrees start from `main`, not the phase branch.** The Agent
    tool's `isolation: worktree` branched every Phase 2 worker from `main`;
    each had to `git checkout -b <step> phase-N` before starting, so the
    brief now says so. Those worktrees under `.claude/worktrees/` are full
    checkouts that ESLint walks (576 phantom errors), so `.claude/**` is in
    `globalIgnores`, and the orchestrator removes worktrees and their
    branches right after merging.

34. **One turn is in flight at a time, and the client owns abandoning it.**
    `Workspace` keeps a turn-generation counter and an `AbortController`: a
    reply only commits while its turn is still the current one, and "Start
    over" and import bump the counter and abort first, so a reply in flight
    cannot re-commit the server's `profileMd` over the session that just
    replaced it. A turn returns the *whole* `profile.md`, so the local profile
    edits (field status, card exclude, skill confirm/reject) are disabled
    while `busy` and refused by `editProfile` behind that; the send paths are
    guarded before the draft is cleared, so a refused send never eats what the
    user typed. A mid-stream failure is caught and shown as an error bubble —
    `send` is called as `void send(...)`, so an uncaught one would be silent.

35. **The blocked-host audit reads every segment of a call, not the last
    message.** `llm.ts` returns `messages` (each response of one logical call,
    `pause_turn` continuations included) alongside `message`, and
    `explore.ts` runs `assertNoBlockedFetches` over all of them: the paused
    segments are exactly where the server tools ran, so checking only the
    final response left the PRD guarantee (D13, D19) half-enforced. A
    client disconnect now stops the turn at the next step boundary — the
    route's progress callback throws once the stream is cancelled — but a
    model call already in flight still completes, which is `llm.ts`'s
    deliberate choice so the usage row stays exact. (Reversed by D45: the
    call in flight is now aborted.)

36. **Location and work mode are board filters, not elicitation questions.**
    `ELICIT_ORDER` is now `climateInterests`, `seniority`,
    `retrainingAppetite`: the initial conversation no longer spends a turn
    asking where someone wants to work or whether they want remote. Both stay
    `PreferenceKey`s in the `profile.md` contract — inferred from the resume
    by `inferPreferences`, editable in the Profile tab, and still settable
    from query feedback via `preferenceEdits` ("bad fit: these are all in
    Texas" is the user volunteering it, not us asking). What changed is that
    generated query strings carry no place names and no remote/hybrid
    wording; the queries prompt takes location and work mode as context for
    which fields and employers are realistic, never as literal query terms.
    `ALERT_STEPS` in `boards.ts` instead tells the person to set that board's
    own location filter and its remote/hybrid filter, in the "look for…"
    house style of D32 — every major board already ships those filters, and
    a filter the board maintains beats a term hacked into the keyword box.
    Elicitation completeness is therefore scoped to the asked keys
    (`isElicitationComplete` in `elicit.ts`, which `workspace.ts`'s
    `nextStep` now calls instead of `missingPreferences`), or a profile with
    no inferable location would never leave the elicit step.

    Whether these two should nonetheless be asked early for *some* fields is
    an open product decision, parked in `docs/backlog.md` §2. (Seniority
    is no longer asked either: D48.)

37. **Exploration-first UI from the design handoff (2026-09-20).** The
    field board is the product spine; chat is demoted to a right rail; there
    are no top-level tabs. The spec is
    `docs/design_handoff_climate_career_exploration/README.md` plus the
    prototype HTML read as markup, not ported: `support.js` is a prototype
    runtime and stays out of `src/`. Shipped as is: the colour, type,
    spacing, radius and shadow tokens (as CSS custom properties in
    `globals.css`), Instrument Sans and IBM Plex Mono through `next/font`,
    the three animations. Deliberately not shipped: the prototype state bar,
    the dark scheme (light-only until the design has one), a responsive
    layout below ~900px (the pilot is desktop Chrome), and the percentage fit
    bar (D39). States the handoff has none for: turn errors and parser
    warnings render as a bubble in the rail; the Fields step before
    discovery, and a discovery that returns zero fields, show a "Match
    fields" button with a one-line note. (The rail and the field board are
    replaced by one column and the Roles screen: D49, D50.)

38. **The flow is sequential and discovery is started by the user.** Start
    runs `cards` (which also infers preferences). The Highlights screen then
    asks the three preference questions in the rail; pill answers apply
    locally with no model call, so `interpretAnswer` is unreachable from the
    UI and stays for scripts and a later composer. "Match fields" runs
    `discover` and shows the pending screen. It never auto-starts: the person
    excludes highlights first, and discovery costs about $0.50. One turn in
    flight at a time stands (D34), so the handoff's concurrent matching,
    field counts ("5 of 6 in", "two more fields") and time estimates are not
    built; the pending screen shows elapsed time and the real progress lines
    the server streams. (Two questions now, inline on Highlights, and the
    button reads "Find climate roles": D48, D49. Superseded by D54: one
    optional question, and the button no longer waits for an answer.)

39. **The expanded field card renders from discovery data; explore leaves
    the beta path.** `discover.ts` gains, per field: `fitLevel`
    (`strong | some | stretch` — three labels drawn at three fixed widths;
    a model-produced percentage is false precision), `sector` (one line),
    `summary` (two sentences), `chips` (3–4 transferable skills), `evidence`
    (`{cardId, why}` per cited card, rendered as the evidence lines) and an
    `ask` (`{question, key, placeholder}`) attached to the uncertainty.
    `profile.md` gets them as known keys on fields (`Sector`, `Fit level`,
    `Summary`, `Chips`, `Evidence`, `Ask`), cards get an optional `Years`,
    and the fixtures are regenerated in the same commit. The first-run notes
    box is appended to the pasted text under a `Notes:` label and the cards
    step reads constraints from it into preferences. `explore.ts` and
    `try:explore` are kept but no UI path reaches them: the handoff has no
    place for example posts, keywords or day-to-day text. A "Dig deeper"
    button that fills a fourth block is backlog, and PLAN.md's alpha goal
    now counts expanded fields, not explored ones. (The expanded card is
    gone; the same discovery data renders as a field heading on the Roles
    screen: D50. Explore still has no UI path.)

40. **Queries are written per field from the roles the person ticked.**
    Roles get a `Selected: yes | no` key. The expanded card's CTA sends a
    `queries` turn naming one field (a new `TurnInput` kind carrying the
    field id; the `GENERATE_QUERIES_TEXT` sentence convention is retired).
    The call returns exactly three queries, one each for linkedin, indeed
    and climatebase, every one serving that field only — never a query
    across fields, because boards rank against a coherent role profile. The
    2–4-per-board, twelve-total batch over accepted and unsure fields is
    retired. The field's mark (Interesting / Unsure / Not for me, stored as
    the existing `accepted | unsure | rejected` statuses) and its selected
    roles go to the prompt as context, and the Searches screen orders groups
    Interesting first. Revision (D32) is unchanged. (Superseded by D47.)

41. **Feedback keeps the good/bad contract; accept-or-keep is a whole-turn
    undo.** The four verdicts map to `good` (Good fit) and `bad` (Partly
    right, Wrong roles, No results); the verdict label and the reason chips
    are prefixed into the `reason` text, so `QueryFeedbackSchema` and the
    revise prompt do not change. The browser keeps the pre-turn `profileMd`:
    "Accept and use" keeps the returned profile, "Keep the old one" restores
    the snapshot, and editing the revised text is a local `setQueryText`
    edit. Copy timestamps ("copied 6 min ago") are client state only.
    (Superseded by D51: feedback has no UI path in the alpha. Copy
    timestamps remain client state.)

42. **No free-text composer in the beta.** The rail holds the preference
    questions, the per-field asks, the working log, errors and warnings, and
    a "Change an answer" row that re-shows the preference pills (local, no
    model call). Free text would need a general chat step — a new
    `StepName`, the `llm_usage` CHECK migration (D22), a prompt module — and
    would expose an open model chat behind the passcode. Fellows' feedback to
    the builder goes through the external form link from step 3.3, never
    through the app. The profile drawer is a read-only view with export,
    import and delete: a hand edit of the whole file would need a re-run and
    can break the sections the app writes. Corrections happen through the
    UI: the card Edit form, Exclude, the marks, and "Change an answer".
    User control over the profile (PRD) is met by those, and by export. A
    scoped "ask about the open field" step (read-only, no tools) is the
    first candidate after the pilot starts; it is in `docs/backlog.md` §5.
    (The rail is gone, D49, and the marks and feedback with it, D50, D51;
    no composer and the read-only drawer stand.)

43. **A per-field ask writes a preference and does not re-rank.** Answering
    a field's question appends `<key>: <answer>` to the profile's other
    preferences locally, opens the drawer to show it, and flips the field's
    button to "Noted". No model call; the next discovery or revision reads
    it. The handoff's "it sharpens the ranking" is not promised in copy.
    (The ask is now a text box under the field heading on the Roles screen,
    with "Save answer"; the no-re-rank rule stands: D50.) (Superseded by
    D57: the ask is no longer shown; discovery still writes it.)

44. **Opus 5.5 at `medium`, and discovery recalls rather than searches
    (2026-09-24).** Discovery took 157–252s on Opus 5 at `high` with up to
    8 searches and 4 fetches, grew with each field key 2b.2 added, and ran
    into both a 300s non-streamed request timeout and its 16K output cap. One
    run per variant on the videographer fixture (§6): Opus 5.5 at `medium`
    with the same tools took 109s and $0.40; with no web at all, 65s and
    $0.20, with the same six fields and every fit level kept. So:
    - The model was `claude-opus-5-5` for every call (priced $4 / $20 per
      MTok, cache read $0.20, 5-minute cache write $5); D46 moved `queries`
      and `revise` to Sonnet 5.5, and discovery stays on Opus 5.5. Opus 5.5
      rejects disabled thinking and defaults to `medium`, so every call
      still sets effort explicitly.
    - `discover` joins `cards` and `elicit` at `medium`. `queries` and
      `revise` stayed `high` here: short calls, not re-measured (now
      `medium` on Sonnet 5.5: D46).
    - **Discovery has no web tools.** The baseline is how well Opus 5.5
      does from the reference collection plus what it already knows. A
      larger catalogue of roles and occupations is the planned next source;
      unbounded web search is unlikely to return. The two-call fallback
      (which existed only because server tools and structured output might
      not combine) and its research prompts are deleted.
    - **Sources are catalogue URLs only.** With no search, any other URL is
      one the model remembers, and a remembered URL can be wrong. The
      validator removes and counts every source the catalogue does not
      list. A field or role outside the catalogue is kept with no sources —
      it is named from the model's knowledge — so D30's "no non-blocked
      source → dropped" rule is retired; the card-citation rule stands.
    - `explore.ts` keeps its web tools; no UI path reaches it (D39).

    Re-check with the Phase 3 evals (3.1): if recalled fields turn out
    wrong or generic, the catalogue comes first, then bounded search.
    (Superseded in part by D61: the app no longer reads the catalogue, and
    "sources are catalogue URLs only" now describes the catalogue arm.)

45. **Every model call streams, has a 3-minute deadline, and stops when the
    browser goes away (2026-09-24).** Supersedes D27's timeout arithmetic and
    reverses D35's "a call in flight still completes".
    - `structured()` streams like `streamText()` (`messages.stream()` +
      `finalMessage()`), so no HTTP timeout sits under a long answer and
      the SDK can no longer silently restart one at 300s. Both shapes share
      a 32K output cap.
    - `CALL_TIMEOUT_MS = 180_000` bounds one logical call — every attempt,
      retry and `pause_turn` continuation — through one `AbortSignal`;
      past it the call fails with `LlmTimeoutError` and the user sees a
      fixed sentence. Measured calls run 15–110s. `REQUEST_TIMEOUT_MS`
      equals it, and `maxDuration` stays 800s because a turn makes a few
      sequential calls.
    - `CallRequest.signal` aborts a call (`LlmCancelledError`). The turn
      route fires it when the response stream is cancelled or the request's
      own signal aborts; `runTurn` wraps each step's `Llm` in `withSignal`,
      so the step modules pass it on without knowing about it. Leaving the
      page mid-discovery no longer pays for the whole call.
    - An aborted call still writes its one usage row (D21). The stream's
      `message_start` gives input and cache tokens, and `message_delta` the
      running output count; output tokens generated after the last delta
      are not reported, so an aborted row undercounts output. A call aborted
      before any response started writes no row.

46. **Model per step: `queries` and `revise` on Sonnet 5.5 at `medium`
    (2026-11-18).** (Superseded by D52.) Decided after the first browser run. Writing one search
    string per role is short, constrained work, and Sonnet 5.5 is $2 / $10
    per MTok against Opus 5.5's $4 / $20. Narrows D44's "Opus 5.5 for every
    call"; discovery on Opus 5.5 at `medium` with no web tools stands.
    - `MODEL` becomes `MODEL_BY_STEP` in `llm.ts`: `queries` and `revise` →
      `claude-sonnet-5-5`; `cards`, `elicit`, `discover` and `explore` stay
      `claude-opus-5-5`. Change the table, not the call sites.
    - `EFFORT_BY_STEP.queries` and `.revise` go from `high` to `medium`.
      Sonnet 5.5 defaults to `high` and Opus 5.5 to `medium`, so effort
      stays explicit on every call. Adaptive thinking, structured outputs,
      streaming, the 32K cap and the D45 deadline apply to both models.
    - `PRICE_PER_MTOK` is keyed by model id. Sonnet 5.5: input $2, output
      $10, cache read $0.10, 5-minute cache write $2.50. `costUsd` takes
      the model that ran; an unpriced id throws `LlmConfigError` rather
      than pricing a call at zero.
    - The usage row's existing `model` column says which model ran; no
      column is added. `pnpm smoke:llm` is now a `queries` call and fails
      unless its row says `claude-sonnet-5-5`.

47. **One LinkedIn query per selected role; the `queries` turn takes no
    field (2026-11-18).** Decided after the first browser run (2026-11-17):
    the person chooses roles, not fields (D50), so a search is written for
    each role they tick; LinkedIn returned accurate results, and the other
    two boards were not run. Supersedes D40's per-field, three-board
    generation.
    - A query carries a `Role` key (`- **Role:** R3`, the role it was
      written for); `Fields` keeps that role's field.
    - `QUERY_BOARDS` is `["linkedin"]`. Indeed and Climatebase searches are
      out of the alpha and in `docs/backlog.md` §3; `boards.ts` keeps their
      alert steps as data. Queries on other boards written before this
      decision stay in the file untouched.
    - The `queries` turn input is `{ kind: "selectedRoles" }` with no
      payload. `generateQueries({ sessionId, profile })` makes one model
      call for every role with `Selected: yes` across all fields; a field's
      status is not consulted. The output schema is built per call and
      keyed by role id, so exactly one draft comes back per role. The
      message carries the person's expertise and climate interests and,
      per field, its sector, summary, fit, chips, the answer to its ask and
      the searches already judged in it.
    - Each role's first untried query is replaced in place (same `Q` id),
      further untried ones for that role are retired as superseded, judged
      queries are never touched, and queries of roles no longer ticked are
      left alone. A draft that is empty or repeats a judged query fails the
      run rather than leaving a role without a search.
    - `workspace.ts`: `canWriteQueries(profile)` (at least one selected
      role), `selectedRoles`, `liveQueryForRole`,
      `buildSelectedRolesTurnInput`. `pnpm try:queries <profile.md>` takes
      no field id.
    - `revise` stays dispatchable and tested, restricted to LinkedIn; a
      revised query keeps the role of the one it replaces (D51).

48. **Seniority is out of the questions and out of role titles; skills are
    areas of expertise (2026-11-18).** The first run showed role titles
    headed by a rank ("Director of …") that a career switcher is unlikely
    to be hired into, level words that narrow a search, and skills written
    as tool names or STAR verbs that read as noise
    (`docs/ux-review-2026-11-17.md` §2, §3). Narrows D36 and D38.
    - `ELICIT_ORDER` is `climateInterests`, `retrainingAppetite`. Both are
      answered by pills alone; no question invites typed text. `seniority`
      stays a `PreferenceKey` on the profile and `inferPreferences` may
      still fill it from the cards, but nothing reads it. (Superseded by
      D54: one optional, multi-select interest question; retraining is no
      longer asked.)
    - Discovery asks for plain occupations. A post-check
      (`stripLevelWords` in `discover.ts`) strips level modifiers from role
      titles, dedupes roles within a field after stripping, and drops a
      role whose title is headed by a rank (Director of…, Head of…, VP…),
      counted in `dropped.rolesLevelTitled`. The discover prompt says
      "companies", not "employers"; `Role.companies` is unchanged.
    - Query text carries no level words either (`queries.ts` uses the
      level lists `discover.ts` owns); LinkedIn's own experience-level
      filter does that job.
    - Card skills are areas of expertise: short domain-level phrases, at
      most six words, never tool names or STAR verbs. Highlights shows
      them first, as "Your expertise". (Superseded by D53: headed
      "Skills", accepted unless removed.)
    - Seniority as an explicit choice on the Roles screen is in
      `docs/backlog.md` §1.

49. **One column, no rail; the profile drawer is a readable summary
    (2026-11-18).** The first run found that the rail held the questions
    that unlocked progress while the button they unlocked sat about
    1,900px down the main column, and that the rail was mostly empty after
    Highlights (`docs/ux-review-2026-11-17.md` §1). The raw `profile.md`
    in the drawer read as a developer tool (§3). Supersedes D37's rail and
    D42's rail contents; D42's no-composer and read-only-drawer rules
    stand.
    - `Rail.tsx` is deleted. The header carries the nav (1 Highlights,
      2 Roles, 3 Searches), "Your profile" and "Start over" (confirm, then
      clear this browser's copy, then first run). (Superseded by D55: four
      unnumbered items, and "Start over" only on the Resume page.)
    - Highlights holds the expertise block, collapsed cards with S/A/R
      behind "Details", the two questions inline (superseded by D54: one
      optional question), and one "Find climate roles" button. Its label is `FIND_ROLES_PILL` in `screens.ts`, which
      `turn.ts` re-exports as `GO_PILL`.
    - Pending, errors and parser warnings render in the main column. The
      assistant message a turn returns is no longer shown.
    - Every input has an `InfoTip` saying what it changes. (Superseded by
      D57: the info icons are deleted.)
    - The drawer renders `profileSummary()` from `profile-summary.ts`:
      plain labels, no ids or schema keys. Export (raw `profile.md` and the
      session JSON), import and the raw file sit behind an "Export"
      disclosure.
    - Copy rule from the review: if the user cannot see it elsewhere on
      screen, the interface does not refer to it.

50. **Roles, not fields, are the unit of choice; fields are headings with
    no marking (2026-11-18).** In the first run the Interesting / Unsure /
    Not for me row rendered broken on every card and had no visible
    effect; the choice that produced searches was ticking roles
    (`docs/ux-review-2026-11-17.md` §2, §4). Supersedes D39's expanded
    field card and D40's field marks; D43 stands.
    - `RoleBoard.tsx` and `RoleGroup.tsx` replace `FieldBoard.tsx` and
      `FieldCard.tsx`. Each field is a heading (name, sector, fit, summary,
      "Draws on: <card titles>", uncertainty, and the optional ask as a
      short text box saved with `addOtherPreference`, no re-rank) with its
      roles beneath as rows with a checkbox. (Superseded by D57:
      no sector line and no ask; "Based on" replaces "Draws on".)
    - Card ids in a role's why are rendered as card titles
      (`citationsToTitles` in `screens.ts`); prompts still cite by id.
    - No marks, no rank numbers, no per-field write button. One sticky
      button, "Write LinkedIn searches for N roles".
    - Field `Status` and its values stay in the `profile.md` contract;
      nothing in the UI writes them now.
    - **Open, to revisit:** how the user tells us whether a field interests
      them at all, now that the marking row is gone (`docs/backlog.md` §2).

51. **Query feedback and revision have no UI path in the alpha
    (2026-11-18).** In the first run, rating a search meant choosing twice
    with different words, and nothing told a revised query apart from the
    old one (`docs/ux-review-2026-11-17.md` §4, §5). Getting that right is
    its own design problem, so the alpha ends when the person has run the
    LinkedIn searches. Supersedes D41.
    - `Feedback.tsx` and the verdict, revision and snapshot helpers in
      `screens.ts` are deleted; `View` has no feedback panel.
    - `revise` is kept on the server like `explore` (D39): dispatchable,
      tested, restricted to LinkedIn, and reached only by
      `pnpm try:queries --revise`. The `feedback` turn input and
      `QueryFeedbackSchema` are unchanged.
    - The feedback loop (what is rated, where, what a rating may change,
      how a revision is shown) is its own later milestone,
      `docs/backlog.md` §4.

52. **Searches (`queries`, `revise`) run on Opus 5.5 at `medium` again
    (2026-11-20).** Reverses D46. In the 2026-11-19 browser run the
    searches Sonnet 5.5 wrote paired a role's title with generic climate
    terms ("green jobs", "climate careers") instead of the field's own
    vocabulary, so they were too general to be worth the saving.
    - `MODEL_BY_STEP.queries` and `.revise` → `claude-opus-5-5`; all six
      steps now run on Opus 5.5 (D62 then moves `discover` to Fable 5.2).
      `EFFORT_BY_STEP` is unchanged: `explore`
      `high`, every other step `medium`, always sent explicitly.
    - The `ModelId` union and the Sonnet 5.5 row in `PRICE_PER_MTOK` are
      kept, so a later switch is a one-line table change. `costUsd` still
      prices each call by the model that ran.
    - `pnpm smoke:llm` stays a `queries` call and now fails unless its row
      says `claude-opus-5-5`.

53. **Skills are accepted unless removed (2026-11-20).** Decided after the
    2026-11-19 browser walkthrough: asking the person to keep or remove
    each inferred skill read as doubt about their own experience, and an
    untouched skill was silently dropped. Before this, an inferred skill
    the person never confirmed reached neither discovery nor the search
    prompts, so this changes what both see.
    - `activeSkills(p)` in `profile.ts` (`confirmed` then `inferred`,
      deduplicated case-insensitively, minus `excluded`) is the one list
      prompts and screens read: `renderPreferencesForDiscover`, the
      `# Skills` block and `Areas of expertise` line in `queries.ts`, the
      Highlights screen and the drawer summary.
    - The three buckets stay in `profile.md`; no format change and no
      fixture regeneration.
    - `confirmSkill` (`cards.ts`) and `confirmProfileSkill` (`workspace.ts`)
      are deleted; `restoreSkill` / `restoreProfileSkill` are added so a
      removal can be undone.
    - Highlights shows one "Skills" row under the note "Inferred from your
      resume.", each tile with a single ×; removed skills follow as muted,
      struck tiles with a + to add them back. No ✓ and no info icon;
      `INFO_TIPS.removeSkill` is deleted. The drawer lists one skills
      section with removed ones struck.
    - The copy follows `docs/design-language.md` principle 6 (trust the
      inference; the reader removes, never confirms) and principle 7
      ("Skills", not "Your expertise").

54. **One optional, multi-select interest question; no retraining question
    (2026-11-20).** Decided after the 2026-11-19 browser walkthrough: two
    required questions held the button back, the retraining pills asked
    the person to rate themselves before seeing a single role, and the
    interest pills came from the catalogue's coarse `sector_group`s with a
    "Not sure yet" escape. Supersedes the two pill-only questions of D48.
    - The Highlights screen asks one question, "Which area of climate work
      interests you most?" (`QUESTION_LABELS.climateInterests` in
      `screens.ts`), under the note `INTEREST_NOTE`, with six fixed
      `aria-pressed` toggle pills: `CLIMATE_AREAS` in `elicit.ts`, label and
      value the same. Any number may be picked; there is no "Not sure yet"
      pill, because picking nothing means "rank on fit alone".
      `toggleClimateInterest` (pure, case-insensitive) writes a pick
      locally with no turn; removing the last one deletes the preference.
      `ELICIT_ORDER` is `["climateInterests"]`.
    - `findRolesGate` needs only one active highlight; its enabled note is
      "You can come back and change any of this." (principle 9 in
      `docs/design-language.md`: reversibility, not duration).
    - Interests rank, never filter (design-language principle 2).
      Discovery rule 5 as shipped defines "comparable" fit as fit level
      `strong` or `some`: every field in a named area at those levels ranks
      above every field outside; only a `stretch` field in a named area
      gives way. A named area never removes a field, and the model judges
      which area a field belongs to from the work, not from the
      catalogue's coarser `sector_group`.
    - Live check (2026-11-20, videographer fixture,
      `--interest="Energy,Carbon Removal"`, $0.24, 80s): six fields, the
      four in the picked areas first, the two outside fields still listed.
      A first run with the looser wording interleaved outside fields, which
      is why "comparable" was defined.
    - The retraining question is gone. `retrainingAppetite` stays a
      preference key that discovery reads; it is filled from the notes
      box, and `inferPreferences` may still infer it from the cards at high
      confidence. `inferPreferences` no longer writes climate interests, so
      a pick is always the person's own, and it makes no call when only
      climate interests are missing.
    - Discovery's `summary` must not repeat or paraphrase the field's name:
      it is shown directly under it (2b.18 keeps the summary on the Roles
      screen).
    - `try:discover` takes `--interest=<comma-separated areas>`;
      `--retraining` is gone. `listSectorGroups` is deleted, and the cards
      turn no longer carries sector groups to the browser
      (`QuestionContext`, `QuestionView.answer`, `answerRows`,
      `INFO_TIPS.answer` are deleted from `screens.ts`; `interestPills`
      renders the six pills with their pressed state).

55. **A four-item nav and a Resume page that holds "Start over"
    (2026-11-20).** From the 2026-11-19 browser walkthrough.
    - The nav is Resume · Highlights · Roles · Searches (`NAV_STEPS`,
      `NAV_LABELS` in `screens.ts`): no numbers, always shown, steps not yet
      reached disabled, every reached step a link back. This fixes the
      Highlights item, which landed on Roles once fields existed. The
      `firstRun` screen is renamed `resume`.
    - The Resume page (`ResumeScreen.tsx`) has two states, chosen by
      `resumeView` in `screens.ts`. Before any card: the entry form, both
      boxes starting from `profile.inputs` (non-empty only when an earlier
      Start failed), each with one visible label and no placeholder. Once
      cards exist: the stored resume and notes read-only, or "This profile
      was saved without its resume text." for a profile saved before D56;
      editing the resume and reading it again is not built
      (`docs/backlog.md` §1).
    - "Start over" lives only on the Resume page, behind a native `<dialog>`
      (`StartOverDialog.tsx`, `showModal()`, no `window.confirm`) that
      offers "Download profile" first: the same JSON the drawer's Export
      writes and Import reads back (`saveSessionExport` in
      `src/components/shell/save-file.ts`).
    - The green mark is removed from the header. Re-running discovery from
      Highlights updates the roles; the note under the button says so.

56. **What the person types is kept in the profile (2026-11-20).** The
    user's decision: inputs are stored in the profile alongside selections,
    "so the user can always see what they've input and it lets the user
    revisit prior pages". This reverses the earlier stance that the pasted
    text is not kept.
    - `## Inputs` is the eighth section, between `## Queries` and
      `## Session Notes`, with `### Resume` and `### Notes`. Every line is
      written as a `> ` quote (a blank line as a bare `>`), so pasted
      markdown is never read as profile structure; reading strips exactly
      one `>` and one space. Unknown `###` blocks under it survive a round
      trip, so a later input needs no format change.
    - Normalisation (`normalizeInputText`): CRLF and CR become LF, trailing
      whitespace per line and outer blank lines are dropped.
    - The browser writes it when Start is pressed (`recordStartInputs` in
      `workspace.ts`), before the turn is sent, and sends the turn from
      that recorded state, so a failed read keeps what was typed. Nothing
      is recorded when the text exceeds the message cap. The cards step
      still reads its text from the message.
    - No prompt reads `inputs`: the raw resume carries contact details, and
      the cards are what every later step reasons from.
      `serializeProfileForPrompt` omits the section, and marker tests pin
      all five prompts (elicit, discover, explore, queries, revise).
    - It stays in `localStorage` with the rest of the profile and travels in
      each turn's request body; the server remains stateless and logs no
      bodies.

57. **Highlights, Roles and Searches say each thing once (2026-11-20).**
    From the 2026-11-19 walkthrough, and the user's answer that the field
    summary stays. Applies `docs/design-language.md` principles 3 ("say a
    thing once per screen"), 10 ("evidence behind a click"), 11 ("do not
    interrupt a choice with a question") and 12 ("simplify first"); mostly
    deletions. Supersedes the inline ask of D43 and D50, D50's "Draws on",
    and D49's info tips.
    - **Roles:** under a field title only the fit label, the move label,
      "Based on" and the two-sentence summary remain, then "Not sure yet:".
      The sector line restated the title and went. The follow-up question
      (question, textarea, "Save answer", "Change") interrupted a
      selection screen and went; discovery still writes `Sector` and `Ask`
      to the profile and `addOtherPreference` stays in `profile.ts`, with
      their fate in `docs/backlog.md` §2, §4. The summary stays because it
      says what the work is and why the person fits, which the title does
      not (discovery is told not to restate the name, D54).
    - **"Based on" replaces "Draws on":** a disclosure button
      (`aria-expanded`) on the fit row; expanded, one line per cited
      highlight, in citation order and deduplicated by card: its title and,
      where the field has an evidence line for that card, that sentence
      with card ids rendered as titles. `RoleGroupView.basedOn` in
      `screens.ts`; `ask`, `askAnswer` and the `onAnswerAsk` prop chain
      are deleted.
    - **Footer button:** "Write LinkedIn searches" at zero, with "Tick at
      least one role first." beside it; "… for N roles" otherwise, with no
      note, so "N roles ticked" no longer repeats the button's count. Same
      in the Searches screen's "no search yet" block.
    - **Highlights:** the lead says what highlights are for ("Every
      suggested field and role is tied to at least one highlight. Skills
      sum up what you know across them and shape your searches."); the
      "N of M highlights used to match roles" note is gone. Years are off
      the cards, the editor and the drawer summary; `Years` stays on the
      card in `profile.md`, the cards prompt still fills it and an edit
      keeps it.
    - **Searches:** the "Get new matches by email" disclosure is off the
      search card; `ALERT_STEPS` stays in `boards.ts` as data.
    - **Info icons** are deleted outright (`InfoTip.tsx`, `INFO_TIPS` and
      their CSS): each one repeated the page or the button it sat on.

58. **The latest discovery run is the person's list (2026-11-21).** A
    re-run used to upsert only what it returned, so fields and roles from
    earlier runs stayed on the Roles screen in their old order, ticks
    included, and "Write LinkedIn searches" still wrote a search for a role
    resting on a highlight the person had since excluded (Gate 2b code
    review). Since D50 no screen can remove a field, so nothing else could
    clear them.
    - `applyDiscovery` moves the fields a run returns into that run's rank
      order and marks every field and role it did not return
      `- **Dropped:** yes` (`DROPPED_KEY`, `isDropped` in `profile.ts`),
      un-ticking the role. A field or role the next run returns again loses
      the mark. Ids are kept, never deleted, so queries that cite them still
      resolve and no id is reused.
    - `roleGroups` and `selectedRoles` leave dropped items out, so the Roles
      and Searches screens, the drawer and query writing all see the latest
      run only. A run that writes no field leaves the profile as it was.
    - Revision (`queries.ts`) now reads every field that is not rejected:
      with no screen marking fields, discovered ones stay `candidate`, and
      the old accepted-or-unsure filter left revision with no field to add a
      search for.

59. **The research link check is a dev-only fetch path (2026-11-23).**
    Phase 2c requires every URL in `docs/research/` to resolve and none to
    sit on a blocked domain. `pnpm research:check-links`
    (`scripts/check-research-links.ts`, pure parts in
    `src/lib/research-links.ts`) is the one fetch path outside
    `src/lib/llm.ts`, allowed because it is a script no route can reach
    and it reads nothing but a status code and a redirect's `Location`.
    - A blocked URL (`isBlockedSourceHost`, the same list as D13 and D25) is
      never requested and fails the check. Redirects are followed by hand,
      each hop's host checked before it is requested, so a redirect onto a
      blocked host fails without reaching it.
    - HEAD first, one GET retry with the body cancelled unread; a generic
      user agent; 45s per URL (Eurostat pages take ~30s); 8 at a time.
    - 2xx/3xx pass. 401, 403 and 429 are reported as "refused" (the site
      answered but declines automated checks) and do not fail the run; the
      gate report lists them. Anything else fails.

60. **Reference research works from datasets, not reports (2026-11-23,
    gate G2c.1).** The 2c.1 survey showed that the jobs reports either
    carry no occupations or derive them from a few datasets (O*NET, BLS,
    ILOSTAT). Fields and roles are therefore identified from datasets read
    through their APIs or an MCP server. The O*NET database is the main
    starting point, extended by BLS and ILOSTAT; the OECD's datasets are
    derived from its publications and from O*NET and BLS, so they are
    explored as a separate side step (2c.3b), not as the backbone. No worker extracts figures or lists from
    an analysis page or a report; a report is named only as how a dataset
    was found. This replaces the per-area report backbone proposed in
    the 2c.1 recommendation (archived, gitignored, in
    `docs/archive/2c.1-source-survey/`; committed copy at `9bad65f`). Which further datasets join
    (ESCO, the EU Taxonomy, any OECD table) is settled at G2c.2, after the 2c.3
    exploration. A script that calls these APIs is a dev-only fetch path
    like D59: no route can reach it, and it refuses blocked hosts.

61. **Memory-only discovery is the app's behaviour and the baseline arm
    (2026-11-25, step 2d.2).** The evaluation that follows the demo holds
    the pipeline constant and changes only what the model is given:
    nothing, then the O*NET-based catalogue from Phase 2c, then whatever
    comes after. The app runs the first arm.
    - A model-generated shared catalogue was considered and rejected: it
      would be a middle arm (model plus model-written data), not the floor.
    - **No URL from memory, ever.** The memory schema
      (`DiscoverOutputSchemaMemory`) has no `ref` and no `sources`, and the
      validator strips any URL from the free text of fields and roles,
      counted in `textUrlsStripped`. No `Ref` and no source is written.
    - Example companies are plain text, never links: well-known
      organisations the model is sure exist, in the US or the EU, or an
      organisation type ("a utility's grid-planning team") rather than a
      guessed name; organisations, never people (D6).
    - The prompt (`DISCOVER_SYSTEM_PROMPT_MEMORY`) frames climate work by
      ten areas, the six `CLIMATE_AREAS` plus Climate Finance, Industry &
      Materials, Nature & Water, and Corporate Sustainability & Climate
      Services, so coverage does not depend on the six interest pills.
    - The catalogue path stays behind `DiscoverOptions.catalogue`
      (`DISCOVER_SYSTEM_PROMPT_CATALOGUE`, byte-identical to the old
      prompt), reached only by `pnpm try:discover --catalogue` and the
      evaluation, the way `explore` and `revise` are script-only (D39,
      D47). The reference tables, `pnpm seed` and `pnpm db:check-rls` stay.
    - 2c.8 feeds the evaluation's catalogue arm; the app switches to it
      only if the evaluation says so.

    Supersedes D44's "sources are catalogue URLs only" for the app; it now
    describes the catalogue arm.

62. **`discover` runs on Claude Fable 5.2 at `medium` (2026-11-25, step
    2d.1).** `MODEL_BY_STEP.discover` is `claude-fable-5-2`, priced $8 /
    $40 per MTok, cache read $0.20, cache write $10 (`PRICE_PER_MTOK`,
    from the model table checked 2026-11-25). The other five steps stay on
    Opus 5.5 (D52). The request shape is unchanged: adaptive thinking,
    structured output, streaming. No server-side fallback: a refusal is
    `LlmRefusalError` and the usual error banner. Fable 5.2 needs an
    Anthropic organisation with 30-day data retention (`docs/deploy.md`).
    The 3-minute deadline is unchanged: the two measured memory-mode
    discovery calls took 61.5s and 78.8s (§6), and it would have been
    raised for `discover` alone had one passed 150s.

63. **Supabase keys use the publishable / secret names (2026-11-25, Phase
    2d deploy prep).** Supabase replaced the legacy anon and service-role
    JWT keys with a publishable key (`sb_publishable_…`) and a secret key
    (`sb_secret_…`), and the local CLI prints both as `PUBLISHABLE_KEY` and
    `SECRET_KEY`. The env vars are renamed to match:
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`. Each
    new key runs as the same Postgres role as the key it replaces (`anon`,
    `service_role`), so RLS, the migrations and `pnpm db:check-rls` are
    unchanged. `anonClient()` and `serviceClient()` keep their names because
    they name the role, not the key. Applied migrations still say "anon key"
    in comments; they are never edited.

64. **The turn route waits for its usage rows before the function ends
    (2026-11-25, Phase 2d).** In production a full run left `cards` and
    `elicit` rows but none for `discover` or `queries`, the last call of
    their turns. The likely cause (Vercel logs were not available): the
    usage insert was fire-and-forget, the route closed the response right
    after the last call, and Vercel suspended the function before an insert
    on a cold connection completed. `recordUsage` in `llm.ts` still never
    blocks the call, but tracks each write until it settles;
    `usageWritesSettled(timeoutMs = USAGE_FLUSH_TIMEOUT_MS)` (5s) resolves
    when every write pending at call time has settled or the timeout
    passes, and never rejects. `/api/turn` calls `after()` from
    `next/server`, whose callback waits for the turn's stream `start` to
    finish (its `finally`, so the disconnect path is covered too, D45) and
    then awaits `usageWritesSettled()`. The response body is never delayed;
    only the invocation is extended, by at most 5s. No dependency added
    (`after` uses the platform's `waitUntil`).
65. **A turn waits only for its own usage rows, and memory mode strips URLs
    from every rendered string (2026-11-26, Gate 2d code review).**
    `recordUsage` also files each write under the call's abort signal, and
    `usageWritesSettled(signal?, timeoutMs)` with a signal waits only for
    those writes, so on Fluid compute one turn is never held up to 5s by
    another turn's insert; `/api/turn` passes its `abort.signal`, which
    `runTurn` puts on every call (D45). The route resolves `turnDone` first
    in its `finally`, so nothing that throws there can leave `after()`
    waiting until `maxDuration`. In memory mode (D61) field names and role
    titles go through `stripUrls` too, a field left with no name is dropped
    as surplus, and `textUrlsStripped` counts only kept fields and roles.
    `stripUrls` ends a link at a comma or semicolon before a space, the end
    or a card ID (so "https://a.org,C1" keeps its citation), keeps a
    balanced "(…)" inside a link, removes bracketed link lists with their
    separators, and treats "source" and "link" as lead-ins only with a
    colon ("open source" survives); "at" and "via" still go with the URL
    that is their object. `turnErrorMessage` keeps its `ReferenceReadError`
    sentence: `explore`, which only scripts send (D39), still reads the
    reference tables through the route.

66. **A link needs no scheme, and text is stripped of URLs in both
    discovery modes (2026-11-26, Gate 2d code review, second pass).**
    `stripUrls` and `hasUrl` used to see a link only where it began with
    `http(s)://` or `www.`, so "rmi.org/insights" in a field's summary was
    shown, and `try:discover` passed it. A bare host followed by a path now
    counts as a link (`BARE_LINK_RE` in `discover.ts`); the slash is what
    makes it one, so "350.org" alone stays a name. Three guards keep
    ordinary prose out: the host is lower case ("ASP.NET/C#" is a skill),
    it ends in a top-level domain from a fixed list ("node.js/typescript"),
    and the path starts with a lower-case letter or a digit
    ("350.org/Sunrise Movement" is two organisations). A link on a
    top-level domain outside the list, written with no scheme, still gets
    through; the list is the place to add one. Catalogue mode used to
    filter only `sources`, so a URL the model wrote into a fit, summary or
    why was written to the profile, against what D44 and D61 say.
    `validateOutput` now runs every draft through `prepareDraft` (was
    `memoryDraft`), which strips URLs from the same strings in both modes
    and keeps a catalogue draft's refs and `sources`; `textUrlsStripped`
    counts both modes, and `try:discover --catalogue` fails on a URL in the
    text as memory mode does. The catalogue arm's request (prompt, message,
    schema) is unchanged. Not done here: a memory-mode re-run still matches
    a kept field or role by its exact name or title (`docs/backlog.md` §2,
    "A re-run keeps a role only if its wording is unchanged").

67. **Each access code has a dollar cap, kept as one running total in
    `access_codes` (2026-11-26, Phase 2e.1).** The new table
    `public.access_codes` has five columns: `code_key` (the first 32 hex
    chars of the SHA-256 of a generated code, pinned to that shape by a
    CHECK; the code itself is never stored), `cap_usd`, `spent_usd`
    (default 0; both non-negative and not NaN by CHECK), `disabled` and
    `created_at`. The table is closed: RLS on, no policies, every grant
    revoked from `anon` and `authenticated`. The app reaches it only
    through two SECURITY DEFINER functions (`search_path = ''`, EXECUTE
    revoked from PUBLIC and granted to `anon` and `authenticated`), called
    with the publishable key: `access_code_budget(key)` returns one
    `(cap_usd, spent_usd, disabled)` row for a known key and none for an
    unknown one, and `access_code_add_spend(key, usd)` adds to the total in
    one atomic UPDATE, raises 22023 for a null, negative, NaN or infinite
    amount, and does nothing for an unknown key. Anyone can call them, but
    only with a 32-hex key they cannot guess, so the worst a tester can do
    with their own key is use up their own budget. There is no label
    column, nor a name, session id or time of last use: nothing
    server-side holds free text, and who holds which code is known only to
    the operator, outside the repo and the database. The per-session cap
    planned for step 3.3 (D4, and the comment in the `llm_usage`
    migration) is dropped: the session id is made in the browser and
    "Start over" makes a new one, so a cap keyed on it stops nobody.
    `llm_usage` is untouched and no usage row is linked to a code (D22
    stands). The data rule now reads, as approved by the user on
    2026-11-26: "There are two server-side writes: the anonymous
    `llm_usage` row, and one running dollar total per access code
    (`access_codes.spent_usd`). Neither holds content or identity. An
    access-code row is a derived key, a cap, a total, a disabled flag and a
    creation time." `src/lib/budget.ts` is the ledger over the two
    functions: `BudgetLedger` (`read`, `addSpend`), `supabaseBudgetLedger`
    (through `anonClient().rpc`), `memoryBudgetLedger` (mirrors the SQL,
    for tests), `budgetVerdict` (null or disabled is `inactive`, at or
    over the cap or non-finite is `exhausted`) and `BudgetLedgerError`,
    which carries the error code only and is never logged with a key. The
    cap value is never written into code: it is an argument to the
    operator's script that step 2e.2 adds. `pnpm db:check-rls` asserts the
    closed table and the functions' behaviour (group f).

68. **Each invited person enters with their own access code, and the
    session cookie carries its key (2026-11-26, Phase 2e.3).** Codes are
    generated, never chosen: 16 characters (80 bits) shown as
    `XXXX-XXXX-XXXX-XXXX`, and the database key is the first 32 hex of the
    SHA-256 of the normalised code (trimmed, upper-cased, dashes and spaces
    dropped) with no server secret, because a code this long cannot be
    guessed and rotating `PASSCODE_COOKIE_SECRET` must not reset anyone's
    total. The cookie is now `v2.<expiry>.<scope>.<hmac>`, the HMAC
    covering `v2.<expiry>.<scope>`; the scope is the code's key or the
    marker `operator`, which is not hex and so can never be a key. Signing
    the scope means the browser cannot swap in another key. Any version but
    v2 is refused, so deploying this signs everyone out once. The token
    holds a derived key, never the code. `verifySession` (a boolean) is
    renamed `readSession` and returns `{ codeKey }` or null; `signSession`
    requires `codeKey` (null for the operator) so no caller mints a session
    without deciding, and throws on anything that is not null or a key.
    `/api/enter` reads the field `code` (was `passcode`) and runs in this
    order: when `OPERATOR_PASSCODE` is set, the typed text is compared to it
    first in constant time; otherwise the text is normalised, anything not
    16 characters of the alphabet (`isAccessCodeShape`) is refused without
    a database round trip, and the key is read through
    `supabaseBudgetLedger().read`. Three outcomes: enter, with the key in
    the cookie; the same 401 for an unknown, a disabled and a malformed
    code, so the response never says which; or a 503 when the ledger cannot
    be read, logging the error code only, never the typed text, the code or
    the key. A code that has reached its cap still enters, because the
    person's profile is in their browser and they must be able to read and
    export it; it is the next model call that is refused (step 2e.4). The
    route only reads the ledger. The operator passcode is optional, its
    sessions carry no key and are not metered, so it is for the operator and
    local work only. There is no rate limiting on `/api/enter`: an 80-bit
    code makes guessing pointless. D5 (one shared passcode) is superseded
    for invited people by this decision.

69. **Every model call made under an access code is checked against the
    code's budget before it runs and charged its cost after (2026-11-26,
    Phase 2e.4).** The check lives in `src/lib/llm.ts` because every model
    call goes through it: `CallRequest.codeKey` carries the code's derived
    key (from the signed session cookie, never from the request body), and
    `runCall` reads the code's budget once per logical call — not per
    `pause_turn` continuation, not per SDK retry — after the session-id and
    tool checks and before any request. It fails closed: `LlmBudgetError`
    with reason `exhausted` (total at or over the cap), `inactive`
    (disabled, unknown, or a key that is not 32 hex characters, refused
    without a read) or `unavailable` (the read rejected, or outlasted
    `BUDGET_READ_TIMEOUT_MS`, 5s, so a hung ledger cannot hold a turn
    open); its message names the step and the reason, never the key, cap
    or total, and a refused call writes no usage row and no charge because
    nothing was billed. A caller abort during the read is still
    `LlmCancelledError`. The charge is `costUsd` added through
    `BudgetLedger.addSpend` in `recordOnce`, the one place the usage row is
    recorded, so an aborted or failed call that was billed is charged too
    (D45), and it is tracked in the same pending sets as the row, so
    `usageWritesSettled(signal)` in the route's `after()` waits for both
    (D64, D65); a zero-cost call is not charged. The overshoot bound: the
    check is before a call and the charge after it, so a code can go over
    its cap by the calls already in flight when it crosses — one call in
    ordinary use, cents — and the next call is refused. A failed charge is a
    `console.warn` with the error code only, never the key or the amount,
    and never fails the call; it undercounts, which is accepted. An
    organisation-level spend limit in the Claude Console stays as the
    backstop for both. A keyless call (the operator passcode, the `try:*`
    scripts, `smoke:llm`) is not metered and never touches the ledger.
    `llm_usage` is unchanged: `UsageRow` gains no field, the key never
    reaches a row or a log line, and no row is linked to a code (D22).

70. **The operator passcode is read from `OPERATOR_PASSCODE`, not
    `APP_PASSCODE` (2026-11-26, G2e.1 code review).** Through Phase 2d,
    `APP_PASSCODE` held the one passcode every invited fellow was given. D68
    kept the variable and turned a match into an operator session, with no
    key and no cap, and the access-code field accepts the passcode text, so
    after the merge any fellow typing the old passcode would have run
    uncapped. Renaming the variable makes the old value inert on deploy
    whatever is still set in Vercel: `/api/enter` never reads
    `APP_PASSCODE`, and `route.test.ts` asserts that a value set there does
    not enter. The name also now says what the value is (the global naming
    rule). `OPERATOR_PASSCODE` stays optional and unset in production unless
    the operator needs it, and when set it must be a fresh value, never the
    Phase 2d passcode. Cookies from Phase 2d cannot carry over either: they
    are v1, and D68 refuses every version but v2.

---

## 6. Verification log

What each gate ran and found, in date order. Gates 2b and 3 have not run.

### Phase 1 and Gate 1

**Phase 1 status (2026-09-12).** The first session ran out mid-phase (D28)
leaving 1.1 and 1.2 in orphaned worktrees; the second session salvaged them,
ran 1.3 and 1.4, and committed all four steps on `phase-1`. The worktrees are
removed.

**Gate 1 run (2026-09-12).** `pnpm test` (199), `pnpm lint`, `pnpm typecheck`
and `pnpm build` all pass. `/code-review` at medium over `main...phase-1`
returned four confirmed correctness findings, all in the apply-back paths, all
since fixed with one regression test each: `cards.ts:430` (a draft card rejected by `normalizeDrafts` silently
excludes the user's existing card), `cards.ts:404` (case-sensitive card-id
match duplicates *and* excludes a card when the model returns `c3`),
`discover.ts:443` (dedupe by ref-or-name vs. apply by ref-then-name collapses
two same-named fields and reports a stale id), `discover.ts:385` (refs stored
untrimmed in `extra.Ref` but compared trimmed, so `" CF12 "` fails to match on
a later run). They were profile-corruption bugs, not prompt-quality bugs, and
were fixed before the 2.1/2.4 UI starts writing to the same paths. Validation
now dedupes on the same ref-then-name keys `findExistingField` /
`findExistingRole` match on, so a dedupe key and a match key can no longer
disagree (D30). Still outstanding: the user's own trial run of
`pnpm try:cards` / `pnpm try:discover` on a real resume.

### Phase 2, the 2.5 end-to-end run, and Gate 2

**Phase 2 status (2026-09-12).** 2.1–2.4 ran as four worktree workers (2.1
and 2.4 Opus, 2.2 and 2.3 Fable) and were merged into `phase-2`; 2.5 wired
them into `src/lib/turn.ts` and `POST /api/turn` (D31). Worker live runs:
explore $0.25 / 107s on the videographer fixture with 48 URLs seen and zero
blocked hosts; queries $0.08 / 91s (11 queries, four boards); revise $0.09 /
38s on "bad fit: all roles need PE license" (one query retired, three
narrowed, three added, one field moved to unsure, explanation quoting the
reason). The 2.5 end-to-end run is recorded below the Gate 2 line; the
Vercel preview deploy needs a linked project and is the user's step.

**2.5 end-to-end run (2026-09-12, local `next start`, not a preview URL —
no Vercel CLI or linked project on this machine).** A driver that uses the
browser's own modules (`nextStep`, `buildTurnRequest`, `decodeTurnEvents`,
`applyTurnResponse`, `applyQueryFeedback`) ran the videographer fixture
resume through `POST /api/turn` behind the passcode cookie: cards (22s,
$0.04, 4 cards, 3 of 5 preferences inferred) → two elicitation pill clicks
(0s, no model call) → discover (167s, $0.54, 6 fields, 17 roles) → explore
F1 (102s, $0.27, +4 roles, day-to-day and keywords on the field) → accept
F1 locally → queries (79s, $0.06, 12 queries over four boards) → "bad fit"
feedback on Q1 (33s, $0.08, Q1 marked bad with the reason, 3 queries added,
explanation quoting the reason). ~6.7 minutes and $1.00 for the loop; 14
chat messages; profile.md 29KB with zero parse warnings, no blocked hosts,
and one usage row per call with no content. The server log had nothing but
the startup lines. Every step's `deltas` count matched its heartbeats plus
progress lines, so the stream stayed alive through the 167s discovery.
Seams found and fixed before this run: none in the modules; the only
failures were in the driver's cookie parsing. Not exercised: the React
components in a browser (2.1 and 2.4 had no browser run either) — that is
the user's Gate 2 run.

**Gate 2 security review (2026-09-12).** `/security-review` on Opus over
`main...phase-2` (the 2.1–2.5 diff: the turn route, `turn.ts`, `turn-stream.ts`,
the four React components, `cards`/`elicit`/`discover`/`explore`/`queries`/
`boards`/`workspace`, the four `try-*` scripts, and the config changes)
returned **no HIGH or MEDIUM findings**. What it confirmed, so a later change
that breaks one of these is a regression and not a new opinion:

- **The gate covers the new endpoint.** `PUBLIC_PATHS` in `proxy.ts` is still
  only `/enter` and `/api/enter`, so `/api/turn` gets the `401` JSON body
  unauthenticated (D7). The cookie is `SameSite=Lax` and no state-changing
  `GET` was added, so a cross-site POST carries no cookie.
- **No XSS sink.** No `dangerouslySetInnerHTML` anywhere in `src/components/`
  or `src/app/`; chat text is a React text child, not parsed markdown. The one
  model-supplied `href` (field sources, `FieldsTab.tsx`) is scheme-guarded with
  `/^https?:\/\//` — which is what stops a `javascript:` URL the model
  emitted — and carries `rel="noreferrer"`. `linkedinGuidanceLinks`
  `encodeURIComponent`s every parameter.
- **Nothing content-bearing is logged or persisted.** The new code has exactly
  one `console.*` call: the route's catch, which logs the error *class* and
  step. `turnErrorMessage` interpolates only regex-constrained ids (`Q\d+`,
  `F\d+`) and integers — never model text or the request body (D31). Every
  body goes through `parseTurnRequest` before anything else, and `runTurn`
  holds no state.
- **The no-scraping enforcement point held.** No `new Anthropic(`, raw
  `fetch(`, `child_process`, `eval` or `new Function` in any new module; web
  tools come only from `webTools()`, and `explore.ts` adds a post-hoc
  `assertNoBlockedFetches` over tool-result and citation URLs on top of it
  (D13, D19).

Not vulnerabilities, recorded so they are not re-raised each gate: prompt
injection from pasted resume text or fetched pages (inherent to the design;
blast radius is the user's own profile and the output renders as inert text),
and model-directed `web_fetch` to internal hosts (that fetch runs on
Anthropic's infrastructure, not ours, so it is not SSRF against this app).

The user's own Gate 2 run — the browser pass over the React components and two
real job-board searches — is still outstanding.

### Phase 2b (pre-gate)

**Phase 2b status (2026-09-20).** All six steps committed on `phase-2b`
(2b.1 by the orchestrator; 2b.2, 2b.3 and 2b.4 in parallel worktrees, merged
with one trivial conflict in `turn.test.ts`; 2b.5 and 2b.6 sequential). The
old tab components are deleted; `src/components/shell/` and `screens.ts`
replace them. `pnpm test` (346), `pnpm lint`, `pnpm typecheck` and
`pnpm build` pass.

**Live loop (2026-09-20, step 2b.6).** Run through the try scripts against
the local stack, videographer resume plus a `Notes:` block:

| Stage | Result | Cost | Time |
|---|---|---|---|
| `try:cards` | 4 cards with `Years`; notes became stated seniority, retraining appetite and climate interests | $0.05 | 14s |
| `try:discover` | 6 fields, 16 roles; every field has fit level, sector, summary, chips, one evidence line per cited card and an ask; 0 dropped | $0.72 | 252s |
| `try:queries F1` (two roles ticked) | exactly 3 queries, one per board, `Fields: F1`; scripted bad-fit revision replaced the judged board's query | $0.11 | 47s |

About $0.90 for the loop. Gate 2b itself — the user's browser run,
`/code-review` and `/security-review` — has not run; it must run in a
separate session (AGENTS.md).

**Discovery latency (2026-09-24, D44).** The user's browser run of
discovery never finished: no usage row, no server error. It was one long
non-streamed call, so it met the 300s request timeout and its silent retry.
Timed on the videographer fixture, one run per variant (~$1.64 total):

| Variant | Time | Cost | Fields / roles | URLs not from the catalogue |
|---|---|---|---|---|
| Opus 5, `high`, 8 searches + 4 fetches (before) | 226s | $0.69 | 6 / 17 | 14 |
| Opus 5.5, `medium`, same tools | 109s | $0.40 | 6 / 13 | 13 |
| Opus 5.5, `medium`, 3 searches, no fetch | 97s | $0.36 | 6 / 14 | 0 |
| Opus 5.5, `medium`, no web (shipped) | 65s | $0.20 | 6 / 13 | 1 (recalled) |

None dropped a field and every field kept its fit level. Web fetch was never
used. One run each, so the numbers are rough; earlier Opus 5 `high` runs
ranged from 157s to 252s.


### Phase 2b revision: the 2b.13 end-to-end run (2026-11-18)

The revised loop (D46–D51) was run live through the try scripts on two
inputs: the user's own resume from `userdata/` (never committed; this repo is
public, so only counts, costs and times are recorded for it) and the
videographer fixture. Each
pass was `try:cards`, then `try:discover` with the two pill answers written
by `applyPillAnswer` (new `--interest` and `--retraining` options), then
`try:queries --tick` on three roles in two fields (new option; it ticks with
`setRoleSelected`, as the Roles screen does).

| Pass | Step | Result | Cost | Time |
|---|---|---|---|---|
| Own resume | `try:cards` | 5 cards, each with situation, actions, results and areas of expertise | $0.069 | 21s |
| | `try:discover` (interest "not sure yet", no retraining) | 6 fields, 12 roles, nothing dropped, no level word in a title | $0.230 | 96s |
| | `try:queries --tick R3,R4,R7` | 3 LinkedIn queries, one per ticked role | $0.012 | 4s |
| Videographer | `try:cards` | 3 cards, same checks | $0.048 | 14s |
| | `try:discover` (interest nature/food/finance/policy/software, a short course) | 6 fields, 13 roles, nothing dropped, no level word in a title | $0.198 | 62s |
| | `try:queries --tick R1,R3,R4` | 3 LinkedIn queries, one per ticked role | $0.011 | 4s |

A session costs about $0.31 and two minutes of model time on the own resume
and about $0.26 and 80 seconds on the fixture; discovery is three quarters of
both. The whole run cost $0.59, including the one repeated `queries` stage.
One run per stage, so the numbers are rough.

The fixture's queries from the committed prompt (the own-resume queries were
read and judged sound, and are not recorded):

- Video and Social Media Producer: `("video producer" OR "social media producer" OR "social video producer") AND ("climate change" OR "climate solutions" OR "climate news" OR "environmental journalism")`
- Documentary Producer: `("documentary producer" OR "series producer" OR "impact producer") AND ("climate change" OR "environmental justice" OR "climate solutions" OR "energy transition")`
- Multimedia Producer: `("multimedia producer" OR "video producer" OR "digital content producer") AND ("land trust" OR conservation OR watershed OR "land conservation")`

What the run showed, and what changed:

- **Two fixture queries had no climate subject.** On the first `queries`
  run, both roles under "Climate communications and media" got a field group
  made of medium words only (newsroom, journalism, explainer; documentary,
  broadcast), so the search would have returned the same job at any employer.
  The prompt bans "climate" as a lone field term and gave the model nothing
  to use when climate is the field's own subject. Step 2 of
  `QUERIES_SYSTEM_PROMPT` now says a field term names what the employer works
  on, never the job's craft or medium, and that such a field takes specific
  phrases ("climate change", "energy transition"). The stage was rerun once
  on both inputs; the three queries above are from that rerun. The own-resume
  queries were sound both times.
- **`try:discover`'s evidence check was stricter than the product.** An
  earlier run on the own resume failed on "F4 cites C2 without an evidence
  line". It did not recur in either pass. `validateOutput` keeps such a field
  and no screen renders evidence lines, so the script now prints it as a
  warning instead of failing.
- **Tidied in the same step, not found by the run:** the two question texts
  read as form questions; `queries.ts` takes its level words from
  `discover.ts` (`levelPhrasesIn` replaces `levelWordsIn`, and "intern" is no
  longer on the list); the stored turn messages name the Roles and Searches
  screens and count roles dropped for a rank title.

No query carried a level word and no title tripped the level check in either
pass. The UI steps 2b.11–2b.12 were verified by unit tests, lint, typecheck
and build only; the browser check is left to gate G2b.4.

### Phase 2b revision: the 2b.19 end-to-end run (2026-11-20)

The loop as it stands after 2b.14–2b.18 (D52–D57) was run live through the
try scripts on the same two inputs as 2b.13: the `userdata/` resume (never
committed; only counts, costs and times are recorded for it) and the
videographer fixture. Each pass was `try:cards`, then `try:discover` with two
interest areas written by `--interest` (D54), then `try:queries --tick` on
four roles in four fields. Every step ran on `claude-opus-5-5` at `medium`
effort (`MODEL_BY_STEP`, `EFFORT_BY_STEP`; D52 for `queries`). All six
scripts exited 0 on the first model call; nothing was rerun and no script
or prompt was changed.

| Pass | Step | Result | Tokens (in / cache write / out) | Cost | Time |
|---|---|---|---|---|---|
| `userdata/` resume | `try:cards` | 5 cards, 20 inferred skills | 1,573 / 3,053 / 2,282 | $0.0672 | 19.4s |
| | `try:discover --interest="Energy,Transportation"` | 6 fields, 12 roles, nothing dropped, no level word in a title | 15,616 / 3,452 / 8,803 | $0.2558 | 79.8s |
| | `try:queries --tick` (4 roles, 4 fields) | 4 LinkedIn queries, one per ticked role | 2,015 / 2,171 / 581 | $0.0305 | 8.4s |
| | **Total** | | | **$0.3535** | **107.6s** |
| Videographer | `try:cards` | 3 cards, 16 inferred skills | 1,014 / 3,053 / 1,232 | $0.0440 | 11.9s |
| | `try:discover --interest="Food & Agriculture,Energy"` | 6 fields, 14 roles, nothing dropped, no level word in a title | 14,711 / 3,452 / 6,525 | $0.2066 | 61.6s |
| | `try:queries --tick R1,R4,R10,R12` | 4 LinkedIn queries, one per ticked role | 1,839 / 2,171 / 896 | $0.0361 | 10.6s |
| | **Total** | | | **$0.2867** | **84.1s** |

The whole run cost $0.64. No call read from the cache (each stage ran once
per input, in parallel across the two inputs). Discovery is still about
three quarters of a session. A `queries` call on Opus 5.5 costs about three
times what it did on Sonnet 5.5 in 2b.13 ($0.031–0.036 against
$0.011–0.012), which is two to three cents a session. One run per stage, so
the numbers are rough.

The checks, on both inputs:

- **Inputs survive (D56).** The cards output has `## Inputs` with a
  `### Resume` block, and the section is byte-identical (same hash) in the
  cards, discover and queries outputs.
- **Skills (D53).** The `Inferred` skills line is non-empty in both cards
  outputs. That the prompts read `activeSkills` is covered by unit tests,
  not by this run.
- **Interest order (D54).** Fields in the picked areas come first and a
  field outside them is still listed. Fixture: regenerative agriculture and
  agtech (strong), clean energy brand and content video (strong) and
  alternative proteins (some) rank above land, water and conservation
  nonprofit storytelling (strong), climate communications and media
  (strong) and climate policy and advocacy (some). `userdata/` resume: five
  fields in the picked areas, then one outside. A `some` field inside a
  picked area ranks above a `strong` field outside it, as D54 says.
- **Summaries (D54).** All twelve `Summary` lines open with what the person
  would do ("You would film growers and agronomists on working farms…");
  none repeats or paraphrases its field's name.
- **Level words.** No title tripped the level check and no query phrase
  carried a level word.
- **One warning, not a failure:** on the `userdata/` resume, discovery wrote
  one field whose fit text cites a card with no evidence line of its own,
  the same case 2b.13 turned into a warning.

**Search quality: all eight queries pass.** Every query pairs the role's
title variants with terms that name what employers in its field work on;
none has a climate half made only of generic terms ("green jobs", "climate
careers", "sustainability"), the Sonnet 5.5 failure that D52 reversed. The
four `userdata/` queries were read and judged the same way and are not
recorded. The fixture's four:

- Video Producer, regenerative agriculture and agtech: `("video producer" OR videographer OR "content producer") AND ("regenerative agriculture" OR agtech OR "soil health" OR farmers)`
- Video Content Creator, clean energy brand and content video: `("video content creator" OR "content creator" OR "social video producer") AND (solar OR "heat pumps" OR "home energy" OR "energy storage")`
- Multimedia Storyteller, land, water and conservation nonprofit storytelling: `("multimedia storyteller" OR "multimedia producer" OR "digital storyteller") AND (conservation OR "land trust" OR watershed OR "river restoration")`
- Documentary Producer, climate communications and media: `("documentary producer" OR "documentary filmmaker" OR "video journalist") AND ("climate change" OR "climate solutions" OR "environmental journalism")`

The last is the least specific of the eight. Climate is that field's own
subject, so its terms are the subject phrases the 2b.13 prompt change asks
for, and it passes; it is the query to watch if the check is tightened.
Queries were judged by reading them: no job board was opened or searched.
The UI steps 2b.15–2b.18 were not exercised by this run; the try scripts
cover the model stages and the profile, not the screens.

### Phase 2d: the 2d.2 memory-only run (2026-11-25)

The loop after 2d.1 and 2d.2 (D61, D62) was run live through the try
scripts on the same two inputs as 2b.19: the `userdata/` resume (only
counts, costs and times recorded) and the videographer fixture. Discovery
ran in memory mode on `claude-fable-5-2` at `medium`; the other steps on
`claude-opus-5-5`. Each stage ran once, the two inputs in parallel, nothing
rerun, no prompt changed after the run. One catalogue-arm call was added on
the fixture for comparison.

| Pass | Step | Result | Tokens (in / cache write / out) | Cost | Time |
|---|---|---|---|---|---|
| `userdata/` resume | `try:cards` | 5 cards | 1,573 / 3,053 / 2,249 | $0.0665 | 21.0s |
| | `try:discover --interest="Energy,Transportation"` (memory, Fable 5.2) | 5 fields, 11 roles, nothing dropped, no level word | 1,913 / 3,818 / 7,476 | $0.3525 | 78.8s |
| | `try:queries --tick` (4 roles, 4 fields) | 4 LinkedIn queries | 2,132 / 2,171 / 1,093 | $0.0412 | 13.0s |
| | **Total** | | | **$0.4602** | |
| Videographer | `try:cards` | 3 cards | 1,014 / 3,053 / 1,251 | $0.0443 | 12.7s |
| | `try:discover --interest="Food & Agriculture,Energy"` (memory, Fable 5.2) | 5 fields, 14 roles, nothing dropped, no level word | 1,141 / 3,818 / 5,735 | $0.2767 | 61.5s |
| | `try:queries --tick R1,R4,R7,R10` | 4 LinkedIn queries | 1,700 / 2,171 / 1,076 | $0.0392 | 11.7s |
| | **Total** | | | **$0.3602** | |
| Videographer, catalogue arm | `try:discover --catalogue` (Fable 5.2) | 5 fields, 13 roles; 5 `Ref` lines, 7 lines with source URLs | 14,781 / 3,452 / 7,418 | $0.4495 | 79.3s |

The whole run cost $1.27 (the two memory loops $0.82). The checks, on both
inputs:

- All seven scripts exited 0; both memory discovery calls finished well
  inside the 180s deadline.
- **No URL from memory (D61).** Zero `Ref` lines; every `- **Sources:**`
  label bare (16 of 16 and 19 of 19); zero `http` or `www.` outside
  `## Inputs`.
- **Interest order (D54).** Fields in the picked areas with fit strong or
  some rank first; one or two fields outside them are still listed.
- **Search quality.** All eight queries pass the 2b.19 check.
- **Companies.** In the fixture run discovery named 26 organisations and
  12 organisation types; the reviewing worker judged none non-existent
  (from model knowledge, unverified), and three were loose fits for their
  field.

Against 2b.19 (Opus 5.5 with the catalogue), discovery cost $0.35 / $0.28
against $0.26 / $0.21 in about the same time (78.8s / 61.5s against
79.8s / 61.6s): a far smaller input (about 2K tokens against 15K) does not
offset Fable's higher output price. One run per stage, so the numbers are
rough.

### Phase 2d: the 2d.3 production database (2026-11-25)

Supabase project `thqugwlqlpflgtndymus`, through the logged-in CLI (2.95.4).
The Vercel half of 2d.3 is not verified: see the last paragraph.

- **Migrations.** `supabase migration list --linked` showed an empty remote;
  the dry run listed the three files and nothing else; after
  `supabase db push` all three versions show as applied.
- **RLS, anon side.** `scripts/check-rls.ts` against production with the
  publishable key: all 15 anon checks pass (insert-only on `llm_usage`,
  select-only on the three reference tables, which are empty).
- **RLS, service-role side.** The script's four service-role checks did not
  run: the CLI returns the secret key masked, so they failed with
  `Invalid API key`. The same four were run as SQL in one transaction that
  was rolled back (`set local role service_role`, then `anon`): the
  service role can insert into `llm_usage`; a `session_id` that is not 32
  hex chars, a free-text `step` and a `linkedin.com` source are each
  rejected with 23514; anon's select on `llm_usage` is refused with 42501.
  The script itself has not passed end to end with the real secret key.
- **Left behind: nothing.** The failed run could not delete its one anon
  probe row; it was deleted by session id. `llm_usage` and
  `climate_fields` both count 0 rows.

The production domain does not run this branch. `gh api …/deployments`
shows every production deployment since 2026-09-18 as "Deployment was
blocked"; the domain serves the 2026-09-13 build (`<html lang="en">` with
no font classes), where `POST /api/enter` with a wrong passcode returns 500
instead of 401, the sign of a missing passcode variable in that deployment.
The gate itself holds there: `/` redirects to `/enter` and `/api/turn`
returns 401. The `phase-2d` preview of `9272e47` built, but redirects to
Vercel's login, so nothing on it was checked.

**Later the same day, after the fix.** The cause was a paused Vercel project.
Unpaused, with `phase-2d` promoted, GitHub shows a successful Production
deployment of `512b2db` and the domain serves it (font classes on
`<html>`). From outside, without the passcode: `POST /api/enter` with a
wrong or an empty passcode returns 401 and sets no cookie; `/` redirects to
`/enter`; `/api/turn` returns 401 unauthenticated and with a forged
`cjs_session` cookie. Not checked: anything behind the passcode (the loop,
the `llm_usage` rows from Vercel, the 800s function limit in practice) and
the build log's Node and pnpm versions. `llm_usage` held 0 rows at the time
of writing; the first rows come from the G2d.1 run.

**The G2d.1 run and `llm_usage`.** The user's run through the production
URL reached Searches with no error. It left two rows in one session, where
the flow makes at least four calls: `cards` (Opus 5.5, 1,528 in / 2,249 out,
$0.0664, 18.3s) and `elicit` (Opus 5.5, 2,153 / 201, $0.0176, 3.9s). No
`discover` row and no `queries` row. The Supabase variables are therefore
right; what is lost is the insert for the last call of a turn. D64 is the
fix (the route waits for pending writes inside `after()`); the cause is
likely, not proven, and the fix is unit-tested but not yet seen working on
Vercel. It is confirmed when a production run leaves a `discover` and a
`queries` row.

**D64 confirmed (2026-11-26).** With `d65a92f` promoted (GitHub shows its
Production deployment at 21:47 UTC), the user's second run through to
Searches left all four rows in one session: `cards` (Opus 5.5, $0.0491),
`elicit` (Opus 5.5, $0.0144), `discover` (Fable 5.2, 1,291 in / 4,526 out,
$0.2295, 47.3s) and `queries` (Opus 5.5, 1,571 / 1,183, $0.0408, 13.2s);
$0.334 for the loop. Read with `supabase db query --linked`. The earlier
session's two rows stay as they were.

**Step 2e.5: the budget on the local stack (2026-11-26).** Against the
local Supabase stack and `pnpm dev`, with one throwaway code from
`pnpm codes:add --cap 0.01`, entered through `POST /api/enter`, then
`cards` turns on `src/lib/__fixtures__/resumes/data-scientist.txt` with
curl. The first turn did not complete: `extractCards` ran ($0.0386, the
charge landed before the next read) and `inferPreferences` was refused,
so the reply was the `exhausted` sentence after one progress line. A cap
lower than one call's cost stops a turn between its calls, and the cards
the first call made are not returned. With the cap raised to $1
(`codes:set`), one `cards` turn completed in 18.1s with a `final` event
($0.0418, two `llm_usage` rows). Set back to $0.01, `codes:list` showed a
total of $0.080389 against the $0.01 cap. The next turn came back in
0.016s as a progress line and one `error` event with the `exhausted`
sentence; the session's `llm_usage` count, read with the service role, was
3 before and 3 after, so no model call was made. The dev log showed only
`turn step=cards failed: LlmBudgetError`. The code row was then deleted.
