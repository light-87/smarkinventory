/**
 * lib/daily/core.ts — Daily Reports DB writes (plan/tab-daily-reports.md
 * R2-07): self clock-in/out, the "working on" project tag, manual hours, and
 * owner attendance corrections.
 *
 * Every exported function takes an already-created `SupabaseClient<Database>`
 * plus the acting user's id, mirroring `lib/receive/core.ts` — so
 * `lib/daily/actions.ts` ("use server") wraps these with the per-request
 * RLS-bound client, while tests can call the same functions with a
 * service-role client.
 *
 * RLS is the real backstop everywhere below (attendance/time_entries insert/
 * update policies — supabase/migrations/0001_users_team.sql — already pin an
 * employee caller to `user_id = auth.uid()`); the role checks here exist so a
 * disallowed caller gets a clear message instead of an opaque Postgres RLS
 * error.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";
import { combineDateAndTime, needsHoursPrompt, todayDateOnly } from "./compute";
import type { LogHoursInput, OwnerSetAttendanceInput, UpdateHoursInput } from "./types";

type DB = SupabaseClient<Database>;

export type ClockInResult = { ok: true } | { ok: false; error: string };
export type ClockOutResult = { ok: true; hasLoggedHours: boolean } | { ok: false; error: string };
export type SetWorkingOnResult = { ok: true } | { ok: false; error: string };
export type LogHoursResult = { ok: true; id: string } | { ok: false; error: string };
export type UpdateHoursResult = { ok: true } | { ok: false; error: string };
export type OwnerSetAttendanceResult = { ok: true } | { ok: false; error: string };

/** Self clock-in for today — upserts the one logical (user, work_date) row. */
export async function clockIn(supabase: DB, actorId: string, projectId: string | null | undefined): Promise<ClockInResult> {
  const workDate = todayDateOnly();
  const { error } = await supabase.from(TABLES.attendance).upsert(
    {
      user_id: actorId,
      work_date: workDate,
      check_in: new Date().toISOString(),
      current_project_id: projectId ?? null,
    },
    { onConflict: "user_id,work_date" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Self clock-out for today — returns whether hours are already logged (drives the clock-out prompt). */
export async function clockOut(supabase: DB, actorId: string): Promise<ClockOutResult> {
  const workDate = todayDateOnly();
  const { error } = await supabase
    .from(TABLES.attendance)
    .update({ check_out: new Date().toISOString() })
    .eq("user_id", actorId)
    .eq("work_date", workDate);
  if (error) return { ok: false, error: error.message };

  const { count, error: countError } = await supabase
    .from(TABLES.time_entries)
    .select("id", { count: "exact", head: true })
    .eq("user_id", actorId)
    .eq("work_date", workDate);
  if (countError) return { ok: false, error: countError.message };

  return { ok: true, hasLoggedHours: !needsHoursPrompt(count ?? 0) };
}

/** Switch "working on" mid-day, without a fresh clock-in (creates today's row if it doesn't exist yet). */
export async function setWorkingOn(supabase: DB, actorId: string, projectId: string | null): Promise<SetWorkingOnResult> {
  const workDate = todayDateOnly();
  const { error } = await supabase.from(TABLES.attendance).upsert(
    { user_id: actorId, work_date: workDate, current_project_id: projectId },
    { onConflict: "user_id,work_date", ignoreDuplicates: false },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Manual hours entry (self, or owner adding/correcting anyone's — SCHEMA.md §7 `smark_time_entries`). */
export async function logManualHours(supabase: DB, actorId: string, input: LogHoursInput): Promise<LogHoursResult> {
  const { data, error } = await supabase
    .from(TABLES.time_entries)
    .insert({
      user_id: input.userId,
      project_id: input.projectId,
      work_date: input.workDate,
      hours: input.hours,
      note: input.note ?? null,
      entered_by: actorId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

/** Edit an existing hours row (self's own row, or owner correcting anyone's — enforced by RLS + the caller). */
export async function updateManualHours(supabase: DB, input: UpdateHoursInput): Promise<UpdateHoursResult> {
  const { error } = await supabase
    .from(TABLES.time_entries)
    .update({ hours: input.hours, note: input.note ?? null })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Owner backfill/correction of anyone's attendance for a given day — upserts
 * the one logical row, only touching the fields the owner actually supplied
 * (so correcting just the check-out time doesn't clobber an already-set
 * check-in). `HH:mm` times are combined with `workDate` via
 * `lib/daily/compute.ts` `combineDateAndTime` (server-local time zone — see
 * that module's header comment).
 */
export async function ownerSetAttendance(supabase: DB, input: OwnerSetAttendanceInput): Promise<OwnerSetAttendanceResult> {
  const { data: existing, error: existingError } = await supabase
    .from(TABLES.attendance)
    .select("id, check_in, check_out, current_project_id, note")
    .eq("user_id", input.userId)
    .eq("work_date", input.workDate)
    .maybeSingle();
  if (existingError) return { ok: false, error: existingError.message };

  const checkIn = input.checkInTime ? combineDateAndTime(input.workDate, input.checkInTime) : (existing?.check_in ?? null);
  const checkOut = input.checkOutTime ? combineDateAndTime(input.workDate, input.checkOutTime) : (existing?.check_out ?? null);
  const projectId = input.projectId !== undefined ? input.projectId : (existing?.current_project_id ?? null);
  const note = input.note !== undefined ? input.note : (existing?.note ?? null);

  const { error } = await supabase.from(TABLES.attendance).upsert(
    {
      user_id: input.userId,
      work_date: input.workDate,
      check_in: checkIn,
      check_out: checkOut,
      current_project_id: projectId,
      note: note ?? null,
    },
    { onConflict: "user_id,work_date" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
