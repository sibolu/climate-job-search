-- llm_usage: the ONE server-side write this product ever makes
-- (PRD "no user data stored server-side"; PLAN.md §2 "Cost telemetry", §7.4).
--
-- It exists for two reasons only: a per-session spend cap, and evidence for a
-- later "is Sonnet good enough for chat turns?" decision. It therefore stores
-- counters and nothing else.

create table public.llm_usage (
  id                          uuid primary key default gen_random_uuid(),
  -- Random per-browser id from session.ts (`newSessionId()`): 32 hex chars.
  -- Not an account, not derived from anything about the person, and never
  -- joined to anything. The CHECK below pins that shape.
  session_id                  text not null,
  -- Which lib module made the call: cards | elicit | discover | explore |
  -- queries | revise (session.ts StepName). A fixed vocabulary, not free text.
  step                        text not null,
  model                       text not null,
  input_tokens                int,
  output_tokens               int,
  cache_read_input_tokens     int,
  cache_creation_input_tokens int,
  cost_usd                    numeric(10, 6),
  duration_ms                 int,
  created_at                  timestamptz not null default now(),

  -- The shape of these columns is the guard, not a comment. The anon key is
  -- public and INSERT on this table is open by design, so anything a browser
  -- can put here must be unable to carry content or an identifier: session_id
  -- is exactly the 32 hex chars session.ts generates, and step is the closed
  -- StepName vocabulary. Free text has nowhere to go.
  constraint llm_usage_session_id_shape check (session_id ~ '^[0-9a-f]{32}$'),
  constraint llm_usage_step_vocab       check (
    step in ('cards', 'elicit', 'discover', 'explore', 'queries', 'revise')
  ),
  constraint llm_usage_model_len        check (char_length(model) between 1 and 80),
  constraint llm_usage_counts_nonneg    check (
    coalesce(input_tokens, 0) >= 0
    and coalesce(output_tokens, 0) >= 0
    and coalesce(cache_read_input_tokens, 0) >= 0
    and coalesce(cache_creation_input_tokens, 0) >= 0
    and coalesce(cost_usd, 0) >= 0
    and coalesce(duration_ms, 0) >= 0
  )
);

-- The per-session spend cap (Phase 3.3) sums cost_usd for one session id over
-- a time window; this is the index it reads.
create index llm_usage_session_created_idx on public.llm_usage (session_id, created_at);

comment on table public.llm_usage is
  'Anonymous cost telemetry. THERE ARE NO CONTENT COLUMNS AND NONE MAY BE ADDED: no prompts, completions, resume text, chat messages, profile text, IP addresses or identifiers of any kind. The PRD forbids storing user data server-side; this table is the single, deliberate exception and it stays counters-only so that exception costs the user nothing. Rows are written by anon (insert-only RLS) and read back only by the maintainer via the service role.';
comment on column public.llm_usage.session_id is
  'Random 32-hex-character id generated in the browser, used only to group rows for the per-session spend cap. Anonymous by construction, and constrained to that shape so no identifier or free text can be written here.';
comment on column public.llm_usage.step is
  'Name of the lib module that made the call. A closed vocabulary (session.ts StepName), enforced by a CHECK constraint, never user text.';
comment on column public.llm_usage.cost_usd is
  'Computed in the app from token counts and the model price list.';
