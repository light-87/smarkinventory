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

/**
 * Auth/permission refusal raised by the guards below. Typed (rather than a
 * bare Error) so `lib/pm/action-error.ts` can tell "your session is gone —
 * send them to /login" apart from "you're signed in but this is owner-only",
 * and so neither one ever reaches the user as an unhandled server-action
 * throw (which replaces the whole page with Next's crash screen).
 */
export class PmAuthError extends Error {
  readonly kind: "signed_out" | "forbidden";

  constructor(message: string, kind: "signed_out" | "forbidden") {
    super(message);
    this.name = "PmAuthError";
    this.kind = kind;
  }
}

async function resolveCaller(): Promise<PmActionContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new PmAuthError("Not signed in.", "signed_out");

  const { data: role } = await supabase.rpc("smark_role");
  if (!role) throw new PmAuthError("Your account isn't active.", "signed_out");

  return { supabase, actorId: user.id, role: role as Role };
}

/** Read access (owner/employee full, accountant read-only). */
export async function requirePmReader(): Promise<PmActionContext> {
  const ctx = await resolveCaller();
  if (!canSee(ctx.role, "projects")) throw new PmAuthError("You don't have access to Projects.", "forbidden");
  return ctx;
}

/** Write access (owner/employee full; accountant is read-only). Row-level scoping (e.g. "only my own task") is enforced per-action, not here. */
export async function requirePmWriter(): Promise<PmActionContext> {
  const ctx = await resolveCaller();
  if (!canWrite(ctx.role, "projects")) {
    throw new PmAuthError("You don't have permission to make changes on Projects.", "forbidden");
  }
  return ctx;
}

/** Owner-only actions (create task, assign hours, triage bugs, accept/reject change requests, etc). */
export async function requirePmOwner(): Promise<PmActionContext> {
  const ctx = await resolveCaller();
  if (!isOwner(ctx.role)) throw new PmAuthError("Only the owner can do this.", "forbidden");
  return ctx;
}
