/**
 * lib/expenses/rollups.ts — pure shaping of `v_expense_rollups` rows
 * (plan/SCHEMA.md §8 [R2-21]) into the exact series each chart/tile needs.
 *
 * DB-free by design (tests/unit/expenses-rollups.test.ts exercises this with
 * fixture rows, no Supabase) — `lib/expenses/queries.ts` is the only caller
 * that fetches the view; everything downstream of that fetch is arithmetic.
 *
 * The view is pre-filtered at the SQL layer (`deleted_at is null and
 * is_draft = false`, see 0005_views_fks.sql) — every function here can
 * assume every row it's handed is a confirmed, live entry.
 */

import type { ExpenseRollupRow } from "@/types/db";
import type { ChartBucket } from "./types";
import { currentMonthKey, currentYearKey, monthPeriodOf, periodLabel, trailingPeriods } from "./period";

type Rows = readonly ExpenseRollupRow[];

function rowsFor(rows: Rows, bucket: ChartBucket, period: string): Rows {
  return rows.filter((r) => r.bucket === bucket && r.period === period);
}

function sum(rows: Rows, entryType: "expense" | "income"): number {
  return rows.filter((r) => r.entry_type === entryType).reduce((acc, r) => acc + r.total, 0);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Income vs expense bars + cumulative net line
 * ──────────────────────────────────────────────────────────────────────────── */

export interface IncomeExpensePoint {
  period: string;
  label: string;
  income: number;
  expense: number;
  net: number;
}

/** One point per trailing period (gap-free x-axis, zero-filled). */
export function buildIncomeExpenseSeries(
  rows: Rows,
  bucket: ChartBucket,
  periods: readonly string[],
): IncomeExpensePoint[] {
  return periods.map((period) => {
    const slice = rowsFor(rows, bucket, period);
    const income = sum(slice, "income");
    const expense = sum(slice, "expense");
    return { period, label: periodLabel(bucket, period), income, expense, net: income - expense };
  });
}

export interface CumulativeNetPoint {
  period: string;
  label: string;
  net: number;
  cumulative: number;
}

/** Running total of `net` across an already-built income/expense series. */
export function buildCumulativeNet(series: readonly IncomeExpensePoint[]): CumulativeNetPoint[] {
  let running = 0;
  return series.map((point) => {
    running += point.net;
    return { period: point.period, label: point.label, net: point.net, cumulative: running };
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Category donut (expense breakdown for one period)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface CategorySlice {
  category: string;
  total: number;
}

/** Expense-only breakdown by category for a single period, desc-sorted, zero categories dropped. */
export function buildCategoryBreakdown(rows: Rows, bucket: ChartBucket, period: string): CategorySlice[] {
  const slice = rowsFor(rows, bucket, period).filter((r) => r.entry_type === "expense");
  const byCategory = new Map<string, number>();
  for (const row of slice) {
    const key = row.category ?? "Other";
    byCategory.set(key, (byCategory.get(key) ?? 0) + row.total);
  }
  return Array.from(byCategory.entries())
    .map(([category, total]) => ({ category, total }))
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total);
}

/* ────────────────────────────────────────────────────────────────────────────
 * By-account split (expense breakdown for one period, ranked)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AccountSlice {
  accountId: string | null;
  label: string;
  total: number;
}

export function buildAccountBreakdown(
  rows: Rows,
  bucket: ChartBucket,
  period: string,
  accountNameById: ReadonlyMap<string, string>,
): AccountSlice[] {
  const slice = rowsFor(rows, bucket, period).filter((r) => r.entry_type === "expense");
  const byAccount = new Map<string, number>();
  for (const row of slice) {
    const key = row.account_id ?? "none";
    byAccount.set(key, (byAccount.get(key) ?? 0) + row.total);
  }
  return Array.from(byAccount.entries())
    .map(([accountId, total]) => ({
      accountId: accountId === "none" ? null : accountId,
      label: accountId === "none" ? "No account" : (accountNameById.get(accountId) ?? "Unknown account"),
      total,
    }))
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Top-projects income (for one period, ranked)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ProjectIncomeSlice {
  projectId: string;
  label: string;
  total: number;
}

export function buildTopProjectsIncome(
  rows: Rows,
  bucket: ChartBucket,
  period: string,
  projectNameById: ReadonlyMap<string, string>,
  limit = 6,
): ProjectIncomeSlice[] {
  const slice = rowsFor(rows, bucket, period).filter((r) => r.entry_type === "income" && r.project_id != null);
  const byProject = new Map<string, number>();
  for (const row of slice) {
    const key = row.project_id as string;
    byProject.set(key, (byProject.get(key) ?? 0) + row.total);
  }
  return Array.from(byProject.entries())
    .map(([projectId, total]) => ({ projectId, label: projectNameById.get(projectId) ?? "Unknown project", total }))
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/* ────────────────────────────────────────────────────────────────────────────
 * YoY compare — always month-granularity, this calendar year vs last
 * ──────────────────────────────────────────────────────────────────────────── */

export interface YoyPoint {
  monthIndex: number;
  label: string;
  thisYear: number;
  lastYear: number;
}

/** Net (income − expense) per calendar month, this year vs the previous year. */
export function buildYoyCompare(rows: Rows, referenceDate: Date = new Date()): YoyPoint[] {
  const year = Number(currentYearKey(referenceDate));
  const points: YoyPoint[] = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    const thisPeriod = `${year}-${mm}`;
    const lastPeriod = `${year - 1}-${mm}`;
    const thisSlice = rowsFor(rows, "month", thisPeriod);
    const lastSlice = rowsFor(rows, "month", lastPeriod);
    points.push({
      monthIndex: m,
      label: periodLabel("month", thisPeriod).split(" ")[0]!, // "Jan" / "Feb" / …
      thisYear: sum(thisSlice, "income") - sum(thisSlice, "expense"),
      lastYear: sum(lastSlice, "income") - sum(lastSlice, "expense"),
    });
  }
  return points;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Summary tiles — this month + this year, in/out/net (period-switcher independent)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SummaryTiles {
  monthIn: number;
  monthOut: number;
  monthNet: number;
  yearIn: number;
  yearOut: number;
  yearNet: number;
}

export function buildSummaryTiles(rows: Rows, referenceDate: Date = new Date()): SummaryTiles {
  const month = rowsFor(rows, "month", currentMonthKey(referenceDate));
  const year = rowsFor(rows, "year", currentYearKey(referenceDate));
  const monthIn = sum(month, "income");
  const monthOut = sum(month, "expense");
  const yearIn = sum(year, "income");
  const yearOut = sum(year, "expense");
  return { monthIn, monthOut, monthNet: monthIn - monthOut, yearIn, yearOut, yearNet: yearIn - yearOut };
}

/* ────────────────────────────────────────────────────────────────────────────
 * AI spend meter [R2-37] — from smark_agent_runs.actual_cost, not the view.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AgentRunCostInput {
  actual_cost: number | null;
  created_at: string;
}

export interface AiSpendMonthPoint {
  period: string;
  label: string;
  total: number;
}

export interface AiSpendSummary {
  /** Mean `actual_cost` over runs that HAVE a cost (finished runs) — "₹/run". */
  avgPerRun: number | null;
  /** Sum of `actual_cost` for the current calendar month. */
  thisMonthTotal: number;
  /** Trailing months (oldest→newest), zero-filled. */
  monthly: AiSpendMonthPoint[];
  /** True once at least one run has a cost — gates the honest zero-state (R2-37). */
  hasData: boolean;
}

export function buildAiSpendSummary(
  runs: readonly AgentRunCostInput[],
  monthsBack = 6,
  referenceDate: Date = new Date(),
): AiSpendSummary {
  const costed = runs.filter((r): r is { actual_cost: number; created_at: string } => r.actual_cost != null);
  const periods = trailingPeriods("month", monthsBack, referenceDate);

  const byMonth = new Map<string, number>();
  for (const run of costed) {
    const key = monthPeriodOf(run.created_at.slice(0, 10));
    byMonth.set(key, (byMonth.get(key) ?? 0) + run.actual_cost);
  }

  const monthly = periods.map((period) => ({
    period,
    label: periodLabel("month", period),
    total: byMonth.get(period) ?? 0,
  }));

  const avgPerRun = costed.length > 0 ? costed.reduce((acc, r) => acc + r.actual_cost, 0) / costed.length : null;
  const thisMonthTotal = byMonth.get(currentMonthKey(referenceDate)) ?? 0;

  return { avgPerRun, thisMonthTotal, monthly, hasData: costed.length > 0 };
}

/** Re-exported so callers only need one import for the trailing-window helper. */
export { trailingPeriods };
