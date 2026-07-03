/**
 * lib/settings/queries.ts — server-only data fetching for the Settings
 * surface (plan/tab-settings.md). Every function takes an already-created
 * request Supabase client (lib/supabase/server.ts `createClient()`) so it
 * runs under the caller's session + RLS — never the service-role client.
 * Style matches the sibling packages already landed (lib/expenses/queries.ts,
 * lib/receive/queries.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { DistributorRowSchema, OrderingRuleRowSchema, PartFieldTemplateRowSchema, TABLES } from "@/types/db";
import {
  KNOWN_DISTRIBUTOR_KEY_ENV_VARS,
  labelForRule,
  type DistributorItem,
  type KeyState,
  type OrderingRuleItem,
  type PartFieldTemplateItem,
} from "./types";

type DB = SupabaseClient<Database>;

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`[settings] ${context}: ${error.message}`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Standard search ladder
 * ──────────────────────────────────────────────────────────────────────────── */

export async function getOrderingRules(supabase: DB): Promise<OrderingRuleItem[]> {
  const { data, error } = await supabase.from(TABLES.ordering_rules).select("*").order("rank", { ascending: true });
  assertNoError(error, "smark_ordering_rules");

  const rows = OrderingRuleRowSchema.array().parse(data ?? []);
  return rows.map((row) => ({ row, label: labelForRule(row) }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Distributors
 * ──────────────────────────────────────────────────────────────────────────── */

/** Best-effort "is a key configured" check — see lib/settings/types.ts's KNOWN_DISTRIBUTOR_KEY_ENV_VARS header note. */
function keyStateFor(name: string, apiType: string): { keyState: KeyState; envVarNames: readonly string[] } {
  if (apiType !== "rest") return { keyState: "not_applicable", envVarNames: [] };

  const envVarNames = KNOWN_DISTRIBUTOR_KEY_ENV_VARS[name] ?? [];
  if (envVarNames.length === 0) return { keyState: "needed", envVarNames: [] };

  const configured = envVarNames.every((v) => Boolean(process.env[v]));
  return { keyState: configured ? "configured" : "needed", envVarNames };
}

export async function getDistributors(supabase: DB): Promise<DistributorItem[]> {
  const { data, error } = await supabase.from(TABLES.distributors).select("*").order("name", { ascending: true });
  assertNoError(error, "smark_distributors");

  const rows = DistributorRowSchema.array().parse(data ?? []);
  return rows.map((row) => ({ row, ...keyStateFor(row.name, row.api_type) }));
}

/** Next `rank` for `smark_distributor_preferences` — new sites land ranked last, `enabled: false` (default OFF). */
export async function getNextDistributorPreferenceRank(supabase: DB): Promise<number> {
  const { data, error } = await supabase.from(TABLES.distributor_preferences).select("rank");
  assertNoError(error, "smark_distributor_preferences");
  const ranks = (data ?? []).map((r) => r.rank as number);
  return ranks.length === 0 ? 1 : Math.max(...ranks) + 1;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Remembered custom part-form fields [R2-23]
 * ──────────────────────────────────────────────────────────────────────────── */

export async function getPartFieldTemplates(supabase: DB): Promise<PartFieldTemplateItem[]> {
  const { data, error } = await supabase
    .from(TABLES.part_field_templates)
    .select("*")
    .order("created_at", { ascending: true });
  assertNoError(error, "smark_part_field_templates");
  return PartFieldTemplateRowSchema.array().parse(data ?? []);
}
