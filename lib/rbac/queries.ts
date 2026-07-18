/**
 * lib/rbac/queries.ts — read helpers for module grants (migration 0013).
 * Server-only (takes the caller's already-created Supabase client — RLS is
 * the real boundary, same idiom as lib/employees/queries.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";
import type { Role } from "@/lib/auth/roles";
import type { InventoryAccess, Module } from "./types";

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

/**
 * (0017) One user's inventory access level: "edit" / "view", or null when they
 * have no inventory grant at all. Null and "view" both mean "cannot edit stock".
 */
export async function getUserInventoryAccess(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<InventoryAccess | null> {
  const { data, error } = await supabase
    .from(TABLES.module_grants)
    .select("access")
    .eq("user_id", userId)
    .eq("module", "inventory")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.access as InventoryAccess | undefined) ?? null;
}

/** Skips the query for non-employees (owner/accountant are never grant-gated). */
export async function getInventoryAccessIfEmployee(
  supabase: SupabaseClient<Database>,
  userId: string,
  role: Role,
): Promise<InventoryAccess | null> {
  if (role !== "employee") return null;
  return getUserInventoryAccess(supabase, userId);
}

/** Owner-only: inventory access level per user_id — feeds the View/Edit toggle in the grid. */
export async function getAllInventoryAccess(
  supabase: SupabaseClient<Database>,
): Promise<Record<string, InventoryAccess>> {
  const { data, error } = await supabase.from(TABLES.module_grants).select("user_id, access").eq("module", "inventory");
  if (error) throw new Error(error.message);
  const map: Record<string, InventoryAccess> = {};
  for (const row of data ?? []) map[row.user_id] = row.access as InventoryAccess;
  return map;
}
