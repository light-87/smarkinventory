/**
 * lib/expenses/period.ts — pure period/bucket math shared by the rollup
 * shaping (lib/expenses/rollups.ts) and the charts. `v_expense_rollups`
 * (plan/SCHEMA.md §8 [R2-21]) emits `period` strings in exactly these three
 * formats — this module is the ONE place that produces/parses them so the
 * app-side bucket walking always agrees with the SQL view's `to_char(...)`.
 *
 * DB-free and Date-free where possible (string math on `YYYY-MM-DD`) so
 * `tests/unit/expenses-period.test.ts` can assert exact period lists without
 * timezone flakiness.
 */

import type { ChartBucket } from "./types";

/** `YYYY-MM-DD` → `{ y, m, d }` (`m` is 1-indexed, matching the calendar). */
function splitIso(dateOnly: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `to_char(entry_date, 'YYYY-MM')`. */
export function monthPeriodOf(dateOnly: string): string {
  const { y, m } = splitIso(dateOnly);
  return `${y}-${pad2(m)}`;
}

/** `to_char(entry_date, 'YYYY') || '-Q' || to_char(entry_date, 'Q')`. */
export function quarterPeriodOf(dateOnly: string): string {
  const { y, m } = splitIso(dateOnly);
  return `${y}-Q${Math.ceil(m / 3)}`;
}

/** `to_char(entry_date, 'YYYY')`. */
export function yearPeriodOf(dateOnly: string): string {
  const { y } = splitIso(dateOnly);
  return String(y);
}

export function periodOf(bucket: ChartBucket, dateOnly: string): string {
  if (bucket === "month") return monthPeriodOf(dateOnly);
  if (bucket === "quarter") return quarterPeriodOf(dateOnly);
  return yearPeriodOf(dateOnly);
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "Jul 2026" / "Q3 2026" / "2026" — the axis/tile label for a raw period string. */
export function periodLabel(bucket: ChartBucket, period: string): string {
  if (bucket === "month") {
    const [y, m] = period.split("-");
    const idx = Number(m) - 1;
    return `${MONTH_LABELS[idx] ?? m} ${y}`;
  }
  if (bucket === "quarter") {
    const [y, q] = period.split("-");
    return `${q} ${y}`;
  }
  return period;
}

/** One step back in the given bucket, expressed as a `{y, ordinal}` pair (ordinal = month 1-12 or quarter 1-4; unused for year). */
function stepBack(y: number, ordinal: number, bucket: ChartBucket): { y: number; ordinal: number } {
  if (bucket === "year") return { y: y - 1, ordinal: 0 };
  const span = bucket === "month" ? 12 : 4;
  const zeroBased = ordinal - 1 - 1; // step back one unit, 0-indexed
  if (zeroBased < 0) return { y: y - 1, ordinal: span };
  return { y, ordinal: zeroBased + 1 };
}

function periodToParts(bucket: ChartBucket, period: string): { y: number; ordinal: number } {
  if (bucket === "year") return { y: Number(period), ordinal: 0 };
  const [yStr = "0", rest = ""] = period.split("-");
  const ordinal = bucket === "month" ? Number(rest) : Number(rest.replace("Q", ""));
  return { y: Number(yStr), ordinal };
}

function partsToPeriod(bucket: ChartBucket, y: number, ordinal: number): string {
  if (bucket === "year") return String(y);
  if (bucket === "month") return `${y}-${pad2(ordinal)}`;
  return `${y}-Q${ordinal}`;
}

/**
 * The trailing `count` periods for `bucket`, oldest→newest, ENDING at
 * `referenceDate`'s own period. Always returns exactly `count` entries (even
 * if `v_expense_rollups` has no rows for some of them) so charts render a
 * stable, gap-free x-axis rather than "however many periods happened to have
 * data".
 */
export function trailingPeriods(bucket: ChartBucket, count: number, referenceDate: Date = new Date()): string[] {
  const iso = `${referenceDate.getFullYear()}-${pad2(referenceDate.getMonth() + 1)}-${pad2(referenceDate.getDate())}`;
  const current = periodOf(bucket, iso);
  const parts: string[] = [current];
  let cursor = periodToParts(bucket, current);
  for (let i = 1; i < count; i++) {
    cursor = stepBack(cursor.y, cursor.ordinal, bucket);
    parts.unshift(partsToPeriod(bucket, cursor.y, cursor.ordinal));
  }
  return parts;
}

/** The current period string for `bucket` (last of `trailingPeriods(bucket, 1, ref)`). */
export function currentPeriod(bucket: ChartBucket, referenceDate: Date = new Date()): string {
  return trailingPeriods(bucket, 1, referenceDate)[0]!;
}

/** `YYYY-MM` for the current calendar month — the entries-list default & summary-tile key. */
export function currentMonthKey(referenceDate: Date = new Date()): string {
  return currentPeriod("month", referenceDate);
}

/** `YYYY` for the current calendar year — the summary-tile key. */
export function currentYearKey(referenceDate: Date = new Date()): string {
  return currentPeriod("year", referenceDate);
}
