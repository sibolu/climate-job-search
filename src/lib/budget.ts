/**
 * The access-code ledger (technical-plan.md D67, Phase 2e.1).
 *
 * Each invited person holds an access code with a dollar cap on the model
 * calls their turns make. The running total lives in `public.access_codes`,
 * which the browser's key cannot touch directly: the app reaches it only
 * through two SECURITY DEFINER functions, `access_code_budget(key)` and
 * `access_code_add_spend(key, usd)`, called with the publishable key.
 *
 * A code key is the first 32 hex chars of the SHA-256 of the code; the code
 * itself is never stored or sent here. Nothing in this module logs anything:
 * no code, no key, no amount, no database message. A failure surfaces as a
 * `BudgetLedgerError` that carries the Postgres/PostgREST error code only.
 *
 * - {@link supabaseBudgetLedger} is the ledger route handlers use.
 * - {@link memoryBudgetLedger} mirrors the SQL for tests and local scripts.
 * - {@link budgetVerdict} is the pure decision over a read.
 */

import { anonClient } from "./supabase";

export interface BudgetState {
  capUsd: number;
  spentUsd: number;
  disabled: boolean;
}

export interface BudgetLedger {
  /** The code's budget, or null for an unknown key. Rejects with BudgetLedgerError when the ledger cannot be read. */
  read(codeKey: string): Promise<BudgetState | null>;
  /** Adds a non-negative dollar amount to the code's total. Rejects with BudgetLedgerError on failure. */
  addSpend(codeKey: string, usd: number): Promise<void>;
}

/** The SQLSTATE `access_code_add_spend` raises for a bad amount (invalid_parameter_value). */
export const INVALID_AMOUNT_CODE = "22023";

/**
 * A ledger read or write failed. The message names the operation only and
 * `code` is the Postgres/PostgREST error code (or null when there was none):
 * never a key, an amount or a message from the database.
 */
export class BudgetLedgerError extends Error {
  readonly code: string | null;

  constructor(operation: "read" | "addSpend", code: string | null) {
    super(`Budget ledger ${operation} failed${code === null ? "" : ` (${code})`}`);
    this.name = "BudgetLedgerError";
    this.code = code;
  }
}

export type BudgetVerdict = "allowed" | "exhausted" | "inactive";

/**
 * Whether a code may make another call. Unknown (null) or disabled is
 * "inactive"; a total at or over the cap is "exhausted". A non-finite cap or
 * total fails closed as "exhausted".
 */
export function budgetVerdict(state: BudgetState | null): BudgetVerdict {
  if (state === null || state.disabled) return "inactive";
  if (!Number.isFinite(state.capUsd) || !Number.isFinite(state.spentUsd)) return "exhausted";
  return state.spentUsd >= state.capUsd ? "exhausted" : "allowed";
}

function isValidAmount(usd: number): boolean {
  return typeof usd === "number" && Number.isFinite(usd) && usd >= 0;
}

function errorCode(error: { code?: string | null } | null | undefined): string | null {
  const code = error?.code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/** PostgREST returns `numeric` as a number or a string depending on version. */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The ledger over `public.access_codes`, through the publishable key's RPCs. */
export function supabaseBudgetLedger(): BudgetLedger {
  return {
    async read(codeKey) {
      let result;
      try {
        result = await anonClient().rpc("access_code_budget", { key: codeKey });
      } catch {
        throw new BudgetLedgerError("read", null);
      }
      if (result.error !== null) throw new BudgetLedgerError("read", errorCode(result.error));
      const rows: unknown[] = Array.isArray(result.data) ? result.data : [];
      if (rows.length === 0) return null;
      const row = rows[0] as { cap_usd?: unknown; spent_usd?: unknown; disabled?: unknown };
      const capUsd = toFiniteNumber(row.cap_usd);
      const spentUsd = toFiniteNumber(row.spent_usd);
      if (capUsd === null || spentUsd === null || typeof row.disabled !== "boolean") {
        throw new BudgetLedgerError("read", null);
      }
      return { capUsd, spentUsd, disabled: row.disabled };
    },

    async addSpend(codeKey, usd) {
      if (!isValidAmount(usd)) throw new BudgetLedgerError("addSpend", INVALID_AMOUNT_CODE);
      let result;
      try {
        result = await anonClient().rpc("access_code_add_spend", { key: codeKey, usd });
      } catch {
        throw new BudgetLedgerError("addSpend", null);
      }
      if (result.error !== null) throw new BudgetLedgerError("addSpend", errorCode(result.error));
    },
  };
}

export interface MemoryBudgetLedger extends BudgetLedger {
  /** A copy of the code's current state, or null for an unknown key. */
  snapshot(codeKey: string): BudgetState | null;
  /** Adds or replaces a code, as the operator's script would. */
  set(codeKey: string, state: BudgetState): void;
}

/**
 * An in-memory ledger that mirrors the SQL functions: `addSpend` refuses a
 * negative or non-finite amount and does nothing for an unknown key.
 */
export function memoryBudgetLedger(initial: Record<string, BudgetState> = {}): MemoryBudgetLedger {
  const codes = new Map<string, BudgetState>(
    Object.entries(initial).map(([key, state]) => [key, { ...state }]),
  );
  return {
    async read(codeKey) {
      const state = codes.get(codeKey);
      return state === undefined ? null : { ...state };
    },
    async addSpend(codeKey, usd) {
      if (!isValidAmount(usd)) throw new BudgetLedgerError("addSpend", INVALID_AMOUNT_CODE);
      const state = codes.get(codeKey);
      if (state !== undefined) state.spentUsd += usd;
    },
    snapshot(codeKey) {
      const state = codes.get(codeKey);
      return state === undefined ? null : { ...state };
    },
    set(codeKey, state) {
      codes.set(codeKey, { ...state });
    },
  };
}
