/**
 * lib/attendance/core.ts — Attendance module DB writes: holidays, leave
 * requests, comp-work claims + their approve/reject decisions. Self
 * mark-present and owner day-correction reuse `lib/daily/core.ts` directly
 * (same `smark_attendance` table, no need to re-implement clock-in/out or
 * the owner backfill path — see lib/attendance/actions.ts).
 *
 * Every exported function takes an already-created `SupabaseClient<Database>`
 * plus the acting user's id, mirroring lib/daily/core.ts, so actions.ts
 * ("use server") wraps these with the per-request RLS-bound client while
 * tests can call the same functions with a service-role client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";
import type {
  AddHolidayInput,
  DecideCompWorkInput,
  DecideLeaveRequestInput,
  RemoveHolidayInput,
  SetWeeklyOffInput,
  SubmitCompWorkInput,
  SubmitLeaveRequestInput,
} from "./types";

type DB = SupabaseClient<Database>;

type Result = { ok: true } | { ok: false; error: string };
type ResultWithId = { ok: true; id: string } | { ok: false; error: string };

/** Employee claims they worked a holiday date. Unique (user_id, work_date) — a second claim for the same day errors. */
export async function submitCompWork(supabase: DB, actorId: string, input: SubmitCompWorkInput): Promise<ResultWithId> {
  const { data, error } = await supabase
    .from(TABLES.comp_work)
    .insert({
      user_id: actorId,
      work_date: input.workDate,
      note: input.note ?? null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

/** Owner approve/reject of a comp-work claim. Returns the claim's user_id + work_date for the caller to notify with. */
export async function decideCompWork(
  supabase: DB,
  deciderId: string,
  input: DecideCompWorkInput,
): Promise<({ ok: true; userId: string; workDate: string }) | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from(TABLES.comp_work)
    .update({
      status: input.approve ? "approved" : "rejected",
      decided_by: deciderId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select("user_id, work_date")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, userId: data.user_id as string, workDate: data.work_date as string };
}

/** Employee submits a leave request. Compensatory-balance check happens in actions.ts BEFORE this is called. */
export async function submitLeaveRequest(supabase: DB, actorId: string, input: SubmitLeaveRequestInput): Promise<ResultWithId> {
  const { data, error } = await supabase
    .from(TABLES.leave_requests)
    .insert({
      user_id: actorId,
      start_date: input.startDate,
      end_date: input.endDate,
      reason: input.reason,
      note: input.note ?? null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

/** Owner approve/reject of a leave request. Returns the request's user_id + date range for the caller to notify with. */
export async function decideLeaveRequest(
  supabase: DB,
  deciderId: string,
  input: DecideLeaveRequestInput,
): Promise<({ ok: true; userId: string; startDate: string; endDate: string }) | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from(TABLES.leave_requests)
    .update({
      status: input.approve ? "approved" : "rejected",
      decided_by: deciderId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select("user_id, start_date, end_date")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, userId: data.user_id as string, startDate: data.start_date as string, endDate: data.end_date as string };
}

/** Owner adds a specific-date holiday. */
export async function addHoliday(supabase: DB, ownerId: string, input: AddHolidayInput): Promise<ResultWithId> {
  const { data, error } = await supabase
    .from(TABLES.holidays)
    .insert({
      kind: "specific",
      holiday_date: input.holidayDate,
      weekday: null,
      name: input.name,
      created_by: ownerId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

/** Owner sets a weekly-off weekday (idempotent-ish — a duplicate weekday errors on the partial unique index). */
export async function setWeeklyOff(supabase: DB, ownerId: string, input: SetWeeklyOffInput): Promise<ResultWithId> {
  const { data, error } = await supabase
    .from(TABLES.holidays)
    .insert({
      kind: "weekly_off",
      holiday_date: null,
      weekday: input.weekday,
      name: input.name,
      created_by: ownerId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

/** Owner removes any holiday row (specific date or weekly-off day). */
export async function removeHoliday(supabase: DB, input: RemoveHolidayInput): Promise<Result> {
  const { error } = await supabase.from(TABLES.holidays).delete().eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
