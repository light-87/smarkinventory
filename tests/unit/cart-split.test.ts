import { describe, expect, test } from "bun:test";
import { splitQtyAcrossDemand } from "@/lib/orders/split";
import type { CartDemandSlice } from "@/types/db";

function slice(overrides: Partial<CartDemandSlice> & { qty: number }): CartDemandSlice {
  return {
    project_id: "project-1",
    bom_id: "bom-1",
    bom_line_id: "line-1",
    ...overrides,
  };
}

describe("lib/orders/split — splitQtyAcrossDemand", () => {
  test("client's canonical case: demand 400+200, qty_to_order 100 → proportional 67/33 (largest-remainder, sums exactly to 100)", () => {
    const demand: CartDemandSlice[] = [
      slice({ project_id: "A", bom_id: "bomA", bom_line_id: "lineA", qty: 400 }),
      slice({ project_id: "B", bom_id: "bomB", bom_line_id: "lineB", qty: 200 }),
    ];
    const result = splitQtyAcrossDemand(demand, 100);
    expect(result).toHaveLength(2);
    const byProject = new Map(result.map((r) => [r.project_id, r.qty]));
    expect(byProject.get("A")).toBe(67);
    expect(byProject.get("B")).toBe(33);
    expect(result.reduce((sum, r) => sum + r.qty, 0)).toBe(100);
  });

  test("no demand breakdown (manual add) → a single traceability-less line for the full qty", () => {
    const result = splitQtyAcrossDemand([], 42);
    expect(result).toEqual([{ project_id: null, bom_id: null, bom_line_id: null, qty: 42 }]);
  });

  test("qty_to_order <= 0 → no lines at all", () => {
    expect(splitQtyAcrossDemand([slice({ qty: 100 })], 0)).toEqual([]);
    expect(splitQtyAcrossDemand([slice({ qty: 100 })], -5)).toEqual([]);
  });

  test("exact even divide needs no rounding", () => {
    const demand: CartDemandSlice[] = [
      slice({ project_id: "A", qty: 300 }),
      slice({ project_id: "B", qty: 300 }),
    ];
    const result = splitQtyAcrossDemand(demand, 200);
    const byProject = new Map(result.map((r) => [r.project_id, r.qty]));
    expect(byProject.get("A")).toBe(100);
    expect(byProject.get("B")).toBe(100);
  });

  test("a slice whose proportional share rounds to zero is dropped entirely (never a zero-qty order line)", () => {
    const demand: CartDemandSlice[] = [
      slice({ project_id: "big", qty: 1000 }),
      slice({ project_id: "tiny", qty: 1 }),
    ];
    const result = splitQtyAcrossDemand(demand, 1);
    expect(result).toEqual([{ project_id: "big", bom_id: "bom-1", bom_line_id: "line-1", qty: 1 }]);
  });

  test("zero total demand (all slices qty 0) falls back to a single untraceable line, same as no breakdown", () => {
    const demand: CartDemandSlice[] = [slice({ project_id: "A", qty: 0 })];
    const result = splitQtyAcrossDemand(demand, 10);
    expect(result).toEqual([{ project_id: null, bom_id: null, bom_line_id: null, qty: 10 }]);
  });

  test("three-way split still sums exactly to qty_to_order under rounding", () => {
    const demand: CartDemandSlice[] = [
      slice({ project_id: "A", qty: 100 }),
      slice({ project_id: "B", qty: 100 }),
      slice({ project_id: "C", qty: 100 }),
    ];
    const result = splitQtyAcrossDemand(demand, 10);
    expect(result.reduce((sum, r) => sum + r.qty, 0)).toBe(10);
  });
});
