/**
 * components/shelves/stock-state.ts — shared low/out coloring for the rack
 * cards and Live-contents rows (plan/tab-shelves.md: "Low dots share
 * `stockState` with Dashboard/Inventory").
 *
 * Mirrors the prototype's `stockState()` (SmarkStock.dc.html support code:
 * `qty===0 → out`, `qty<=reorder → low`, else `ok`) against the PART's
 * rollup (`total_qty`/`reorder_point`), not a single location's qty — a part
 * spread across two ESDs is only "ok" if its combined stock clears the
 * threshold. No shared `lib/` home for this exists yet outside this
 * package — flagged in the report as a candidate for promotion if
 * Dashboard/Inventory land their own copy.
 */

export type StockState = "ok" | "low" | "out";

export interface StockStateInput {
  total_qty: number;
  reorder_point: number | null;
}

export function stockStateForPart(part: StockStateInput): StockState {
  if (part.total_qty <= 0) return "out";
  if (part.reorder_point != null && part.total_qty <= part.reorder_point) return "low";
  return "ok";
}

/** Either low or out — the single "orange dot" condition used throughout the rack UI. */
export function isLowState(state: StockState): boolean {
  return state !== "ok";
}
