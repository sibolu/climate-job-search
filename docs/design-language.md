# Design language

How this product talks and how its screens are arranged. Read this before
changing anything in `src/components/shell/` or any user-facing string.

The visual tokens (colour, type, radius, shadow) are **not** here: they are
decided in the handoff README in `docs/design_handoff_climate_career_exploration/`
and implemented as CSS variables in `src/app/globals.css`. Layout decisions
are numbered in `docs/technical-plan.md` §5 (D37, D42, D49–D51). This file is
the layer above both: the principles that let a contributor judge a new
screen or sentence without a spec.

This is a living document. Each principle was extracted from a concrete
choice, and the example that triggered it is kept next to it. Add a principle
only when a real decision produced it; add the example in the same commit.
Open questions are listed at the end rather than resolved by guesswork.

Sources so far: the first-run copy session (2026-11-19) and the end-to-end
walkthrough notes (2026-11-19). The walkthrough's concrete change list is
being applied separately; this file keeps only the rules it revealed.

## Who reads the screen, and how they arrive

Climatebase fellows who want to move into climate work and are unsure where
their existing skills fit (PRD.md). They arrive mid-transition, often
uncertain, and primed to hear that they lack something. Every screen should
leave them feeling that what they have already done counts, and that the
next step is theirs to choose.

## Principles

Each principle is one imperative line, then the example that produced it.

### 1. Motivate; never define against others

Say what this tool does for the reader. Do not describe other sites, other
approaches, or the reader's own habits as the thing we are better than.

- Rejected: *Start from what you have done, not from the word "climate".*
  The second clause scolds and implies someone else is doing it wrong.
- Accepted: *Your experience already fits climate work. Find out where.*

### 2. Present results as suggestions that rank, never as a closed set or a filter

Fields and roles the model surfaces are a starting shortlist. Wording must
not imply that anything unlisted is closed to the reader, and a preference
answer reorders the list rather than removing options. Say so where the
reader might fear otherwise.

- Rejected: *Explore the climate fields open to you.* Implies other fields
  are closed.
- Accepted: *Explore the climate fields that could most use your skills.*
  ("most" says the list ranks; it does not mark a boundary.)
- Accepted: the interest question keeps *The answer decides which roles are
  listed first* and adds a line that unselected areas are not filtered out.

### 3. Say a thing once per screen

Each instruction, promise, status or explanation appears in exactly one
place. When a control already carries it (a textarea placeholder, a button
label, a count in a button), the surrounding prose, helper text and info
icons do not repeat it. When an info icon and the page say the same thing,
remove the icon.

- Rejected: first-run screen with "paste your resume" in the lead, the
  textarea placeholder and a label, three times on one screen.
- Accepted: each box has one visible label that carries the instruction and
  no placeholder; the headline carries the promise; the lead describes what
  comes next.
- Rejected: *5 roles ticked* above a button reading *Write … for 5 roles*,
  plus an info icon explaining the same thing.
- Rejected: the one-line sector under a field title; it restated the
  title and went.
  Accepted: the two-sentence summary under it stays, because it says what
  the work is and why the person fits, which the title does not.
- Rejected: a *Notes* label plus a separate *Notes: constraints…* helper.
  One prompt per field, marked *Optional*.

### 4. Describe the real flow, in the order it happens

Lead copy names the steps the reader will actually take, in sequence. Do not
promise an output before the step that unlocks it.

- Rejected: *See climate fields… and the searches to run on job boards.*
  Skips the step where the reader picks fields and roles.
- Accepted: *Explore the climate fields that could most use your skills, pick
  the ones that interest you, and get searches to run on job boards.*

### 5. Leave room for discovery

The product is for exploration as much as matching. Copy and controls should
invite the reader to find fields they had not considered and to follow their
interest, not only to confirm a fit.

- Example: *pick the ones that interest you* was added to the lead for this
  reason.
- Example: the interest question is multi-select. A reader can plausibly
  care about more than one area, and a single choice would force a false
  narrowing before they have seen anything.

### 6. Trust the inference; the reader's job is to remove, not to confirm

Inferred items (skills, highlights) are accepted by default and shown as the
reader's own. Offer removal, not a keep/confirm step. This is how the screen
says "what you have done counts" without saying it.

- Rejected: each inferred skill with *Keep* and *Remove*, under *Read from
  your resume. Keep or…*.
- Accepted: skills shown as tiles with a single remove control, under
  *Inferred from your resume*.

### 7. Use the words the reader already uses on job boards

Name things the way LinkedIn and resumes do. Do not invent a product term
when a familiar one exists, and prefer the plain phrase over the clever one.

- Rejected: *Your expertise*. Accepted: *Skills*, which also matches the
  *Highlights* heading in register.
- Rejected: *Draws on*. Accepted: *Based on*.

### 8. Explain the mechanism once, where it matters; never explain the obvious

Say how a section feeds the result when the reader would otherwise not know
(how Highlights and Skills each shape the suggested fields). Do not explain
what any reader infers on their own (that an excluded item is not used).

- Accepted: one sentence on the Highlights screen on how Highlights differ
  from Skills in generating fields.
- Rejected: a note that excluded skills or highlights are not used.

### 9. Reassure about reversibility, not about duration

Where the reader is about to commit something, tell them it can be changed
later rather than how long it will take. (Time estimates also conflict with
the pending screen's "real phases, no estimates", technical-plan.md §2.)

- Rejected: *About a minute…* under the first-run Start button.
- Accepted: *You can change anything later.*

### 10. Evidence behind a click, not in the way

Show the conclusion inline and the reasoning on demand. The card reads clean;
the supporting experience expands when asked.

- Accepted: *Based on* sits next to the overlap indicator under the field
  title and expands to show which experience the field was generated from.

### 11. Do not interrupt a choice with a question

A screen whose job is selection does not open a conversation. Follow-up
questions and feedback belong to their own stage, later in the flow.

- Rejected: clicking a role produced *Do you want to keep leading a science
  organization, or go back to hands-on building…?* Deferred to the feedback
  milestone in `docs/backlog.md`.

### 12. Simplify first; add back when a reason appears

When an element mostly repeats another or has no clear job, remove it now and
note it for later rather than keeping it to be safe.

- Examples from the walkthrough: the decorative green box in the top bar,
  the sector line under a field, the retraining question (moved to the backlog),
  the follow-up questions on roles.

## Voice

- Second person, present tense. "Your experience", "pick", "explore".
- Prefer verbs of exploration and choice over verbs of processing:
  *explore, pick, find out* rather than *generate, submit, process*.
- Headline makes one promise in one or two short sentences. The lead is one
  sentence that names the steps.
- "Fit" is used actively (*fits*, *could fit*), never passively (*fit in*),
  which reads as squeezing the reader into a space.
- Questions are specific, not atmospheric: *Which area of climate work
  interests you most?* rather than *What draws you to climate work?*

## Density and structure

- One primary action per screen. Status that the button already carries is
  not shown separately (principle 3).
- Prose does not repeat what a control already says (principle 3).
- Info icons are a last resort. Before adding one, ask whether the page
  already says it; if so, remove the icon, not the sentence.
- Navigation is a plain list of screen names, no step numbers, every item a
  link back to its screen.
- Destructive actions live on the one screen where they make sense (*Start
  over* on the resume screen only) and are confirmed with a chance to save
  first: offer the profile download, warn that everything else is lost.
- No decorative elements in the chrome. If a box carries no information or
  action, it goes.
- Every control does something. Nothing is shown that is not built.

## Current first-run copy (reference)

```
Your experience already fits climate work. Find out where.

Explore the climate fields that could most use your skills, pick the ones
that interest you, and get searches to run on job boards.
```

## Open questions

- Where secondary actions sit on a screen, and how they are styled relative
  to the primary one.
- When a label is enough and when a full sentence is needed.
- What the product calls the model's work (the log lines, the pending
  screen) and how much of it the reader should see.
- How Highlights should be shown: the STAR framing is under review.
- Which of these principles are general enough to move to a portable,
  project-independent set.
