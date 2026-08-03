"use server";

/**
 * lib/attendance/actions.ts — Server Actions for the Attendance module.
 *
 * Thin wrappers: validate with zod (lib/attendance/types.ts) FIRST, resolve
 * the caller's session + role via the per-request RLS-bound client
 * (lib/supabase/server.ts — never the service client), then delegate to
 * lib/attendance/core.ts (or lib/daily/core.ts for the two flows this module
 * reuses: self mark-present and owner day-correction, both of which just
 * write `smark_attendance` — see prompt "reuse existing infra"). Mirrors
 * lib/daily/actions.ts's requireSession/requireWriter shape.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canWrite, isOwner, type Role } from "@/lib/auth/roles";
import * as dailyCore from "@/lib/daily/core";
import * as core from "./core";
import { getCompBalanceDays } from "./queries";
import {
  canSpendCompDays,
  compDaysForLeave,
  formatCompDays,
  inclusiveDayCount,
  STANDARD_ANNUAL_COMP_DAYS,
} from "./comp-days";
import { postLedgerEntry, setCompSettings } from "./comp-ledger";
import { HOURS_PER_DAY } from "./status";
import {
  notifyCompDecided,
  notifyCompPending,
  notifyLeaveDecided,
  notifyLeavePending,
  notifyOvertimeDecided,
  notifyOvertimePending,
} from "@/lib/notifications/fanout";
import { TABLES } from "@/types/db";
import {
  AddHolidayInputSchema,
  DecideCompWorkInputSchema,
  DecideLeaveRequestInputSchema,
  DecideOvertimeInputSchema,
  MarkPresentInputSchema,
  OwnerCorrectAttendanceInputSchema,
  RemoveHolidayInputSchema,
  SetWeeklyOffInputSchema,
  SubmitCompWorkInputSchema,
  SubmitLeaveRequestInputSchema,
  SubmitOvertimeInputSchema,
  SetCompBalanceInputSchema,
  SetCompEntitlementInputSchema,
  type AddHolidayInput,
  type DecideCompWorkInput,
  type DecideLeaveRequestInput,
  type DecideOvertimeInput,
  type MarkPresentInput,
  type OwnerCorrectAttendanceInput,
  type RemoveHolidayInput,
  type SetWeeklyOffInput,
  type SubmitCompWorkInput,
  type SubmitLeaveRequestInput,
  type SubmitOvertimeInput,
  type SetCompBalanceInput,
  type SetCompEntitlementInput,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };
type ActionResultWithId = { ok: true; id: string } | { ok: false; error: string };

async function requireSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: role } = await supabase.rpc("smark_role");
  if (!role) throw new Error("Your account isn't active.");
  return { supabase, actorId: user.id, role: role as Role };
}

/** Owner (any user's row) or an employee acting on their OWN row — accountant is read-only everywhere on Attendance. */
async function requireAttendanceWriter() {
  const session = await requireSession();
  if (!canWrite(session.role, "attendance")) {
    throw new Error("You don't have permission to make changes on Attendance.");
  }
  return session;
}

async function requireOwner() {
  const session = await requireSession();
  if (!isOwner(session.role)) throw new Error("Only the owner can do that.");
  return session;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Self mark-present — reuses lib/daily/core.clockIn (same smark_attendance
 * table, same "one row per user per day" semantics).
 * ──────────────────────────────────────────────────────────────────────────── */

export async function markPresentAction(input: MarkPresentInput): Promise<ActionResult> {
  const parsed = MarkPresentInputSchema.parse(input);
  const { supabase, actorId } = await requireAttendanceWriter();
  const result = await dailyCore.clockIn(supabase, actorId, parsed.projectId ?? null);
  if (result.ok) revalidatePath("/attendance");
  return result;
}

/** (0018) Self mark-out for today — reuses lib/daily/core.clockOut (stamps check_out on today's row). */
export async function markOutAction(): Promise<ActionResult> {
  const { supabase, actorId } = await requireAttendanceWriter();
  const result = await dailyCore.clockOut(supabase, actorId);
  if (!result.ok) return result;
  revalidatePath("/attendance");
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Overtime (0018) — self-report extra hours → owner approval → hours comp-off.
 * ──────────────────────────────────────────────────────────────────────────── */

export async function submitOvertimeAction(input: SubmitOvertimeInput): Promise<ActionResultWithId> {
  const parsed = SubmitOvertimeInputSchema.parse(input);
  const { supabase, actorId } = await requireAttendanceWriter();

  const { data: userRow } = await supabase.from(TABLES.app_users).select("display_name, username").eq("id", actorId).maybeSingle();
  const employeeName = userRow?.display_name ?? userRow?.username ?? "An employee";

  const result = await core.submitOvertime(supabase, actorId, parsed);
  if (result.ok) {
    await notifyOvertimePending(supabase, { employeeName, workDate: parsed.workDate, hours: parsed.hours });
    revalidatePath("/attendance");
  }
  return result;
}

export async function decideOvertimeAction(input: DecideOvertimeInput): Promise<ActionResult> {
  const parsed = DecideOvertimeInputSchema.parse(input);
  const { supabase, actorId } = await requireOwner();
  const result = await core.decideOvertime(supabase, actorId, parsed);
  if (!result.ok) return result;
  await notifyOvertimeDecided(supabase, {
    userId: result.userId,
    workDate: result.workDate,
    approved: parsed.approve,
    hoursApproved: result.hoursApproved,
  });
  revalidatePath("/attendance");
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Comp-work claims
 * ──────────────────────────────────────────────────────────────────────────── */

export async function submitCompWorkAction(input: SubmitCompWorkInput): Promise<ActionResultWithId> {
  const parsed = SubmitCompWorkInputSchema.parse(input);
  const { supabase, actorId } = await requireAttendanceWriter();

  const { data: userRow } = await supabase.from(TABLES.app_users).select("display_name, username").eq("id", actorId).maybeSingle();
  const employeeName = userRow?.display_name ?? userRow?.username ?? "An employee";

  const result = await core.submitCompWork(supabase, actorId, parsed);
  if (result.ok) {
    await notifyCompPending(supabase, { employeeName, workDate: parsed.workDate });
    revalidatePath("/attendance");
  }
  return result;
}

export async function decideCompWorkAction(input: DecideCompWorkInput): Promise<ActionResult> {
  const parsed = DecideCompWorkInputSchema.parse(input);
  const { supabase, actorId } = await requireOwner();
  const result = await core.decideCompWork(supabase, actorId, parsed);
  if (!result.ok) return result;
  await notifyCompDecided(supabase, { userId: result.userId, workDate: result.workDate, approved: parsed.approve });
  revalidatePath("/attendance");
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Leave requests
 * ──────────────────────────────────────────────────────────────────────────── */

export async function submitLeaveRequestAction(input: SubmitLeaveRequestInput): Promise<ActionResultWithId> {
  const parsed = SubmitLeaveRequestInputSchema.parse(input);
  const { supabase, actorId } = await requireAttendanceWriter();

  // (0020) Comp-off is counted in DAYS. Check the cost up front rather than
  // only at approval: an employee asking for three days on a one-day balance
  // should hear it now, not after the owner has thought about it.
  if (parsed.reason === "compensatory") {
    const balance = await getCompBalanceDays(supabase, actorId);
    const cost = compDaysForLeave(inclusiveDayCount(parsed.startDate, parsed.endDate), parsed.halfDay ?? false);
    if (balance <= 0) {
      return { ok: false, error: "You have no comp-off days banked yet." };
    }
    if (!canSpendCompDays(balance, cost)) {
      return {
        ok: false,
        error: `That leave costs ${formatCompDays(cost)} and you have ${formatCompDays(balance)} banked.`,
      };
    }
  }

  const { data: userRow } = await supabase.from(TABLES.app_users).select("display_name, username").eq("id", actorId).maybeSingle();
  const employeeName = userRow?.display_name ?? userRow?.username ?? "An employee";

  const result = await core.submitLeaveRequest(supabase, actorId, parsed);
  if (result.ok) {
    await notifyLeavePending(supabase, { employeeName, startDate: parsed.startDate, endDate: parsed.endDate });
    revalidatePath("/attendance");
  }
  return result;
}

export async function decideLeaveRequestAction(input: DecideLeaveRequestInput): Promise<ActionResult> {
  const parsed = DecideLeaveRequestInputSchema.parse(input);
  const { supabase, actorId } = await requireOwner();

  // (0020) Approving a compensatory leave spends DAYS, and the cost is a
  // property of the request (half day = 0.5, otherwise one per calendar day)
  // rather than a number the owner types. core.decideLeaveRequest writes the
  // ledger debit; this is the balance check that stops it going negative.
  //
  // `compHours` is still written for continuity with the 0018 column, derived
  // from the day cost so the two never disagree.
  let compHours: number | null = null;
  if (parsed.approve) {
    const { data: leave } = await supabase
      .from(TABLES.leave_requests)
      .select("user_id, start_date, end_date, reason, half_day")
      .eq("id", parsed.id)
      .maybeSingle();
    if (leave?.reason === "compensatory") {
      const cost = compDaysForLeave(inclusiveDayCount(leave.start_date, leave.end_date), Boolean(leave.half_day));
      const balance = await getCompBalanceDays(supabase, leave.user_id);
      if (!canSpendCompDays(balance, cost)) {
        return {
          ok: false,
          error: `Not enough comp-off: this leave costs ${formatCompDays(cost)}, only ${formatCompDays(Math.max(balance, 0))} banked.`,
        };
      }
      compHours = cost * HOURS_PER_DAY;
    }
  }

  const result = await core.decideLeaveRequest(supabase, actorId, { ...parsed, compHours });
  if (!result.ok) return result;
  await notifyLeaveDecided(supabase, {
    userId: result.userId,
    startDate: result.startDate,
    endDate: result.endDate,
    approved: parsed.approve,
  });
  revalidatePath("/attendance");
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Holiday admin — owner only
 * ──────────────────────────────────────────────────────────────────────────── */

export async function addHolidayAction(input: AddHolidayInput): Promise<ActionResultWithId> {
  const parsed = AddHolidayInputSchema.parse(input);
  const { supabase, actorId } = await requireOwner();
  const result = await core.addHoliday(supabase, actorId, parsed);
  if (result.ok) revalidatePath("/attendance");
  return result;
}

export async function setWeeklyOffAction(input: SetWeeklyOffInput): Promise<ActionResultWithId> {
  const parsed = SetWeeklyOffInputSchema.parse(input);
  const { supabase, actorId } = await requireOwner();
  const result = await core.setWeeklyOff(supabase, actorId, parsed);
  if (result.ok) revalidatePath("/attendance");
  return result;
}

export async function removeHolidayAction(input: RemoveHolidayInput): Promise<ActionResult> {
  const parsed = RemoveHolidayInputSchema.parse(input);
  const { supabase } = await requireOwner();
  const result = await core.removeHoliday(supabase, parsed);
  if (result.ok) revalidatePath("/attendance");
  return result;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Owner day-correction — reuses lib/daily/core.ownerSetAttendance (same
 * "one logical row per user per day" upsert; the attendance module has no
 * project-tag concept, so projectId is simply left undefined = untouched).
 * ──────────────────────────────────────────────────────────────────────────── */

export async function ownerCorrectAttendanceAction(input: OwnerCorrectAttendanceInput): Promise<ActionResult> {
  const parsed = OwnerCorrectAttendanceInputSchema.parse(input);
  const { supabase } = await requireOwner();
  const result = await dailyCore.ownerSetAttendance(supabase, {
    userId: parsed.userId,
    workDate: parsed.workDate,
    checkInTime: parsed.checkInTime,
    checkOutTime: parsed.checkOutTime,
    note: parsed.note,
  });
  if (result.ok) revalidatePath("/attendance");
  return result;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Comp-off: owner corrections + the yearly entitlement (0020)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Owner writes an employee's comp-off balance to an exact figure.
 *
 * Needed because the app is taking over a balance that already exists on
 * paper: the owner has to be able to say "Krunal starts with 6 days" without
 * inventing fake overtime claims to add up to it. Also the escape hatch for
 * any correction after the fact.
 *
 * Recorded as a DELTA against the current balance rather than a stored total,
 * so the ledger stays append-only and the adjustment shows up in history as
 * what it was — an owner correction, with a reason and a name against it.
 */
export async function setCompBalanceAction(input: SetCompBalanceInput): Promise<ActionResult> {
  const parsed = SetCompBalanceInputSchema.parse(input);
  const { supabase, actorId } = await requireOwner();

  const current = await getCompBalanceDays(supabase, parsed.userId);
  const delta = Math.round((parsed.balanceDays - current) * 10) / 10;
  if (delta === 0) return { ok: true };

  await postLedgerEntry(supabase, {
    userId: parsed.userId,
    entryDate: parsed.entryDate,
    deltaDays: delta,
    sourceKind: "manual",
    note: parsed.note?.trim() || `Balance set to ${formatCompDays(parsed.balanceDays)} by the owner`,
    createdBy: actorId,
  });

  revalidatePath("/attendance");
  revalidatePath(`/team/${parsed.userId}`);
  return { ok: true };
}

/**
 * Owner turns the yearly comp-off entitlement on or off for one employee.
 *
 * A toggle rather than a computed length-of-service rule, at the client's
 * request: "the admin should manually add for the first time... a toggle,
 * they get 16 days off per year, yes or no". Stored as a number of days so
 * the standard 16 can change, or an individual can differ, without a
 * migration — `on` simply writes the standard figure.
 *
 * Takes effect at the next January reset; it does not grant days today.
 */
export async function setCompEntitlementAction(input: SetCompEntitlementInput): Promise<ActionResult> {
  const parsed = SetCompEntitlementInputSchema.parse(input);
  const { supabase, actorId } = await requireOwner();

  const annualDays = parsed.entitled ? (parsed.annualDays ?? STANDARD_ANNUAL_COMP_DAYS) : 0;
  await setCompSettings(supabase, actorId, parsed.userId, annualDays);

  revalidatePath("/attendance");
  revalidatePath(`/team/${parsed.userId}`);
  return { ok: true };
}
