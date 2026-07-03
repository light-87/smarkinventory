import { describe, expect, test } from "bun:test";
import { buildPartSpecs, computeStockValue } from "@/lib/part-events/specs";
import type { PartAttributes, PartRow } from "@/types/db";

/** lib/part-events/specs.ts — the Specifications grid + R2-11 Last price / Stock value rows. */

function makePart(overrides: Partial<PartRow> = {}): PartRow {
  return {
    id: "p1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
    internal_pid: "SMK-000101",
    mpn: "GRM188R71H104KA93D",
    manufacturer: "Murata",
    lcsc_pn: "C1525",
    description: null,
    category: "Capacitor",
    value: "100nF",
    package: "0603",
    voltage: "50V",
    part_status: "active",
    datasheet_url: null,
    default_distributor: null,
    attributes: {} as PartAttributes,
    total_qty: 1200,
    reorder_point: 100,
    source_sheet: null,
    needs_review: false,
    last_unit_price: 2.5,
    currency: "INR",
    created_by: null,
    ...overrides,
  };
}

describe("computeStockValue", () => {
  test("qty × last_unit_price when priced", () => {
    expect(computeStockValue(makePart({ total_qty: 1200, last_unit_price: 2.5 }))).toBe(3000);
  });

  test("null when never priced (R2-11 honesty rule — never guessed)", () => {
    expect(computeStockValue(makePart({ last_unit_price: null }))).toBeNull();
  });

  test("rounds to 2 decimal places", () => {
    expect(computeStockValue(makePart({ total_qty: 3, last_unit_price: 0.1 }))).toBeCloseTo(0.3, 2);
  });
});

describe("buildPartSpecs", () => {
  test("includes the typed facets, long-tail attributes, and price/value rows in order", () => {
    const specs = buildPartSpecs(
      makePart({ attributes: { dielectric: "X7R", tolerance: "10%" } as PartAttributes }),
    );
    const labels = specs.map((s) => s.label);
    expect(labels).toEqual([
      "Value",
      "Voltage",
      "Package",
      "Category",
      "Manufacturer",
      "LCSC PN",
      "Dielectric",
      "Tolerance",
      "Last price",
      "Stock value",
    ]);
    expect(specs.find((s) => s.label === "Value")!.value).toBe("100nF");
    expect(specs.find((s) => s.label === "Dielectric")!.value).toBe("X7R");
    expect(specs.find((s) => s.label === "Last price")!.value).toContain("2.50");
    expect(specs.find((s) => s.label === "Stock value")!.value).toContain("3,000.00");
  });

  test("skips null/empty fields entirely rather than showing a blank row", () => {
    const specs = buildPartSpecs(makePart({ voltage: null, manufacturer: null, lcsc_pn: "" }));
    const labels = specs.map((s) => s.label);
    expect(labels).not.toContain("Voltage");
    expect(labels).not.toContain("Manufacturer");
    expect(labels).not.toContain("LCSC PN");
  });

  test("an unpriced part gets honest fallback text, not a blank/zero", () => {
    const specs = buildPartSpecs(makePart({ last_unit_price: null }));
    expect(specs.find((s) => s.label === "Last price")!.value).toBe("Not yet priced");
    expect(specs.find((s) => s.label === "Stock value")!.value).toBe("— (unpriced)");
  });

  test("titlecases an unknown custom attribute key", () => {
    const specs = buildPartSpecs(makePart({ attributes: { pin_count: 8, wire_gauge: "22AWG" } as unknown as PartAttributes }));
    expect(specs.find((s) => s.label === "Pin count")!.value).toBe("8");
    expect(specs.find((s) => s.label === "Wire Gauge")!.value).toBe("22AWG");
  });
});
