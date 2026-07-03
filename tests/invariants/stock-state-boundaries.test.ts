import { describe, expect, test } from "bun:test";
import { stockStateOf } from "@/lib/inventory/stock-state";
import { stockStateFor } from "@/lib/dashboard/compute";
import { stockStateForPart } from "@/components/shelves/stock-state";

/**
 * INVARIANT — stock-state boundaries + cross-surface consistency
 * (plan/tab-dashboard.md §4 "Low/out counts must agree with Inventory's Stock
 * facet and Shelves' low dots (same `stockState` rule: 0 = out, ≤
 * reorder_point = low)" · plan/tab-inventory.md §4 "Stock facet logic shared
 * with Dashboard stats + Shelves low dots (single `stockState`)" ·
 * plan/tab-shelves.md §4 "Low dots share `stockState` with
 * Dashboard/Inventory").
 *
 * As-landed reality: THREE separate implementations exist, one per surface —
 * `lib/inventory/stock-state.ts` (`stockStateOf`), `lib/dashboard/compute.ts`
 * (`stockStateFor`), `components/shelves/stock-state.ts`
 * (`stockStateForPart`) — each explicitly documenting itself as a
 * deliberate-for-now duplicate of the same rule (no shared `lib/` location
 * owns it yet). This file is the "single `stockState`" requirement made
 * executable: rather than trusting three independent copies to stay in sync
 * by convention, every boundary case here is asserted against ALL THREE, so
 * any future drift between them fails a test immediately instead of showing
 * up as "Dashboard says low, Inventory says out" in front of a client.
 *
 * Note for the integrator: consider promoting one of these three (or a new
 * `lib/format.ts`-adjacent module, since that's the other cross-package-
 * shared, integrator-owned home) to THE shared implementation and having the
 * other two re-export it, closing the duplication these three packages each
 * flagged in their own comments.
 */

// Normalizes each surface's slightly different call shape to one signature
// for the shared assertions below — the three real functions themselves are
// what's under test, this is just a thin adapter, not a fourth implementation.
const implementations = {
  "lib/inventory/stock-state.ts (stockStateOf)": (qty: number, reorderPoint: number | null) =>
    stockStateOf(qty, reorderPoint),
  "lib/dashboard/compute.ts (stockStateFor)": (qty: number, reorderPoint: number | null) =>
    stockStateFor(qty, reorderPoint),
  "components/shelves/stock-state.ts (stockStateForPart)": (qty: number, reorderPoint: number | null) =>
    stockStateForPart({ total_qty: qty, reorder_point: reorderPoint }),
} as const;

describe("invariant: stock-state boundaries (per implementation)", () => {
  for (const [name, stateOf] of Object.entries(implementations)) {
    describe(name, () => {
      test("total_qty = 0 is always OUT, regardless of reorder_point", () => {
        expect(stateOf(0, 10)).toBe("out");
        expect(stateOf(0, null)).toBe("out");
        expect(stateOf(0, 0)).toBe("out");
      });

      test("total_qty exactly AT reorder_point is LOW — the boundary is inclusive ('≤ reorder_point')", () => {
        expect(stateOf(5, 5)).toBe("low");
      });

      test("total_qty one ABOVE reorder_point is IN STOCK ('ok') — exclusive on the high side", () => {
        expect(stateOf(6, 5)).toBe("ok");
      });

      test("total_qty one BELOW reorder_point is LOW", () => {
        expect(stateOf(4, 5)).toBe("low");
      });

      test("null reorder_point never reports LOW for positive stock — only OUT or 'ok'", () => {
        expect(stateOf(1, null)).toBe("ok");
        expect(stateOf(0, null)).toBe("out");
      });

      test("reorder_point = 0 (explicitly no buffer): any positive stock is 'ok', zero is OUT — never LOW", () => {
        expect(stateOf(1, 0)).toBe("ok");
        expect(stateOf(0, 0)).toBe("out");
      });
    });
  }
});

describe("invariant: stock-state — the three surfaces AGREE (single stockState, not three drifting copies)", () => {
  test("every (qty, reorder_point) combination across a boundary sweep resolves to the SAME state on Inventory, Dashboard, and Shelves", () => {
    const reorderPoints = [null, 0, 1, 5, 10, 50];
    for (const reorderPoint of reorderPoints) {
      for (let qty = -1; qty <= 60; qty += 1) {
        const results = Object.entries(implementations).map(([name, stateOf]) => ({
          name,
          state: stateOf(qty, reorderPoint),
        }));
        const [first, ...rest] = results;
        for (const other of rest) {
          expect(
            other.state,
            `qty=${qty} reorder_point=${reorderPoint}: ${other.name} says "${other.state}" but ${first!.name} says "${first!.state}"`,
          ).toBe(first!.state);
        }
      }
    }
  });

  test("the three states are exhaustive and mutually exclusive across a boundary sweep — every total_qty from 0..20 against reorder_point=10 lands in exactly one bucket (checked against the inventory implementation, per the agreement test above)", () => {
    const buckets: Record<"out" | "low" | "ok", number> = { out: 0, low: 0, ok: 0 };
    for (let qty = 0; qty <= 20; qty += 1) {
      buckets[stockStateOf(qty, 10)] += 1;
    }
    expect(buckets.out).toBe(1); // qty === 0
    expect(buckets.low).toBe(10); // qty 1..10
    expect(buckets.ok).toBe(10); // qty 11..20
  });
});
