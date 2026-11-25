# Backlog

Unordered, unsized, uncommitted. Nothing here is scheduled. Promote an item
into a phase in [PLAN.md](../PLAN.md), and record the design decision in
[docs/technical-plan.md](technical-plan.md) §5, before building it.

Items are written at the granularity of a planning session, not a worker
brief: what and why, the module or decision it touches, and where it came
from. `(2026-11-17 run)` marks items from the first browser walkthrough and
`docs/ux-review-2026-11-17.md`; `(2026-11-19 walkthrough)` marks items from
the second one, whose change list became PLAN.md steps 2b.14–2b.19;
`(pre-2b)` marks items carried over from the old PLAN.md backlog.

## 1. Resume input and the profile

- **Resume file upload: PDF, .docx, Google Doc** alongside paste. Extraction
  must be in-browser or a stateless pass-through, and must land in the same
  paste → cards path (`cards.ts`). Google Docs needs an auth flow, so it is
  the last of the three. *(pre-2b; 2026-11-17 run)*
- **Edit every prior input and show how the profile changes.** Every
  reached nav item is a link back to its screen (2b.17), and re-running
  discovery from Highlights updates the roles, but nothing shows what
  changed. Wanted: change an answer, a card, a skill or a ticked role from
  anywhere, and show a before/after of the profile entries that changed.
  Builds on the readable profile summary (2b.11); the pre-turn snapshot
  `screens.ts` kept for accept-or-keep was deleted with the feedback screen
  in 2b.12 (D51). *(2026-11-17 run)*
- **Re-read an edited resume.** The Resume page shows the stored resume
  and notes read-only (2b.17, D56); the only way to use a different one is
  "Start over". Letting the person edit it and read it again needs a rule
  for what a re-read does to edited highlights, ticked roles and searches.
  *(2026-11-19 walkthrough)*
- **Rethink how a highlight is shown.** Cards are laid out as Situation /
  Action / Result behind "Details" (`Highlights.tsx`), which is the cards
  prompt's schema shown raw. Reconsider whether STAR is the right frame for
  the reader, or only for the model. Touches the card layout and editor,
  and `cards.ts` only if the stored shape changes (then `profile.ts`, the
  fixtures and the round-trip tests too). *(2026-11-19 walkthrough)*
- **Retraining as a consideration.** The retraining question is gone
  (2b.16, D54); `retrainingAppetite` stays a preference key, filled from
  the notes box or by `inferPreferences` when the cards clearly support it,
  and discovery still labels each field's move
  (`sector`, `adjacent`, `retraining`) and ranks retraining last. Decide
  whether and where the person says how far they would retrain: a filter
  on the Roles screen next to seniority (below), a later question, or
  nothing beyond the "Needs retraining" label. *(2026-11-19 walkthrough)*
- **Seniority as a choice.** The seniority question and seniority in role
  titles are out (2b.9). Bring seniority back as an explicit option on the
  Roles screen: titles on par with the resume, one level below, or any.
  Being open to a lower level is realistic for a career switch. Touches
  `discover.ts` (title generation) and `queries.ts` (level words in the
  query). *(2026-11-17 run)*
- **Editable profile drawer**, scoped to a section that cannot break what
  the app writes (D42). *(pre-2b)*
- **The stored resume in the profile drawer.** `## Inputs` (D56) is shown
  only on the Resume page; the drawer's summary (`profile-summary.ts`)
  leaves it out, so the raw file under "Export" is the only other place it
  appears. Decide whether the summary names it, and how briefly.
  *(found in 2b.19)*

## 2. Discovery, fields and roles

- **Trades and field roles in the reference data.** The Phase 2c research
  covers professional career switchers only. Installers, technicians,
  electricians and other trades are left out, although public green-jobs
  data is dominated by them. Adding them means a second pass over the same
  sources with the `field-technician` function kept in.
  *(decided 2026-11-23)*
- **Finding the fields and roles that are growing now.** An extension to
  the Phase 2c research, which works from official datasets and so lags
  the market. Two ideas, suggested by Gemini and not yet checked:
  - *Climate VC portfolios.* Pull company lists from Lowercarbon Capital,
    Breakthrough Energy Ventures, Congruent Ventures, Energy Impact
    Partners and World Fund (EU), then read each company's openings from
    its applicant-tracking system's public endpoint (Greenhouse, Lever,
    Ashby, Workable). The 2c.1 survey already found the Breakthrough and
    Energy Impact Partners portfolios to be open lists.
  - *Public subsidies and grants.* Cross-reference recent awardees from
    the US Department of Energy (Loan Programs Office, ARPA-E), Inflation
    Reduction Act tax-credit beneficiaries, EU Innovation Fund grantees
    and Horizon Europe consortia. A large grant tends to be followed by
    hiring for project developers, permitting leads and engineers.

  Before building either: pulling openings from tracking-system endpoints
  at scale would be a job corpus, which the PRD forbids, so it must stay
  bounded like the career-page rule (titles, function and URL only) and
  each system's terms must allow it. Check which awardee lists are
  published as datasets, in line with D60; tax-credit beneficiaries may
  not be public at all. *(noted 2026-11-23)*

- **Field-level interest.** The Interesting / Unsure / Not for me row is
  gone (2b.12); fields are headings only. Decide how, and whether, the user
  tells us a whole field is or is not for them: a dismiss on the heading, an
  implicit signal from which roles they tick, or nothing. Field `Status`
  and its `accepted | rejected | unsure` values are still on the profile
  waiting for it. *(decided 2026-11-18)*
- **What a field heading says.** The Roles screen shows a field's name, its
  overlap label, its move label, "Based on", the two-sentence summary and
  any "Not sure yet" line (2b.18, D57). Discovery still writes a `Sector` line per field that no
  screen shows. Either cut it from the discovery schema (less output, a
  faster turn) or bring it back with a job the title does not already do.
  *(2026-11-19 walkthrough)*
- **Interest areas and the catalogue do not line up.** The six areas the
  person picks from (`CLIMATE_AREAS` in `elicit.ts`, D54) are matched to
  fields by the model alone: the catalogue's `sector_group` has three
  coarse values, and about a quarter of its fields sit in none of the six
  (climate finance, policy, communications, carbon accounting software,
  risk analytics, adaptation, environmental justice). Options: tag each
  field in `data/climate_fields.yaml` with an area (a schema change and a
  migration) so ranking by interest can be checked in the evals; add areas
  for what the six leave out; or leave it to the prompt. Ask first whether
  fellows miss an area. *(2026-11-19 walkthrough)*
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
  source of ground truth in `docs/data-flow.html`. *(2026-11-17 run)*
- **Example companies as links.** Turn the "Example companies" list into
  the top employers for the role, each clickable to its corporate careers
  page. Needs a vetted URL per company (reference data or a bounded
  lookup), never a scrape. *(2026-11-17 run)*
- **Location and work mode early, for some fields.** Removed from
  elicitation in D36 and asked nowhere since. Revisit only if usage data or
  BLS employment-by-region evidence shows the number of jobs for some
  roles or industries varies enough to change which fields are suggested,
  not just filter them. *(pre-2b; 2026-11-17 run)*
- **Re-rank on a per-field answer.** Moved to §4 with the follow-up
  question it depends on, which left the Roles screen in 2b.18. *(pre-2b)*
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
- **Search specificity.** Searches written by Sonnet 5.5 paired a role's
  title with generic climate terms ("green jobs", "climate careers") and
  not the field's own vocabulary. 2b.14 moves `queries` back to Opus 5.5
  and 2b.15 puts the person's skills into the prompt for the first time. In
  the 2b.19 run all eight queries passed the specificity check on Opus 5.5,
  at about $0.03 per `queries` call, three times the Sonnet 5.5 cost
  (technical-plan.md §6). This stays a watch item: if the pilot still shows
  general searches, the fix is the `queries.ts` prompt (field-specific
  terms required, generic ones banned), and the Phase 3 eval rubric should
  check for it either way. Related:
  product-review.md B6. *(2026-11-19 walkthrough)*
- **Job alerts.** The "Get new matches by email" steps left the search card
  in 2b.18; `ALERT_STEPS` in `boards.ts` keeps the text. The PRD has the
  person set up alerts by hand, so the guidance should return once it has a
  place that does not crowd each card: once per board on the Searches
  screen, or in the pilot kit (3.4). *(2026-11-19 walkthrough)*
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
- **Follow-up questions on a field.** Discovery writes one question per
  field (`Ask`: "the one question whose answer would most change the fit").
  It was shown under the field on the Roles screen and removed in 2b.18
  (D57): a screen for choosing should not open a conversation
  (design-language.md, principle 11). The question is still generated and
  stored, and `addOtherPreference` in `profile.ts` can still save an
  answer, but the shell no longer calls it and nothing shows either. Decide with the rest of this milestone: whether the question
  comes back, at which stage (after the searches have been run is the
  likely place), and what an answer changes. An answer that changes nothing
  on screen was the earlier complaint (D43, D50): it should re-order that
  field's roles or the fields without a full discovery re-run, by a cheap
  call or a rule, with copy that says what changed. If it does not come
  back, cut `ask` from the discovery schema. *(2026-11-19 walkthrough;
  pre-2b)*

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

- **Is the preference-inference call still earning its cost?** The paste
  turn makes a second Opus call (`inferPreferences` in `elicit.ts`) that
  now fills only location, work mode, seniority and retraining appetite,
  none of which is asked and one of which (seniority) nothing reads. Since
  D54 it never infers climate interests and makes no call when only they
  are missing, so a profile whose notes state the four makes none. Check
  its share of `llm_usage` cost and whether discovery does any worse
  without it. *(2026-11-19 walkthrough, found while planning)*

## 6. Process

- **Post-edit hook that runs lint and unit tests.** Cheap, but needs a
  scope narrower than "every edit" to fit the one-verification-pass-per-step
  rule in AGENTS.md. *(pre-2b)*
