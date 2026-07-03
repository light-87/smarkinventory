"use server";

/**
 * lib/settings/actions.ts — Server Actions for the Settings surface.
 *
 * Same idiom as lib/expenses/actions.ts / lib/ai/actions.ts: resolve the
 * caller's session + role via the per-request RLS-bound client (never the
 * service client), gate with lib/auth/roles's `canWrite(role, "settings")`
 * BEFORE touching a table (RLS is still the real enforcement — this is the
 * friendly layer in front of it — plus migration 0004's own trigger/CHECK
 * additionally protect the Package rung at the DB level regardless of what
 * happens here), then validate with zod and write.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canWrite } from "@/lib/auth/roles";
import { TABLES } from "@/types/db";
import { writeAppConfig } from "./app-config";
import { checkRuleRemovable, nextRank } from "./rules";
import {
  AddOrderingRuleSchema,
  AppConfigFormSchema,
  DistributorFormSchema,
  type AddOrderingRuleInput,
  type AppConfigFormInput,
  type DistributorFormInput,
} from "./validation";
import type { ActionResult, AppConfig } from "./types";

async function requireSettingsWriter() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canWrite(role, "settings")) {
    throw new Error("Only the owner can change Settings.");
  }
  return { supabase, actorId: user.id };
}

function revalidateSettings(): void {
  revalidatePath("/settings");
}

/* ────────────────────────────────────────────────────────────────────────────
 * Standard search ladder
 * ──────────────────────────────────────────────────────────────────────────── */

export async function addOrderingRuleAction(input: AddOrderingRuleInput): Promise<ActionResult> {
  try {
    const parsed = AddOrderingRuleSchema.parse(input);
    const { supabase, actorId } = await requireSettingsWriter();

    const { data: existing, error: rankError } = await supabase.from(TABLES.ordering_rules).select("rank");
    if (rankError) throw new Error(rankError.message);
    const rank = nextRank((existing ?? []).map((r) => r.rank as number));

    const { data, error } = await supabase
      .from(TABLES.ordering_rules)
      .insert({ key: "custom", enabled: true, mandatory: false, rank, params: { label: parsed.text }, created_by: actorId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    revalidateSettings();
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to add the rule." };
  }
}

export async function removeOrderingRuleAction(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireSettingsWriter();

    const { data: row, error: fetchError } = await supabase
      .from(TABLES.ordering_rules)
      .select("key, mandatory")
      .eq("id", id)
      .single();
    if (fetchError) throw new Error(fetchError.message);

    const check = checkRuleRemovable(row);
    if (!check.removable) return { ok: false, error: check.reason ?? "This rule can't be removed." };

    const { error } = await supabase.from(TABLES.ordering_rules).delete().eq("id", id);
    if (error) throw new Error(error.message);

    revalidateSettings();
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to remove the rule." };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Distributors [R2-28 "addable"]
 * ──────────────────────────────────────────────────────────────────────────── */

export async function createDistributorAction(input: DistributorFormInput): Promise<ActionResult> {
  try {
    const parsed = DistributorFormSchema.parse(input);
    const { supabase, actorId } = await requireSettingsWriter();

    const { data: distributor, error } = await supabase
      .from(TABLES.distributors)
      .insert({
        name: parsed.name,
        api_type: parsed.method,
        base_url: parsed.baseUrl?.trim() || null,
        default_region: parsed.defaultRegion?.trim() || null,
        active: true,
        created_by: actorId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // New sites default OFF in every BOM's sequence editor (plan/tab-settings.md
    // R2-28) — that starting-sequence lives in smark_distributor_preferences,
    // separate from this row's global `active` flag.
    const { data: prefRanks, error: rankError } = await supabase.from(TABLES.distributor_preferences).select("rank");
    if (rankError) throw new Error(rankError.message);
    const rank = nextRank((prefRanks ?? []).map((r) => r.rank as number));

    const { error: prefError } = await supabase
      .from(TABLES.distributor_preferences)
      .insert({ distributor_id: distributor.id, rank, enabled: false });
    if (prefError) throw new Error(prefError.message);

    revalidateSettings();
    return { ok: true, id: distributor.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to add the distributor." };
  }
}

export async function setDistributorActiveAction(id: string, active: boolean): Promise<ActionResult> {
  try {
    const { supabase } = await requireSettingsWriter();
    const { error } = await supabase.from(TABLES.distributors).update({ active }).eq("id", id);
    if (error) throw new Error(error.message);

    revalidateSettings();
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update the distributor." };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Remembered custom part-form fields [R2-23] — retire toggle only (no delete).
 * ──────────────────────────────────────────────────────────────────────────── */

export async function setPartFieldTemplateActiveAction(id: string, active: boolean): Promise<ActionResult> {
  try {
    const { supabase } = await requireSettingsWriter();
    const { error } = await supabase.from(TABLES.part_field_templates).update({ active }).eq("id", id);
    if (error) throw new Error(error.message);

    revalidateSettings();
    revalidatePath("/receive"); // retired fields stop auto-rendering on Receive's New-part form
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update the field." };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * App-wide config (label size / low-stock default / concurrency default)
 * ──────────────────────────────────────────────────────────────────────────── */

export async function updateAppConfigAction(
  input: AppConfigFormInput,
): Promise<ActionResult<{ config: AppConfig }>> {
  try {
    const parsed = AppConfigFormSchema.parse(input);
    await requireSettingsWriter();

    const config = await writeAppConfig(parsed);
    revalidateSettings();
    return { ok: true, config };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save — try again." };
  }
}
