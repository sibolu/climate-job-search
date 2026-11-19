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
5. [Decisions](#5-decisions) — numbered D1–D45, cited from code as
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
| Hosting | Vercel for app and route handlers. Supabase Postgres for the reference collection only | Existing subscriptions |
| Access | Shared passcode (env var) checked in middleware, cookie after entry. No accounts | Gates the pilot without identifying anyone |
| LLM | Anthropic TS SDK, `claude-opus-5-5`, adaptive thinking, every call streamed, 3-minute deadline per call, cancelled when the browser disconnects (`maxDuration` 800s) | Effort per call (chat and discovery `medium`, queries `high`). See D44, D45 |
| Grounding | Supabase reference collection, then the model's own knowledge. No web tools in any step the UI reaches (D44); `explore.ts` keeps `web_search_20260209` / `web_fetch_20260209` with `blocked_domains` for linkedin.com, indeed.com, climatebase.org | Baseline before a larger roles-and-occupations catalogue; hard constraint still enforced in code |
| Session state | `profile.md` text + chat messages + query feedback, in `localStorage`. Sent to the route handler on every turn. Export, import, and "start over" buttons | PRD's "single .md the user keeps"; server is stateless |
| Reference data | Supabase tables `climate_fields`, `example_roles`, `example_job_posts`, seeded from `data/*.yaml` in the repo. Anon key with select-only RLS | The PRD's one allowed collection, reproducible from the repo |
| Cost telemetry | `llm_usage` table: random per-browser session id, model, tokens, cost, duration, step name. No content, no identity | Per-session spend cap and evidence for a later Sonnet 5 decision. See D4 |
| Resume input | Plain-text paste (textarea). PDF upload deferred | User asked for text; removes a parsing surface |
| Structured steps | `output_config.format` structured outputs for cards, fields, queries | Deterministic shapes for the UI |
| Tests | `vitest`; prompt behaviors covered by evals, not unit tests | Unit tests for parsers and pure logic only |

---

## 2. UI shape

Exploration-first, from the Claude Design handoff in
`docs/design_handoff_climate_career_exploration/` (D37). Desktop Chrome,
~1280px+, light-only. The handoff README is the visual spec: colours,
type, spacing and interaction states are final; its sample content is not.

- **One shell, no top-level tabs.** Header with the product mark and a
  three-step nav: 1 Highlights, 2 Fields, 3 Searches. A collapsible
  read-only profile drawer under the header with export, import and
  "Delete everything". A 352px assistant rail on the right, absent on first
  run.
- **First run:** paste a resume or bio, optional notes, Start.
- **Highlights:** the experience cards as a grid; Edit and Exclude per card.
  The rail asks the three preference questions with pills. A "Match fields"
  button starts discovery; it never auto-starts (D38).
- **Field board:** ranked field cards with move type, a three-level fit
  label, a blurb and chips; Interesting / Unsure / Not for me on each card.
  Order is resolved on arrival, not live. A card expands in place to show
  evidence lines, roles with checkboxes, an uncertainty with an optional
  question, employers and sources, all from discovery data (D39). The
  expanded card's CTA writes searches for the ticked roles (D40).
- **Pending:** the board with a status strip, a skeleton card and a live log
  in the rail while a turn runs. Elapsed time, real phases, no estimates.
- **Searches:** per-field groups of query cards, one per board, with copy,
  "Open <board>", alert steps and Good / Wrong results.
- **Feedback:** verdict, reason chips, free text, "Send and revise"; the
  revised query is shown for accept, edit or keep-the-old-one (D41).
- **Rail:** questions with pills, per-field asks, the working log, errors
  and warnings, and a "Change an answer" row. No free-text composer (D42).

The chat-led two-pane layout that Phase 2 shipped is retired by Phase 2b.

---

## 3. Repo layout

Each module is owned by the step that created it (PLAN.md step number in
parentheses). Do not create a later step's file early.

```
src/
  lib/
    passcode.ts     # shared-passcode logic (0.1)
    profile.ts      # profile.md schema, parse/serialize — the contract (0.2)
    session.ts      # browser session state + per-turn payload (0.2)
    __fixtures__/   # canonical profile.md fixtures used by the round-trip tests
    llm.ts          # client wrapper, model config, usage logging, web tools (0.3)
    supabase.ts     # anonClient() / serviceClient() (0.4)
    database.types.ts  # GENERATED by `pnpm db:types`; do not hand-edit (0.4)
    reference-schema.ts # data/*.yaml shapes + blocked-source rules (0.4)
    reference.ts    # typed reads from the Supabase reference tables (0.4)
    cards.ts        # pasted text → experience cards (1.1)
    elicit.ts       # preference elicitation policy and answer pills (1.2)
    discover.ts     # fields/roles discovery, no web tools (1.4; D44)
    explore.ts      # field drill-down, example posts, LinkedIn guidance (2.2)
    queries.ts      # query generation and revision from feedback (2.3)
    boards.ts       # client-safe board labels, alert steps, query extra keys (2.4; D32)
    workspace.ts    # browser-side step policy and profile edits for the UI (2.1/2.4/2b.3)
    screens.ts      # pure screen and rail state for the shell (2b.4/2b.5)
    turn-stream.ts  # NDJSON wire codec + sendTurn (2.1)
    turn.ts         # server dispatcher: TurnRequest → TurnResponse (2.5; D31)
  components/shell/ # AppShell, Header, ProfileDrawer, Rail, FirstRun, Highlights,
                    # Pending, FieldBoard, FieldCard, Searches, QueryCard, Feedback (2b.4/2b.5)
  app/
    api/turn/       # the one turn endpoint (NDJSON stream; 2.5)
    api/enter/      # passcode check
    page.tsx        # the single-page workspace
  proxy.ts          # passcode gate (Next 16's name for middleware.ts; D7)
supabase/
  config.toml          # local stack config (supabase init)
  migrations/          # reference tables, llm_usage, blocked-source CHECK, RLS
data/                  # climate_fields.yaml, example_roles.yaml, example_job_posts.yaml (1.3)
scripts/
  seed.ts              # data/*.yaml → Supabase (mirror; service role)
  try-cards.ts         # stage 1.1 live check
  try-discover.ts      # stage 1.4 live check (catalogue-only sources)
  try-explore.ts       # stage 2.2 live check (blocked-host assertion)
  try-queries.ts       # stage 2b.3 live check (three per-field queries + scripted revise)
  check-rls.ts         # asserts the RLS shape against a live stack
  smoke-llm.ts         # one live Claude call; proves the usage row lands (0.3)
docs/
  data-flow.html       # API calls and profile.md reads/writes (keep current)
  technical-plan.md    # this file
evals/                 # synthetic profiles, structural checks, feedback-loop eval, baseline arm (3.1, not started)
```

---

## 4. Risks specific to this project

- **Grounding quality is the hypothesis under test.** Discovery now runs on
  the reference collection and the model's own knowledge (D44), so a field
  outside the collection has no source at all. Step 1.4's check counts
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
2. App model `claude-opus-5` everywhere, effort tuned per call. Re-evaluate
   Sonnet 5 for chat turns after Phase 3 using `llm_usage`. (Model now
   `claude-opus-5-5`: D44.)
3. All user state lives in the browser (`localStorage`) and is resent each
   turn. No accounts, no server-side profiles or transcripts. Consequence: the
   PRD's baseline comparison uses synthetic profiles and the builder's own,
   not fellows' transcripts, unless a fellow exports and shares one.
4. Anonymous usage rows (random session id, model, tokens, cost, duration,
   step) are written to Supabase for spend caps and model-choice evidence. Nothing else leaves
   the browser except the API request itself. If even this is too much, the
   cap moves client-side and the table is dropped.
5. Access by a single shared passcode given to invited fellows.
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
9. **`profile.md` format is "labeled-bullet markdown"**, defined once in the
   header comment of `src/lib/profile.ts`: seven `##` sections in fixed order
   (Preferences, Experience Cards, Skills, Fields, Role Shortlist, Queries,
   Session Notes); items are `### <ID>: <title>` headings with
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
    a live stack and asserts, with the anon key, that the three reference
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
    are written fire-and-forget through the anon key, and a failure is a
    `console.warn` carrying the error *code* only — telemetry must never cost
    the user their turn, and must never be a channel through which content
    leaks. Refused and truncated turns are logged before the error is thrown,
    so the cost telemetry stays complete. `UsageRow`'s key set is fixed by
    `USAGE_ROW_KEYS` and guarded both at compile time and in `llm.test.ts`, so
    adding a content field fails the build. `streamText` starts the call
    eagerly and lets it complete even if the consumer stops reading deltas
    (the API reports output tokens only in the final `message_delta`), so
    `final` always settles and the row is exact.
22. **`llm_usage`'s shape is a CHECK constraint, not a comment.** The anon key
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
    an open product decision, parked in PLAN.md backlog item 4.

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
    fields" button with a one-line note.

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
    the server streams.

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
    now counts expanded fields, not explored ones.

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
    Interesting first. Revision (D32) is unchanged.

41. **Feedback keeps the good/bad contract; accept-or-keep is a whole-turn
    undo.** The four verdicts map to `good` (Good fit) and `bad` (Partly
    right, Wrong roles, No results); the verdict label and the reason chips
    are prefixed into the `reason` text, so `QueryFeedbackSchema` and the
    revise prompt do not change. The browser keeps the pre-turn `profileMd`:
    "Accept and use" keeps the returned profile, "Keep the old one" restores
    the snapshot, and editing the revised text is a local `setQueryText`
    edit. Copy timestamps ("copied 6 min ago") are client state only.

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
    first candidate after the pilot starts; it is backlog item 6.

43. **A per-field ask writes a preference and does not re-rank.** Answering
    a field's question appends `<key>: <answer>` to the profile's other
    preferences locally, opens the drawer to show it, and flips the field's
    button to "Noted". No model call; the next discovery or revision reads
    it. The handoff's "it sharpens the ranking" is not promised in copy.

44. **Opus 5.5 at `medium`, and discovery recalls rather than searches
    (2026-09-24).** Discovery took 157–252s on Opus 5 at `high` with up to
    8 searches and 4 fetches, grew with each field key 2b.2 added, and ran
    into both a 300s non-streamed request timeout and its 16K output cap. One
    run per variant on the videographer fixture (§6): Opus 5.5 at `medium`
    with the same tools took 109s and $0.40; with no web at all, 65s and
    $0.20, with the same six fields and every fit level kept. So:
    - `MODEL` is `claude-opus-5-5` (priced $4 / $20 per MTok, cache read
      $0.20, 5-minute cache write $5). Opus 5.5 rejects disabled thinking
      and defaults to `medium`, so every call still sets effort explicitly.
    - `discover` joins `cards` and `elicit` at `medium`. `queries` and
      `revise` stay `high`: short calls, not re-measured.
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

