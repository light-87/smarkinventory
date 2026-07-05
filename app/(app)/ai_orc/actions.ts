"use server";

/**
 * app/(app)/ai_orc/actions.ts — Server Actions for the /ai_orc sandbox panel:
 * upload a test BOM and start a LIMITED run (first N lines, default 5) so the
 * AI pipeline can be timed and accuracy-checked cheaply before a full-BOM run.
 *
 * Owner-only, like the page and the state API route — this is the ops
 * console, not a team surface. Reuses the exact production paths
 * (lib/bom/service.ts createUploadedBom, lib/runs/enqueue.ts enqueueRun) so a
 * sandbox run exercises byte-for-byte the same code a real run does; the ONLY
 * difference is `lineLimit`.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getStorageAdapter } from "@/lib/storage";
import { TABLES, ConcurrencyPresetSchema } from "@/types/db";
import { createUploadedBom, type CreateBomResult } from "@/lib/bom/service";
import { enqueueRun } from "@/lib/runs/enqueue";

async function requireOwner() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: role } = await supabase.rpc("smark_role");
  if (role !== "owner") throw new Error("The AI sandbox is owner-only.");
  return { supabase, actorId: user.id };
}

export interface SandboxOptions {
  projects: { id: string; name: string }[];
  boms: { id: string; name: string; projectName: string; buildQty: number; createdAt: string }[];
}

/** Dropdown data for the sandbox panel: projects (upload target) + recent BOMs (run target). */
export async function getSandboxOptionsAction(): Promise<SandboxOptions> {
  const { supabase } = await requireOwner();

  const [{ data: projects, error: projError }, { data: boms, error: bomError }] = await Promise.all([
    supabase.from(TABLES.projects).select("id, name").order("created_at", { ascending: false }).limit(50),
    supabase
      .from(TABLES.boms)
      .select("id, name, project_id, build_qty, created_at")
      .order("created_at", { ascending: false })
      .limit(15),
  ]);
  if (projError) throw new Error(projError.message);
  if (bomError) throw new Error(bomError.message);

  const projectNameById = new Map((projects ?? []).map((p) => [p.id, p.name]));
  return {
    projects: (projects ?? []).map((p) => ({ id: p.id, name: p.name })),
    boms: (boms ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      projectName: projectNameById.get(b.project_id) ?? "?",
      buildQty: b.build_qty,
      createdAt: b.created_at,
    })),
  };
}

/** Upload a test BOM from the sandbox — same parser/storage path as the Projects upload. */
export async function sandboxUploadBomAction(formData: FormData): Promise<CreateBomResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a .xlsx file to upload." };

  const parsed = z
    .object({ projectId: z.uuid(), name: z.string().trim().min(1, "Give the test BOM a name.") })
    .parse({ projectId: formData.get("projectId"), name: formData.get("name") });

  const { supabase, actorId } = await requireOwner();
  const buffer = Buffer.from(await file.arrayBuffer());

  const result = await createUploadedBom(supabase, getStorageAdapter(), {
    projectId: parsed.projectId,
    name: parsed.name,
    priorityNotes: null,
    fileBuffer: buffer,
    fileName: file.name,
    actorId,
  });
  if (result.ok) revalidatePath(`/projects/${parsed.projectId}/boms`);
  return result;
}

const SandboxRunInputSchema = z.object({
  bomId: z.uuid(),
  tier: ConcurrencyPresetSchema.default("economy"),
  lineLimit: z.coerce.number().int().min(1).max(50).default(5),
});

export type SandboxRunResult = { ok: true; runId: string } | { ok: false; error: string };

/** Start a limited test run: only the first `lineLimit` to-order lines get jobs. */
export async function sandboxStartRunAction(input: {
  bomId: string;
  tier?: string;
  lineLimit?: number;
}): Promise<SandboxRunResult> {
  const parsed = SandboxRunInputSchema.parse(input);
  const { supabase, actorId } = await requireOwner();
  const service = createServiceClient();

  const result = await enqueueRun(supabase, service, {
    bomId: parsed.bomId,
    tier: parsed.tier,
    actorId,
    lineLimit: parsed.lineLimit,
  });
  if (result.ok) revalidatePath(`/projects`, "layout");
  return result;
}
