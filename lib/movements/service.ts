/**
 * lib/movements/service.ts — the DB-backed half of the movement/undo write
 * path. Every decision (is this delta legal? is this movement undoable?
 * what does the reversing row look like?) is delegated to `./pure`; this
 * file only does I/O against Supabase and stays as thin as possible.
 *
 * Callers: Scan take-out/add (this package), and — via the cross-package
 * import allowance in docs/OWNERSHIP.md — Receive confirm and Bulk-takeout
 * finish. All three go through `recordMovement`; only Scan's undo toast (and
 * anywhere Part-detail eventually surfaces an undo action) calls
 * `undoMovement`.
 *
 * Concurrency note: PostgREST has no multi-statement transaction, and this
 * package cannot add a migration/RPC on its own (docs/OWNERSHIP.md — schema
 * changes go through the integrator). `updateLocationQty` below uses an
 * optimistic-concurrency update (`.eq("qty", expectedQty)`) with a few
 * retries instead, then the movement row is inserted. A genuinely atomic
 * version of this (a single SECURITY DEFINER function doing both writes) is
 * flagged as a follow-up for the integrator in this package's report —
 * `smark_stock_locations_qty_nonnegative` still protects the DB from ever
 * going negative even if the retry loop above raced.
 *
 * `undoMovement` inserts its reversing row BEFORE touching qty (opposite
 * order from `recordMovement`) so `smark_movements_undo_of_unique`
 * (UNIQUE(undo_of)) — not the earlier `existingUndo` read, which two
 * concurrent undos can both pass — is what arbitrates a concurrent
 * double-undo; only the insert's actual winner ever reverses the qty.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLES, type Database, type MovementRow, type StockLocationRow } from "@/types/db";
import { applyDelta, assertUndoable, buildMovementInsert, buildUndoInsert } from "./pure";
import { MovementValidationError, type MovementInput, type MovementResult, type UndoableMovement } from "./types";

type Client = SupabaseClient<Database>;

const MAX_QTY_UPDATE_ATTEMPTS = 3;

/**
 * Postgres unique-violation (`23505`) — fired by `smark_movements_undo_of_unique`
 * (UNIQUE(undo_of)) when two concurrent undos race for the same original
 * movement. Exported for direct unit testing of the friendly-error mapping,
 * mirroring `lib/bom/service.ts`'s `isUniqueViolation`.
 */
export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505");
}

/** Reads the current qty for one stock-location row (throws if it no longer exists). */
async function fetchLocation(client: Client, locationId: string): Promise<StockLocationRow> {
  const { data, error } = await client.from(TABLES.stock_locations).select("*").eq("id", locationId).single();
  if (error || !data) {
    throw new MovementValidationError(`stock location "${locationId}" not found: ${error?.message ?? "no row"}`);
  }
  return data;
}

/**
 * Applies `deltaQty` to a location's qty with optimistic concurrency
 * (retries a few times if another writer changed the row between the read
 * and the write — see the module-level note on why this isn't a single
 * atomic statement). Returns the updated row.
 */
async function updateLocationQty(client: Client, locationId: string, deltaQty: number): Promise<StockLocationRow> {
  let lastError: string | null = null;

  for (let attempt = 0; attempt < MAX_QTY_UPDATE_ATTEMPTS; attempt += 1) {
    const current = await fetchLocation(client, locationId);
    const nextQty = applyDelta(current.qty, deltaQty); // throws MovementValidationError if it'd go negative

    const { data, error } = await client
      .from(TABLES.stock_locations)
      .update({ qty: nextQty })
      .eq("id", locationId)
      .eq("qty", current.qty) // optimistic check — only writes if qty hasn't moved since we read it
      .select("*")
      .maybeSingle();

    if (error) {
      lastError = error.message;
      continue;
    }
    if (data) return data;
    // 0 rows matched: someone else wrote first — loop and retry against the fresh value.
    lastError = "concurrent update — qty changed since read";
  }

  throw new MovementValidationError(`could not update stock location "${locationId}" after retries: ${lastError}`);
}

/**
 * Records a new stock mutation: writes `smark_movements` and applies the
 * same delta to the target location's qty (`smark_parts.total_qty` then
 * follows automatically via the DB trigger — never write it directly).
 */
export async function recordMovement(client: Client, input: MovementInput): Promise<MovementResult> {
  const insertRow = buildMovementInsert(input); // validates before any I/O happens

  const location = await updateLocationQty(client, input.locationId, input.deltaQty);

  const { data: movement, error } = await client.from(TABLES.movements).insert(insertRow).select("*").single();
  if (error || !movement) {
    // The qty write above already landed — surfaced clearly so the caller can
    // tell the user their stock count is right but retry logging the movement.
    throw new MovementValidationError(
      `stock qty was updated but the movement record failed to write: ${error?.message ?? "no row returned"}`,
    );
  }

  return { movement, location };
}

/**
 * Reverses a previously-recorded movement: validates it's undoable, writes
 * the negated `reason: "undo"` row (`undo_of` = the original), and reverses
 * the qty change on the SAME location the original movement touched.
 *
 * A movement with no `big_box_id` (documented as possible for
 * context-less/import-time adjusts) writes the reversing audit row but has
 * no location to reverse a qty change on.
 */
export async function undoMovement(
  client: Client,
  movementId: string,
  actor: string,
): Promise<{ movement: MovementRow; location: StockLocationRow | null }> {
  const { data: original, error: fetchError } = await client
    .from(TABLES.movements)
    .select("*")
    .eq("id", movementId)
    .single();
  if (fetchError || !original) {
    throw new MovementValidationError(`movement "${movementId}" not found: ${fetchError?.message ?? "no row"}`);
  }

  const { data: existingUndo, error: undoLookupError } = await client
    .from(TABLES.movements)
    .select("id")
    .eq("undo_of", movementId)
    .maybeSingle();
  if (undoLookupError) {
    throw new MovementValidationError(`could not check undo status of "${movementId}": ${undoLookupError.message}`);
  }

  const undoable: UndoableMovement = {
    id: original.id,
    part_id: original.part_id,
    big_box_id: original.big_box_id,
    delta_qty: original.delta_qty,
    reason: original.reason,
    bom_id: original.bom_id,
  };
  const alreadyUndoneIds = new Set<string>(existingUndo ? [movementId] : []);
  assertUndoable(undoable, alreadyUndoneIds);

  const undoInsert = buildUndoInsert(undoable, actor);

  // Insert the undo row FIRST and let `smark_movements_undo_of_unique`
  // (UNIQUE(undo_of)) arbitrate. Two concurrent undos of the same movement
  // can both pass the `existingUndo` check above; if the qty reversal ran
  // before this insert, both would apply the reversing delta and only the
  // loser's insert would fail — silently double-reversing the qty while the
  // "undoable once" invariant only protected the movement row. Reversing the
  // order means the qty is only ever touched by whichever caller's insert
  // actually wins the unique constraint.
  const { data: undoMovementRow, error: insertError } = await client
    .from(TABLES.movements)
    .insert(undoInsert)
    .select("*")
    .single();
  if (insertError || !undoMovementRow) {
    if (isUniqueViolation(insertError)) {
      throw new MovementValidationError("this movement has already been undone");
    }
    throw new MovementValidationError(
      `undo movement failed to write: ${insertError?.message ?? "no row returned"}`,
    );
  }

  let location: StockLocationRow | null = null;
  if (original.big_box_id) {
    const { data: locationRow, error: locationError } = await client
      .from(TABLES.stock_locations)
      .select("id")
      .eq("part_id", original.part_id)
      .eq("big_box_id", original.big_box_id)
      .maybeSingle();
    if (locationError) {
      throw new MovementValidationError(`could not find the location to reverse: ${locationError.message}`);
    }
    if (locationRow) {
      location = await updateLocationQty(client, locationRow.id, undoInsert.delta_qty);
    }
  }

  return { movement: undoMovementRow, location };
}
