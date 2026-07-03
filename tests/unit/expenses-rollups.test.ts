import { describe, expect, test } from "bun:test";
import type { ExpenseRollupRow } from "@/types/db";
import {
  buildAccountBreakdown,
  buildAiSpendSummary,
  buildCategoryBreakdown,
  buildCumulativeNet,
  buildIncomeExpenseSeries,
  buildSummaryTiles,
  buildTopProjectsIncome,
  buildYoyCompare,
} from "@/lib/expenses/rollups";

/**
 * lib/expenses/rollups — pure shaping of `v_expense_rollups` rows into every
 * chart/tile series (plan/tab-expenses.md R2-21). DB-free: fixtures below
 * stand in for the view's output (already filtered to confirmed, live
 * entries — 0005_views_fks.sql excludes soft-deleted + draft rows at the SQL
 * layer, so every function here can assume that).
 */

function row(overrides: Partial<ExpenseRollupRow>): ExpenseRollupRow {
  return {
    bucket: "month",
    period: "2026-07",
    entry_type: "expense",
    category: "Materials",
    account_id: "acct-1",
    project_id: null,
    total: 0,
    entry_count: 0,
    ...overrides,
  };
}

describe("buildIncomeExpenseSeries", () => {
  test("sums across categories/accounts within a period and zero-fills missing periods", () => {
    const rows: ExpenseRollupRow[] = [
      row({ period: "2026-07", entry_type: "expense", category: "Materials", total: 100 }),
      row({ period: "2026-07", entry_type: "expense", category: "Rent", total: 50 }),
      row({ period: "2026-07", entry_type: "income", category: "Client payment", total: 300 }),
    ];
    const series = buildIncomeExpenseSeries(rows, "month", ["2026-06", "2026-07"]);
    expect(series).toEqual([
      { period: "2026-06", label: "Jun 2026", income: 0, expense: 0, net: 0 },
      { period: "2026-07", label: "Jul 2026", income: 300, expense: 150, net: 150 },
    ]);
  });

  test("ignores rows from a different bucket", () => {
    const rows: ExpenseRollupRow[] = [row({ bucket: "quarter", period: "2026-Q3", total: 999 })];
    const series = buildIncomeExpenseSeries(rows, "month", ["2026-07"]);
    expect(series[0]!.expense).toBe(0);
  });
});

describe("buildCumulativeNet", () => {
  test("runs a cumulative total across periods", () => {
    const series = buildIncomeExpenseSeries(
      [
        row({ period: "2026-06", entry_type: "income", total: 100 }),
        row({ period: "2026-07", entry_type: "expense", total: 40 }),
      ],
      "month",
      ["2026-06", "2026-07"],
    );
    expect(buildCumulativeNet(series).map((p) => p.cumulative)).toEqual([100, 60]);
  });
});

describe("buildCategoryBreakdown", () => {
  test("expense-only, summed by category, desc-sorted, zero categories dropped", () => {
    const rows: ExpenseRollupRow[] = [
      row({ category: "Materials", total: 200 }),
      row({ category: "Rent", total: 500 }),
      row({ category: "Tools", total: 0 }),
      row({ entry_type: "income", category: "Client payment", total: 1000 }), // excluded — income
      row({ bucket: "year", period: "2026", category: "Rent", total: 9999 }), // excluded — wrong bucket
    ];
    expect(buildCategoryBreakdown(rows, "month", "2026-07")).toEqual([
      { category: "Rent", total: 500 },
      { category: "Materials", total: 200 },
    ]);
  });
});

describe("buildAccountBreakdown", () => {
  test("groups by account, resolves names, sorts desc", () => {
    const rows: ExpenseRollupRow[] = [
      row({ account_id: "acct-1", total: 100 }),
      row({ account_id: "acct-2", total: 400 }),
      row({ account_id: null, total: 20 }),
    ];
    const names = new Map([
      ["acct-1", "Cash box"],
      ["acct-2", "HDFC current"],
    ]);
    expect(buildAccountBreakdown(rows, "month", "2026-07", names)).toEqual([
      { accountId: "acct-2", label: "HDFC current", total: 400 },
      { accountId: "acct-1", label: "Cash box", total: 100 },
      { accountId: null, label: "No account", total: 20 },
    ]);
  });
});

describe("buildTopProjectsIncome", () => {
  test("income-only, project-only, ranked, respects limit", () => {
    const rows: ExpenseRollupRow[] = [
      row({ entry_type: "income", project_id: "p1", total: 500 }),
      row({ entry_type: "income", project_id: "p2", total: 1500 }),
      row({ entry_type: "income", project_id: "p3", total: 100 }),
      row({ entry_type: "income", project_id: null, total: 999 }), // excluded — no project (not a "payment")
      row({ entry_type: "expense", project_id: "p2", total: 50 }), // excluded — not income
    ];
    const names = new Map([
      ["p1", "Alpha"],
      ["p2", "Beta"],
      ["p3", "Gamma"],
    ]);
    expect(buildTopProjectsIncome(rows, "month", "2026-07", names, 2)).toEqual([
      { projectId: "p2", label: "Beta", total: 1500 },
      { projectId: "p1", label: "Alpha", total: 500 },
    ]);
  });
});

describe("buildYoyCompare", () => {
  test("net (income − expense) per calendar month, this year vs last", () => {
    const rows: ExpenseRollupRow[] = [
      row({ period: "2026-01", entry_type: "income", total: 1000 }),
      row({ period: "2026-01", entry_type: "expense", total: 400 }),
      row({ period: "2025-01", entry_type: "income", total: 600 }),
      row({ period: "2025-01", entry_type: "expense", total: 600 }),
    ];
    const points = buildYoyCompare(rows, new Date(2026, 6, 3));
    expect(points).toHaveLength(12);
    expect(points[0]).toEqual({ monthIndex: 1, label: "Jan", thisYear: 600, lastYear: 0 });
  });
});

describe("buildSummaryTiles", () => {
  test("this month + this year in/out/net, independent of chart bucket", () => {
    const ref = new Date(2026, 6, 3); // Jul 2026
    const rows: ExpenseRollupRow[] = [
      row({ bucket: "month", period: "2026-07", entry_type: "income", total: 5000 }),
      row({ bucket: "month", period: "2026-07", entry_type: "expense", total: 2000 }),
      row({ bucket: "year", period: "2026", entry_type: "income", total: 40000 }),
      row({ bucket: "year", period: "2026", entry_type: "expense", total: 15000 }),
    ];
    expect(buildSummaryTiles(rows, ref)).toEqual({
      monthIn: 5000,
      monthOut: 2000,
      monthNet: 3000,
      yearIn: 40000,
      yearOut: 15000,
      yearNet: 25000,
    });
  });
});

describe("buildAiSpendSummary", () => {
  test("honest zero-state with no runs", () => {
    const summary = buildAiSpendSummary([], 3, new Date(2026, 6, 3));
    expect(summary.hasData).toBe(false);
    expect(summary.avgPerRun).toBeNull();
    expect(summary.thisMonthTotal).toBe(0);
    expect(summary.monthly).toEqual([
      { period: "2026-05", label: "May 2026", total: 0 },
      { period: "2026-06", label: "Jun 2026", total: 0 },
      { period: "2026-07", label: "Jul 2026", total: 0 },
    ]);
  });

  test("averages only costed runs and sums by month", () => {
    const runs = [
      { actual_cost: 10, created_at: "2026-06-10T00:00:00+00:00" },
      { actual_cost: 30, created_at: "2026-07-01T00:00:00+00:00" },
      { actual_cost: null, created_at: "2026-07-02T00:00:00+00:00" }, // in-flight run, not costed yet
    ];
    const summary = buildAiSpendSummary(runs, 2, new Date(2026, 6, 3));
    expect(summary.hasData).toBe(true);
    expect(summary.avgPerRun).toBe(20); // (10 + 30) / 2
    expect(summary.thisMonthTotal).toBe(30);
    expect(summary.monthly).toEqual([
      { period: "2026-06", label: "Jun 2026", total: 10 },
      { period: "2026-07", label: "Jul 2026", total: 30 },
    ]);
  });
});
