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
import { getCompBalance } from "./queries";
import { countDaysInclusive } from "./status";
import {
  notifyCompDecided,
  notifyCompPending,
  notifyLeaveDecided,
  notifyLeavePending,
} from "@/lib/notifications/fanout";
import { TABLES } from "@/types/db";
import {
  AddHolidayInputSchema,
  DecideCompWorkInputSchema,
  DecideLeaveRequestInputSchema,
  MarkPresentInputSchema,
  OwnerCorrectAttendanceInputSchema,
  RemoveHolidayInputSchema,
  SetWeeklyOffInputSchema,
  SubmitCompWorkInputSchema,
  SubmitLeaveRequestInputSchema,
  type AddHolidayInput,
  type DecideCompWorkInput,
  type DecideLeaveRequestInput,
  type MarkPresentInput,
  type OwnerCorrectAttendanceInput,
  type RemoveHolidayInput,
  type SetWeeklyOffInput,
  type SubmitCompWorkInput,
  type SubmitLeaveRequestInput,
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

  // Compensatory reason requires available comp balance — checked here BEFORE
  // insert (migration 0009 header: balance is derived, not a DB constraint).
  if (parsed.reason === "compensatory") {
    const balance = await getCompBalance(supabase, actorId);
    const requestedDays = countDaysInclusive(parsed.startDate, parsed.endDate);
    if (requestedDays > balance) {
      return {
        ok: false,
        error: `Not enough comp balance: requesting ${requestedDays} day(s), only ${Math.max(balance, 0)} available.`,
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
  const result = await core.decideLeaveRequest(supabase, actorId, parsed);
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
