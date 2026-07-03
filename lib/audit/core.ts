/**
 * lib/audit/core.ts — the guided box-audit DB writes (FEATURES.md §5.4/§9).
 *
 * Every exported function takes an already-created `SupabaseClient<Database>`
 * plus the acting user's id, mirroring `lib/receive/core.ts`:
 *   - `lib/audit/actions.ts` ("use server") wraps these for the app, using
 *     the per-request RLS-bound client from `lib/supabase/server.ts`;
 *   - tests call the SAME functions directly with a fake/service-role client
 *     — no `next/headers` import here, so both call sites work.
 *
 * Confirm/type a counted qty per ESD →
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
 * (owned by 0002, not this package). Both `confirmAuditCountCore`'s location
 * write and `undoAuditCountCore`'s `applyLocationDelta` DO use an
 * optimistic-concurrency check (`.eq("qty", expectedQty)` + retry), mirroring
 * `lib/movements/service.ts`'s `updateLocationQty` — two concurrent
 * audits/undos on the same ESD shouldn't clobber each other. `undoAuditCountCore`
 * additionally inserts its undo row BEFORE reversing qty (opposite order from
 * `confirmAuditCountCore`) so `smark_movements_undo_of_unique` — not the earlier
 * `existingUndo` read, which two concurrent undos can both pass — is what
 * arbitrates a concurrent double-undo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MovementRowSchema, PartEventRowSchema, StockLocationRowSchema, TABLES, type Database } from "@/types/db";

type DB = SupabaseClient<Database>;

/**
 * Postgres unique-violation (`23505`) — fired by `smark_movements_undo_of_unique`
 * (UNIQUE(undo_of)) when two concurrent undos race for the same original
 * movement. Exported for direct unit testing of the friendly-error mapping,
 * mirroring `lib/bom/service.ts`'s `isUniqueViolation`.
 */
export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505");
}

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
 * Applies a signed delta to a stock-location's qty with optimistic
 * concurrency (a few retries if another writer changed the row between the
 * read and the write) — the same shape as `lib/movements/service.ts`'s
 * `updateLocationQty`, duplicated here rather than imported (shelves isn't
 * on `lib/movements`'s cross-package allowlist — see module docstring).
 */
export async function applyLocationDelta(
  supabase: DB,
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

/**
 * CASes a guided-audit count into a stock-location's qty: re-reads the
 * current qty immediately before writing and only writes conditionally on
 * `.eq("qty", freshQty)` (a few retries), the same optimistic-concurrency
 * shape as `applyLocationDelta` / `lib/movements/service.ts`'s
 * `updateLocationQty` — fixing finding #3, where this used to be an
 * unguarded absolute `.update({ qty: countedQty })` that could silently
 * clobber a concurrent pick/receive/adjust on the same ESD between the
 * caller's read and this write. Returns the qty this write actually saw as
 * "before" (`freshQtyBefore`), so the caller can log a movement whose delta
 * matches exactly what was overwritten.
 */
export async function applyAuditRecount(
  supabase: DB,
  locationId: string,
  countedQty: number,
  countedAt: string,
): Promise<{ freshQtyBefore: number; last_counted_at: string | null }> {
  const MAX_ATTEMPTS = 3;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { data: current, error: readError } = await supabase
      .from(TABLES.stock_locations)
      .select("qty")
      .eq("id", locationId)
      .single();
    if (readError || !current) {
      throw new Error(`stock location "${locationId}" not found: ${readError?.message ?? "no row"}`);
    }

    const locationUpdate = AuditLocationUpdateSchema.parse({ qty: countedQty, last_counted_at: countedAt });
    const { data, error } = await supabase
      .from(TABLES.stock_locations)
      .update(locationUpdate)
      .eq("id", locationId)
      .eq("qty", current.qty) // optimistic check — only writes if qty hasn't moved since we read it
      .select("qty, last_counted_at")
      .maybeSingle();

    if (error) {
      lastError = error.message;
      continue;
    }
    if (data) return { freshQtyBefore: current.qty, last_counted_at: data.last_counted_at };
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
export async function confirmAuditCountCore(
  supabase: DB,
  userId: string,
  input: ConfirmAuditCountInput,
): Promise<ConfirmAuditCountResult> {
  const { boxId, locationId, countedQty } = input;
  if (!Number.isInteger(countedQty) || countedQty < 0) {
    throw new Error("Counted quantity must be a whole number, 0 or more.");
  }

  const { data: location, error: locationError } = await supabase
    .from(TABLES.stock_locations)
    .select("id, part_id, big_box_id, qty")
    .eq("id", locationId)
    .eq("big_box_id", boxId)
    .maybeSingle();
  if (locationError) throw new Error(locationError.message);
  if (!location) throw new Error("That ESD location isn't in this box (it may have moved — refresh and retry).");

  const countedAt = new Date().toISOString();

  // CAS the counted qty in (finding #3): re-reads immediately before writing
  // so a concurrent pick/receive/adjust on the SAME ESD between the box-membership
  // check above and this write is reconciled into the delta below rather than
  // silently clobbered by an absolute overwrite.
  const { freshQtyBefore } = await applyAuditRecount(supabase, locationId, countedQty, countedAt);
  const delta = countedQty - freshQtyBefore;
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

  return { delta, newQty: countedQty, countedAt, isVariance: variance, movementId };
}

export type UndoAuditCountResult = { ok: true; newQty: number } | { ok: false; error: string };

/**
 * Reverses a variance movement written by `confirmAuditCountCore` — the audit
 * walk's Undo affordance (FEATURES.md §9 "every stock mutation ... is
 * undoable"), mirroring `lib/movements/service.ts`'s `undoMovement` shape
 * (same pairing rules: no undo-of-undo, undo-once) without importing it
 * (see module docstring on the cross-package allowlist).
 */
export async function undoAuditCountCore(supabase: DB, userId: string, movementId: string): Promise<UndoAuditCountResult> {
  try {
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

    const undoPayload = AuditUndoMovementInsertSchema.parse({
      part_id: original.part_id,
      big_box_id: original.big_box_id,
      delta_qty: reverseDelta,
      reason: "undo",
      reason_detail: null,
      actor: userId,
      undo_of: original.id,
    });
    // Insert the undo row FIRST and let `smark_movements_undo_of_unique`
    // (UNIQUE(undo_of)) arbitrate (finding #5). Two concurrent undos of the
    // same movement can both pass the `existingUndo` check above; if qty were
    // reversed before this insert, both would apply the reversing delta and
    // only the loser's insert would fail — silently double-reversing the qty.
    // Reversing the order means qty is only ever touched by whichever caller
    // actually wins the unique constraint.
    const { error: undoInsertError } = await supabase.from(TABLES.movements).insert(undoPayload);
    if (undoInsertError) {
      if (isUniqueViolation(undoInsertError)) return { ok: false, error: "This count has already been undone." };
      return { ok: false, error: undoInsertError.message };
    }

    const updatedLocation = await applyLocationDelta(supabase, location.id, reverseDelta);

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
