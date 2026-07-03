/**
 * lib/movements/types.ts — shared shapes for the movement/undo write path.
 *
 * Owned by `scan` (docs/OWNERSHIP.md), imported read-only by `receive` and
 * `takeout` (their finish/confirm actions write movements through this lib
 * instead of re-deriving the pairing rules themselves).
 */

import type { MovementReason, MovementReasonDetail, MovementRow, StockLocationRow } from "@/types/db";

/** Everything needed to write one NEW (non-undo) movement + apply its delta. */
export interface MovementInput {
  /** The specific ESD/stock-location row this movement applies to. */
  locationId: string;
  partId: string;
  bigBoxId: string;
  /** Signed — positive = stock added, negative = stock removed. Never 0. */
  deltaQty: number;
  reason: Exclude<MovementReason, "undo">;
  /** Only ever `"audit"`, and only alongside `reason: "adjust"` (SCHEMA §6). */
  reasonDetail?: MovementReasonDetail | null;
  bomId?: string | null;
  /** Acting user — `smark_app_users.id`. Stamped on every movement (NOT NULL in SQL). */
  actor: string;
}

export interface MovementResult {
  movement: MovementRow;
  location: StockLocationRow;
}

/** The subset of a movement row undo needs — deliberately narrow (easy to unit test with fixtures). */
export interface UndoableMovement {
  id: string;
  part_id: string;
  big_box_id: string | null;
  delta_qty: number;
  reason: MovementReason;
  bom_id: string | null;
}

/** Insert-ready row shape (no `id`/`created_at`/`updated_at` — the DB defaults those). */
export interface MovementInsertRow {
  part_id: string;
  big_box_id: string | null;
  delta_qty: number;
  reason: MovementReason;
  reason_detail: MovementReasonDetail | null;
  bom_id: string | null;
  actor: string;
  undo_of: string | null;
}

export class MovementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MovementValidationError";
  }
}
