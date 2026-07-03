"use server";

/**
 * lib/projects/phase-actions.ts — phase-timeline editor Server Actions
 * (R2-30). Date edits bump `version_label` + log a `change` activity
 * (FEATURES.md §10: "Date edits bump a version label + log `change`
 * activities" — the client-visible history of slips); advancing is two
 * sequential updates (old row → done, next counted row → active) rather than
 * a stored procedure — the DB's partial unique index
 * (`smark_project_phases_one_active_per_project`) still rejects two ACTIVE
 * rows if the order were ever wrong, so this can't silently violate the
 * single-active invariant even without a real transaction.
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLES, type Database } from "@/types/db";
import { requireProjectsOwner, requireProjectsWriter } from "./auth";
import { PhaseInputSchema, ReorderPhasesInputSchema, type PhaseInput, type ReorderPhasesInput } from "./types";
import { getPhases } from "./queries";
import { findNextPhaseId, isCountedRow } from "./phase-math";

type DB = SupabaseClient<Database>;

async function logChangeActivity(supabase: DB, actorId: string, projectId: string, body: string): Promise<void> {
  const { error } = await supabase.from(TABLES.project_activities).insert({
    project_id: projectId,
    type: "change",
    title: "Timeline updated",
    body,
    created_by: actorId,
  });
  // A failed audit-log insert shouldn't roll back a phase edit that already
  // succeeded — surface it server-side and move on, same tradeoff as the
  // rest of this file's best-effort revalidate calls.
  if (error) console.error("projects: failed to log timeline change activity", error);
}

export async function addPhaseAction(projectId: string, input: PhaseInput): Promise<void> {
  const parsed = PhaseInputSchema.parse(input);
  const { supabase, actorId } = await requireProjectsWriter();

  const existing = await getPhases(supabase, projectId);
  const nextSort = existing.length > 0 ? Math.max(...existing.map((p) => p.sort_order)) + 1 : 0;

  const { error } = await supabase.from(TABLES.project_phases).insert({
    project_id: projectId,
    sort_order: nextSort,
    name: parsed.name,
    start_date: parsed.start_date ?? null,
    end_date: parsed.end_date ?? null,
    duration_text: parsed.duration_text ?? null,
    notes: parsed.notes ?? null,
    row_kind: parsed.row_kind,
    created_by: actorId,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}`);
}

export async function updatePhaseAction(projectId: string, input: PhaseInput): Promise<void> {
  const parsed = PhaseInputSchema.parse(input);
  if (!parsed.id) throw new Error("Missing phase id.");
  const { supabase, actorId } = await requireProjectsWriter();

  const { data: current, error: fetchError } = await supabase
    .from(TABLES.project_phases)
    .select("*")
    .eq("id", parsed.id)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!current) throw new Error("Phase not found.");

  const nextStart = parsed.start_date ?? null;
  const nextEnd = parsed.end_date ?? null;
  const datesChanged = current.start_date !== nextStart || current.end_date !== nextEnd;
  const nextVersion = datesChanged ? current.version_label + 1 : current.version_label;

  const { error } = await supabase
    .from(TABLES.project_phases)
    .update({
      name: parsed.name,
      start_date: nextStart,
      end_date: nextEnd,
      duration_text: parsed.duration_text ?? null,
      notes: parsed.notes ?? null,
      row_kind: parsed.row_kind,
      version_label: nextVersion,
    })
    .eq("id", parsed.id);
  if (error) throw new Error(error.message);

  if (datesChanged) {
    await logChangeActivity(supabase, actorId, projectId, `"${parsed.name}" dates changed — now v${nextVersion}.`);
  }

  revalidatePath(`/projects/${projectId}`);
}

export async function removePhaseAction(projectId: string, phaseId: string): Promise<void> {
  const { supabase } = await requireProjectsWriter();
  const { error } = await supabase.from(TABLES.project_phases).delete().eq("id", phaseId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}`);
}

export async function reorderPhasesAction(input: ReorderPhasesInput): Promise<void> {
  const parsed = ReorderPhasesInputSchema.parse(input);
  const { supabase } = await requireProjectsWriter();

  for (const [i, id] of parsed.orderedIds.entries()) {
    const { error } = await supabase.from(TABLES.project_phases).update({ sort_order: i }).eq("id", id);
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/projects/${parsed.projectId}`);
}

/**
 * Bootstraps the timeline (no active phase yet → activates the first counted
 * row) or advances past `currentActiveId` (marks it done, activates the next
 * not-done counted row per `findNextPhaseId`). No-op on the "activate next"
 * side if the just-finished phase was the last one — the owner then uses
 * "Confirm project complete" instead (a separate, explicit action).
 *
 * Owner-only (finding #4): FEATURES.md §10 / plan/tab-orders-projects.md
 * R2-30 both say "exactly one active phase (owner advances it)" — the row
 * editors (add/update/remove/reorder above) stay owner+employee full per the
 * §2 Projects matrix, but advancing is the one timeline control the spec
 * singles out as owner-only, matching archive/unarchive, share-token
 * regenerate, and project-completion confirm (all `requireProjectsOwner`).
 */
export async function advancePhaseAction(projectId: string, currentActiveId: string | null): Promise<void> {
  const { supabase } = await requireProjectsOwner();
  const phases = await getPhases(supabase, projectId);

  if (!currentActiveId) {
    const first = [...phases].sort((a, b) => a.sort_order - b.sort_order).find(isCountedRow);
    if (!first) throw new Error("Add a phase before starting the timeline.");
    const { error } = await supabase.from(TABLES.project_phases).update({ status: "active" }).eq("id", first.id);
    if (error) throw new Error(error.message);
    revalidatePath(`/projects/${projectId}`);
    return;
  }

  const nextId = findNextPhaseId(phases, currentActiveId);

  const { error: doneError } = await supabase
    .from(TABLES.project_phases)
    .update({ status: "done" })
    .eq("id", currentActiveId);
  if (doneError) throw new Error(doneError.message);

  if (nextId) {
    const { error: activeError } = await supabase
      .from(TABLES.project_phases)
      .update({ status: "active" })
      .eq("id", nextId);
    if (activeError) throw new Error(activeError.message);
  }

  revalidatePath(`/projects/${projectId}`);
}
