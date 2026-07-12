"use server";

/**
 * app/(app)/projects/[projectId]/boms/actions.ts — Server Actions for the
 * BOM-pipeline surface (upload/create/reconcile/build-qty), scoped under
 * bom-pipeline's owned route segment (docs/OWNERSHIP.md).
 *
 * Thin wrappers: resolve the caller's session + role via the per-request
 * RLS-bound client (never the service client — CLAUDE.md), role-gate the
 * same way RLS gates "projects" (owner/employee full, accountant read-only —
 * FEATURES.md §2), then delegate to `lib/bom/service.ts`'s pure-ish writes.
 * Mirrors `lib/receive/actions.ts`'s shape.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canWrite } from "@/lib/auth/roles";
import { getStorageAdapter } from "@/lib/storage";
import type { BomTemplateColumn } from "@/types/db";
import {
  AddCustomColumnInputSchema,
  CreateBomInAppInputSchema,
  UpdateBuildQtyInputSchema,
  UploadBomInputSchema,
  type CreateBomRowInput,
} from "@/lib/bom/types";
import {
  createInAppBom,
  createUploadedBom,
  deleteBom,
  runReconcile,
  setBomArchived,
  setBuildQty,
  type ArchiveBomResult,
  type CreateBomResult,
  type DeleteBomResult,
} from "@/lib/bom/service";
import { getEffectiveBomColumns } from "@/lib/bom/template";
import { makeCustomColumn } from "@/lib/bom/columns";

async function requireProjectsWriter() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canWrite(role, "projects")) {
    throw new Error("You don't have permission to make changes on Projects.");
  }
  return { supabase, actorId: user.id };
}

/** The columns the Create-BOM grid should start from (standard + remembered custom ones). */
export async function getBomColumnsAction(): Promise<BomTemplateColumn[]> {
  const supabase = await createClient();
  return getEffectiveBomColumns(supabase);
}

/** "+ Add field" on the Create-BOM grid — validated locally (no DB write until the BOM itself saves). */
export async function previewCustomColumnAction(input: { label: string; type: "text" | "number" }): Promise<
  { ok: true; column: BomTemplateColumn } | { ok: false; error: string }
> {
  const parsed = AddCustomColumnInputSchema.parse(input);
  const column = makeCustomColumn(parsed.label, parsed.type);
  if (!column) return { ok: false, error: "That field name isn't usable — try something else." };
  return { ok: true, column };
}

export async function uploadBomAction(formData: FormData): Promise<CreateBomResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a .xlsx file to upload." };

  const parsed = UploadBomInputSchema.parse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    priorityNotes: formData.get("priorityNotes") || null,
  });

  const { supabase, actorId } = await requireProjectsWriter();
  const buffer = Buffer.from(await file.arrayBuffer());

  const result = await createUploadedBom(supabase, getStorageAdapter(), {
    projectId: parsed.projectId,
    name: parsed.name,
    priorityNotes: parsed.priorityNotes ?? null,
    fileBuffer: buffer,
    fileName: file.name,
    actorId,
  });
  if (result.ok) revalidatePath(`/projects/${parsed.projectId}/boms`);
  return result;
}

export async function createBomInAppAction(input: {
  projectId: string;
  name: string;
  buildQty: number;
  priorityNotes: string | null;
  columns: BomTemplateColumn[];
  rows: CreateBomRowInput[];
}): Promise<CreateBomResult> {
  const parsed = CreateBomInAppInputSchema.parse(input);
  const { supabase, actorId } = await requireProjectsWriter();

  const result = await createInAppBom(supabase, {
    projectId: parsed.projectId,
    name: parsed.name,
    buildQty: parsed.buildQty,
    priorityNotes: parsed.priorityNotes ?? null,
    columns: parsed.columns,
    rows: parsed.rows,
    actorId,
  });
  if (result.ok) revalidatePath(`/projects/${parsed.projectId}/boms`);
  return result;
}

export type UpdateBuildQtyResult = { ok: true } | { ok: false; error: string };

/** Build-qty editor (×N banner) — persists + immediately re-reconciles need at the new ×N [R2-27]. */
export async function updateBuildQtyAction(input: { bomId: string; buildQty: number }): Promise<UpdateBuildQtyResult> {
  const parsed = UpdateBuildQtyInputSchema.parse(input);
  const { supabase } = await requireProjectsWriter();
  try {
    await setBuildQty(supabase, parsed.bomId, parsed.buildQty);
    revalidatePath("/projects", "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update build qty." };
  }
}

/** Delete a BOM from the project's BOMs list — blocked (friendly error) once AI runs exist. */
export async function deleteBomAction(input: { projectId: string; bomId: string }): Promise<DeleteBomResult> {
  const { supabase } = await requireProjectsWriter();
  try {
    const result = await deleteBom(supabase, input.bomId);
    if (result.ok) revalidatePath(`/projects/${input.projectId}/boms`);
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not delete that BOM." };
  }
}

/**
 * Archive / un-archive a BOM (soft-delete) — allowed even when AI runs exist
 * (keeps run/cost history, hides the BOM, releases its demand). Reversible.
 */
export async function setBomArchivedAction(input: {
  projectId: string;
  bomId: string;
  archived: boolean;
}): Promise<ArchiveBomResult> {
  const { supabase } = await requireProjectsWriter();
  try {
    const result = await setBomArchived(supabase, input.bomId, input.archived);
    if (result.ok) {
      revalidatePath(`/projects/${input.projectId}/boms`);
      // Demand release/restore self-heals on the next cart render — mirror the
      // broad revalidate the other BOM writes use so on-order surfaces refresh.
      revalidatePath("/projects", "layout");
    }
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not archive that BOM." };
  }
}

export type ReconcileResult = { ok: true } | { ok: false; error: string };

/** Manual "Re-reconcile" — re-runs the matcher ladder against current stock (e.g. after a receive). */
export async function reconcileBomAction(bomId: string): Promise<ReconcileResult> {
  const { supabase } = await requireProjectsWriter();
  try {
    await runReconcile(supabase, bomId);
    revalidatePath("/projects", "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reconcile that BOM." };
  }
}
