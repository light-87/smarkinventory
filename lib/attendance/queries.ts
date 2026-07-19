/**
 * lib/attendance/queries.ts — server-only data fetching for the Attendance
 * module. Every function takes an already-created request Supabase client
 * (`lib/supabase/server.ts` `createClient()`) so it runs under the caller's
 * session + RLS — never the service-role client. Mirrors lib/daily/queries.ts.
 *
 * "Employee sees self only" (`lib/auth/roles.ts` `attendance` area = self for
 * employee) is enforced HERE at the query layer for leave/comp-work lists —
 * holidays are company-wide and readable by every authed role (RLS already
 * allows this), so `getHolidays` takes no actor filter. Callers
 * (app/(app)/attendance/page.tsx) MUST pass the caller's own id when
 * `dataScope(role, "attendance") === "self"` — same one enforcement point
 * convention as lib/daily/queries.ts's header.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalStatus, Database, HolidayKind, LeaveReason } from "@/types/db";
import { TABLES } from "@/types/db";
import {
  buildCalendar,
  computeCompBalanceHours,
  datesInRange,
  resolveDayStatus,
  type ApprovedLeaveInput,
  type CalendarDay,
  type HolidayInput,
  monthRange,
} from "./status";

type DB = SupabaseClient<Database>;

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`[attendance] ${context}: ${error.message}`);
}

/**
 * Nav-badge signal: how many attendance approvals are waiting on the owner —
 * pending leave + overtime + comp-work across all users. Runs under the
 * caller's RLS (only owner/accountant see others' rows; the layout calls this
 * for the owner). `head: true` counts without pulling rows.
 */
export async function countPendingAttendanceApprovals(client: DB): Promise<number> {
  const tables = [TABLES.leave_requests, TABLES.overtime, TABLES.comp_work] as const;
  const results = await Promise.all(
    tables.map((table) => client.from(table).select("id", { count: "exact", head: true }).eq("status", "pending")),
  );
  return results.reduce((sum, r) => sum + (r.count ?? 0), 0);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Holidays — company-wide, readable by every active role.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface HolidayView {
  id: string;
  kind: HolidayKind;
  holidayDate: string | null;
  weekday: number | null;
  name: string;
}

function toHolidayInput(h: HolidayView): HolidayInput {
  return { kind: h.kind, holidayDate: h.holidayDate, weekday: h.weekday, name: h.name };
}

/** Every holiday row — `range` optionally narrows `specific` dates to a window (weekly-offs always included, they recur forever). */
export async function getHolidays(supabase: DB, range?: { from: string; to: string }): Promise<HolidayView[]> {
  const { data, error } = await supabase
    .from(TABLES.holidays)
    .select("id, kind, holiday_date, weekday, name")
    .order("kind", { ascending: true })
    .order("holiday_date", { ascending: true });
  assertNoError(error, "smark_holidays");

  const rows: HolidayView[] = (data ?? []).map((h) => ({
    id: h.id,
    kind: h.kind as HolidayKind,
    holidayDate: h.holiday_date,
    weekday: h.weekday,
    name: h.name,
  }));

  if (!range) return rows;
  return rows.filter((h) => h.kind === "weekly_off" || (h.holidayDate !== null && h.holidayDate >= range.from && h.holidayDate <= range.to));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Leave requests
 * ──────────────────────────────────────────────────────────────────────────── */

export interface LeaveRequestView {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  reason: LeaveReason;
  note: string | null;
  status: ApprovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  /** (0018) Comp-off hours debited when a compensatory leave was approved; null otherwise. */
  compHours: number | null;
}

/** `actorFilter: null` = every user's requests (owner/accountant "all"); a user id = that user's own only (employee "self"). */
export async function getLeaveRequests(
  supabase: DB,
  actorFilter: string | null,
  options: { status?: ApprovalStatus } = {},
): Promise<LeaveRequestView[]> {
  let query = supabase
    .from(TABLES.leave_requests)
    .select("id, user_id, start_date, end_date, reason, note, status, decided_by, decided_at, created_at, comp_hours")
    .order("created_at", { ascending: false });
  if (actorFilter) query = query.eq("user_id", actorFilter);
  if (options.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  assertNoError(error, "smark_leave_requests");

  return (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    startDate: r.start_date,
    endDate: r.end_date,
    reason: r.reason as LeaveReason,
    note: r.note,
    status: r.status as ApprovalStatus,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
    compHours: r.comp_hours,
  }));
}

/**
 * Approved leave requests (any user) whose `[start_date, end_date]` overlaps
 * `[from, to]` — feeds the owner dashboard's "Leaves this week" widget.
 * Brand-new, additive query: `getLeaveRequests` above has no range/overlap
 * filter (it returns a whole actor's history), so this is a separate function
 * rather than a change to it.
 */
export async function getApprovedLeaveRequestsOverlapping(supabase: DB, from: string, to: string): Promise<LeaveRequestView[]> {
  const { data, error } = await supabase
    .from(TABLES.leave_requests)
    .select("id, user_id, start_date, end_date, reason, note, status, decided_by, decided_at, created_at, comp_hours")
    .eq("status", "approved")
    .lte("start_date", to)
    .gte("end_date", from)
    .order("start_date", { ascending: true });
  assertNoError(error, "smark_leave_requests (overlapping range)");

  return (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    startDate: r.start_date,
    endDate: r.end_date,
    reason: r.reason as LeaveReason,
    note: r.note,
    status: r.status as ApprovalStatus,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
    compHours: r.comp_hours,
  }));
}

export interface BirthdayView {
  id: string;
  username: string;
  displayName: string | null;
  birthDate: string;
}

/** `true` when `birthDate`'s month+day (year ignored) matches `dateOnly`'s month+day. */
function isBirthdayOn(birthDate: string, dateOnly: string): boolean {
  return birthDate.slice(5) === dateOnly.slice(5); // "MM-DD" slice of a YYYY-MM-DD string
}

/**
 * Active users whose birthday (month+day, year ignored) falls on any day in
 * `[from, to]` — feeds the owner dashboard's "Birthdays this week" widget.
 * `smark_app_users.birth_date` (0009) is a plain `date`; matched in JS against
 * every day of the window (`datesInRange`, existing pure helper) since
 * month/day-only comparison isn't a simple indexed SQL filter and the active
 * user count is small.
 */
export async function getUpcomingBirthdays(supabase: DB, from: string, to: string): Promise<BirthdayView[]> {
  const { data, error } = await supabase
    .from(TABLES.app_users)
    .select("id, username, display_name, birth_date")
    .eq("active", true)
    .not("birth_date", "is", null);
  assertNoError(error, "smark_app_users (birthdays)");

  const windowDays = datesInRange(from, to);
  return (data ?? [])
    .filter((u): u is typeof u & { birth_date: string } => u.birth_date !== null)
    .filter((u) => windowDays.some((day) => isBirthdayOn(u.birth_date, day)))
    .map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, birthDate: u.birth_date }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Comp-work claims
 * ──────────────────────────────────────────────────────────────────────────── */

export interface CompWorkView {
  id: string;
  userId: string;
  workDate: string;
  note: string | null;
  status: ApprovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** `actorFilter: null` = every user's claims (owner/accountant "all"); a user id = that user's own only (employee "self"). */
export async function getCompWork(
  supabase: DB,
  actorFilter: string | null,
  options: { status?: ApprovalStatus } = {},
): Promise<CompWorkView[]> {
  let query = supabase
    .from(TABLES.comp_work)
    .select("id, user_id, work_date, note, status, decided_by, decided_at, created_at")
    .order("created_at", { ascending: false });
  if (actorFilter) query = query.eq("user_id", actorFilter);
  if (options.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  assertNoError(error, "smark_comp_work");

  return (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    workDate: r.work_date,
    note: r.note,
    status: r.status as ApprovalStatus,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Overtime claims (0018)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface OvertimeView {
  id: string;
  userId: string;
  workDate: string;
  hoursClaimed: number;
  hoursApproved: number | null;
  note: string | null;
  status: ApprovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** `actorFilter: null` = every user's claims (owner/accountant "all"); a user id = that user's own only (employee "self"). */
export async function getOvertime(
  supabase: DB,
  actorFilter: string | null,
  options: { status?: ApprovalStatus } = {},
): Promise<OvertimeView[]> {
  let query = supabase
    .from(TABLES.overtime)
    .select("id, user_id, work_date, hours_claimed, hours_approved, note, status, decided_by, decided_at, created_at")
    .order("created_at", { ascending: false });
  if (actorFilter) query = query.eq("user_id", actorFilter);
  if (options.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  assertNoError(error, "smark_overtime");

  return (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    workDate: r.work_date,
    hoursClaimed: r.hours_claimed,
    hoursApproved: r.hours_approved,
    note: r.note,
    status: r.status as ApprovalStatus,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  }));
}

/**
 * (0018) Derived comp-off balance in HOURS (never stored) —
 *   Σ approved overtime hours_approved
 *   + approved comp-work days × 8 (existing holiday-comp folded in)
 *   − Σ approved compensatory-leave comp_hours.
 */
export async function getCompBalance(supabase: DB, userId: string): Promise<number> {
  const [overtime, compWork, leaves] = await Promise.all([
    getOvertime(supabase, userId, { status: "approved" }),
    getCompWork(supabase, userId, { status: "approved" }),
    getLeaveRequests(supabase, userId, { status: "approved" }),
  ]);
  const approvedOvertimeHours = overtime.reduce((sum, o) => sum + (o.hoursApproved ?? 0), 0);
  const approvedCompLeaveDebitHours = leaves
    .filter((l) => l.reason === "compensatory")
    .reduce((sum, l) => sum + (l.compHours ?? 0), 0);
  return computeCompBalanceHours({
    approvedOvertimeHours,
    approvedCompWorkDays: compWork.length,
    approvedCompLeaveDebitHours,
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Attendance-row lookups (smark_attendance itself — presence, not status)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Dates (YYYY-MM-DD) `userId` has a `smark_attendance` row for, within `[from, to]`. */
export async function getAttendanceDatesForUser(supabase: DB, userId: string, from: string, to: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from(TABLES.attendance)
    .select("work_date")
    .eq("user_id", userId)
    .gte("work_date", from)
    .lte("work_date", to);
  assertNoError(error, "smark_attendance (dates for user)");
  return new Set((data ?? []).map((r) => r.work_date));
}

/** Every active user's `smark_attendance` row for ONE day, keyed by user id (present ⇔ key exists). */
export async function getAttendancePresenceForDay(supabase: DB, workDate: string): Promise<Set<string>> {
  const { data, error } = await supabase.from(TABLES.attendance).select("user_id").eq("work_date", workDate);
  assertNoError(error, "smark_attendance (day presence)");
  return new Set((data ?? []).map((r) => r.user_id));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Calendar + day breakdown — the composed views the UI actually renders.
 * ──────────────────────────────────────────────────────────────────────────── */

function toApprovedLeaveInput(l: LeaveRequestView): ApprovedLeaveInput {
  return { startDate: l.startDate, endDate: l.endDate, reason: l.reason };
}

/** One user's month calendar (`YYYY-MM`) — every day resolved to a status via lib/attendance/status.ts. */
export async function getMonthCalendar(supabase: DB, userId: string, month: string, todayDate: string): Promise<CalendarDay[]> {
  const { from, to } = monthRange(month);
  const [attendanceDates, holidays, leaves] = await Promise.all([
    getAttendanceDatesForUser(supabase, userId, from, to),
    getHolidays(supabase, { from, to }),
    getLeaveRequests(supabase, userId, { status: "approved" }),
  ]);

  return buildCalendar({
    from,
    to,
    todayDate,
    attendanceDates,
    holidays: holidays.map(toHolidayInput),
    approvedLeaves: leaves.map(toApprovedLeaveInput),
  });
}

export interface AppUserBasic {
  id: string;
  username: string;
  displayName: string | null;
}

export interface DayBreakdownEntry {
  user: AppUserBasic;
  status: ReturnType<typeof resolveDayStatus>["status"];
  holidayName: string | null;
  leaveReason: LeaveReason | null;
}

/** Who was Present / Compensatory / Holiday / Leave / Absent / Not-marked on `workDate`, across every active user — owner & accountant's "who was in" view. */
export async function getDayBreakdown(
  supabase: DB,
  workDate: string,
  todayDate: string,
  users: readonly AppUserBasic[],
): Promise<DayBreakdownEntry[]> {
  const [presentUserIds, holidays, approvedLeaves] = await Promise.all([
    getAttendancePresenceForDay(supabase, workDate),
    getHolidays(supabase, { from: workDate, to: workDate }),
    getLeaveRequests(supabase, null, { status: "approved" }),
  ]);

  const holidayInputs = holidays.map(toHolidayInput);

  return users.map((user) => {
    const userLeaves = approvedLeaves.filter((l) => l.userId === user.id).map(toApprovedLeaveInput);
    const result = resolveDayStatus({
      date: workDate,
      todayDate,
      hasAttendanceRow: presentUserIds.has(user.id),
      holidays: holidayInputs,
      approvedLeaves: userLeaves,
    });
    return { user, ...result };
  });
}

export interface MonthBreakdownDay {
  date: string;
  entries: DayBreakdownEntry[];
}

/**
 * Every active user's status for every day of `[from, to]`, batched into 3
 * queries total (not 3 × N days like calling `getDayBreakdown` per day would)
 * — feeds the calendar's "click a date → who was in" panel for owner/
 * accountant without re-querying per click (the whole month is precomputed
 * once server-side).
 */
export async function getMonthBreakdown(
  supabase: DB,
  from: string,
  to: string,
  todayDate: string,
  users: readonly AppUserBasic[],
): Promise<MonthBreakdownDay[]> {
  const [attendanceRes, holidays, approvedLeaves] = await Promise.all([
    supabase.from(TABLES.attendance).select("user_id, work_date").gte("work_date", from).lte("work_date", to),
    getHolidays(supabase, { from, to }),
    getLeaveRequests(supabase, null, { status: "approved" }),
  ]);
  assertNoError(attendanceRes.error, "smark_attendance (month breakdown)");

  const presentByDate = new Map<string, Set<string>>();
  for (const r of attendanceRes.data ?? []) {
    const set = presentByDate.get(r.work_date) ?? new Set<string>();
    set.add(r.user_id);
    presentByDate.set(r.work_date, set);
  }

  const holidayInputs = holidays.map(toHolidayInput);
  const leavesByUser = new Map<string, ApprovedLeaveInput[]>();
  for (const l of approvedLeaves) {
    const arr = leavesByUser.get(l.userId) ?? [];
    arr.push(toApprovedLeaveInput(l));
    leavesByUser.set(l.userId, arr);
  }

  return datesInRange(from, to).map((date) => {
    const presentIds = presentByDate.get(date) ?? new Set<string>();
    const dayHolidays = holidayInputs.filter((h) => h.kind === "weekly_off" || h.holidayDate === date);
    const entries = users.map((user) => {
      const result = resolveDayStatus({
        date,
        todayDate,
        hasAttendanceRow: presentIds.has(user.id),
        holidays: dayHolidays,
        approvedLeaves: leavesByUser.get(user.id) ?? [],
      });
      return { user, ...result };
    });
    return { date, entries };
  });
}
