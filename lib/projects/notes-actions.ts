"use server";

/**
 * lib/projects/notes-actions.ts — Notes & tasks feed Server Actions (R2-06).
 * Append-only: no plain "edit" beyond the author's 15-minute window (owner
 * exempt from the window, but still can't un-append the feed — it's an
 * UPDATE of title/body, not a delete). Task fields only ever apply to
 * `type === "task"` rows.
 */

import { revalidatePath } from "next/cache";
import { TABLES } from "@/types/db";
import { requireProjectsWriter } from "./auth";
import { ActivityInputSchema, type ActivityInput } from "./types";

const EDIT_WINDOW_MS = 15 * 60 * 1000;

export async function addActivityAction(input: ActivityInput): Promise<void> {
  const parsed = ActivityInputSchema.parse(input);
  if (!parsed.title?.trim() && !parsed.body?.trim()) {
    throw new Error("Add a title or a note.");
  }
  const { supabase, actorId } = await requireProjectsWriter();

  const isTask = parsed.type === "task";
  const { error } = await supabase.from(TABLES.project_activities).insert({
    project_id: parsed.projectId,
    type: parsed.type,
    title: parsed.title?.trim() || null,
    body: parsed.body?.trim() || null,
    task_assignee: isTask ? (parsed.taskAssignee ?? null) : null,
    task_due: isTask ? (parsed.taskDue ?? null) : null,
    task_done: isTask ? false : null,
    shared_to_portal: parsed.sharedToPortal,
    created_by: actorId,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${parsed.projectId}/notes`);
}

export async function toggleTaskDoneAction(projectId: string, activityId: string, done: boolean): Promise<void> {
  const { supabase } = await requireProjectsWriter();
  const { error } = await supabase
    .from(TABLES.project_activities)
    .update({ task_done: done, task_done_at: done ? new Date().toISOString() : null })
    .eq("id", activityId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}/notes`);
}

export interface EditActivityInput {
  projectId: string;
  activityId: string;
  title: string | null;
  body: string | null;
}

/** Author-only edit within the 15-minute window; the owner may edit any entry at any time. */
export async function editActivityAction(input: EditActivityInput): Promise<void> {
  const { supabase, actorId, role } = await requireProjectsWriter();

  const { data: existing, error: fetchError } = await supabase
    .from(TABLES.project_activities)
    .select("id, created_by, created_at")
    .eq("id", input.activityId)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!existing) throw new Error("Entry not found.");

  const isAuthor = existing.created_by === actorId;
  if (role !== "owner") {
    if (!isAuthor) throw new Error("Only the author can edit this entry.");
    const ageMs = Date.now() - new Date(existing.created_at).getTime();
    if (ageMs > EDIT_WINDOW_MS) throw new Error("The 15-minute edit window has passed.");
  }

  const { error } = await supabase
    .from(TABLES.project_activities)
    .update({ title: input.title?.trim() || null, body: input.body?.trim() || null })
    .eq("id", input.activityId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${input.projectId}/notes`);
}
