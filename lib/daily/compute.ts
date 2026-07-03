/**
 * lib/daily/compute.ts — pure helpers behind Daily Reports (plan/tab-daily-
 * reports.md R2-07). Kept dependency-free (no Supabase, no React, no `xlsx`)
 * so `tests/unit/daily-*` can exercise the business rules without a database
 * — `lib/daily/queries.ts` / `lib/daily/export.ts` are the only callers that
 * touch Supabase / build workbooks.
 */

import type { MovementReason, MovementReasonDetail } from "@/types/db";
import { formatDate, formatNumber, formatTime } from "@/lib/format";
import { istDateOnly, istDateRangeToIsoBounds } from "@/lib/timezone";

/* ────────────────────────────────────────────────────────────────────────────
 * Date helpers — "today" / prev-next / range bounds.
 *
 * Anchored to the Asia/Kolkata (IST) calendar day via `lib/timezone.ts`
 * (finding #4 — this used to be server-local calendar day + `.toISOString()`,
 * which on a UTC runtime mis-bucketed every 00:00–05:30 IST event, e.g. an
 * early-morning clock-in, into the previous day; same fix the dashboard
 * package's `todayBoundsIso` got, now sharing one helper so both surfaces
 * agree). `work_date` columns (attendance/time entries) are plain `date` —
 * compared as YYYY-MM-DD strings, no bounds needed. timestamptz columns
 * (movements/orders/runs/cart/expenses) need an explicit [start, end) ISO
 * range for a `date-only` day or day-range.
 *
 * `combineDateAndTime` below is NOT part of this fix — it still builds its
 * ISO instant from server-local `Date` setters, a separate (real, and more
 * severe — every check-in/out is off, not just the midnight edge) gap;
 * flagged for a follow-up rather than folded in here.
 * ──────────────────────────────────────────────────────────────────────────── */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `YYYY-MM-DD` for the IST calendar day of `reference` (default now). */
export function todayDateOnly(reference: Date = new Date()): string {
  return istDateOnly(reference);
}

/** Parses a `YYYY-MM-DD` string into literal {year, month, day} components — pure calendar arithmetic, no timezone attached. */
function parseDateOnlyParts(dateOnly: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return { year: y!, month: (m ?? 1) - 1, day: d ?? 1 };
}

/** `dateOnly` shifted by `deltaDays` (may cross month/year boundaries), e.g. prev/next day nav. Pure calendar-date arithmetic — no timezone involved. */
export function shiftDateOnly(dateOnly: string, deltaDays: number): string {
  const { year, month, day } = parseDateOnlyParts(dateOnly);
  const shifted = new Date(Date.UTC(year, month, day + deltaDays));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export interface IsoBounds {
  /** Inclusive start instant. */
  startIso: string;
  /** Exclusive end instant (start of the day AFTER `to`). */
  endIso: string;
}

/** `[from 00:00 IST, to+1day 00:00 IST)` as ISO instants — the timestamptz query range for a date-only day/range. */
export function dateRangeToIsoBounds(from: string, to: string): IsoBounds {
  const { start, end } = istDateRangeToIsoBounds(from, to);
  return { startIso: start, endIso: end };
}

/** Single-day convenience wrapper. */
export function dayToIsoBounds(dateOnly: string): IsoBounds {
  return dateRangeToIsoBounds(dateOnly, dateOnly);
}

export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseDateOnlyParts(value);
  return !Number.isNaN(Date.UTC(year, month, day));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Attendance / hours
 * ──────────────────────────────────────────────────────────────────────────── */

/** "Prompt at clock-out if nothing logged" (FEATURES.md §5.13). */
export function needsHoursPrompt(hoursEntryCount: number): boolean {
  return hoursEntryCount <= 0;
}

export function sumHours(entries: readonly { hours: number }[]): number {
  return Math.round(entries.reduce((sum, e) => sum + e.hours, 0) * 10) / 10;
}

/**
 * Combines a `date`-only work day with an `HH:mm` local time into an ISO
 * instant — server-local time zone (NOT yet anchored to IST like the rest of
 * this module; see file header). Kept as-is: a separate, out-of-scope gap
 * from finding #4 (this one shifts every check-in/out's clock time, not just
 * events in the midnight-05:30 IST window).
 */
export function combineDateAndTime(workDate: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const { year, month, day } = parseDateOnlyParts(workDate);
  const d = new Date(year, month, day);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toISOString();
}

/* ────────────────────────────────────────────────────────────────────────────
 * Movements today — grouping + line formatting
 * ──────────────────────────────────────────────────────────────────────────── */

export interface MovementDailyRow {
  id: string;
  occurredAt: string;
  actorId: string;
  deltaQty: number;
  reason: MovementReason;
  reasonDetail: MovementReasonDetail | null;
  pid: string;
  boxLabel: string | null;
  bomName: string | null;
}

const REASON_LABELS: Record<MovementReason, string> = {
  pick: "pick",
  bulk_pick: "bulk pick",
  receive: "receive",
  adjust: "adjust",
  undo: "undo",
};

/** "took" / "added" / "adjusted up" / "adjusted down" / "undid" — verb voiced by sign + reason. */
export function movementVerb(reason: MovementReason, deltaQty: number): string {
  if (reason === "undo") return "undid";
  if (reason === "adjust") return deltaQty >= 0 ? "adjusted up" : "adjusted down";
  return deltaQty < 0 ? "took" : "added";
}

/** "took 145 × SMK-000101 (Box B-12) · bulk pick · TMCS Mainboard" (FEATURES.md §5.13 example). */
export function formatMovementLine(row: MovementDailyRow): string {
  const verb = movementVerb(row.reason, row.deltaQty);
  const qty = formatNumber(Math.abs(row.deltaQty));
  const box = row.boxLabel ? ` (${row.boxLabel})` : "";
  const reasonLabel = REASON_LABELS[row.reason] + (row.reasonDetail ? ` ${row.reasonDetail}` : "");
  const bom = row.bomName ? ` · ${row.bomName}` : "";
  return `${verb} ${qty} × ${row.pid}${box} · ${reasonLabel}${bom}`;
}

export interface MovementTotals {
  itemsOut: number;
  itemsIn: number;
  adjustments: number;
}

/** Totals strip: items out (Σ|negative deltas|) · items in (Σ positive deltas) · adjustment count. */
export function computeMovementTotals(rows: readonly MovementDailyRow[]): MovementTotals {
  let itemsOut = 0;
  let itemsIn = 0;
  let adjustments = 0;
  for (const row of rows) {
    if (row.deltaQty < 0) itemsOut += -row.deltaQty;
    else itemsIn += row.deltaQty;
    if (row.reason === "adjust") adjustments++;
  }
  return { itemsOut, itemsIn, adjustments };
}

export interface MovementActorGroup {
  actorId: string;
  actorName: string;
  rows: MovementDailyRow[];
}

/** Groups movement rows by actor (newest-first within each group), actor groups newest-activity-first. */
export function groupMovementsByActor(
  rows: readonly MovementDailyRow[],
  nameById: ReadonlyMap<string, string>,
): MovementActorGroup[] {
  const byActor = new Map<string, MovementDailyRow[]>();
  for (const row of rows) {
    const list = byActor.get(row.actorId) ?? [];
    list.push(row);
    byActor.set(row.actorId, list);
  }
  const groups: MovementActorGroup[] = [];
  for (const [actorId, actorRows] of byActor) {
    actorRows.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
    groups.push({ actorId, actorName: nameById.get(actorId) ?? "Unknown", rows: actorRows });
  }
  groups.sort((a, b) => (a.rows[0]!.occurredAt < b.rows[0]!.occurredAt ? 1 : -1));
  return groups;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ordering activity today
 * ──────────────────────────────────────────────────────────────────────────── */

export type OrderingActivityKind =
  | "bom_uploaded"
  | "run_started"
  | "run_finished"
  | "cart_add"
  | "order_placed"
  | "arrival";

export interface OrderingActivityItem {
  id: string;
  occurredAt: string;
  actorId: string | null;
  kind: OrderingActivityKind;
  label: string;
}

/** Newest-first feed order. */
export function sortOrderingActivity(items: readonly OrderingActivityItem[]): OrderingActivityItem[] {
  return [...items].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
}

/**
 * "Employee sees self only" (FEATURES.md §2/§5.13) enforced at the query
 * layer, not RLS (operational tables broadly readable to employee — see
 * lib/daily/queries.ts header). `null`-actor rows (arrivals — smark_order_lines
 * carries no actor column today) are dropped under self-scope: nothing
 * attributes them to the viewer, so under a strict "only mine" filter they
 * don't qualify — see this package's report re: v_daily_activity's `arrival`
 * branch always carrying a null actor.
 */
export function filterActivityForActor<T extends { actorId: string | null }>(
  items: readonly T[],
  actorId: string | null,
): T[] {
  if (actorId === null) return [...items];
  return items.filter((item) => item.actorId === actorId);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Misc small formatters
 * ──────────────────────────────────────────────────────────────────────────── */

/** "9:02 AM – 6:14 PM" / "9:02 AM – —" / "—" chip text for a team-table row. */
export function formatInOutRange(checkInLabel: string, checkOutLabel: string): string {
  if (checkInLabel === "—" && checkOutLabel === "—") return "—";
  return `${checkInLabel} – ${checkOutLabel}`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Export row shaping (R2-33 — day/range CSV/xlsx). Pure row-builders so
 * `tests/unit/daily-export.test.ts` can assert the shape without pulling in
 * the `xlsx` package — `lib/daily/export.ts` is the only caller that turns
 * these into an actual CSV string / xlsx workbook.
 * ──────────────────────────────────────────────────────────────────────────── */

export const MOVEMENT_EXPORT_HEADERS = ["Date", "Time", "Person", "Verb", "Qty", "PID", "Box", "Reason", "BOM"] as const;

export function movementExportRow(row: MovementDailyRow, actorName: string): (string | number)[] {
  return [
    formatDate(row.occurredAt),
    formatTime(row.occurredAt),
    actorName,
    movementVerb(row.reason, row.deltaQty),
    Math.abs(row.deltaQty),
    row.pid,
    row.boxLabel ?? "",
    REASON_LABELS[row.reason] + (row.reasonDetail ? ` ${row.reasonDetail}` : ""),
    row.bomName ?? "",
  ];
}

export const ATTENDANCE_EXPORT_HEADERS = ["Date", "Person", "Check-in", "Check-out", "Working on"] as const;

export interface AttendanceExportInput {
  workDate: string;
  personName: string;
  checkIn: string | null;
  checkOut: string | null;
  currentProjectName: string | null;
}

export function attendanceExportRow(row: AttendanceExportInput): (string | number)[] {
  return [
    formatDate(row.workDate),
    row.personName,
    row.checkIn ? formatTime(row.checkIn) : "",
    row.checkOut ? formatTime(row.checkOut) : "",
    row.currentProjectName ?? "",
  ];
}

export const HOURS_EXPORT_HEADERS = ["Date", "Person", "Project", "Hours", "Note"] as const;

export interface HoursExportInput {
  workDate: string;
  personName: string;
  projectName: string;
  hours: number;
  note: string | null;
}

export function hoursExportRow(row: HoursExportInput): (string | number)[] {
  return [formatDate(row.workDate), row.personName, row.projectName, row.hours, row.note ?? ""];
}

export const EXPENSE_EXPORT_HEADERS = ["Date", "Type", "Amount (INR)", "Category", "Vendor", "Note", "Draft"] as const;

export interface ExpenseExportInput {
  entryDate: string;
  entryType: "expense" | "income";
  amount: number;
  category: string;
  vendor: string | null;
  note: string | null;
  /** PO-auto-created, unconfirmed entry (finding #7) — carried through so the export
   * visibly labels it instead of silently mixing it into confirmed spend. */
  isDraft: boolean;
}

export function expenseExportRow(row: ExpenseExportInput): (string | number)[] {
  return [
    formatDate(row.entryDate),
    row.entryType,
    row.amount,
    row.category,
    row.vendor ?? "",
    row.note ?? "",
    row.isDraft ? "yes" : "",
  ];
}
