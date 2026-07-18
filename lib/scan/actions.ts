"use server";

/**
 * lib/scan/actions.ts — Server Action wrapper around `lib/movements` for the
 * Scan surface's online take-out/add path.
 *
 * Scan is accountant=read-only (FEATURES.md §2), and until now that was
 * enforced ONLY by RLS (migration 0002 denies accountant INSERT on
 * `smark_movements` / UPDATE on `smark_stock_locations`) — `hooks/use-scanner.ts`
 * called `recordMovement`/`undoMovement` directly via the RLS-bound browser
 * client, so a read-only caller who somehow reached Take out/Add (or hit the
 * button before the UI-gating below rendered) got an opaque "could not
 * update stock location after retries" Postgres error. Mirrors
 * `lib/receive/actions.ts`'s `requireReceiveWriter` / `lib/part-events/actions.ts`'s
 * `requireInventoryWriter`.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { recordMovement, undoMovement, type MovementInput, type MovementResult } from "@/lib/movements";
import type { MovementRow, StockLocationRow } from "@/types/db";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function requireScanWriter(): Promise<{ supabase: SupabaseServerClient; actorId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to record stock movements.");

  // (0017) inventory view/edit-aware — RPC twin of the write RLS.
  const { data: canEdit } = await supabase.rpc("smark_can_edit_inventory");
  if (!canEdit) {
    throw new Error("You have view-only access to inventory.");
  }
  return { supabase, actorId: user.id };
}

/**
 * Records a take-out/add movement — pre-checks Scan write access before
 * touching the DB. `input.actor` (whatever the browser-side hook read from
 * its own `auth.getUser()`) is stamped over with the SERVER-verified caller
 * id, same as `lib/receive/actions.ts`/`lib/part-events/actions.ts` never
 * trust a client-supplied actor.
 */
export async function recordScanMovementAction(input: MovementInput): Promise<MovementResult> {
  const { supabase, actorId } = await requireScanWriter();
  const result = await recordMovement(supabase, { ...input, actor: actorId });
  revalidatePath("/scan");
  return result;
}

/** Reverses a scan movement (the toast's Undo pill) — same write-access pre-check. */
export async function undoScanMovementAction(
  movementId: string,
): Promise<{ movement: MovementRow; location: StockLocationRow | null }> {
  const { supabase, actorId } = await requireScanWriter();
  const result = await undoMovement(supabase, movementId, actorId);
  revalidatePath("/scan");
  return result;
}
