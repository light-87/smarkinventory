/**
 * lib/rbac/queries.ts — read helpers for module grants (migration 0013).
 * Server-only (takes the caller's already-created Supabase client — RLS is
 * the real boundary, same idiom as lib/employees/queries.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";
import type { Role } from "@/lib/auth/roles";
import type { Module } from "./types";

/** One user's module grants (self-read RLS lets any user fetch their OWN row set; owner can fetch anyone's). */
export async function getUserModuleGrants(supabase: SupabaseClient<Database>, userId: string): Promise<Module[]> {
  const { data, error } = await supabase.from(TABLES.module_grants).select("module").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.module as Module);
}

/**
 * Skips the query entirely for non-employees — owner/accountant are never
 * gated by grants (lib/rbac/access.ts), so there's nothing to fetch.
 */
export async function getModuleGrantsIfEmployee(
  supabase: SupabaseClient<Database>,
  userId: string,
  role: Role,
): Promise<Module[]> {
  if (role !== "employee") return [];
  return getUserModuleGrants(supabase, userId);
}

/** Owner-only: every grant, keyed by user_id — feeds Settings → Users' toggle grid. */
export async function getAllModuleGrants(supabase: SupabaseClient<Database>): Promise<Record<string, Module[]>> {
  const { data, error } = await supabase.from(TABLES.module_grants).select("user_id, module");
  if (error) throw new Error(error.message);
  const map: Record<string, Module[]> = {};
  for (const row of data ?? []) {
    const modules = (map[row.user_id] ??= []);
    modules.push(row.module as Module);
  }
  return map;
}
