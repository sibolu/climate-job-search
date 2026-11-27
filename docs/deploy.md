# Deploying the hosted demo

Production URL: `https://climate-job-search.vercel.app`

Status, 2026-11-25: deployed. Supabase project `thqugwlqlpflgtndymus` has
the migrations and the RLS shape; the production domain serves `phase-2d`
(promoted from its preview, since `main` does not have Phase 2d until PR #7
merges). The full loop works there (G2d.1). Open: confirming on production
that every call's `llm_usage` row lands, after the D64 fix is deployed.
(D64 was confirmed on 2026-11-26.) Phase 2e (an access code per person,
each with a spend cap) needs one more migration and the codes issued before
it is deployed: see "Access codes and spend caps" below.

This runbook covers the hosted demo (PLAN.md step 2d.3). Steps marked **You**
need an account owner; steps marked **Claude** can be run by an agent from
this repo once the projects exist. Nothing here contains a secret: every key
and passcode is a placeholder and lives only in Vercel, Supabase or your
shell. The Supabase project ref is not a secret: it is part of the public
URL the browser calls.

## What is where

| Place | Holds |
|---|---|
| Vercel | The Next.js app, the session-cookie gate (`src/proxy.ts`) and the route handlers (`/api/enter`, which checks an access code, and `/api/turn`). Stateless: no user data is kept. |
| Supabase (production project) | `llm_usage` (one anonymous row per model call: random session id, step, model, token counts, cost, duration; no content); `access_codes` (per code: a derived key, a dollar cap, the running total, a disabled flag, a creation time; no content, no identity), closed to the app except through the functions `access_code_budget` and `access_code_add_spend`; and the three reference tables, left empty because the app reads none of them at run time. |
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
   | `OPERATOR_PASSCODE` | server-only | Optional. The operator passcode: it enters without an access code and its calls are **not capped**. Leave it unset in Vercel, or keep it to yourself and make it a fresh value, never the passcode once shared with fellows; never give it to a tester |
   | `PASSCODE_COOKIE_SECRET` | server-only | `openssl rand -base64 32`, generated once for production |
   | `ANTHROPIC_API_KEY` | server-only | A key from an Anthropic organisation with 30-day data retention (not zero data retention): the `discover` step runs on `claude-fable-5-2`, which needs it; the other steps run on `claude-opus-5-5` |
   | `NEXT_PUBLIC_SUPABASE_URL` | public | `https://<project-ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | The production publishable key |
   | `ENABLE_EXPERIMENTAL_COREPACK` | build | `1` |

   **Do not set `SUPABASE_SECRET_KEY` in Vercel.** It bypasses RLS and
   only the scripts use it (`seed.ts`, `check-rls.ts`, `smoke-llm.ts`,
   `access-codes.ts`); no app
   code reads it. Never give a server-only variable a `NEXT_PUBLIC_` prefix.
   `NEXT_PUBLIC_*` values are baked in at build time, so changing them needs a
   redeploy.
4. **Claude: push the migrations** (`supabase/migrations/`:
   `20260912090000_reference_tables.sql`, `20260912090100_llm_usage.sql`,
   `20260912090200_rls_policies.sql`, and since Phase 2e
   `20261126090000_access_codes.sql`). The Supabase account holds another,
   unrelated project: always pass the new ref explicitly and check it before
   pushing.

   ```bash
   supabase link --project-ref <project-ref>   # logged-in CLI 2.95: no password asked
   cat supabase/.temp/project-ref              # must print <project-ref>
   supabase db push --dry-run                  # lists only the files not yet applied
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
   `llm_usage` and one `access_codes` row (plus inserts the CHECK
   constraints must reject) and deletes what it wrote.

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
   - a wrong code on `/enter` is refused;
   - a code from `codes:add` (see "Access codes and spend caps") leads
     through paste → Highlights → Roles → Searches;
   - new rows appear in `llm_usage` (query below), one per model call, and
     that code's total in `codes:list` has gone up.

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
  --data-urlencode 'code=wrong' https://<domain>/api/enter
# 401: the gate works ("wrong" cannot be a code, so no database read).
# 500: PASSCODE_COOKIE_SECRET is missing from that deployment (variables
# apply from the next deploy on). OPERATOR_PASSCODE may be unset: then only
# access codes enter.
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  --data-urlencode 'code=0000-0000-0000-0000' https://<domain>/api/enter
# A well-formed code nobody was issued, so the ledger is read.
# 401: Supabase is reachable and the access_codes migration is applied.
# 503: the ledger cannot be read (Supabase variables missing on that
# deployment, or the migration not pushed).
# A build from before Phase 2e reads the field `passcode`, not `code`.
```

GitHub records each Vercel deployment and its state:
`gh api "repos/<owner>/<repo>/deployments?environment=Production"`, then
`…/deployments/<id>/statuses`. "Deployment was blocked" is Vercel refusing
the deploy before the build; the reason is on the deployment's page in the
Vercel dashboard. From 2026-09-18 to 2026-11-25 the reason was a paused
Vercel project: previews of a paused project still build, production
deployments do not, and the production domain keeps serving the last build
from before the pause.

## Access codes and spend caps

Each invited person gets their own access code, `XXXX-XXXX-XXXX-XXXX`, with
a dollar cap (`docs/technical-plan.md` D67–D69). The database stores only a
key derived from the code, the cap, the running total, a disabled flag and
the creation time. The pilot's cap is **$5 per code**, about fifteen full
loops at the $0.334 a loop measured on 2026-11-26.

**Run every `codes:*` command in your own terminal, never in a Claude
session:** `codes:add` prints each new code once, it cannot be recovered,
and a code in a transcript is a code someone else can use. Keep the list of
who has which code outside the repo and the database; the database has no
column for it.

`pnpm codes:*` loads `.env.local`, which points at the local stack. For
production, call `tsx` directly so `.env.local` is not loaded, with the URL
and the production secret key from your shell (the script needs only those
two). Each command prints `Database: <host>` first: check it before reading
on.

```bash
read -rs SK   # paste the production secret key, not echoed
codes() {
  NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co \
  SUPABASE_SECRET_KEY="$SK" pnpm exec tsx scripts/access-codes.ts "$@"
}
# ... the commands below, then:
unset SK; unset -f codes
```

1. **Apply the migration** before deploying Phase 2e:
   `supabase db push --dry-run` must list only
   `20261126090000_access_codes.sql`; then `supabase db push`, then the RLS
   check against production (First deploy, step 5), which now also asserts
   that `access_codes` is closed and how the two functions behave. The
   migration only adds, so the build already deployed keeps working.
2. **Issue codes:** `codes add --cap 5 --count <n>` prints `<n>` codes,
   each beside the first 8 characters of its key. Note which person gets
   which key prefix (that is how you find their row later), then hand each
   code over directly. `--cap` is required; there is no default.
3. **Deploy Phase 2e.** The new session cookie (`v2`) refuses the old one,
   so everyone is signed out once and comes back in with their code.
4. **Read the totals:** `codes list` prints each code's key prefix, cap,
   total, state (`enabled` or `disabled`) and creation time.
5. **Raise a cap:** `codes set <key-prefix> --cap <usd>`. The prefix must
   match exactly one code.
6. **Disable a code:** `codes set <key-prefix> --disable` (`--enable`
   undoes it). The code is then refused at `/enter` with "That access code
   wasn't recognised. Check it and try again, or ask the person who invited
   you." A session already open keeps its pages, but its next model call is
   refused with "This access code is no longer active, so I can't run that.
   Everything you have so far is still in this browser, and you can save a
   copy from Your profile. Ask the person who invited you for a new code."

**At the cap**, the person can still enter and read or export their
profile. Their next model call is refused, nothing is run, and the turn
ends with "This access code has used up its budget, so I can't run that.
Everything you have so far is still in this browser, and you can save a
copy from Your profile." If the budget cannot be read, the call is refused
too (it fails closed) and the sentence asks them to try again in a minute.

**The operator passcode** (`OPERATOR_PASSCODE`, optional) is for you and local
work only. It is compared before any code; its sessions carry no key, so
their calls are not checked or charged. The `try:*` scripts and
`smoke:llm` are not metered either.

**What the cap does not guarantee:**

- The check is before each call and the charge after it, so a code can go
  over its cap by the calls in flight when it crosses: one call in ordinary
  use, cents.
- A charge that fails to land is a warning in the function log (error code
  only) and is not retried: the total undercounts.
- The budget is checked per call, not per turn, so in the turn where a code
  crosses its cap a later call can be refused after an earlier one was
  charged (a paste turn makes two), and that turn's output is lost
  (`docs/backlog.md` §5).
- Keep an organisation-level spend limit in the Claude Console as the
  backstop for all three.

## Rotating access

- **One person:** disable their code (`codes set <key-prefix> --disable`)
  and issue them a new one. Their old total stays on the old row.
- **Everyone signed out at once:** replace `PASSCODE_COOKIE_SECRET` with a
  fresh `openssl rand -base64 32` value and redeploy, or bump
  `SESSION_VERSION` in `src/lib/passcode.ts`, which needs a commit. The
  session cookie (`v2.<expiry>.<scope>.<hmac>`) carries the code's derived
  key or `operator`, never a code, signed with `PASSCODE_COOKIE_SECRET`.
  No secret goes into a code's key, so rotating the secret resets nobody's
  total; people come back in with the same code.
- **The operator passcode:** change or remove `OPERATOR_PASSCODE` in Vercel and
  redeploy. `APP_PASSCODE`, the Phase 2d shared passcode, is no longer read
  (technical-plan.md D70): delete it from Vercel, since it does nothing. Sessions already open with it keep working until they expire
  (30 days) or the secret is rotated.

## Reading `llm_usage`

The publishable key can insert rows but not read them, so read in the Supabase
dashboard's SQL editor (or with the secret key from a shell). Rows hold
counters only; there is no prompt, reply or resume text to find.

A missing row for the last call of a turn (`discover`, `queries`) was the
symptom of the function being suspended before its insert landed; the turn
route now waits up to 5s for pending inserts after the response
(`docs/technical-plan.md` D64).

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

The feedback-form link comes with the full deploy (PLAN.md step 3.3).
Spend is capped per access code (above); there is no view of the remaining
budget in the app (`docs/backlog.md` §5).
