---
name: ux-review
description: Visual UX review of the local app through the isolated Playwright MCP, using a test profile built from a resume in userdata/. Screenshots every screen and writes a dated docs/ux-review-<date>.md flagging duplicate calls to action, duplicate information, clutter, flow and copy. Report only, no code changes. Makes a few billed Opus calls to build the profile.
argument-hint: "[path to a resume under userdata/] [--reuse]"
disable-model-invocation: true
---

# UX review

Run a visual UX review of the local web app with the Playwright MCP, then
write a dated report. **Report only: do not change any app code.** Invoking
this skill is the user's explicit go-ahead for a browser run (AGENTS.md
otherwise forbids Playwright). Run it on Opus (AGENTS.md model policy).

Arguments: `$ARGUMENTS`
- A resume path, if given. Otherwise use the only file in
  `userdata/resumes/`; if there are none or several, stop and ask.
- The resume must be gitignored: run `git check-ignore <path>`. If that
  prints nothing, stop and tell the user rather than reading the file.
- `--reuse`: skip Step 1 and use the newest `*-p1-cards.md`,
  `*-p2-roles.md` and `*-p3-searches.md` in `.playwright-mcp/`. If any is
  missing, or `parseProfile` would warn on it, rebuild instead.

`<date>` below is today's date as YYYY-MM-DD. It prefixes every file this run
writes, so earlier runs and their reports keep working.

## What the site is for

The app helps someone who wants to move into climate work find climate roles
where the work they already do (data science, video, web design, …) carries
over, then turns the roles they pick into LinkedIn searches they save as job
alerts. A first-time user pastes a resume. They see their areas of expertise
and a few experience cards the app pulled from it, which they can confirm,
edit or exclude, and answer two quick preference questions. They then get
climate fields ranked by fit, each with the roles it contains and evidence
drawn from their own experience. They tick the roles that appeal and get one
ready-to-run LinkedIn search per role, which they open, copy and save as an
alert. Users are invited fellows, mid-career and wary of AI fluff. The
experience should feel calm, trustworthy and quick to pay off: one obvious
next step at a time, evidence over persuasion. Nothing is stored on the
server; everything lives in the browser. It is designed for desktop Chrome at
about 1280px and wider, light theme only.

## What to look for

1. **Duplicate calls to action.** Each action should appear once per page.
   Flag any button, link or pill that does the same thing as another on the
   same screen, the header included.
2. **Duplicate information.** Each piece of information, such as a skill or
   experience pulled from the resume, a field or role name, a fit label,
   should appear once per page. Use `browser_snapshot` text to find
   repeated strings, then confirm on the screenshot.
3. **Visual clutter.** Too many competing elements, weak hierarchy, crowded
   groups, decoration that carries no information, helper text that could go.
4. **Flow between screens.** Is the next step always obvious? Flag dead ends,
   unnecessary steps and navigation that contradicts itself.
5. **Copy and labels.** Wording that is wordy, jargony, vague or inconsistent
   from one screen to the next.
6. **Your own taste.** The user wants your judgement, not just a checklist.
   Give higher-level feedback too: overall layout strategy, what the product
   should emphasise, what you would remove outright. Argue for a direction.

Out of scope: accessibility audits, hover states, phone and tablet widths.

## Step 1: build the test profile (live, billed, once)

Never copy the resume, or anything derived from it, outside the gitignored
`.playwright-mcp/` folder. Use the repo's scripts with the real key from
`.env.local`. Send stdout to the output file or `/dev/null` so no profile is
printed into context, and keep only the last ~20 lines of stderr:

```bash
mkdir -p .playwright-mcp
pnpm try:cards <resume> .playwright-mcp/<date>-p1-cards.md > /dev/null
pnpm try:discover .playwright-mcp/<date>-p1-cards.md .playwright-mcp/<date>-p2-roles.md \
  --interest=<value> --retraining=<value> > /dev/null
pnpm try:queries .playwright-mcp/<date>-p2-roles.md .playwright-mcp/<date>-p3-searches.md \
  --tick <two or three role ids, from different fields if possible> > /dev/null
```

`--interest` and `--retraining` take the `value` (not the label) of a pill
the Highlights screen offers; the options are in `src/lib/elicit.ts`
(`grep -n 'value: "' src/lib/elicit.ts`). Choose answers the resume makes
plausible. Find role ids with `grep -n '^### R' <file>`.

If a step fails, retry it once. If it fails again, use
`src/lib/__fixtures__/data-scientist.md` for the screens that need that
stage, and say so in the report. Run nothing else that calls the model.

## Step 2: browser setup (read only what you need)

- Read the "Looking at the UI (Playwright MCP)" section of CLAUDE.md
  (`grep -n -A32 'Looking at the UI' CLAUDE.md`). Check `/mcp` shows
  `playwright` connected with `--isolated`. If it does not, stop and tell
  the user.
- Start the server with the API key deliberately broken, so no click can
  trigger a billed model call: `ANTHROPIC_API_KEY=disabled pnpm dev`, in
  the background, with its log in `.playwright-mcp/<date>-dev.log`.
- `browser_resize` to 1440×900. Go to http://localhost:3000/enter and enter
  the `OPERATOR_PASSCODE` from `.env.local`; it is a local-only value.
- Load each profile stage into the browser. State lives in localStorage
  under `SESSION_STORAGE_KEY` in `src/lib/session.ts` (`grep -n` for the
  key and the stored-state interface, then read ~40 lines, not the whole
  file). Build the session JSON for each stage with a small script saved in
  `.playwright-mcp/`, write it with `browser_evaluate`, then reload. The
  profile drawer's Import is an alternative.

## Step 3: screens (one full-page screenshot each)

Name screenshots `<date>-NN-<screen>.png`, bare names, so they land in
`.playwright-mcp/`.

1. First run: empty localStorage
2. Highlights: load `p1-cards`
3. Highlights with one card's "Details" open
4. Roles: load `p2-roles`
5. Searches: load `p3-searches`; open one card's alert-steps disclosure
6. Profile drawer open, with its "Export" disclosure open
7. "Start over" confirmation (cancel it; do not confirm)

**Never click anything that sends a turn:** Start, "Find climate roles",
"Write LinkedIn searches…". The broken key would only produce an error, but
an error screen is not what is being reviewed. Skip the Pending screen,
which needs a live call, and say so in the report. If the screens no longer
match this list, review what the app shows now (`src/lib/screens.ts` has
the `Screen` type) and note the difference in the report.

## Step 4: write the report

Write `docs/ux-review-<date>.md` and leave it uncommitted.

Form your findings first. Then, before writing, read `docs/design-language.md`
(the product's stated copy and layout principles). Keep every finding, but
tag any that goes against a stated principle as "Challenges: <principle>",
and say why the principle should bend. Then skim the headings of the most
recent earlier `docs/ux-review-*.md`, if any.

- **Top:** the 3–5 biggest themes across screens, with your recommended
  direction for each. This is the most important part.
- **Per screen:** the screenshot path (`../.playwright-mcp/<file>.png`), then
  findings ranked by impact. Each finding gets a tag (Duplicate CTA /
  Duplicate info / Clutter / Flow / Copy / Taste), what and where, why it
  matters for this user, the suggested change, and effort (S/M/L). When you
  can name it, give the component in `src/components/shell/`.
- **What is working:** a short list of things to keep.
- **Since the last review:** a short list of earlier themes now resolved and
  ones still present. Omit this section on a first review.
- **Not covered:** anything you could not reach.
- **Privacy:** the report may be committed. Quote the app's own interface
  text exactly, but refer to content from the resume by its ID (C2, F1, R3)
  and a generic description ("a card's skills list"). Never include
  employers, names, numbers or other details from the resume.

Write plainly and concretely.

## Budget and cleanup

Aim for under ~45 tool calls. Use one screenshot per screen; check text with
snapshots, not more screenshots, and do not re-screenshot to verify. When
done, `browser_close` and stop `pnpm dev`. Leave `.playwright-mcp/` in
place. End with a short chat summary in the user's reporting format: action
line first, 1–3 sentences, then `FYI (no action needed):` bullets.
