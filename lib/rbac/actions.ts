"use server";

/**
 * lib/rbac/actions.ts — Server Actions for Settings → Users module grants
 * (migration 0013). Owner-only: RLS on `smark_user_module_grants` only
 * allows the owner to insert/select-all/delete (plus each user's own
 * self-read) — this pre-check just gives a friendly error instead of a raw
 * Postgres/RLS-denial one, same idiom as lib/employees/actions.ts.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { TABLES } from "@/types/db";
import { ModuleGrantInputSchema, type ActionResult, type ModuleGrantInput } from "./types";

async function requireOwner() {
  const user = await getSessionUser();
  if (!user || user.role !== "owner") throw new Error("Owner access required.");
  const supabase = await createClient();
  return { supabase, ownerId: user.id };
}

/** Idempotent: granting an already-granted module is a no-op (unique (user_id, module) + ignoreDuplicates). */
export async function grantModuleAction(input: ModuleGrantInput): Promise<ActionResult> {
  const parsed = ModuleGrantInputSchema.parse(input);
  const { supabase, ownerId } = await requireOwner();

  const { error } = await supabase
    .from(TABLES.module_grants)
    .upsert(
      { user_id: parsed.userId, module: parsed.module, granted_by: ownerId },
      { onConflict: "user_id,module", ignoreDuplicates: true },
    );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/users");
  return { ok: true };
}

export async function revokeModuleAction(input: ModuleGrantInput): Promise<ActionResult> {
  const parsed = ModuleGrantInputSchema.parse(input);
  const { supabase } = await requireOwner();

  const { error } = await supabase
    .from(TABLES.module_grants)
    .delete()
    .eq("user_id", parsed.userId)
    .eq("module", parsed.module);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/users");
  return { ok: true };
}
