-- access_codes: one running dollar total per access code
-- (technical-plan.md D67, Phase 2e.1).
--
-- Each invited person is given an access code with a dollar cap on the model
-- calls their turns make. This table is the ledger behind that cap, and it is
-- the second of the two server-side writes the product makes (the first is
-- llm_usage). Like llm_usage it holds counters and nothing else: a derived
-- key, a cap, a running total, a disabled flag and a creation time.
--
-- The code itself is never stored. code_key is the first 32 hex chars of the
-- SHA-256 of the generated code, so a database dump cannot be turned back
-- into a working code. There is no label, name, session id or time of last
-- use: nowhere to put free text, and nothing that says who holds which code.
-- That mapping is known only to the operator and is written nowhere in the
-- repo or the database.
--
-- The table is closed to the browser: RLS on, no policies, every grant
-- revoked from anon and authenticated. The app reaches it only through the
-- two SECURITY DEFINER functions below, called with the publishable key.
-- Anyone can call them, but only with a 32-hex key they cannot guess, so the
-- worst a tester can do with their own key is use up their own budget.

create table public.access_codes (
  -- First 32 hex chars of sha256(code). Never the code itself.
  code_key   text primary key,
  -- The dollar cap for this code. Set by the operator's script, never in code.
  cap_usd    numeric(10, 6) not null,
  -- Running total of what this code's model calls have cost.
  spent_usd  numeric(12, 6) not null default 0,
  -- An operator switch: a disabled code is refused whatever its total.
  disabled   boolean not null default false,
  created_at timestamptz not null default now(),

  -- The shape is the guard, as on llm_usage: code_key can only be 32 hex
  -- chars, so no identifier or free text can be written into it. numeric
  -- accepts 'NaN' even with a typmod, and NaN sorts above every number, so it
  -- is excluded explicitly rather than relying on `>= 0`.
  constraint access_codes_code_key_shape check (code_key ~ '^[0-9a-f]{32}$'),
  constraint access_codes_cap_nonneg     check (cap_usd >= 0 and cap_usd <> 'NaN'::numeric),
  constraint access_codes_spent_nonneg   check (spent_usd >= 0 and spent_usd <> 'NaN'::numeric)
);

comment on table public.access_codes is
  'One running dollar total per access code (technical-plan.md D67). THERE ARE NO CONTENT OR IDENTITY COLUMNS AND NONE MAY BE ADDED: no code, label, name, session id, IP address, time of last use or free text of any kind. Who holds which code is known only to the operator and is written nowhere here. Closed to anon and authenticated (RLS on, no policies, no grants); the app reaches it only through access_code_budget() and access_code_add_spend().';
comment on column public.access_codes.code_key is
  'First 32 hex chars of the SHA-256 of the generated access code. The code itself is never stored. Constrained to that shape so no identifier or free text can be written here.';
comment on column public.access_codes.cap_usd is
  'Dollar cap on model calls for this code. Set by the operator when the code is made; never written into application code.';
comment on column public.access_codes.spent_usd is
  'Running total in dollars, raised only by access_code_add_spend() with the cost the app computed for each call. Not linked to any llm_usage row.';
comment on column public.access_codes.disabled is
  'Operator switch: a disabled code is refused regardless of its total.';

-- ---------------------------------------------------------------------------
-- RLS: closed. Same two layers as the other tables (grants and policies):
-- here both are empty, so a browser query is a hard permission error.
-- service_role keeps its grants and BYPASSRLS — the operator's script and
-- scripts/check-rls.ts use it.
-- ---------------------------------------------------------------------------

alter table public.access_codes enable row level security;

revoke all on table public.access_codes from anon, authenticated;

-- Deliberately no policies on access_codes.

-- ---------------------------------------------------------------------------
-- The only way in: two SECURITY DEFINER functions.
--
-- They run as their owner (postgres, the table owner, to whom RLS does not
-- apply), so the table needs no grant. search_path is empty so every
-- reference is schema-qualified and a caller cannot shadow a table or
-- operator. PUBLIC's default EXECUTE is revoked, as are Supabase's default
-- grants to anon and authenticated, then EXECUTE is granted back explicitly.
-- ---------------------------------------------------------------------------

-- The budget for one key: one row for a known key, no row for an unknown one.
create function public.access_code_budget(key text)
returns table (cap_usd numeric, spent_usd numeric, disabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.cap_usd, a.spent_usd, a.disabled
  from public.access_codes as a
  where a.code_key = access_code_budget.key;
$$;

-- Adds a dollar amount to one key's total in a single atomic UPDATE. Refuses
-- a null, negative, NaN or infinite amount (22023, invalid_parameter_value);
-- an unknown key matches no row, so it does nothing and creates nothing.
create function public.access_code_add_spend(key text, usd numeric)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if usd is null
     or usd = 'NaN'::numeric
     or usd = 'Infinity'::numeric
     or usd = '-Infinity'::numeric
     or usd < 0 then
    raise exception 'access_code_add_spend: amount must be a finite, non-negative number'
      using errcode = '22023';
  end if;

  update public.access_codes as a
  set spent_usd = a.spent_usd + usd
  where a.code_key = access_code_add_spend.key;
end;
$$;

revoke all on function public.access_code_budget(text) from public, anon, authenticated;
revoke all on function public.access_code_add_spend(text, numeric) from public, anon, authenticated;
grant execute on function public.access_code_budget(text) to anon, authenticated, service_role;
grant execute on function public.access_code_add_spend(text, numeric) to anon, authenticated, service_role;

comment on function public.access_code_budget(text) is
  'Returns (cap_usd, spent_usd, disabled) for a known code key, no row for an unknown one. Callable with the publishable key; the table itself is closed (technical-plan.md D67).';
comment on function public.access_code_add_spend(text, numeric) is
  'Adds a finite, non-negative dollar amount to a code key''s total in one atomic UPDATE. Raises 22023 for a null, negative, NaN or infinite amount; does nothing for an unknown key (technical-plan.md D67).';
