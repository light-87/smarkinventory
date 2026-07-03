"use server";

/**
 * lib/projects/team-actions.ts — Team & hours Server Actions (R2-04).
 * Assign/remove is owner-only (R2-18: "owner should be able to assign
 * engineers"); hours are manual entries (Q-03 final) — employees log only
 * their own, the owner can add/correct anyone's.
 */

import { revalidatePath } from "next/cache";
import { TABLES } from "@/types/db";
import { requireProjectsOwner, requireProjectsWriter } from "./auth";
import { TimeEntryInputSchema, type TimeEntryInput } from "./types";

export async function addProjectMemberAction(projectId: string, userId: string): Promise<void> {
  const { supabase, actorId } = await requireProjectsOwner();
  const { error } = await supabase
    .from(TABLES.project_members)
    .upsert(
      { project_id: projectId, user_id: userId, assigned_by: actorId, active: true },
      { onConflict: "project_id,user_id" },
    );
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}/team`);
}

export async function removeProjectMemberAction(projectId: string, membershipId: string): Promise<void> {
  const { supabase } = await requireProjectsOwner();
  const { error } = await supabase.from(TABLES.project_members).update({ active: false }).eq("id", membershipId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}/team`);
}

export async function addTimeEntryAction(input: TimeEntryInput): Promise<void> {
  const parsed = TimeEntryInputSchema.parse(input);
  const { supabase, actorId, role } = await requireProjectsWriter();

  if (role !== "owner" && parsed.userId !== actorId) {
    throw new Error("You can only log your own hours.");
  }

  const { error } = await supabase.from(TABLES.time_entries).insert({
    project_id: parsed.projectId,
    user_id: parsed.userId,
    work_date: parsed.workDate,
    hours: parsed.hours,
    note: parsed.note?.trim() || null,
    entered_by: actorId,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${parsed.projectId}/team`);
}
