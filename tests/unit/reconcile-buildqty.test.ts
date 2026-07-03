import { describe, expect, test } from "bun:test";
import { reconcileLine, type ReconcileCatalogPart, type ReconcileLineInput } from "@/lib/bom/reconcile";
import { friendlyNameError, isUniqueViolation } from "@/lib/bom/service";

/**
 * ×N build-qty edge cases [R2-27] + the unique-per-project BOM name friendly
 * error (plan/TESTING.md "unit: … ×N, unique-name"). The DB-level guarantee
 * (`smark_boms_project_name_unique`) itself is an integration/RLS-suite
 * concern — this covers the pure mapping from a Postgres 23505 to the
 * friendly message `lib/bom/service.ts` surfaces.
 */

const PART: ReconcileCatalogPart = {
  id: "p1",
  mpn: "ABC123",
  lcsc_pn: null,
  value: null,
  package: null,
  voltage: null,
  part_status: "active",
  total_qty: 100,
};

const LINE: ReconcileLineInput = { id: "l1", qty: 10, value: null, footprint: null, mpn: "ABC123", lcsc_pn: null, dnp: false };

describe("build_qty ×N need math", () => {
  test("need is exactly qty × build_qty", () => {
    expect(reconcileLine(LINE, [PART], 1).need).toBe(10);
    expect(reconcileLine(LINE, [PART], 3).need).toBe(30);
    expect(reconcileLine(LINE, [PART], 10).need).toBe(100);
  });

  test("boundary: need exactly equal to stock is still in_stock (not to_order)", () => {
    expect(reconcileLine(LINE, [PART], 10).matchState).toBe("in_stock"); // need 100 == total_qty 100
  });

  test("boundary: need one unit over stock flips to to_order", () => {
    const line = { ...LINE, qty: 11 };
    expect(reconcileLine(line, [PART], 10).matchState).toBe("to_order"); // need 110 > 100
  });

  test("build_qty of 1 (the DB default) behaves as a no-op multiplier", () => {
    expect(reconcileLine(LINE, [PART], 1).need).toBe(10);
  });

  test("a null qty contributes zero need regardless of build_qty", () => {
    const line = { ...LINE, qty: null };
    expect(reconcileLine(line, [PART], 25).need).toBe(0);
  });
});

describe("unique-per-project BOM name — friendly error mapping", () => {
  test("recognizes a Postgres 23505 unique-violation error shape", () => {
    expect(isUniqueViolation({ code: "23505", message: 'duplicate key value violates unique constraint "smark_boms_project_name_unique"' })).toBe(
      true,
    );
  });

  test("does not misfire on an unrelated error", () => {
    expect(isUniqueViolation({ code: "23503", message: "foreign key violation" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(new Error("network error"))).toBe(false);
  });

  test("friendly message names the BOM", () => {
    expect(friendlyNameError("Mainboard v1.2")).toBe('A BOM named "Mainboard v1.2" already exists in this project.');
  });
});
