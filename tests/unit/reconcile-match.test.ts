import { describe, expect, test } from "bun:test";
import { computeReconcileStats, reconcileLine, reconcileLines, type ReconcileCatalogPart, type ReconcileLineInput } from "@/lib/bom/reconcile";

/**
 * lib/bom/reconcile.ts — the ladder (MPN → LCSC PN → value+package fuzzy,
 * FEATURES.md §7) wired against real BOM-line shapes, and the ×N need math
 * [R2-27]. plan/TESTING.md "unit: reconcile matcher ladder, demand/shortfall
 * math (× build_qty)".
 */

const CATALOG: ReconcileCatalogPart[] = [
  { id: "part-mpn", mpn: "ABC123", lcsc_pn: null, value: null, package: null, voltage: null, part_status: "active", total_qty: 500 },
  { id: "part-lcsc", mpn: null, lcsc_pn: "C1000", value: null, package: null, voltage: null, part_status: "active", total_qty: 10 },
  { id: "part-fuzzy", mpn: null, lcsc_pn: null, value: "4.7k", package: "0603", voltage: null, part_status: "active", total_qty: 5 },
];

describe("reconcileLine", () => {
  test("MPN rung: matched with plenty of stock → in_stock", () => {
    const line: ReconcileLineInput = { id: "l1", qty: 2, value: null, footprint: null, mpn: "ABC123", lcsc_pn: null, dnp: false };
    const result = reconcileLine(line, CATALOG, 1);
    expect(result).toMatchObject({ matchedPartId: "part-mpn", matchState: "in_stock", matchMethod: "mpn", need: 2 });
  });

  test("LCSC rung: matched but insufficient stock → to_order", () => {
    const line: ReconcileLineInput = { id: "l2", qty: 20, value: null, footprint: null, mpn: null, lcsc_pn: "C1000", dnp: false };
    const result = reconcileLine(line, CATALOG, 1);
    expect(result).toMatchObject({ matchedPartId: "part-lcsc", matchState: "to_order", matchMethod: "lcsc", need: 20 });
  });

  test("value+package fuzzy rung: footprint-derived package matches the catalog's package facet", () => {
    const line: ReconcileLineInput = {
      id: "l3",
      qty: 3,
      value: "4.7k",
      footprint: "SMARKKicadLib:R0603",
      mpn: null,
      lcsc_pn: null,
      dnp: false,
    };
    const result = reconcileLine(line, CATALOG, 1);
    expect(result).toMatchObject({ matchedPartId: "part-fuzzy", matchState: "in_stock", matchMethod: "value_pkg" });
  });

  test("no identifiers at all → unresolved, need still computed", () => {
    const line: ReconcileLineInput = { id: "l4", qty: 7, value: null, footprint: null, mpn: null, lcsc_pn: null, dnp: false };
    const result = reconcileLine(line, CATALOG, 1);
    expect(result).toEqual({ id: "l4", matchedPartId: null, matchState: "unresolved", matchConfidence: null, matchMethod: null, need: 7 });
  });

  test("build_qty ×N multiplies need — a line that was in_stock at ×1 flips to to_order at ×10", () => {
    const line: ReconcileLineInput = { id: "l5", qty: 1, value: null, footprint: null, mpn: "ABC123", lcsc_pn: null, dnp: false };
    expect(reconcileLine(line, CATALOG, 1).matchState).toBe("in_stock"); // need 1, have 500
    expect(reconcileLine({ ...line, qty: 60 }, CATALOG, 10).matchState).toBe("to_order"); // need 600 > 500
  });

  test("DNP line with no match is still unresolved (dnp only overrides a matched line's state)", () => {
    const line: ReconcileLineInput = { id: "l6", qty: 999, value: null, footprint: null, mpn: null, lcsc_pn: null, dnp: true };
    const result = reconcileLine(line, CATALOG, 1);
    expect(result).toMatchObject({ matchState: "unresolved", need: 0 });
  });

  test("DNP line that DOES match is trivially in_stock — need is 0 regardless of qty×build_qty", () => {
    const line: ReconcileLineInput = { id: "l7", qty: 999, value: null, footprint: null, mpn: "ABC123", lcsc_pn: null, dnp: true };
    const result = reconcileLine(line, CATALOG, 50);
    expect(result).toMatchObject({ matchedPartId: "part-mpn", matchState: "in_stock", need: 0 });
  });

  test("package mismatch at the fuzzy rung never falls back — unresolved, however close the value", () => {
    const line: ReconcileLineInput = {
      id: "l8",
      qty: 1,
      value: "4.7k",
      footprint: "SMARKKicadLib:R0402",
      mpn: null,
      lcsc_pn: null,
      dnp: false,
    };
    expect(reconcileLine(line, CATALOG, 1).matchState).toBe("unresolved");
  });
});

describe("reconcileLines + computeReconcileStats", () => {
  test("stat trio combines to_order + unresolved into one 'to order' bucket", () => {
    const lines: ReconcileLineInput[] = [
      { id: "a", qty: 1, value: null, footprint: null, mpn: "ABC123", lcsc_pn: null, dnp: false }, // in_stock
      { id: "b", qty: 20, value: null, footprint: null, mpn: null, lcsc_pn: "C1000", dnp: false }, // to_order
      { id: "c", qty: 1, value: null, footprint: null, mpn: null, lcsc_pn: null, dnp: false }, // unresolved
    ];
    const outcomes = reconcileLines(lines, CATALOG, 1);
    expect(computeReconcileStats(outcomes)).toEqual({ lines: 3, inStock: 1, toOrder: 2 });
  });
});
