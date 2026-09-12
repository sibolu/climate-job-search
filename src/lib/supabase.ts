/**
 * Supabase clients. Two of them, and only two.
 *
 * - {@link anonClient} — the anon key. Select-only on the three reference
 *   tables, insert-only on `llm_usage`, nothing else (see
 *   `supabase/migrations/*_rls_policies.sql`). Safe in the browser; that is
 *   the whole point of the RLS shape.
 * - {@link serviceClient} — the service role key. Bypasses RLS, so it is
 *   restricted to `scripts/seed.ts` and `scripts/check-rls.ts`. It throws if
 *   it is ever reached from a browser bundle.
 *
 * Supabase holds the reference collection and the anonymous `llm_usage` rows
 * and nothing else: no profiles, no transcripts, no user content of any kind
 * (PRD "no user data stored server-side", PLAN.md §7.3–7.4).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

export type ReferenceDatabase = Database;
export type TypedSupabaseClient = SupabaseClient<Database>;

/** Thrown when a client is asked for without the env vars it needs. */
export class SupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigError";
  }
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new SupabaseConfigError(
      `${name} is not set. Copy .env.example to .env.local; for the local stack, ` +
        "run `pnpm db:start` and take the values from `supabase status -o env`.",
    );
  }
  return value;
}

const NO_PERSISTENCE = {
  auth: {
    // There are no accounts (PLAN.md §7.5). Never write a session to storage
    // and never try to refresh one.
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
} as const;

let cachedAnon: TypedSupabaseClient | undefined;

/**
 * Read-only client for the reference collection, plus the one allowed write
 * (an anonymous `llm_usage` row). Usable in the browser and on the server.
 */
export function anonClient(): TypedSupabaseClient {
  if (cachedAnon !== undefined) return cachedAnon;
  const url = required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  cachedAnon = createClient<Database>(url, key, NO_PERSISTENCE);
  return cachedAnon;
}

/**
 * Full-access client used by the repo's scripts only (`pnpm seed`,
 * `pnpm db:check-rls`). Never import this from a React component or a route
 * handler: it bypasses RLS.
 *
 * The guard is a `typeof window` check rather than `import "server-only"`
 * because these scripts run under `tsx`, where the `server-only` package
 * resolves to its client build and throws.
 */
export function serviceClient(): TypedSupabaseClient {
  if (typeof window !== "undefined") {
    throw new SupabaseConfigError(
      "serviceClient() was called in a browser. The service role key bypasses RLS and must " +
        "never reach the client bundle; use anonClient() instead.",
    );
  }
  const url = required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const key = required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
  return createClient<Database>(url, key, NO_PERSISTENCE);
}
