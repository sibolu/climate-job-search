-- Reference collection: the three tables seeded from data/*.yaml by
-- scripts/seed.ts (PLAN.md §2 "Reference data"). These explain climate fields
-- and roles; they are NOT a job index and never power search (PRD hard
-- constraint). They hold no user data of any kind.
--
-- Blocked sources are enforced here, in the schema, so no code path — seed
-- script, psql, a future admin tool — can store a LinkedIn / Indeed /
-- Climatebase URL as a source (PRD "no scraping"; PLAN.md §7).

-- ---------------------------------------------------------------------------
-- Host matching (one place, so it is testable)
-- ---------------------------------------------------------------------------

-- `private` is deliberately not in Supabase's exposed schemas, so nothing here
-- is reachable over PostgREST.
create schema if not exists private;
comment on schema private is
  'Internal helpers. Not exposed via PostgREST (see config.toml api.schemas).';

grant usage on schema private to postgres, anon, authenticated, service_role;

-- Lowercased host of an http(s) URL: scheme, userinfo, port, path, query and
-- fragment removed. NULL when the input has no host part.
create or replace function private.source_host(url text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    -- 4. drop the :port
    split_part(
      -- 3. keep what follows the last '@' (userinfo)
      reverse(split_part(reverse(
        -- 2. authority = everything before the first '/', '?' or '#'
        split_part(split_part(split_part(
          -- 1. drop the scheme
          regexp_replace(lower(btrim(coalesce(url, ''))), '^[a-z][a-z0-9+.\-]*://', ''),
        '/', 1), '?', 1), '#', 1)
      ), '@', 1)),
    ':', 1),
  '');
$$;

comment on function private.source_host(text) is
  'Lowercased host of a URL, or NULL. Used by is_blocked_source_host.';

-- The blocked list. Kept as a function (not a table) so it is part of the
-- migration history and cannot be edited away at runtime.
create or replace function private.blocked_source_domains()
returns text[]
language sql
immutable
parallel safe
as $$
  select array['linkedin.com', 'indeed.com', 'climatebase.org']::text[];
$$;

comment on function private.blocked_source_domains() is
  'PRD hard constraint: LinkedIn, Indeed and Climatebase are never sources.';

-- True when `url`''s host is one of the blocked domains or a subdomain of one.
-- Look-alikes (notlinkedin.com, indeed.com.example.org) are NOT blocked.
create or replace function private.is_blocked_source_host(url text)
returns boolean
language sql
immutable
parallel safe
as $$
  select exists (
    select 1
    from unnest(private.blocked_source_domains()) as d(domain)
    where private.source_host(url) = d.domain
       or private.source_host(url) like '%.' || d.domain
  );
$$;

comment on function private.is_blocked_source_host(text) is
  'True when the URL host is linkedin.com, indeed.com, climatebase.org or a subdomain.';

create or replace function private.has_blocked_source(urls text[])
returns boolean
language sql
immutable
parallel safe
as $$
  select exists (
    select 1
    from unnest(coalesce(urls, '{}'::text[])) as u(url)
    where private.is_blocked_source_host(u.url)
  );
$$;

comment on function private.has_blocked_source(text[]) is
  'True when any element of the array is a blocked source URL.';

grant execute on function private.source_host(text) to postgres, anon, authenticated, service_role;
grant execute on function private.blocked_source_domains() to postgres, anon, authenticated, service_role;
grant execute on function private.is_blocked_source_host(text) to postgres, anon, authenticated, service_role;
grant execute on function private.has_blocked_source(text[]) to postgres, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- climate_fields
-- ---------------------------------------------------------------------------

create table public.climate_fields (
  id                     text primary key,
  name                   text not null,
  sector_group           text not null,
  description            text not null,
  climate_link           text not null,
  transferable_functions text[] not null default '{}',
  sources                text[] not null default '{}',
  updated_at             timestamptz not null default now(),

  constraint climate_fields_id_is_slug
    check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint climate_fields_sources_allowed
    check (not private.has_blocked_source(sources))
);

comment on table public.climate_fields is
  'A climate field: what the work is, why it matters for climate, and which job functions transfer into it. Seeded from data/climate_fields.yaml; never written by the app.';
comment on column public.climate_fields.id is 'Stable slug, also the YAML key. Lowercase, hyphenated.';
comment on column public.climate_fields.sector_group is 'Coarse grouping used by the UI, e.g. "energy/grid/storage".';
comment on column public.climate_fields.climate_link is 'Why this field matters for climate, in plain language.';
comment on column public.climate_fields.transferable_functions is 'Job functions that transfer in, e.g. {marketing, software, video, finance}.';
comment on column public.climate_fields.sources is 'Public source URLs. LinkedIn / Indeed / Climatebase are rejected by climate_fields_sources_allowed.';

-- ---------------------------------------------------------------------------
-- example_roles
-- ---------------------------------------------------------------------------

create table public.example_roles (
  id                text primary key,
  field_id          text not null
                      references public.climate_fields (id)
                      on update cascade on delete cascade,
  title             text not null,
  "function"        text not null,
  day_to_day        text not null,
  example_companies text[] not null default '{}',
  sources           text[] not null default '{}',
  updated_at        timestamptz not null default now(),

  constraint example_roles_id_is_slug
    check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint example_roles_sources_allowed
    check (not private.has_blocked_source(sources))
);

create index example_roles_field_id_idx on public.example_roles (field_id);

comment on table public.example_roles is
  'A ROLE profile: what someone in this role does day to day. Never a personal profile — no real individual is described, named or linked (PRD "user control over the profile"; PLAN.md §7.6).';
comment on column public.example_roles."function" is 'The job function the role belongs to, e.g. marketing, software, video, finance.';
comment on column public.example_roles.day_to_day is 'What the ROLE involves day to day. Role profile, not a person.';
comment on column public.example_roles.sources is 'Public source URLs. LinkedIn / Indeed / Climatebase are rejected by example_roles_sources_allowed.';

-- ---------------------------------------------------------------------------
-- example_job_posts
-- ---------------------------------------------------------------------------

create table public.example_job_posts (
  id                   text primary key,
  field_id             text not null
                         references public.climate_fields (id)
                         on update cascade on delete cascade,
  role_id              text
                         references public.example_roles (id)
                         on update cascade on delete set null,
  title                text not null,
  company              text not null,
  requirements_summary text not null,
  source_url           text not null,
  posted_date          date,
  retrieved_at         date not null default current_date,

  constraint example_job_posts_id_is_slug
    check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint example_job_posts_source_url_allowed
    check (not private.is_blocked_source_host(source_url))
);

create index example_job_posts_field_id_idx on public.example_job_posts (field_id);
create index example_job_posts_role_id_idx on public.example_job_posts (role_id);

comment on table public.example_job_posts is
  'A handful of real, publicly reachable job posts per field, kept as illustrations of what employers ask for. Bounded and hand-curated: this is not a job index and does not power search (PRD hard constraint).';
comment on column public.example_job_posts.requirements_summary is
  'A short summary of the requirements, written by the curator. Not a copy of the post.';
comment on column public.example_job_posts.source_url is
  'Company career page or a board that permits access. LinkedIn / Indeed / Climatebase are rejected by example_job_posts_source_url_allowed.';
comment on column public.example_job_posts.retrieved_at is 'When the curator read the post — posts go stale.';
