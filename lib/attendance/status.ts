/**
 * lib/attendance/status.ts — the attendance module's core rule: derive a
 * per-user, per-date status, NEVER stored. `smark_attendance` (0001) only
 * ever carries a row when a user is present — this file is the one place
 * that resolves what a *missing* row means for a given day.
 *
 * Resolution order (see FEATURES prompt / migration 0009 header):
 *   1. Day is a holiday (weekly-off or specific) AND no attendance row → Holiday
 *   2. Attendance row exists → Present (or Compensatory if that date is
 *      ALSO a holiday — comp-workers still show up correctly even before
 *      their comp-work claim is approved, since the attendance row itself
 *      is the source of truth for "were they here")
 *   3. An APPROVED leave request covers the date → Leave (+ reason)
 *   4. Past working day, none of the above → Absent (computed, never written)
 *   5. Today/future, unmarked → Not marked
 *
 * Kept dependency-free (no Supabase, no React, no Date.now()) so
 * tests/unit/attendance-status.test.ts can exercise every branch without a
 * database — lib/attendance/queries.ts is the only caller that touches
 * Supabase and feeds this pure resolver. Small date-parsing helpers are
 * duplicated here rather than imported from lib/daily/compute.ts or
 * lib/timezone.ts, mirroring this repo's existing per-package-independence
 * convention (lib/daily/compute.ts duplicates its own parseDateOnlyParts
 * rather than importing lib/timezone.ts's).
 */

import type { HolidayKind, LeaveReason } from "@/types/db";

/* ────────────────────────────────────────────────────────────────────────────
 * Date-only helpers (pure, no timezone attached — `YYYY-MM-DD` calendar dates)
 * ──────────────────────────────────────────────────────────────────────────── */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseDateOnlyParts(dateOnly: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return { year: y!, month: (m ?? 1) - 1, day: d ?? 1 };
}

function formatDateOnly(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month, day));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 0 (Sunday) – 6 (Saturday) for a `YYYY-MM-DD` calendar date. */
export function weekdayOf(dateOnly: string): number {
  const { year, month, day } = parseDateOnlyParts(dateOnly);
  return new Date(Date.UTC(year, month, day)).getUTCDay();
}

/** `dateOnly` shifted by `deltaDays` (may cross month/year boundaries). */
export function shiftDateOnly(dateOnly: string, deltaDays: number): string {
  const { year, month, day } = parseDateOnlyParts(dateOnly);
  return formatDateOnly(year, month, day + deltaDays);
}

/** Every `YYYY-MM-DD` date from `from` to `to`, inclusive, ascending. */
export function datesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 3660) {
    dates.push(cursor);
    cursor = shiftDateOnly(cursor, 1);
    guard++;
  }
  return dates;
}

/** Inclusive day count of a date range — used for compensatory-leave balance deduction. */
export function countDaysInclusive(startDate: string, endDate: string): number {
  return datesInRange(startDate, endDate).length;
}

/** `{ from, to }` covering every day of the `YYYY-MM` month. */
export function monthRange(monthStr: string): { from: string; to: string } {
  const [y, m] = monthStr.split("-").map(Number);
  const year = y!;
  const month = (m ?? 1) - 1;
  const from = formatDateOnly(year, month, 1);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const to = formatDateOnly(year, month, lastDay);
  return { from, to };
}

/** `YYYY-MM` shifted by `deltaMonths` (may cross year boundaries) — calendar prev/next month nav. */
export function shiftMonth(monthStr: string, deltaMonths: number): string {
  const [y, m] = monthStr.split("-").map(Number);
  const year = y!;
  const month = (m ?? 1) - 1 + deltaMonths;
  const shifted = new Date(Date.UTC(year, month, 1));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Status resolution
 * ──────────────────────────────────────────────────────────────────────────── */

export type AttendanceStatus = "present" | "compensatory" | "holiday" | "leave" | "absent" | "not_marked";

export interface HolidayInput {
  kind: HolidayKind;
  /** Set when `kind === "specific"`, `YYYY-MM-DD`. */
  holidayDate: string | null;
  /** Set when `kind === "weekly_off"`, 0-6. */
  weekday: number | null;
  name: string;
}

export interface ApprovedLeaveInput {
  startDate: string;
  endDate: string;
  reason: LeaveReason;
}

export interface DayStatusResult {
  status: AttendanceStatus;
  /** Set only when `status` is `holiday` or `compensatory`. */
  holidayName: string | null;
  /** Set only when `status` is `leave`. */
  leaveReason: LeaveReason | null;
}

/** The holiday (specific date takes priority over a matching weekly-off) covering `dateOnly`, or `null`. */
export function findHolidayForDate(dateOnly: string, holidays: readonly HolidayInput[]): HolidayInput | null {
  const specific = holidays.find((h) => h.kind === "specific" && h.holidayDate === dateOnly);
  if (specific) return specific;
  const weekday = weekdayOf(dateOnly);
  return holidays.find((h) => h.kind === "weekly_off" && h.weekday === weekday) ?? null;
}

/** The approved leave request (if any) covering `dateOnly`. Caller must pre-filter to `status === "approved"`. */
export function findApprovedLeaveForDate(
  dateOnly: string,
  approvedLeaves: readonly ApprovedLeaveInput[],
): ApprovedLeaveInput | null {
  return approvedLeaves.find((l) => dateOnly >= l.startDate && dateOnly <= l.endDate) ?? null;
}

export interface ResolveDayStatusParams {
  /** `YYYY-MM-DD` day being resolved. */
  date: string;
  /** `YYYY-MM-DD` "today" (IST calendar day) — the past/future/today boundary. */
  todayDate: string;
  /** Does this user have a `smark_attendance` row for `date`? */
  hasAttendanceRow: boolean;
  holidays: readonly HolidayInput[];
  /** Pre-filtered to `status === "approved"` — this function trusts the caller's filter. */
  approvedLeaves: readonly ApprovedLeaveInput[];
}

/** The one resolver every attendance surface (calendar, day breakdown, exports) calls — see module header for the rule order. */
export function resolveDayStatus(params: ResolveDayStatusParams): DayStatusResult {
  const holiday = findHolidayForDate(params.date, params.holidays);

  // 1 + 2 — attendance row wins over "day is a holiday": present, or
  // compensatory when that same day is also a holiday.
  if (params.hasAttendanceRow) {
    return holiday
      ? { status: "compensatory", holidayName: holiday.name, leaveReason: null }
      : { status: "present", holidayName: null, leaveReason: null };
  }

  // 1 (no attendance row case) — holiday with nobody clocked in.
  if (holiday) {
    return { status: "holiday", holidayName: holiday.name, leaveReason: null };
  }

  // 3 — approved leave.
  const leave = findApprovedLeaveForDate(params.date, params.approvedLeaves);
  if (leave) {
    return { status: "leave", holidayName: null, leaveReason: leave.reason };
  }

  // 4 / 5 — computed absence vs "not yet marked".
  return params.date < params.todayDate
    ? { status: "absent", holidayName: null, leaveReason: null }
    : { status: "not_marked", holidayName: null, leaveReason: null };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Month/range calendar builder
 * ──────────────────────────────────────────────────────────────────────────── */

export interface CalendarDay extends DayStatusResult {
  date: string;
}

export interface BuildCalendarParams {
  from: string;
  to: string;
  todayDate: string;
  /** Dates (YYYY-MM-DD) this user has a `smark_attendance` row for. */
  attendanceDates: ReadonlySet<string>;
  holidays: readonly HolidayInput[];
  approvedLeaves: readonly ApprovedLeaveInput[];
}

/** Maps `resolveDayStatus` over every day in `[from, to]` — the month/range calendar view. */
export function buildCalendar(params: BuildCalendarParams): CalendarDay[] {
  return datesInRange(params.from, params.to).map((date) => ({
    date,
    ...resolveDayStatus({
      date,
      todayDate: params.todayDate,
      hasAttendanceRow: params.attendanceDates.has(date),
      holidays: params.holidays,
      approvedLeaves: params.approvedLeaves,
    }),
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Comp balance — DERIVED, never stored (migration 0009 header).
 * ──────────────────────────────────────────────────────────────────────────── */

/** approved comp-work days − approved compensatory-leave days. May go negative if over-spent (UI should never let that happen; actions.ts blocks it before insert). */
export function computeCompBalance(approvedCompWorkDays: number, approvedCompensatoryLeaveDays: number): number {
  return approvedCompWorkDays - approvedCompensatoryLeaveDays;
}

/** A standard workday in hours — the conversion factor for comp-off (0018). */
export const HOURS_PER_DAY = 8;

export interface CompBalanceHoursInput {
  /** Σ hours_approved of approved smark_overtime rows. */
  approvedOvertimeHours: number;
  /** Count of approved smark_comp_work rows (whole holidays worked) — each folded in at hoursPerDay. */
  approvedCompWorkDays: number;
  /** Σ comp_hours of approved compensatory leave requests (the owner-chosen debits). */
  approvedCompLeaveDebitHours: number;
  hoursPerDay?: number;
}

/**
 * (0018) The comp-off balance in HOURS — DERIVED, never stored. Overtime hours
 * plus holiday comp-work (folded at hoursPerDay each) credit the balance;
 * owner-chosen debits on approved compensatory leaves reduce it. May go
 * negative only if a debit was recorded above the balance (actions.ts caps it).
 */
export function computeCompBalanceHours({
  approvedOvertimeHours,
  approvedCompWorkDays,
  approvedCompLeaveDebitHours,
  hoursPerDay = HOURS_PER_DAY,
}: CompBalanceHoursInput): number {
  return approvedOvertimeHours + approvedCompWorkDays * hoursPerDay - approvedCompLeaveDebitHours;
}
