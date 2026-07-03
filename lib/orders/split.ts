/**
 * lib/orders/split.ts — splits a cart line's `qty_to_order` across its
 * per-project `demand` breakdown, for fanning ONE `smark_cart_items` row into
 * MULTIPLE `smark_order_lines` at checkout (SCHEMA.md §4 `smark_order_lines`
 * comment: "one per demand slice ... so traceability survives the cart's
 * aggregation").
 *
 * Why this needs its own math: `demand` carries the FULL per-project demand
 * (e.g. 400 + 200), but `qty_to_order` can be LESS than that total — the
 * client's own shortfall example orders only the 100-unit gap, not the full
 * 600 units already partly covered by stock (FEATURES.md §16). There's no
 * single "right" project to credit that gap to, so this splits it
 * proportionally to each project's share of the demand, using the largest-
 * remainder method (Hamilton's method) so the parts sum EXACTLY to
 * `qtyToOrder` with no fractional drift and no double-rounding loss.
 *
 * Pure — no I/O, easy to pin with exact numbers (tests/unit/cart-split.test.ts).
 */

import type { CartDemandSlice } from "@/types/db";

export interface OrderLineSplit {
  project_id: string | null;
  bom_id: string | null;
  bom_line_id: string | null;
  qty: number;
}

/**
 * Splits `qtyToOrder` across `demand` slices proportionally to each slice's
 * share of the total demand (largest-remainder rounding keeps the sum exact).
 * Manual adds (or any line with no demand breakdown) fall back to a single
 * line with no project/BOM traceability. Zero-qty splits are dropped (a
 * split of 0 would violate `smark_order_lines.qty_ordered > 0`).
 */
export function splitQtyAcrossDemand(
  demand: readonly CartDemandSlice[],
  qtyToOrder: number,
): OrderLineSplit[] {
  if (qtyToOrder <= 0) return [];

  const totalDemand = demand.reduce((sum, slice) => sum + slice.qty, 0);
  if (demand.length === 0 || totalDemand <= 0) {
    return [{ project_id: null, bom_id: null, bom_line_id: null, qty: qtyToOrder }];
  }

  const shares = demand.map((slice) => (slice.qty / totalDemand) * qtyToOrder);
  const floors = shares.map((share) => Math.floor(share));
  const allocated = floors.reduce((sum, floor) => sum + floor, 0);
  let remainder = qtyToOrder - allocated;

  // Largest-remainder method: give the leftover units to the slices with the
  // biggest fractional part first, in stable original order for ties.
  const byFraction = shares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction);

  const qtys = [...floors];
  for (let i = 0; remainder > 0 && i < byFraction.length; i += 1, remainder -= 1) {
    const idx = byFraction[i]!.index;
    qtys[idx] = (qtys[idx] ?? 0) + 1;
  }

  return demand
    .map((slice, index) => ({
      project_id: slice.project_id,
      bom_id: slice.bom_id,
      bom_line_id: slice.bom_line_id,
      qty: qtys[index]!,
    }))
    .filter((split) => split.qty > 0);
}
