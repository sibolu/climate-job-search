<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# How Claude Code works in this repo

Code conventions, commands and the hard constraints are in
[CLAUDE.md](CLAUDE.md), which includes this file. This file is the working
agreement: how phases are run, who does what, and what each turn may cost.

## Where things are written down

- [PLAN.md](PLAN.md): the roadmap. Step statuses are updated there as steps
  finish, so a fresh session resumes where the last one ended.
- [docs/technical-plan.md](docs/technical-plan.md): architecture, the
  numbered decisions (`D1`…), and the verification log. A decision made
  mid-phase is appended there in the same commit as the change; if it
  affects contributors, CLAUDE.md is updated too.
- [docs/data-flow.md](docs/data-flow.md): the one flowchart. Update it only
  when a step, a data store or a source of ground truth is added or removed.
- **Nothing project-related goes into Claude's private memory.** Other
  contributors must be able to read every decision.

## Operating agreement for autonomous runs

- **Kickoff prompt:** `Execute Phase N per PLAN.md. Commit each step on
  branch phase-N. Stop at the gate.` Nothing else is needed.
- **The orchestrator does not ask mid-phase.** Ambiguities are resolved by
  the defaults in the technical plan and stated in the gate report.
- **The user reviews at gates, not steps.** Each gate produces a short
  report in the format from the user's global CLAUDE.md: action line first,
  1–3 sentence summary, gotchas under `FYI (no action needed):`.
- **Branch per phase, PR per phase** via `gh`. Merging is the user's call.
- **Every step ends in one commit** with `pnpm test`, `pnpm lint` and
  `pnpm build` passing.
- **Never run a gate review and a phase execution in the same session.**
  The Gate 0 review fan-out alone was 80% of a five-hour budget.

## Orchestration

The session the user talks to is the orchestrator. It does not write feature
code itself; it writes briefs, spawns workers, checks acceptance, integrates,
and commits.

**Brief template for every worker:**
1. Goal in two sentences and the "done when" check verbatim from PLAN.md.
2. Files it owns (it may not touch others) and the interfaces it must respect
   (`profile.ts`, `session.ts`, `llm.ts`, `reference.ts` signatures pasted in).
3. The hard constraints from CLAUDE.md, verbatim.
4. The relevant decisions from the technical plan, pasted in — do not send a
   worker to read PLAN.md or the technical plan.
5. The turn budget: "this should take under 20 tool calls; if it will not,
   stop and report why."
6. "Run the check yourself. Report in ≤10 lines: what you did, what the
   check showed, anything you could not do."

**Mechanics:**
- `Agent` tool with a `model` override per the policy below,
  `run_in_background` for parallel steps, `isolation: worktree` whenever two
  workers run at once. Parallel only when file ownership is disjoint; the
  orchestrator merges.
- Worktrees branch from `main`, not the phase branch (D33): the brief tells
  the worker to `git checkout -b <step> phase-N` first. Remove worktrees and
  their branches right after merging; `.claude/**` is ESLint-ignored because
  a leftover worktree is a full checkout.
- Sequential steps run on the phase branch with no worktree.
- `/code-review` at each gate; `/security-review` at Gate 2 and at any gate
  that touched auth, input handling, or Supabase.
- The `Workflow` tool (deterministic fan-out with schemas) fits research and
  eval fan-outs (steps 1.3 and 3.1). It needs the user's explicit opt-in:
  they say "use a workflow for step 3.1" and the orchestrator authors one.
- Escalate a worker that reports a blocker, or a bug it could not fix in one
  attempt, by re-briefing the same task to a Fable worker rather than
  retrying at the same tier.

## Model policy

Set by measurement (D28), not taste. Cost per MTok: Fable $10/$50, Opus
$5/$25, Sonnet 5 $2/$10 — a Fable worker has to be earning its 2× over Opus.

- **Fable** orchestrates and owns the steps where prompt quality *is* the
  product: the `profile.md` schema, elicitation, discovery, exploration,
  query generation and revision, reference-collection consolidation,
  evaluation (3.1), and integration. Nothing else.
- **Opus** does the coding and **every gate review**: scaffold, wrappers,
  Supabase, UI, seed scripts, deployment, docs, `/code-review` fan-out,
  `/security-review`.
- **Sonnet 5 at `effort: low`** for data-gathering workers that read the web
  and report facts back. They summarise sources; they do not write product
  prose or code.

## Context and turn budget

Cost is context × turns. 93% of input tokens in the measured window were
cache reads, so every token pulled into context is re-billed on every later
turn, and a worker's cost grows with the square of how long it runs.

- **Every worker finishes in ≤20 turns and stays under ~80K context.** If a
  step cannot fit, split it into two workers with disjoint file ownership. A
  worker that blows through the budget is a briefing bug, not a worker
  failure.
- **Never read a whole file.** No `cat file.ts`, no multi-file `cat -n a b c`,
  no `Read` without `offset`/`limit` on anything over ~200 lines. Use
  `grep -n -C5` or `sed -n 'A,Bp'`. `profile.ts` is 49KB and
  `docs/technical-plan.md` is 37KB; neither is ever read whole.
- **Verify once per step, filtered:**
  `pnpm test && pnpm lint && pnpm typecheck 2>&1 | tail -30`, then
  `pnpm build` once before the commit. Not after every edit.
- Web-search volume is not the problem and is not capped.

## Reporting

Follow the user's global CLAUDE.md: the first line is `**ACTION NEEDED:**`
with only what the user must do, or `**No action needed.**`; then 1–3
sentences; then surprises under `FYI (no action needed):`, one bullet each,
saying inline if the issue is already handled. Never use ✅; write `[DONE]`.
