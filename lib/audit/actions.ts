"use server";

/**
 * lib/audit/actions.ts — Server Action wrapper around `./core`'s guided
 * box-audit DB writes (FEATURES.md §5.4/§9). Mirrors `lib/receive/actions.ts`
 * wrapping `lib/receive/core.ts`: this file's only job is auth (session +
 * role) and handing the per-request RLS-bound client to `./core`, which
 * carries the actual write-path logic (and is directly unit-testable without
 * `next/headers`, since it takes the client as a parameter — see
 * tests/unit/audit-core.test.ts).
 *
 * Role-gated the same way `lib/receive/actions.ts` (`requireReceiveWriter`)
 * and `lib/part-events/actions.ts` (`requireInventoryWriter`) gate theirs:
 * Shelves is accountant=read-only (FEATURES.md §2), and until now that was
 * enforced ONLY by RLS here (migration 0002 denies accountant INSERT/UPDATE
 * on these tables) — a read-only caller got an opaque RLS-denied Postgres
 * error instead of a clear "you don't have permission" message.
 */

import { createClient } from "@/lib/supabase/server";
import * as core from "./core";
import type { ConfirmAuditCountInput, ConfirmAuditCountResult, UndoAuditCountResult } from "./core";

export type { ConfirmAuditCountInput, ConfirmAuditCountResult, UndoAuditCountResult } from "./core";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Signed-in + Shelves-writer check shared by every mutation below. Mirrors
 * `lib/receive/actions.ts`'s `requireReceiveWriter`.
 */
async function requireShelvesWriter(): Promise<{ supabase: SupabaseServerClient; userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  // (0017) inventory view/edit-aware — RPC twin of the write RLS.
  const { data: canEdit } = await supabase.rpc("smark_can_edit_inventory");
  if (!canEdit) {
    throw new Error("You have view-only access to inventory.");
  }
  return { supabase, userId: user.id };
}

/**
 * Confirms (or corrects) one ESD's counted quantity during a guided box
 * audit. Called once per ESD as the person walks the box — see
 * `components/shelves/AuditFlow.tsx`.
 */
export async function confirmAuditCount(input: ConfirmAuditCountInput): Promise<ConfirmAuditCountResult> {
  const { supabase, userId } = await requireShelvesWriter();
  return core.confirmAuditCountCore(supabase, userId, input);
}

/**
 * Reverses a variance movement written by `confirmAuditCount` — the audit
 * walk's Undo affordance (FEATURES.md §9 "every stock mutation ... is
 * undoable").
 */
export async function undoAuditCount(movementId: string): Promise<UndoAuditCountResult> {
  const { supabase, userId } = await requireShelvesWriter();
  return core.undoAuditCountCore(supabase, userId, movementId);
}
