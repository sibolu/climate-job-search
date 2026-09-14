# research/

Background research that informs future PLAN.md steps but is not itself code.

Nothing in this folder is loaded at runtime, seeded into Supabase, or read by
any prompt. It exists so that a decision recorded later in PLAN.md §7 can point
at the evidence behind it instead of re-deriving it.

| Document | Question it answers |
|---|---|
| `skill-to-industry-grounding.md` | Which open, reputable datasets could back a "click a confirmed skill, see where it lands across climate industries" view — and which of them can also be used to check the LLM's claims |
| `deep-research-prompt.md` | Copy-pasteable prompt for a deep-research session to close the page-level verification gaps left open by the above |

Conventions: one topic per file, sources linked inline, and an explicit
"verified / not verified" status on any factual claim that a later
implementation would depend on.
