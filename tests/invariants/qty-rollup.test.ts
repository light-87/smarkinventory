import { describe, test } from "bun:test";

/**
 * INVARIANT — qty rollup property (plan/TESTING.md §5.3 · CROSS-FEATURE.md
 * A3.4). "`total_qty` always equals Σ locations (property-based checks
 * after random op sequences)."
 * Canonical shape: SCHEMA.md `smark_parts.total_qty` (denormalized rollup
 * over `smark_stock_locations`), sync table: "recomputes on every
 * movement/receive/adjust". `smark_stock_locations`: one home per part
 * normally, a second row allowed for the bulk (reel + working box) case.
 * Applies at: unit (property test — random op sequences against the rollup
 * function), DB (trigger/constraint keeping the denorm in sync), worker
 * (concurrent movements don't race the rollup).
 * Skeleton (test.todo) until the inventory-core package lands the
 * movement/location write path. Convert todos to real tests in place — keep
 * the names.
 */

describe("invariant: qty rollup", () => {
  test.todo(
    "property: after any random sequence of receive/pick/adjust/bulk_pick/undo ops on a part, smark_parts.total_qty === SUM(smark_stock_locations.qty) for that part",
    () => {},
  );
  test.todo(
    "multi-location part (reel + working box, the documented 2-row case) rolls up as the SUM across both rows, not just the primary one",
    () => {},
  );
  test.todo(
    "total_qty never goes negative — a pick that would exceed available stock is rejected before the mutation is written, not clamped after",
    () => {},
  );
  test.todo(
    "concurrent movements against the same part serialize correctly — no lost-update race leaves total_qty out of sync with its locations",
    () => {},
  );
  test.todo(
    "adjust movements (positive or negative delta) keep total_qty in sync the same way pick/receive/bulk_pick do",
    () => {},
  );
  test.todo(
    "undo of any movement type restores total_qty to exactly its pre-mutation value (rollup angle of the undo-pairing invariant)",
    () => {},
  );
  test.todo(
    "a location_moved event (box reassignment) changes which big_box_id holds the qty but leaves the part's total_qty unchanged",
    () => {},
  );
  test.todo(
    "Inventory/Part-detail/Shelves/Dashboard/Scan all read the same total_qty — no surface computes its own separate rollup",
    () => {},
  );
});
