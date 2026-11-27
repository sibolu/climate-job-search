import { describe, expect, it } from "vitest";

import {
  BudgetLedgerError,
  INVALID_AMOUNT_CODE,
  budgetVerdict,
  memoryBudgetLedger,
} from "./budget";

const KEY = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";

describe("budgetVerdict", () => {
  it("allows a code under its cap", () => {
    expect(budgetVerdict({ capUsd: 5, spentUsd: 4.99, disabled: false })).toBe("allowed");
  });

  it("is exhausted at the cap", () => {
    expect(budgetVerdict({ capUsd: 5, spentUsd: 5, disabled: false })).toBe("exhausted");
  });

  it("is exhausted over the cap", () => {
    expect(budgetVerdict({ capUsd: 5, spentUsd: 7.2, disabled: false })).toBe("exhausted");
  });

  it("is exhausted for a zero cap", () => {
    expect(budgetVerdict({ capUsd: 0, spentUsd: 0, disabled: false })).toBe("exhausted");
  });

  it("is inactive when disabled, even with budget left", () => {
    expect(budgetVerdict({ capUsd: 5, spentUsd: 0, disabled: true })).toBe("inactive");
  });

  it("is inactive for an unknown code", () => {
    expect(budgetVerdict(null)).toBe("inactive");
  });

  it("fails closed on non-finite numbers", () => {
    expect(budgetVerdict({ capUsd: 5, spentUsd: Number.NaN, disabled: false })).toBe("exhausted");
    expect(budgetVerdict({ capUsd: Number.NaN, spentUsd: 0, disabled: false })).toBe("exhausted");
    expect(budgetVerdict({ capUsd: Infinity, spentUsd: 0, disabled: false })).toBe("exhausted");
  });
});

describe("memoryBudgetLedger", () => {
  it("reads a known code and returns null for an unknown one", async () => {
    const ledger = memoryBudgetLedger({ [KEY]: { capUsd: 5, spentUsd: 1, disabled: false } });
    expect(await ledger.read(KEY)).toEqual({ capUsd: 5, spentUsd: 1, disabled: false });
    expect(await ledger.read(OTHER)).toBeNull();
  });

  it("adds spend to the running total", async () => {
    const ledger = memoryBudgetLedger({ [KEY]: { capUsd: 5, spentUsd: 0, disabled: false } });
    await ledger.addSpend(KEY, 0.25);
    await ledger.addSpend(KEY, 0.5);
    await ledger.addSpend(KEY, 0);
    expect(ledger.snapshot(KEY)?.spentUsd).toBeCloseTo(0.75, 10);
  });

  it("does nothing for an unknown key and creates no row", async () => {
    const ledger = memoryBudgetLedger();
    await expect(ledger.addSpend(OTHER, 1)).resolves.toBeUndefined();
    expect(ledger.snapshot(OTHER)).toBeNull();
    expect(await ledger.read(OTHER)).toBeNull();
  });

  it.each([-0.01, Number.NaN, Infinity, -Infinity])("refuses an amount of %s", async (usd) => {
    const ledger = memoryBudgetLedger({ [KEY]: { capUsd: 5, spentUsd: 1, disabled: false } });
    const error = await ledger.addSpend(KEY, usd).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BudgetLedgerError);
    expect((error as BudgetLedgerError).code).toBe(INVALID_AMOUNT_CODE);
    expect(ledger.snapshot(KEY)?.spentUsd).toBe(1);
  });

  it("hands out copies, so callers cannot change the ledger by mutation", async () => {
    const initial = { [KEY]: { capUsd: 5, spentUsd: 1, disabled: false } };
    const ledger = memoryBudgetLedger(initial);
    initial[KEY].spentUsd = 99;
    const read = await ledger.read(KEY);
    read!.spentUsd = 99;
    expect(ledger.snapshot(KEY)?.spentUsd).toBe(1);
  });

  it("set adds or replaces a code", async () => {
    const ledger = memoryBudgetLedger();
    ledger.set(KEY, { capUsd: 2, spentUsd: 0, disabled: true });
    expect(budgetVerdict(await ledger.read(KEY))).toBe("inactive");
  });
});

describe("BudgetLedgerError", () => {
  it("carries the code and names only the operation", () => {
    const error = new BudgetLedgerError("read", "PGRST202");
    expect(error.code).toBe("PGRST202");
    expect(error.message).toBe("Budget ledger read failed (PGRST202)");
    expect(new BudgetLedgerError("addSpend", null).message).toBe("Budget ledger addSpend failed");
  });
});
