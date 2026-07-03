"use server";

/**
 * lib/daily/actions.ts — Server Actions for Daily Reports.
 *
 * Thin wrappers: validate with zod (lib/daily/types.ts), resolve the caller's
 * session + role via the per-request RLS-bound client (lib/supabase/server.ts
 * — never the service client), then delegate to lib/daily/core.ts. Role-gated
 * the same way RLS gates it (FEATURES.md §2 "Daily Reports | all | self only |
 * read all") so a disallowed caller gets a clear error instead of an opaque
 * RLS-denied Postgres error — mirrors lib/receive/actions.ts.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canWrite, isOwner, type Role } from "@/lib/auth/roles";
import * as core from "./core";
import {
  ClockInInputSchema,
  LogHoursInputSchema,
  OwnerSetAttendanceInputSchema,
  SetWorkingOnInputSchema,
  UpdateHoursInputSchema,
  type ClockInInput,
  type LogHoursInput,
  type OwnerSetAttendanceInput,
  type SetWorkingOnInput,
  type UpdateHoursInput,
} from "./types";
import { TABLES } from "@/types/db";

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

/** Owner (any user's row) or an employee acting on their OWN row — accountant is read-only everywhere on Daily Reports. */
async function requireDailyWriter() {
  const session = await requireSession();
  if (!canWrite(session.role, "daily_reports")) {
    throw new Error("You don't have permission to make changes on Daily Reports.");
  }
  return session;
}

export async function clockInAction(input: ClockInInput): Promise<core.ClockInResult> {
  const parsed = ClockInInputSchema.parse(input);
  const { supabase, actorId } = await requireDailyWriter();
  const result = await core.clockIn(supabase, actorId, parsed.projectId ?? null);
  if (result.ok) revalidatePath("/daily");
  return result;
}

export async function clockOutAction(): Promise<core.ClockOutResult> {
  const { supabase, actorId } = await requireDailyWriter();
  const result = await core.clockOut(supabase, actorId);
  if (result.ok) revalidatePath("/daily");
  return result;
}

export async function setWorkingOnAction(input: SetWorkingOnInput): Promise<core.SetWorkingOnResult> {
  const parsed = SetWorkingOnInputSchema.parse(input);
  const { supabase, actorId } = await requireDailyWriter();
  const result = await core.setWorkingOn(supabase, actorId, parsed.projectId);
  if (result.ok) revalidatePath("/daily");
  return result;
}

/** Self logs their own hours, OR the owner adds/corrects anyone's (SCHEMA.md §7). */
export async function logHoursAction(input: LogHoursInput): Promise<core.LogHoursResult> {
  const parsed = LogHoursInputSchema.parse(input);
  const { supabase, actorId, role } = await requireDailyWriter();
  if (!isOwner(role) && parsed.userId !== actorId) {
    return { ok: false, error: "You can only log your own hours." };
  }
  const result = await core.logManualHours(supabase, actorId, parsed);
  if (result.ok) revalidatePath("/daily");
  return result;
}

export async function updateHoursAction(input: UpdateHoursInput): Promise<core.UpdateHoursResult> {
  const parsed = UpdateHoursInputSchema.parse(input);
  const { supabase, actorId, role } = await requireDailyWriter();

  if (!isOwner(role)) {
    const { data: existing, error } = await supabase.from(TABLES.time_entries).select("user_id").eq("id", parsed.id).maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!existing || existing.user_id !== actorId) {
      return { ok: false, error: "You can only edit your own hours." };
    }
  }

  const result = await core.updateManualHours(supabase, parsed);
  if (result.ok) revalidatePath("/daily");
  return result;
}

/** Owner backfill/correction of anyone's attendance — owner-only (FEATURES.md §5.13 "owner can add/correct anyone's"). */
export async function ownerSetAttendanceAction(input: OwnerSetAttendanceInput): Promise<core.OwnerSetAttendanceResult> {
  const parsed = OwnerSetAttendanceInputSchema.parse(input);
  const { supabase, role } = await requireSession();
  if (!isOwner(role)) throw new Error("Only the owner can correct someone else's attendance.");
  const result = await core.ownerSetAttendance(supabase, parsed);
  if (result.ok) revalidatePath("/daily");
  return result;
}
