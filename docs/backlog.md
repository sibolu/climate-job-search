# Backlog

Unordered, unsized, uncommitted. Nothing here is scheduled. Promote an item
into a phase in [PLAN.md](../PLAN.md), and record the design decision in
[docs/technical-plan.md](technical-plan.md) §5, before building it.

Items are written at the granularity of a planning session, not a worker
brief: what and why, the module or decision it touches, and where it came
from. `(2026-11-17 run)` marks items from the first browser walkthrough and
`docs/ux-review-2026-11-17.md`; `(pre-2b)` marks items carried over from the
old PLAN.md backlog.

## 1. Resume input and the profile

- **Resume file upload: PDF, .docx, Google Doc** alongside paste. Extraction
  must be in-browser or a stateless pass-through, and must land in the same
  paste → cards path (`cards.ts`). Google Docs needs an auth flow, so it is
  the last of the three. *(pre-2b; 2026-11-17 run)*
- **Edit every prior input and show how the profile changes.** Today the
  only way back is "Start over" (2b.11). Wanted: change an answer, a card,
  a skill or a ticked role from anywhere, and show a before/after of the
  profile entries that changed. Builds on the readable profile summary
  (2b.11) and the pre-turn snapshot in `screens.ts`. *(2026-11-17 run)*
- **Seniority as a choice.** The seniority question and seniority in role
  titles are out (2b.9). Bring seniority back as an explicit option on the
  Roles screen: titles on par with the resume, one level below, or any.
  Being open to a lower level is realistic for a career switch. Touches
  `discover.ts` (title generation) and `queries.ts` (level words in the
  query). *(2026-11-17 run)*
- **Editable profile drawer**, scoped to a section that cannot break what
  the app writes (D42). *(pre-2b)*

## 2. Discovery, fields and roles

- **Field-level interest.** The Interesting / Unsure / Not for me row is
  gone (2b.12); fields are headings only. Decide how, and whether, the user
  tells us a whole field is or is not for them: a dismiss on the heading, an
  implicit signal from which roles they tick, or nothing. Field `Status`
  and its `accepted | rejected | unsure` values are still on the profile
  waiting for it. *(decided 2026-11-18)*
- **"Get more fields" / "get more roles".** A second discovery pass that
  excludes what is already on the profile and returns the next tranche.
  Needs a rule for ranking old and new together (order is resolved on
  arrival, D38). *(2026-11-17 run)*
- **Map the climate job landscape, and the trust problem behind it.** Can
  the app show the user the whole space of climate roles (by sector, by
  function) so they trust that the roles offered are not an arbitrary
  slice? Open questions: a chart of role types from the reference
  collection; a "what you were not shown and why" view; whether coverage
  claims need outside data. Related: product-review.md B3 (catalogue
  coverage is thin by function). *(2026-11-17 run, stretch)*
- **Companies with real climate commitments.** The Corporate Climate
  Targets Project dataset
  (https://dataverse.harvard.edu/dataverse/corporateclimatetargetsproject)
  lists firms with climate targets. Possible use: mark example companies in
  the user's own field that have serious mitigation commitments, so a
  "stay in your function, change employer" path is visible. Would be a new
  reference table (seeded from the dataset, licence to check) and a new
  source of ground truth in `docs/data-flow.md`. *(2026-11-17 run)*
- **Example companies as links.** Turn the "Example companies" list into
  the top employers for the role, each clickable to its corporate careers
  page. Needs a vetted URL per company (reference data or a bounded
  lookup), never a scrape. *(2026-11-17 run)*
- **Location and work mode early, for some fields.** Removed from
  elicitation in D36 and asked nowhere since. Revisit only if usage data or
  BLS employment-by-region evidence shows the number of jobs for some
  roles or industries varies enough to change which fields are suggested,
  not just filter them. *(pre-2b; 2026-11-17 run)*
- **"Dig deeper" on a role group.** Re-attach `explore.ts` as an optional
  block: day-to-day, titles, example posts, keywords (D39). *(pre-2b)*

## 3. Searches and job boards

- **More boards: Climatebase, HiringCafe, Indeed.** 2b.8 writes LinkedIn
  only. `boards.ts` already carries Indeed and Climatebase alert steps;
  HiringCafe is new. Each board returns as its own query variant once the
  per-board syntax below is settled. *(2026-11-17 run)*
- **Per-board query syntax.** Customise each query to the search
  capabilities of the board it is for (boolean support, title filters,
  quoted phrases). Needs a short study of each board's current search box
  before the prompt is written. *(2026-11-17 run)*
- **Indeed MCP** (https://docs.indeed.com/mcp/). An official, terms-compliant
  path to Indeed search, which the PRD's no-scraping rule otherwise rules
  out. Any use goes through `src/lib/llm.ts` like every other fetch path.
  Check the terms and what the server exposes first. *(2026-11-17 run)*
- **Combine roles into one search.** Several ticked roles may be one
  query (synonymous titles, or one title with OR terms). A rule for when
  to merge and when to keep separate; today it is strictly one per role.
  *(2026-11-17 run)*
- **Networking searches.** Queries that find people, not jobs: LinkedIn
  people search and Careerbase for someone who made the same switch.
  Different syntax, different alert story, and a privacy question (the
  results are about third parties). *(2026-11-17 run)*

## 4. The feedback loop (its own milestone)

- **Rating queries and revising from feedback** is out of the UI after
  2b.12; `revise` stays in `turn.ts` with no browser path, like `explore`.
  Before it returns, decide: what the user rates (a query, a result set, a
  role), where (inline on the search card, per the UX review §5), what a
  rating is allowed to change (queries only, or roles and the profile too,
  as D32 allowed), and how the change is shown (old query struck through,
  one-line reason). product-review.md B6 and B7 (queries written blind;
  revision learns from one bit) belong to this milestone. *(2026-11-17 run)*

## 5. UI and platform

- **Responsive layout below ~900px** and a dark scheme, once the design
  covers them (D37). *(pre-2b)*
- **Show session cost in the UI** (wanted first), then spend control:
  per-session budget, cheaper effort or model past a threshold, or a hard
  stop. Cost is computed per call already; it is not returned to the
  browser yet. *(pre-2b)*
- **A way to ask.** The rail composer idea (pre-2b item 2) is moot once the
  rail is gone (2b.11), but the need remains: (B) "ask about this role
  group", a read-only step grounded in that field's profile entry and
  reference row, no tools, no profile writes; (C) the same over the whole
  profile, capped per session. Both need a new `StepName`, the `llm_usage`
  CHECK migration and a prompt module (D42). *(pre-2b)*

## 6. Process

- **Post-edit hook that runs lint and unit tests.** Cheap, but needs a
  scope narrower than "every edit" to fit the one-verification-pass-per-step
  rule in AGENTS.md. *(pre-2b)*
