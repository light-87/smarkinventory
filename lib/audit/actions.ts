"use server";

/**
 * lib/audit/actions.ts — the one write path for the guided box audit
 * (FEATURES.md §5.4/§9): confirm/type a counted qty per ESD →
 * - a variance (`countedQty !== recordedQty`) writes a `smark_movements` row
 *   (`reason='adjust'`, `reason_detail='audit'`) exactly like any other
 *   stock mutation, undoable via `undo_of` (A3 invariant) — and a mirror
 *   `smark_part_events` row (`event_type='adjusted'`) so part-detail's
 *   living-record timeline shows it too;
 * - `smark_stock_locations.qty` is corrected and `last_counted_at` stamped
 *   REGARDLESS of variance (a confirmed exact count is still "counted");
 * - `smark_parts.total_qty` re-syncs via the existing DB trigger
 *   (`trg_smark_stock_locations_sync_total_qty`) — never written here.
 *
 * Role-gated the same way `lib/receive/actions.ts` (`requireReceiveWriter`)
 * and `lib/part-events/actions.ts` (`requireInventoryWriter`) gate theirs:
 * Shelves is accountant=read-only (FEATURES.md §2), and until now that was
 * enforced ONLY by RLS here (migration 0002 denies accountant INSERT/UPDATE
 * on these tables) — a read-only caller got an opaque RLS-denied Postgres
 * error instead of a clear "you don't have permission" message.
 *
 * Cross-package note (see package report): this duplicates the
 * "write a movement + update a location" shape that `lib/movements` (scan)
 * formalizes. OWNERSHIP.md doesn't list shelves as an allowed importer of
 * `lib/movements` (only takeout/receive are) — so audit writes (and their
 * undo, below) land directly here rather than through that seam. Once
 * shelves is added to that allowlist, consider routing this through it to
 * avoid two code paths writing the same invariant.
 *
 * Not run in a transaction (two/three sequential PostgREST calls, no DB
 * function): if a movement insert succeeds but the location update then
 * fails, the log row and the actual qty can momentarily disagree. Same
 * caveat almost certainly applies to every other package's first cut at
 * this — flagged for the integrator rather than reaching for a migration
 * (owned by 0002, not this package). The location update DOES use an
 * optimistic-concurrency check (`.eq("qty", expectedQty)` + retry) though,
 * mirroring `lib/movements/service.ts`'s `updateLocationQty` — two
 * concurrent audits/undos on the same ESD shouldn't clobber each other.
 */

import { createClient } from "@/lib/supabase/server";
import { canWrite } from "@/lib/auth/roles";
import {
  MovementRowSchema,
  PartEventRowSchema,
  StockLocationRowSchema,
  TABLES,
} from "@/types/db";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const AuditMovementInsertSchema = MovementRowSchema.pick({
  part_id: true,
  big_box_id: true,
  delta_qty: true,
  reason: true,
  reason_detail: true,
  actor: true,
});

const AuditUndoMovementInsertSchema = MovementRowSchema.pick({
  part_id: true,
  big_box_id: true,
  delta_qty: true,
  reason: true,
  reason_detail: true,
  actor: true,
  undo_of: true,
});

const AuditPartEventInsertSchema = PartEventRowSchema.pick({
  part_id: true,
  event_type: true,
  reason: true,
  qty: true,
  location_big_box_id: true,
  actor: true,
  occurred_at: true,
});

const AuditLocationUpdateSchema = StockLocationRowSchema.pick({
  qty: true,
  last_counted_at: true,
});

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

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canWrite(role, "shelves")) {
    throw new Error("You don't have permission to make changes on Shelves.");
  }
  return { supabase, userId: user.id };
}

/**
 * Applies a signed delta to a stock-location's qty with optimistic
 * concurrency (a few retries if another writer changed the row between the
 * read and the write) — the same shape as `lib/movements/service.ts`'s
 * `updateLocationQty`, duplicated here rather than imported (shelves isn't
 * on `lib/movements`'s cross-package allowlist — see module docstring).
 */
async function applyLocationDelta(
  supabase: SupabaseServerClient,
  locationId: string,
  deltaQty: number,
): Promise<{ qty: number; last_counted_at: string | null }> {
  const MAX_ATTEMPTS = 3;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { data: current, error: readError } = await supabase
      .from(TABLES.stock_locations)
      .select("qty, last_counted_at")
      .eq("id", locationId)
      .single();
    if (readError || !current) {
      throw new Error(`stock location "${locationId}" not found: ${readError?.message ?? "no row"}`);
    }

    const nextQty = current.qty + deltaQty;
    if (nextQty < 0) {
      throw new Error(`insufficient stock: ${current.qty} available, delta ${deltaQty} would go negative`);
    }

    const { data, error } = await supabase
      .from(TABLES.stock_locations)
      .update({ qty: nextQty })
      .eq("id", locationId)
      .eq("qty", current.qty) // optimistic check — only writes if qty hasn't moved since we read it
      .select("qty, last_counted_at")
      .maybeSingle();

    if (error) {
      lastError = error.message;
      continue;
    }
    if (data) return data;
    lastError = "concurrent update — qty changed since read";
  }

  throw new Error(`could not update stock location "${locationId}" after retries: ${lastError}`);
}

export interface ConfirmAuditCountInput {
  boxId: string;
  locationId: string;
  /** What the person counted on the shelf — a whole number, zero included. */
  countedQty: number;
}

export interface ConfirmAuditCountResult {
  delta: number;
  newQty: number;
  countedAt: string;
  isVariance: boolean;
  /** Set only when `isVariance` — the movement id, so the caller can offer Undo. */
  movementId: string | null;
}

/**
 * Confirms (or corrects) one ESD's counted quantity during a guided box
 * audit. Called once per ESD as the person walks the box — see
 * `components/shelves/AuditFlow.tsx`.
 */
export async function confirmAuditCount(
  input: ConfirmAuditCountInput,
): Promise<ConfirmAuditCountResult> {
  const { boxId, locationId, countedQty } = input;
  if (!Number.isInteger(countedQty) || countedQty < 0) {
    throw new Error("Counted quantity must be a whole number, 0 or more.");
  }

  const { supabase, userId } = await requireShelvesWriter();

  const { data: location, error: locationError } = await supabase
    .from(TABLES.stock_locations)
    .select("id, part_id, big_box_id, qty")
    .eq("id", locationId)
    .eq("big_box_id", boxId)
    .maybeSingle();
  if (locationError) throw new Error(locationError.message);
  if (!location) throw new Error("That ESD location isn't in this box (it may have moved — refresh and retry).");

  const delta = countedQty - location.qty;
  const countedAt = new Date().toISOString();
  const variance = delta !== 0;
  let movementId: string | null = null;

  if (variance) {
    const movementPayload = AuditMovementInsertSchema.parse({
      part_id: location.part_id,
      big_box_id: location.big_box_id,
      delta_qty: delta,
      reason: "adjust",
      reason_detail: "audit",
      actor: userId,
    });
    const { data: movement, error: movementError } = await supabase
      .from(TABLES.movements)
      .insert(movementPayload)
      .select("id")
      .single();
    if (movementError || !movement) throw new Error(movementError?.message ?? "movement insert returned no row");
    movementId = movement.id;

    const eventPayload = AuditPartEventInsertSchema.parse({
      part_id: location.part_id,
      event_type: "adjusted",
      reason: "audit",
      qty: delta,
      location_big_box_id: location.big_box_id,
      actor: userId,
      occurred_at: countedAt,
    });
    const { error: eventError } = await supabase.from(TABLES.part_events).insert(eventPayload);
    if (eventError) throw new Error(eventError.message);
  }

  const locationUpdate = AuditLocationUpdateSchema.parse({ qty: countedQty, last_counted_at: countedAt });
  const { error: updateError } = await supabase
    .from(TABLES.stock_locations)
    .update(locationUpdate)
    .eq("id", locationId);
  if (updateError) throw new Error(updateError.message);

  return { delta, newQty: countedQty, countedAt, isVariance: variance, movementId };
}

export type UndoAuditCountResult = { ok: true; newQty: number } | { ok: false; error: string };

/**
 * Reverses a variance movement written by `confirmAuditCount` — the audit
 * walk's Undo affordance (FEATURES.md §9 "every stock mutation ... is
 * undoable"), mirroring `lib/movements/service.ts`'s `undoMovement` shape
 * (same pairing rules: no undo-of-undo, undo-once) without importing it
 * (see module docstring on the cross-package allowlist).
 */
export async function undoAuditCount(movementId: string): Promise<UndoAuditCountResult> {
  try {
    const { supabase, userId } = await requireShelvesWriter();

    const { data: original, error: fetchError } = await supabase
      .from(TABLES.movements)
      .select("id, part_id, big_box_id, delta_qty, reason")
      .eq("id", movementId)
      .maybeSingle();
    if (fetchError) return { ok: false, error: fetchError.message };
    if (!original) return { ok: false, error: "That count no longer exists." };
    if (original.reason === "undo") return { ok: false, error: "Cannot undo an undo." };
    if (!original.big_box_id) return { ok: false, error: "This count has no location to reverse." };

    const { data: existingUndo, error: undoLookupError } = await supabase
      .from(TABLES.movements)
      .select("id")
      .eq("undo_of", movementId)
      .maybeSingle();
    if (undoLookupError) return { ok: false, error: undoLookupError.message };
    if (existingUndo) return { ok: false, error: "This count has already been undone." };

    const { data: location, error: locationError } = await supabase
      .from(TABLES.stock_locations)
      .select("id")
      .eq("part_id", original.part_id)
      .eq("big_box_id", original.big_box_id)
      .maybeSingle();
    if (locationError) return { ok: false, error: locationError.message };
    if (!location) return { ok: false, error: "That ESD location no longer exists." };

    const reverseDelta = -original.delta_qty;
    const updatedLocation = await applyLocationDelta(supabase, location.id, reverseDelta);

    const undoPayload = AuditUndoMovementInsertSchema.parse({
      part_id: original.part_id,
      big_box_id: original.big_box_id,
      delta_qty: reverseDelta,
      reason: "undo",
      reason_detail: null,
      actor: userId,
      undo_of: original.id,
    });
    const { error: undoInsertError } = await supabase.from(TABLES.movements).insert(undoPayload);
    if (undoInsertError) return { ok: false, error: undoInsertError.message };

    const { error: eventError } = await supabase.from(TABLES.part_events).insert(
      AuditPartEventInsertSchema.parse({
        part_id: original.part_id,
        event_type: "adjusted",
        reason: "audit undo",
        qty: reverseDelta,
        location_big_box_id: original.big_box_id,
        actor: userId,
        occurred_at: new Date().toISOString(),
      }),
    );
    if (eventError) return { ok: false, error: eventError.message };

    return { ok: true, newQty: updatedLocation.qty };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not undo that count." };
  }
}
