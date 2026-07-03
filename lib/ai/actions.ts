"use server";

/**
 * lib/ai/actions.ts — Server Actions for the AI Memory surface
 * (plan/tab-ai-memory.md). Same idiom as lib/expenses/actions.ts: resolve
 * the caller's session + role via the per-request RLS-bound client (never
 * the service client), gate with `lib/auth/roles`'s `canApproveRules`
 * BEFORE touching the table (RLS is still the real enforcement — this is
 * the friendly layer in front of it, and migration 0004 already restricts
 * `smark_learned_rules*` writes to the owner at the DB level too), then
 * delegate the actual transition to `lib/ai/digest.ts` (status flip + v++
 * digest bump).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canApproveRules } from "@/lib/auth/roles";
import { approveRule, rejectRule, retireRule } from "./digest";
import type { ActionResult } from "./types";

async function requireRulesApprover() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canApproveRules(role)) {
    throw new Error("Only the owner can approve, reject, or retire AI-memory rules.");
  }
  return { supabase, actorId: user.id };
}

function revalidateAiMemory(): void {
  revalidatePath("/ai-memory");
}

export async function approveRuleAction(ruleId: string): Promise<ActionResult<{ id: string; docVersion: number | null }>> {
  try {
    const { supabase, actorId } = await requireRulesApprover();
    const result = await approveRule(supabase, ruleId, actorId);
    revalidateAiMemory();
    return { ok: true, id: ruleId, docVersion: result.docVersion };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to approve rule." };
  }
}

export async function rejectRuleAction(ruleId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireRulesApprover();
    await rejectRule(supabase, ruleId);
    revalidateAiMemory();
    return { ok: true, id: ruleId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to reject rule." };
  }
}

export async function retireRuleAction(ruleId: string): Promise<ActionResult<{ id: string; docVersion: number | null }>> {
  try {
    const { supabase, actorId } = await requireRulesApprover();
    const result = await retireRule(supabase, ruleId, actorId);
    revalidateAiMemory();
    return { ok: true, id: ruleId, docVersion: result.docVersion };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to retire rule." };
  }
}
