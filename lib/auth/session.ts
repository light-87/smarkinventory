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

export interface SessionUser {
  id: string;
  username: string;
  displayName: string | null;
  role: Role;
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
    .select("id, username, display_name, role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.active) return null;

  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.display_name,
    role: profile.role as Role,
  };
}
