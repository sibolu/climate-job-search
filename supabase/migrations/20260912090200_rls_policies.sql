-- Row level security for all four tables.
--
-- The shape the product needs, and nothing wider:
--   * reference tables — anon may SELECT, and that is all. They are written
--     only by scripts/seed.ts from data/*.yaml, using the service role.
--   * llm_usage       — anon may INSERT, and that is all. It cannot read back
--     its own rows, so the table can never be used to fetch anything about
--     anyone.
--
-- `authenticated` gets exactly the same as `anon`: there are no accounts
-- (PLAN.md §7.5), but the role exists in every Supabase project, so it is
-- pinned down rather than left at Supabase's defaults.
--
-- Two layers on purpose: table grants (a hard permission error) and policies
-- (a filtered result). Either alone would be enough; together, a mistake in
-- one is caught by the other. `service_role` has BYPASSRLS and keeps its
-- grants — that is what seed.ts uses.

-- ---------------------------------------------------------------------------
-- climate_fields
-- ---------------------------------------------------------------------------

alter table public.climate_fields enable row level security;

revoke all on table public.climate_fields from anon, authenticated;
grant select on table public.climate_fields to anon, authenticated;

create policy climate_fields_anon_select
  on public.climate_fields
  for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- example_roles
-- ---------------------------------------------------------------------------

alter table public.example_roles enable row level security;

revoke all on table public.example_roles from anon, authenticated;
grant select on table public.example_roles to anon, authenticated;

create policy example_roles_anon_select
  on public.example_roles
  for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- example_job_posts
-- ---------------------------------------------------------------------------

alter table public.example_job_posts enable row level security;

revoke all on table public.example_job_posts from anon, authenticated;
grant select on table public.example_job_posts to anon, authenticated;

create policy example_job_posts_anon_select
  on public.example_job_posts
  for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- llm_usage — insert only, never readable by the browser
-- ---------------------------------------------------------------------------

alter table public.llm_usage enable row level security;

revoke all on table public.llm_usage from anon, authenticated;
grant insert on table public.llm_usage to anon, authenticated;

create policy llm_usage_anon_insert
  on public.llm_usage
  for insert
  to anon, authenticated
  with check (true);

-- Deliberately no SELECT, UPDATE or DELETE policy on llm_usage: a browser can
-- add a usage row and can never read one back.
