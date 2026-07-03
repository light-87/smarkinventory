import { describe, expect, test } from "bun:test";
import {
  currentMonthKey,
  currentPeriod,
  currentYearKey,
  monthPeriodOf,
  periodLabel,
  quarterPeriodOf,
  trailingPeriods,
  yearPeriodOf,
} from "@/lib/expenses/period";

/**
 * lib/expenses/period — pure bucket math that MUST agree with
 * `v_expense_rollups`'s `to_char(...)` period strings (0005_views_fks.sql).
 */

describe("period-of-date helpers", () => {
  test("monthPeriodOf → YYYY-MM", () => {
    expect(monthPeriodOf("2026-07-03")).toBe("2026-07");
    expect(monthPeriodOf("2026-01-31")).toBe("2026-01");
  });

  test("quarterPeriodOf → YYYY-QN", () => {
    expect(quarterPeriodOf("2026-01-15")).toBe("2026-Q1");
    expect(quarterPeriodOf("2026-04-01")).toBe("2026-Q2");
    expect(quarterPeriodOf("2026-07-03")).toBe("2026-Q3");
    expect(quarterPeriodOf("2026-12-31")).toBe("2026-Q4");
  });

  test("yearPeriodOf → YYYY", () => {
    expect(yearPeriodOf("2026-07-03")).toBe("2026");
  });
});

describe("periodLabel", () => {
  test("month → 'Mon YYYY'", () => {
    expect(periodLabel("month", "2026-07")).toBe("Jul 2026");
    expect(periodLabel("month", "2026-01")).toBe("Jan 2026");
  });

  test("quarter → 'QN YYYY'", () => {
    expect(periodLabel("quarter", "2026-Q3")).toBe("Q3 2026");
  });

  test("year → the bare year", () => {
    expect(periodLabel("year", "2026")).toBe("2026");
  });
});

describe("trailingPeriods", () => {
  test("month bucket: ends at the reference month, ascending, gap-free, crossing a year boundary", () => {
    const ref = new Date(2026, 0, 15); // Jan 2026
    expect(trailingPeriods("month", 3, ref)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  test("month bucket: within the same year", () => {
    const ref = new Date(2026, 6, 3); // Jul 2026
    expect(trailingPeriods("month", 4, ref)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07"]);
  });

  test("quarter bucket: crosses a year boundary", () => {
    const ref = new Date(2026, 0, 15); // Q1 2026
    expect(trailingPeriods("quarter", 3, ref)).toEqual(["2025-Q3", "2025-Q4", "2026-Q1"]);
  });

  test("year bucket: consecutive years ending at the reference year", () => {
    const ref = new Date(2026, 6, 3);
    expect(trailingPeriods("year", 3, ref)).toEqual(["2024", "2025", "2026"]);
  });

  test("always returns exactly `count` entries even for count=1", () => {
    const ref = new Date(2026, 6, 3);
    expect(trailingPeriods("month", 1, ref)).toEqual(["2026-07"]);
  });
});

describe("currentPeriod / currentMonthKey / currentYearKey", () => {
  test("agree with trailingPeriods' last element", () => {
    const ref = new Date(2026, 6, 3);
    expect(currentPeriod("month", ref)).toBe("2026-07");
    expect(currentPeriod("quarter", ref)).toBe("2026-Q3");
    expect(currentPeriod("year", ref)).toBe("2026");
    expect(currentMonthKey(ref)).toBe("2026-07");
    expect(currentYearKey(ref)).toBe("2026");
  });
});
