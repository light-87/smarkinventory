/**
 * lib/pm/auth.ts — Server Action auth guards for the Project-Management
 * module. Same shape as lib/projects/auth.ts / lib/attendance/actions.ts's
 * requireSession helper: resolve the caller's session + role via the
 * per-request RLS-bound client, then gate against lib/auth/roles' §2 matrix
 * ("projects" area: owner full · employee full · accountant read).
 *
 * Kept self-contained (no import from lib/projects/auth.ts) — this is a
 * separate package (see supabase/migrations/0010_pm.sql header / docs/
 * OWNERSHIP.md), even though it happens to reuse the same "projects" area.
 */

import { createClient } from "@/lib/supabase/server";
import { canSee, canWrite, isOwner, type Role } from "@/lib/auth/roles";

export interface PmActionContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  actorId: string;
  role: Role;
}

async function resolveCaller(): Promise<PmActionContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: role } = await supabase.rpc("smark_role");
  if (!role) throw new Error("Your account isn't active.");

  return { supabase, actorId: user.id, role: role as Role };
}

/** Read access (owner/employee full, accountant read-only). */
export async function requirePmReader(): Promise<PmActionContext> {
  const ctx = await resolveCaller();
  if (!canSee(ctx.role, "projects")) throw new Error("You don't have access to Projects.");
  return ctx;
}

/** Write access (owner/employee full; accountant is read-only). Row-level scoping (e.g. "only my own task") is enforced per-action, not here. */
export async function requirePmWriter(): Promise<PmActionContext> {
  const ctx = await resolveCaller();
  if (!canWrite(ctx.role, "projects")) {
    throw new Error("You don't have permission to make changes on Projects.");
  }
  return ctx;
}

/** Owner-only actions (create task, assign hours, triage bugs, accept/reject change requests, etc). */
export async function requirePmOwner(): Promise<PmActionContext> {
  const ctx = await resolveCaller();
  if (!isOwner(ctx.role)) throw new Error("Only the owner can do this.");
  return ctx;
}
