"use server";

/**
 * lib/projects/actions.ts — project-level Server Actions: create, archive/
 * unarchive (R2-32), share-token regenerate (R2-30), owner-confirm complete
 * (R2-14 · Q-07). Phase-row CRUD lives in `phase-actions.ts`, team in
 * `team-actions.ts`, documents in `documents-actions.ts` + the upload route,
 * notes/tasks in `notes-actions.ts` — kept apart so no one file gets huge.
 */

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { TABLES } from "@/types/db";
import { requireProjectsOwner, requireProjectsWriter } from "./auth";
import { CreateProjectInputSchema, type CreateProjectInput } from "./types";
import { getPhases } from "./queries";
import { isTimelineComplete } from "./phase-math";

export interface CreateProjectResult {
  ok: true;
  id: string;
}

/** Projects list — "New project" card (name required, client optional). */
export async function createProjectAction(input: CreateProjectInput): Promise<CreateProjectResult> {
  const parsed = CreateProjectInputSchema.parse(input);
  const { supabase, actorId } = await requireProjectsWriter();

  const { data, error } = await supabase
    .from(TABLES.projects)
    .insert({ name: parsed.name, client: parsed.client?.trim() || null, created_by: actorId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/projects");
  return { ok: true, id: data.id };
}

/**
 * Archive (owner-only, R2-32): consequences are "releases all cart demand
 * from this project's BOMs, freezes activity/tasks, hides it from active
 * lists and pickers; portal link stops resolving" — all of that falls out of
 * other packages' queries filtering on `archived_at is null` (v_part_demand,
 * pickers, the portal read functions); this action only stamps the column.
 */
export async function archiveProjectAction(projectId: string): Promise<void> {
  const { supabase } = await requireProjectsOwner();
  const { error } = await supabase
    .from(TABLES.projects)
    .update({ archived_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) throw new Error(error.message);

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
}

export async function unarchiveProjectAction(projectId: string): Promise<void> {
  const { supabase } = await requireProjectsOwner();
  const { error } = await supabase.from(TABLES.projects).update({ archived_at: null }).eq("id", projectId);
  if (error) throw new Error(error.message);

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
}

/** Capability token for `/p/:share_token` — regenerate = revoke the old link (R2-30/§11). */
export async function regenerateShareTokenAction(projectId: string): Promise<{ token: string }> {
  const { supabase } = await requireProjectsOwner();
  const token = randomBytes(18).toString("base64url");

  const { error } = await supabase.from(TABLES.projects).update({ share_token: token }).eq("id", projectId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}`);
  return { token };
}

/** "Project done" = last phase done + owner confirm (stamps `completed_at`) — Q-07 final, no auto-complete. */
export async function confirmProjectCompleteAction(projectId: string): Promise<void> {
  const { supabase } = await requireProjectsOwner();
  const phases = await getPhases(supabase, projectId);
  if (!isTimelineComplete(phases)) {
    throw new Error("Every phase must be done before confirming the project complete.");
  }

  const { error } = await supabase
    .from(TABLES.projects)
    .update({ completed_at: new Date().toISOString().slice(0, 10) })
    .eq("id", projectId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}`);
}
