/**
 * lib/projects/auth.ts — Server Action auth guards for the Projects surface.
 *
 * Same shape as lib/receive/actions.ts's requireReceiveReader/Writer: resolve
 * the caller's session + role via the per-request RLS-bound client, then gate
 * against lib/auth/roles' §2 matrix so a read-only caller (accountant — the
 * Projects area matrix row is "read") gets a clear error instead of an opaque
 * RLS-denied Postgres error. `requireProjectsOwner` additionally gates the
 * owner-only actions this package owns (member assign/remove, archive,
 * share-token regenerate — plan/tab-orders-projects.md R2-04/R2-30/R2-32).
 */

import { createClient } from "@/lib/supabase/server";
import { canSee, canWrite, isOwner, type Role } from "@/lib/auth/roles";

export interface ProjectsActionContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  actorId: string;
  role: Role;
}

async function resolveCaller(): Promise<ProjectsActionContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: role } = await supabase.rpc("smark_role");
  if (!role) throw new Error("Your account isn't active.");

  return { supabase, actorId: user.id, role };
}

/** Read access (owner/employee full, accountant read-only). */
export async function requireProjectsReader(): Promise<ProjectsActionContext> {
  const ctx = await resolveCaller();
  if (!canSee(ctx.role, "projects")) throw new Error("You don't have access to Projects.");
  return ctx;
}

/** Write access (owner/employee full; accountant is read-only on this area). */
export async function requireProjectsWriter(): Promise<ProjectsActionContext> {
  const ctx = await resolveCaller();
  if (!canWrite(ctx.role, "projects")) {
    throw new Error("You don't have permission to make changes on Projects.");
  }
  return ctx;
}

/** Owner-only actions (member assign/remove, archive/unarchive, share-token regenerate). */
export async function requireProjectsOwner(): Promise<ProjectsActionContext> {
  const ctx = await resolveCaller();
  if (!isOwner(ctx.role)) throw new Error("Only the owner can do this.");
  return ctx;
}
