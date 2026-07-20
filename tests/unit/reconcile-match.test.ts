import { describe, expect, test } from "bun:test";
import { computeReconcileStats, reconcileLine, reconcileLines, type ReconcileCatalogPart, type ReconcileLineInput } from "@/lib/bom/reconcile";

/**
 * lib/bom/reconcile.ts — EXACT-identity matching only (MPN → LCSC PN) plus
 * the ×N need math [R2-27]. The fuzzy value+package rung is deliberately NOT
 * used for BOM reconcile (manual-test finding F-002: a fuzzy hit pins a BOM
 * line to a similar-but-wrong catalog part and shows a wrong location in the
 * Status column — AI sourcing reads unmatched lines as-is instead). The
 * fuzzy rung itself is still covered by tests/unit/matcher.test.ts and
 * tests/invariants/package-mandatory.test.ts for its remaining consumers.
 */

const CATALOG: ReconcileCatalogPart[] = [
  { id: "part-mpn", mpn: "ABC123", lcsc_pn: null, value: null, package: null, voltage: null, part_status: "active", total_qty: 500 },
  { id: "part-lcsc", mpn: null, lcsc_pn: "C1000", value: null, package: null, voltage: null, part_status: "active", total_qty: 10 },
  // A perfect would-be fuzzy candidate — must NEVER be matched by reconcile.
  { id: "part-fuzzy", mpn: null, lcsc_pn: null, value: "4.7k", package: "0603", voltage: null, part_status: "active", total_qty: 5 },
];

describe("reconcileLine", () => {
  test("MPN rung: matched with plenty of stock → in_stock", () => {
    const line: ReconcileLineInput = { id: "l1", qty: 2, mpn: "ABC123", lcsc_pn: null, dnp: false };
    const result = reconcileLine(line, CATALOG, 1);
    expect(result).toMatchObject({ matchedPartId: "part-mpn", matchState: "in_stock", matchMethod: "mpn", need: 2 });
  });

  test("LCSC rung: matched but insufficient stock → to_order", () => {
    const line: ReconcileLineInput = { id: "l2", qty: 20, mpn: null, lcsc_pn: "C1000", dnp: false };
    const result = reconcileLine(line, CATALOG, 1);
    expect(result).toMatchObject({ matchedPartId: "part-lcsc", matchState: "to_order", matchMethod: "lcsc", need: 20 });
  });

  test("no exact identity → unresolved, even when a perfect fuzzy candidate exists in the catalog", () => {
    // Pre-F-002 this line fuzzy-matched part-fuzzy via value "4.7k" + footprint-derived package 0603.
    const line: ReconcileLineInput = { id: "l3", qty: 3, mpn: null, lcsc_pn: null, dnp: false };
    const result = reconcileLine(line, CATALOG, 1);
    expect(result).toMatchObject({ matchedPartId: null, matchState: "unresolved", matchMethod: null });
  });

  test("an MPN unknown to the catalog stays unresolved — no fallback guessing", () => {
    const line: ReconcileLineInput = { id: "l4", qty: 1, mpn: "NOT-IN-CATALOG-999", lcsc_pn: null, dnp: false };
    expect(reconcileLine(line, CATALOG, 1).matchState).toBe("unresolved");
  });

  test("no identifiers at all → unresolved, need still computed", () => {
    const line: ReconcileLineInput = { id: "l5", qty: 7, mpn: null, lcsc_pn: null, dnp: false };
    const result = reconcileLine(line, CATALOG, 1);
    expect(result).toEqual({ id: "l5", matchedPartId: null, matchState: "unresolved", matchConfidence: null, matchMethod: null, need: 7 });
  });

  test("build_qty ×N multiplies need — a line that was in_stock at ×1 flips to to_order at ×10", () => {
    const line: ReconcileLineInput = { id: "l6", qty: 1, mpn: "ABC123", lcsc_pn: null, dnp: false };
    expect(reconcileLine(line, CATALOG, 1).matchState).toBe("in_stock"); // need 1, have 500
    expect(reconcileLine({ ...line, qty: 60 }, CATALOG, 10).matchState).toBe("to_order"); // need 600 > 500
  });

  test("DNP line with no match is still unresolved (dnp only overrides a matched line's state)", () => {
    const line: ReconcileLineInput = { id: "l7", qty: 999, mpn: null, lcsc_pn: null, dnp: true };
    const result = reconcileLine(line, CATALOG, 1);
    expect(result).toMatchObject({ matchState: "unresolved", need: 0 });
  });

  test("DNP line that DOES match is trivially in_stock — need is 0 regardless of qty×build_qty", () => {
    const line: ReconcileLineInput = { id: "l8", qty: 999, mpn: "ABC123", lcsc_pn: null, dnp: true };
    const result = reconcileLine(line, CATALOG, 50);
    expect(result).toMatchObject({ matchedPartId: "part-mpn", matchState: "in_stock", need: 0 });
  });
});

describe("reconcileLines + computeReconcileStats", () => {
  test("stat trio combines to_order + unresolved into one 'to order' bucket", () => {
    const lines: ReconcileLineInput[] = [
      { id: "a", qty: 1, mpn: "ABC123", lcsc_pn: null, dnp: false }, // in_stock
      { id: "b", qty: 20, mpn: null, lcsc_pn: "C1000", dnp: false }, // to_order
      { id: "c", qty: 1, mpn: null, lcsc_pn: null, dnp: false }, // unresolved
    ];
    const outcomes = reconcileLines(lines, CATALOG, 1);
    expect(computeReconcileStats(outcomes)).toEqual({ lines: 3, inStock: 1, toOrder: 2 });
  });

  test("nets stock across sibling lines matched to the same part (P6)", () => {
    // part-mpn has total_qty 500; three lines all matched to it.
    const lines: ReconcileLineInput[] = [
      { id: "s1", qty: 300, mpn: "ABC123", lcsc_pn: null, dnp: false }, // 500 ≥ 300 → in_stock, 200 left
      { id: "s2", qty: 300, mpn: "ABC123", lcsc_pn: null, dnp: false }, // 200 < 300 → to_order (reserves nothing)
      { id: "s3", qty: 150, mpn: "ABC123", lcsc_pn: null, dnp: false }, // 200 ≥ 150 → in_stock, 50 left
    ];
    const outcomes = reconcileLines(lines, CATALOG, 1);
    expect(outcomes.map((o) => o.matchState)).toEqual(["in_stock", "to_order", "in_stock"]);
    // The bug this fixes: the stateless per-line primitive would call the 2nd line
    // in_stock too (300 ≤ 500), silently dropping a real shortfall from sourcing.
    expect(reconcileLine(lines[1]!, CATALOG, 1).matchState).toBe("in_stock");
  });
});
