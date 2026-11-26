# Deploying the hosted demo

Production URL: `https://climate-job-search.vercel.app`

Status, 2026-11-26: deployed. Supabase project `thqugwlqlpflgtndymus` has
the migrations and the RLS shape; the production domain serves `phase-2d`
(promoted from its preview, since `main` does not have Phase 2d until PR #7
merges). Open: the first full loop on production, which is PLAN.md G2d.1.

This runbook covers the hosted demo (PLAN.md step 2d.3). Steps marked **You**
need an account owner; steps marked **Claude** can be run by an agent from
this repo once the projects exist. Nothing here contains a secret: every key
and passcode is a placeholder and lives only in Vercel, Supabase or your
shell. The Supabase project ref is not a secret: it is part of the public
URL the browser calls.

## What is where

| Place | Holds |
|---|---|
| Vercel | The Next.js app, the passcode gate (`src/proxy.ts`) and the route handlers (`/api/enter`, `/api/turn`). Stateless: no user data is kept. |
| Supabase (production project) | `llm_usage` (one anonymous row per model call: random session id, step, model, token counts, cost, duration; no content) and the three reference tables, left empty because the app reads none of them at run time yet. |
| Anthropic | The model calls, made only from `src/lib/llm.ts` with the server-only `ANTHROPIC_API_KEY`. |
| The visitor's browser | Everything about the user: `profile.md` (pasted resume included), chosen roles and searches, in `localStorage`. |

## First deploy

1. **You: create the Supabase production project.** A new project, separate
   from any existing one in the account. Note its project ref, URL, publishable key,
   secret key and database password; keep them in a password manager.
2. **You: create the Vercel project** from the GitHub repo (framework Next.js,
   build command `next build`, the default). In Settings:
   - Node.js version **24.x** (the repo has no `engines` field or `.nvmrc`, so
     Vercel would otherwise use its default).
   - pnpm: `package.json` pins `pnpm@12.4.1` through `packageManager`, but
     the lockfile header is `lockfileVersion: '9.0'`, which Vercel's
     detection may map to an older pnpm. Set `ENABLE_EXPERIMENTAL_COREPACK=1`
     so Vercel uses the pinned version.
   - **Plan: Pro.** `/api/turn` declares `maxDuration = 800` (equal to
     `MAX_DURATION_SECONDS` in `src/lib/llm.ts`). Vercel's limit with fluid
     compute is 300 s on Hobby and 800 s on Pro and Enterprise. One model call
     is bounded at 3 minutes (`CALL_TIMEOUT_MS`), but a turn can make a few
     calls in sequence. On Hobby the 800 s value is over the limit: expect
     the build to reject it or the function to stop at 300 s with a 504
     (`FUNCTION_INVOCATION_TIMEOUT`); which of the two is not verified.
3. **You: set the environment variables** in Vercel (Production, and Preview
   if you use previews):

   | Name | Scope | Value |
   |---|---|---|
   | `APP_PASSCODE` | server-only | The shared passcode you choose for fellows |
   | `PASSCODE_COOKIE_SECRET` | server-only | `openssl rand -base64 32`, generated once for production |
   | `ANTHROPIC_API_KEY` | server-only | A key from an Anthropic organisation with 30-day data retention (not zero data retention): the `discover` step runs on `claude-fable-5-2`, which needs it; the other steps run on `claude-opus-5-5` |
   | `NEXT_PUBLIC_SUPABASE_URL` | public | `https://<project-ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | The production publishable key |
   | `ENABLE_EXPERIMENTAL_COREPACK` | build | `1` |

   **Do not set `SUPABASE_SECRET_KEY` in Vercel.** It bypasses RLS and
   only the scripts use it (`seed.ts`, `check-rls.ts`, `smoke-llm.ts`); no app
   code reads it. Never give a server-only variable a `NEXT_PUBLIC_` prefix.
   `NEXT_PUBLIC_*` values are baked in at build time, so changing them needs a
   redeploy.
4. **Claude: push the three migrations** (`supabase/migrations/`:
   `20260912090000_reference_tables.sql`, `20260912090100_llm_usage.sql`,
   `20260912090200_rls_policies.sql`). The Supabase account holds another,
   unrelated project: always pass the new ref explicitly and check it before
   pushing.

   ```bash
   supabase link --project-ref <project-ref>   # logged-in CLI 2.95: no password asked
   cat supabase/.temp/project-ref              # must print <project-ref>
   supabase db push --dry-run                  # lists the three files only
   supabase db push
   ```

   `supabase/.temp/` is gitignored. No `pnpm seed`: the app reads no
   reference table yet.
5. **Claude: check RLS against production** before the URL is shared. Supply
   all three values from the shell for this one command, never in a file.
   Call `tsx` directly so `.env.local` is not loaded at all (Node gives shell
   variables precedence over `--env-file`, but any variable you forgot would
   silently come from the local stack through `pnpm db:check-rls`):

   ```bash
   read -rs SK   # paste the production secret key, not echoed
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co \
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key> \
   SUPABASE_SECRET_KEY="$SK" \
     pnpm exec tsx scripts/check-rls.ts; unset SK
   ```

   It exits non-zero on any violation. It writes probe rows only to
   `llm_usage` (plus one `climate_fields` insert the CHECK constraint must
   reject) and deletes what it wrote.

   The secret key has to come from the dashboard (Settings, API keys):
   `supabase projects api-keys` prints it masked, and a masked or wrong key
   fails the four service-role checks with `Invalid API key`. In that case
   the clean-up fails too (it uses the secret key) and one anon probe row
   stays in `llm_usage`; the warning prints its session id. Delete it with
   `supabase db query --linked "delete from llm_usage where session_id = '<id>'"`.
6. **You, then Claude: deploy and verify.** Get the commit to demo onto the
   production domain (see "Which deployment is production" below) and check
   the build log shows Node 24 and pnpm 12. Then, from a clean browser
   window:
   - a wrong passcode on `/enter` is refused;
   - the right one leads through paste → Highlights → Roles → Searches;
   - new rows appear in `llm_usage` (query below), one per model call.

## Which deployment is production

Vercel builds every push, but only a build of the production branch (`main`)
is served on the production domain. A push to any other branch, `phase-2d`
included, gives a preview deployment at a `…-<team>.vercel.app` URL, and
previews sit behind Vercel Authentication: a visitor without a Vercel login
is redirected to `vercel.com/sso-api`, so a preview cannot be the demo URL
as it stands.

To serve a branch before it is merged, either promote its latest preview
deployment to production in the dashboard (Deployments, the deployment's
menu, "Promote to Production"; Vercel rebuilds it with the Production
environment variables), or change the production branch in Settings, Git.

How to tell what a domain serves, without logging in:

```bash
curl -s https://<domain>/enter | grep -o '<html[^>]*>'
# a build from Phase 2b or later carries the font classes on <html>;
# the 2026-09-13 build prints only data-dpl-id and lang="en"
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  --data-urlencode 'passcode=wrong' https://<domain>/api/enter
# 401: the gate works. 500: APP_PASSCODE or PASSCODE_COOKIE_SECRET is
# missing from that deployment (variables apply from the next deploy on)
```

GitHub records each Vercel deployment and its state:
`gh api "repos/<owner>/<repo>/deployments?environment=Production"`, then
`…/deployments/<id>/statuses`. "Deployment was blocked" is Vercel refusing
the deploy before the build; the reason is on the deployment's page in the
Vercel dashboard. From 2026-09-18 to 2026-11-25 the reason was a paused
Vercel project: previews of a paused project still build, production
deployments do not, and the production domain keeps serving the last build
from before the pause.

## Rotating the passcode

Change `APP_PASSCODE` in Vercel and redeploy. New visitors need the new
passcode, but anyone already signed in keeps working: the session cookie
(`v1.<expiry>.<hmac>`, `src/lib/passcode.ts`) carries no passcode, only an
expiry 30 days out, signed with `PASSCODE_COOKIE_SECRET`. To sign everyone
out at once, also replace `PASSCODE_COOKIE_SECRET` with a fresh
`openssl rand -base64 32` value and redeploy (or bump `SESSION_VERSION` in
`passcode.ts`, which needs a commit).

## Reading `llm_usage`

The publishable key can insert rows but not read them, so read in the Supabase
dashboard's SQL editor (or with the secret key from a shell). Rows hold
counters only; there is no prompt, reply or resume text to find.

```sql
-- Spend per day
select date_trunc('day', created_at) as day, count(*) as calls,
       round(sum(cost_usd), 2) as usd
from llm_usage group by 1 order by 1 desc;

-- Spend and latency per step and model
select step, model, count(*) as calls, round(sum(cost_usd), 2) as usd,
       round(avg(duration_ms) / 1000.0, 1) as avg_seconds
from llm_usage group by 1, 2 order by usd desc;

-- Heaviest sessions (random ids, not people)
select session_id, count(*) as calls, round(sum(cost_usd), 2) as usd,
       min(created_at) as first_call
from llm_usage group by 1 order by usd desc limit 20;
```

## Not there yet

There is no per-session spend cap and no feedback-form link; both come with
the full deploy (PLAN.md step 3.3). Until then the passcode is the only guard
on spend: share it narrowly and watch `llm_usage`.
