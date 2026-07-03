import type { PartRow } from "@/types/db";
import type { StockState } from "./stock-state";

/** One `smark_stock_locations` row, already joined out to shelf code + box name. */
export interface InventoryPartLocation {
  id: string;
  qty: number;
  boxName: string;
  shelfCode: string;
  lastCountedAt: string | null;
}

/**
 * `smark_parts` row + everything the facet sidebar / table needs, computed
 * once server-side (lib/inventory/query.ts) instead of re-derived per render.
 */
export interface InventoryPart extends PartRow {
  locations: InventoryPartLocation[];
  stockState: StockState;
  /** Distinct distributor names from this part's order history (part_events). */
  distributorNames: string[];
  /** Distinct project names this part has been ordered/picked for. */
  projectNames: string[];
}
