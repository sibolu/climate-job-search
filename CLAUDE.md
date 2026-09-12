# Claude Code conventions for this repo

- **Read PLAN.md first.** It is the roadmap, the decisions log (§7), and the
  operating agreement for autonomous phase execution (§5). Update step
  statuses there as work completes.
- **Record decisions in the repo, not in memory.** New architectural
  decisions or constraints go into PLAN.md §7 (and README.md if they affect
  contributors) in the same commit as the change. Do not rely on Claude's
  private memory for anything another contributor would need.
- **Model policy** (PLAN.md §4): Fable orchestrates and owns quality-critical
  steps; Opus does the coding; escalate a blocked Opus task to Fable.
- **Hard constraints** (PRD.md): no scraping LinkedIn, Indeed, or Climatebase;
  no job index; no model training; no user data stored server-side.
- **Prompts** live as plain template strings in `src/lib/*.ts`, one module
  each, so they can be edited without touching React.
- **Reporting** follows the user's global CLAUDE.md: action line first, 1–3
  sentence summary, gotchas under `FYI (no action needed):`.

Phase 0.1 expands this file with build, lint, and test commands.
