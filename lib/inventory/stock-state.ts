/**
 * lib/inventory/stock-state.ts — the ONE stock-state rule (mission note:
 * "Stock state rule: qty=0 out, ≤reorder_point low (shared util in your
 * files)"). Shared by the inventory table/facets, the part-detail drawer
 * qty pill, and the CSV export — one function, so "low" never drifts.
 *
 * Pure — no I/O. Dashboard's stats tiles / Shelves' low dots reimplement the
 * same rule per FEATURES.md §5 ("Stock facet logic shared with Dashboard
 * stats + Shelves low dots"); this is the inventory-owned copy those
 * packages can mirror.
 */

export type StockState = "ok" | "low" | "out";

export const STOCK_STATE_LABEL: Record<StockState, string> = {
  ok: "In stock",
  low: "Low",
  out: "Out",
};

/** qty ≤ 0 → out; qty ≤ reorder_point (when set) → low; else ok. */
export function stockStateOf(qty: number, reorderPoint: number | null | undefined): StockState {
  if (qty <= 0) return "out";
  if (reorderPoint != null && qty <= reorderPoint) return "low";
  return "ok";
}
