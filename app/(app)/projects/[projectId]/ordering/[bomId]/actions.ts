"use server";

/**
 * app/(app)/projects/[projectId]/ordering/[bomId]/actions.ts — Server
 * Actions for the Ordering Workspace (plan/tab-ordering-workspace.md).
 * Thin wrappers: resolve the caller's session + role (owner/employee full,
 * accountant read-only — FEATURES.md §2 "Projects" row), then delegate to
 * lib/runs/**. Mirrors app/(app)/projects/[projectId]/boms/actions.ts's shape.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canWrite } from "@/lib/auth/roles";
import { TABLES } from "@/types/db";
import {
  SaveDistributorSequenceInputSchema,
  SavePrioritiesInputSchema,
  type SaveDistributorSequenceInput,
  type SavePrioritiesInput,
} from "@/lib/runs/types";
import type { DistributorSequenceItem } from "@/types/db";

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

export type OrderingActionResult = { ok: true } | { ok: false; error: string };

export async function saveDistributorSequenceAction(input: SaveDistributorSequenceInput): Promise<OrderingActionResult> {
  const parsed = SaveDistributorSequenceInputSchema.parse(input);
  const { supabase } = await requireProjectsWriter();

  const sequence: DistributorSequenceItem[] = parsed.sequence.map((s) => ({ distributor_id: s.distributorId, enabled: s.enabled }));
  const { error } = await supabase.from(TABLES.boms).update({ distributor_sequence: sequence }).eq("id", parsed.bomId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects`, "layout");
  return { ok: true };
}

export async function savePrioritiesAction(input: SavePrioritiesInput): Promise<OrderingActionResult> {
  const parsed = SavePrioritiesInputSchema.parse(input);
  const { supabase } = await requireProjectsWriter();
  const { error } = await supabase.from(TABLES.boms).update({ priority_notes: parsed.priorities }).eq("id", parsed.bomId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects`, "layout");
  return { ok: true };
}
