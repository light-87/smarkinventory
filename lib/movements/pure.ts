/**
 * lib/movements/pure.ts — the movement/undo pairing + rollup math, with zero
 * I/O (FEATURES.md §9 · CROSS-FEATURE A3.3/A3.4 · plan/tab-scan.md: "keep it
 * pure + unit-tested (rollup sync total_qty)").
 *
 * This module is the ONE place that decides:
 *   - what a new movement row looks like (`buildMovementInsert`)
 *   - what its undo row looks like, and whether undoing is even allowed
 *     (`buildUndoInsert` / `assertUndoable`)
 *   - how a location's qty changes under a delta, and that it never goes
 *     negative (`applyDelta`)
 *   - the rollup identity `total_qty === Σ locations.qty`
 *     (`sumLocationQty`)
 *
 * `lib/movements/service.ts` is the ONLY caller that talks to Supabase; it
 * defers every decision above to these functions so the decision logic stays
 * testable without a database (see tests/invariants/undo-pairing.test.ts and
 * tests/invariants/qty-rollup.test.ts — both exercise this file directly).
 *
 * The DB has its own twin enforcement (migration 0002_catalog_location.sql):
 *   - `smark_stock_locations_qty_nonnegative` CHECK (qty >= 0)
 *   - `smark_movements_undo_of_unique` UNIQUE(undo_of) — undoable once
 *   - `smark_movements_undo_pairing` CHECK ((reason='undo') = (undo_of is not null))
 *   - the `trg_smark_stock_locations_sync_total_qty` trigger recomputes
 *     `smark_parts.total_qty` from `SUM(smark_stock_locations.qty)` on every
 *     insert/update/delete — so the rollup itself can never drift from a
 *     bug here; this module's job is to never let a BAD delta reach the DB
 *     in the first place, and to give callers a clear error before that.
 */

import type { MovementReason } from "@/types/db";
import { MovementValidationError, type MovementInput, type MovementInsertRow, type UndoableMovement } from "./types";

/* ────────────────────────────────────────────────────────────────────────────
 * New movement rows
 * ──────────────────────────────────────────────────────────────────────────── */

const NON_UNDO_REASONS: ReadonlySet<MovementReason> = new Set(["pick", "receive", "adjust", "bulk_pick"]);

/**
 * Validates + shapes a NEW (non-undo) movement for insert. Throws
 * `MovementValidationError` rather than writing a row that would violate the
 * DB's own CHECK constraints (fail fast, friendly message) — SCHEMA.md §6:
 *   - `delta_qty` is signed and non-zero (a zero-delta "movement" is not a
 *     movement — callers should no-op instead of writing one)
 *   - `reason` is one of pick/receive/adjust/bulk_pick (never `undo` here —
 *     use `buildUndoInsert` for that path)
 *   - `reason_detail` (`"audit"`) is only valid alongside `reason: "adjust"`
 */
export function buildMovementInsert(input: MovementInput): MovementInsertRow {
  if (!Number.isInteger(input.deltaQty) || input.deltaQty === 0) {
    throw new MovementValidationError("delta_qty must be a non-zero integer");
  }
  if (!NON_UNDO_REASONS.has(input.reason)) {
    throw new MovementValidationError(`reason "${input.reason}" is not a valid new-movement reason`);
  }
  const reasonDetail = input.reasonDetail ?? null;
  if (reasonDetail !== null) {
    if (reasonDetail !== "audit") {
      throw new MovementValidationError(`reason_detail "${reasonDetail}" is not recognized`);
    }
    if (input.reason !== "adjust") {
      throw new MovementValidationError('reason_detail "audit" is only valid when reason is "adjust"');
    }
  }
  if (!input.actor) {
    throw new MovementValidationError("actor is required on every movement");
  }

  return {
    part_id: input.partId,
    big_box_id: input.bigBoxId,
    delta_qty: input.deltaQty,
    reason: input.reason,
    reason_detail: reasonDetail,
    bom_id: input.bomId ?? null,
    actor: input.actor,
    undo_of: null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Undo pairing
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Throws with a clear reason when `original` cannot be undone:
 *   - a movement whose own `reason` is `"undo"` can never itself be undone
 *     (no undo chains — CROSS-FEATURE A3.3)
 *   - a movement that already has a reversing row pointing at it
 *     (`alreadyUndoneMovementIds` = the set of `undo_of` values seen so far)
 *     can only be undone once.
 */
export function assertUndoable(original: UndoableMovement, alreadyUndoneMovementIds: ReadonlySet<string>): void {
  if (original.reason === "undo") {
    throw new MovementValidationError("cannot undo an undo movement (no undo chains)");
  }
  if (alreadyUndoneMovementIds.has(original.id)) {
    throw new MovementValidationError("this movement has already been undone");
  }
}

/**
 * Builds the reversing movement row for `original`: same part/box/bom,
 * negated delta, `reason: "undo"`, `undo_of: original.id`, stamped with
 * whoever performed the undo (may differ from the original actor — e.g. the
 * owner undoing an employee's mistake).
 *
 * Callers MUST run `assertUndoable` first (kept separate so a caller that
 * already has the "already undone?" answer from its own query doesn't have
 * to thread it through this function's signature too).
 */
export function buildUndoInsert(original: UndoableMovement, actor: string): MovementInsertRow {
  if (!actor) {
    throw new MovementValidationError("actor is required on every movement");
  }
  return {
    part_id: original.part_id,
    big_box_id: original.big_box_id,
    delta_qty: -original.delta_qty,
    reason: "undo",
    reason_detail: null,
    bom_id: original.bom_id,
    actor,
    undo_of: original.id,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Location qty / rollup math
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Applies a signed delta to a location's current qty. Throws BEFORE the
 * mutation would be written when the result would go negative — the DB's
 * CHECK is the last line of defense, this is the friendly first one ("a pick
 * that would exceed available stock is rejected before the mutation is
 * written, not clamped after" — qty-rollup invariant).
 */
export function applyDelta(currentQty: number, deltaQty: number): number {
  const next = currentQty + deltaQty;
  if (next < 0) {
    throw new MovementValidationError(
      `insufficient stock: ${currentQty} available, delta ${deltaQty} would go negative`,
    );
  }
  return next;
}

/** `smark_parts.total_qty` identity: the sum of every location's qty for the part. */
export function sumLocationQty(locations: readonly { qty: number }[]): number {
  return locations.reduce((total, location) => total + location.qty, 0);
}
