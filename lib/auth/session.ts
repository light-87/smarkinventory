/**
 * lib/auth/session.ts — server-only session lookup: Supabase Auth user +
 * the matching `smark_app_users` profile row (username/display_name/role).
 *
 * Deliberately re-checks `active` here even though `smark_role()` (the RLS
 * helper) already returns NULL for deactivated accounts server-side — this
 * is the single place every Server Component/layout asks "who is this and
 * are they allowed in at all", so it fails closed (returns null) rather than
 * handing back a half-populated user for a deactivated account.
 *
 * Import from Server Components / Server Actions / Route Handlers only
 * (uses `lib/supabase/server.ts`, which reads `next/headers` cookies).
 */

import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/types/db";
import type { Role } from "@/lib/auth/roles";
import { getInventoryAccessIfEmployee, getModuleGrantsIfEmployee } from "@/lib/rbac/queries";
import type { InventoryAccess, Module } from "@/lib/rbac/types";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string | null;
  role: Role;
  /**
   * (0011) Non-null once the employee has completed first-login onboarding
   * (DOB + date_of_joining + bank details). Owners/accountants ignore this
   * entirely (see app/(app)/layout.tsx's onboarding gate) — it only ever
   * drives a redirect for role === "employee".
   */
  onboardedAt: string | null;
  /**
   * (0013) Module grants — only ever populated for role === "employee";
   * owner/accountant get an empty array since lib/rbac/access.ts never
   * consults grants for them anyway. Feeds effectiveCanSee()/nav filtering.
   */
  grantedModules: Module[];
  /**
   * (0017) Inventory grant level for an employee: "edit" / "view", or null (no
   * inventory grant, or role is owner/accountant — who are never grant-gated).
   * Feeds effectiveCanWrite() for the inventory areas.
   */
  inventoryAccess: InventoryAccess | null;
}

/** Current signed-in + active user, or `null` (no session, or deactivated). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from(TABLES.app_users)
    .select("id, username, display_name, role, active, onboarded_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.active) return null;

  const role = profile.role as Role;
  const [grantedModules, inventoryAccess] = await Promise.all([
    getModuleGrantsIfEmployee(supabase, profile.id, role),
    getInventoryAccessIfEmployee(supabase, profile.id, role),
  ]);

  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.display_name,
    role,
    onboardedAt: profile.onboarded_at,
    grantedModules,
    inventoryAccess,
  };
}
