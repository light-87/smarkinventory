import { describe, expect, test } from "bun:test";
import {
  annualResetEntries,
  canSpendCompDays,
  compBalanceDays,
  compDaysForHours,
  compDaysForLeave,
  formatCompDays,
  inclusiveDayCount,
  FULL_DAY_THRESHOLD_HOURS,
  STANDARD_ANNUAL_COMP_DAYS,
} from "@/lib/attendance/comp-days";

/**
 * lib/attendance/comp-days — the day-based comp-off rules introduced by
 * migration 0020, replacing 0018's hours arithmetic. Pure functions, so this
 * needs no database (same convention as tests/unit/pm-kpi.test.ts).
 *
 * The rules, as the client stated them: under 4 hours of extra work earns half
 * a day, 4 or more earns a whole one; a half-day leave costs 0.5 and a full
 * day costs 1; entitled staff get 16 days each January and anything unused is
 * lost.
 */

describe("compDaysForHours — what extra work is worth", () => {
  test("under four hours earns half a day", () => {
    expect(compDaysForHours(1)).toBe(0.5);
    expect(compDaysForHours(3.5)).toBe(0.5);
    expect(compDaysForHours(3.99)).toBe(0.5);
  });

  test("four hours or more earns a whole day", () => {
    // The boundary is inclusive: rounding a full half-shift DOWN to a half day
    // is the reading an employee would argue with.
    expect(compDaysForHours(FULL_DAY_THRESHOLD_HOURS)).toBe(1);
    expect(compDaysForHours(8)).toBe(1);
    expect(compDaysForHours(12)).toBe(1);
  });

  test("nothing, zero, or nonsense earns nothing", () => {
    expect(compDaysForHours(0)).toBe(0);
    expect(compDaysForHours(-3)).toBe(0);
    expect(compDaysForHours(null)).toBe(0);
    expect(compDaysForHours(undefined)).toBe(0);
    expect(compDaysForHours(Number.NaN)).toBe(0);
  });
});

describe("compDaysForLeave — what time off costs", () => {
  test("a half day costs 0.5", () => {
    expect(compDaysForLeave(1, true)).toBe(0.5);
  });

  test("a full day costs 1, and each further day adds one", () => {
    expect(compDaysForLeave(1, false)).toBe(1);
    expect(compDaysForLeave(3, false)).toBe(3);
  });

  test("the half-day flag is ignored on a multi-day range", () => {
    // Otherwise a week off could be charged at half a day.
    expect(compDaysForLeave(5, true)).toBe(5);
  });

  test("an empty or invalid range costs nothing", () => {
    expect(compDaysForLeave(0, false)).toBe(0);
    expect(compDaysForLeave(-2, true)).toBe(0);
  });
});

describe("inclusiveDayCount", () => {
  test("counts both ends", () => {
    expect(inclusiveDayCount("2026-08-03", "2026-08-03")).toBe(1);
    expect(inclusiveDayCount("2026-08-03", "2026-08-05")).toBe(3);
  });

  test("spans month and year boundaries", () => {
    expect(inclusiveDayCount("2026-01-30", "2026-02-02")).toBe(4);
    expect(inclusiveDayCount("2026-12-31", "2027-01-01")).toBe(2);
  });

  test("an inverted or unparseable range is zero", () => {
    expect(inclusiveDayCount("2026-08-05", "2026-08-03")).toBe(0);
    expect(inclusiveDayCount("not-a-date", "2026-08-03")).toBe(0);
  });
});

describe("compBalanceDays — the ledger sums to the balance", () => {
  test("adds credits and debits", () => {
    expect(
      compBalanceDays([{ deltaDays: 16 }, { deltaDays: 0.5 }, { deltaDays: -1 }, { deltaDays: -0.5 }]),
    ).toBe(15);
  });

  test("an empty ledger is zero", () => {
    expect(compBalanceDays([])).toBe(0);
  });

  test("repeated halves don't drift into floating-point noise", () => {
    const entries = Array.from({ length: 10 }, () => ({ deltaDays: 0.1 }));
    expect(compBalanceDays(entries)).toBe(1);
  });
});

describe("annualResetEntries — the 1 January movements", () => {
  test("clears the leftover and grants the entitlement", () => {
    // 3 days unused going into the new year, entitled to 16.
    expect(annualResetEntries(3, STANDARD_ANNUAL_COMP_DAYS)).toEqual({ reset: -3, grant: 16 });
  });

  test("unused days are lost, not carried — the reset always cancels the balance exactly", () => {
    expect(annualResetEntries(7.5, 16).reset).toBe(-7.5);
  });

  test("a zero balance needs no reset row", () => {
    expect(annualResetEntries(0, 16)).toEqual({ reset: 0, grant: 16 });
  });

  test("staff without the entitlement get no grant", () => {
    expect(annualResetEntries(2, 0)).toEqual({ reset: -2, grant: 0 });
  });

  test("a negative balance (an over-spend correction) is cancelled upward", () => {
    expect(annualResetEntries(-1.5, 0)).toEqual({ reset: 1.5, grant: 0 });
  });
});

describe("canSpendCompDays", () => {
  test("allows spending exactly the balance", () => {
    expect(canSpendCompDays(1, 1)).toBe(true);
    expect(canSpendCompDays(0.5, 0.5)).toBe(true);
  });

  test("refuses to go negative", () => {
    expect(canSpendCompDays(0.5, 1)).toBe(false);
    expect(canSpendCompDays(0, 0.5)).toBe(false);
  });

  test("a zero-cost request is not spendable", () => {
    expect(canSpendCompDays(5, 0)).toBe(false);
  });
});

describe("formatCompDays", () => {
  test("singular only for exactly one day", () => {
    expect(formatCompDays(1)).toBe("1 day");
    expect(formatCompDays(0.5)).toBe("0.5 days");
    expect(formatCompDays(2)).toBe("2 days");
    expect(formatCompDays(0)).toBe("0 days");
  });

  test("whole numbers don't render a trailing .0", () => {
    expect(formatCompDays(16)).toBe("16 days");
    expect(formatCompDays(1.5)).toBe("1.5 days");
  });
});
