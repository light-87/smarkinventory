import { describe, expect, test } from "bun:test";
import { INVENTORY_EXPORT_HEADERS, inventoryPartToCsvRow, toCsv, toCsvValue } from "@/lib/inventory/csv";
import type { InventoryPart } from "@/lib/inventory/types";
import type { PartAttributes, PartRow } from "@/types/db";

/** lib/inventory/csv.ts — R2-33 hand-rolled CSV export (RFC 4180 quoting, no library). */

describe("toCsvValue", () => {
  test("passes plain values through untouched", () => {
    expect(toCsvValue("SMK-000101")).toBe("SMK-000101");
    expect(toCsvValue(1200)).toBe("1200");
  });

  test("null/undefined render as an empty field", () => {
    expect(toCsvValue(null)).toBe("");
    expect(toCsvValue(undefined)).toBe("");
  });

  test("quotes a field containing a comma, doubling no quotes", () => {
    expect(toCsvValue("Shelf B, Box B-12")).toBe('"Shelf B, Box B-12"');
  });

  test("quotes and doubles embedded quotes", () => {
    expect(toCsvValue('12" reel')).toBe('"12"" reel"');
  });

  test("quotes a field containing a line break", () => {
    expect(toCsvValue("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("toCsv", () => {
  test("joins cells with commas and rows with CRLF", () => {
    const csv = toCsv([
      ["PID", "Qty"],
      ["SMK-000101", 1200],
    ]);
    expect(csv).toBe("PID,Qty\r\nSMK-000101,1200");
  });
});

describe("inventoryPartToCsvRow", () => {
  function makePart(overrides: Partial<InventoryPart> = {}): InventoryPart {
    const base: PartRow = {
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
      datasheet_url: "https://example.com/ds.pdf",
      default_distributor: null,
      attributes: {} as PartAttributes,
      total_qty: 1200,
      reorder_point: 100,
      source_sheet: null,
      needs_review: false,
      last_unit_price: 2.5,
      currency: "INR",
      created_by: null,
    };
    return {
      ...base,
      locations: [{ id: "l1", qty: 1200, boxName: "B-12", shelfCode: "B", lastCountedAt: null }],
      stockState: "ok",
      distributorNames: [],
      projectNames: [],
      ...overrides,
    };
  }

  test("matches the documented column order and computes stock value", () => {
    const row = inventoryPartToCsvRow(makePart());
    expect(row).toEqual([
      "SMK-000101",
      "GRM188R71H104KA93D",
      "Murata",
      "C1525",
      "Capacitor",
      "100nF",
      "50V",
      "0603",
      1200,
      100,
      "active",
      "Shelf B · B-12 (1200)",
      2.5,
      3000, // 1200 * 2.50
      "https://example.com/ds.pdf",
    ]);
    expect(row.length).toBe(INVENTORY_EXPORT_HEADERS.length);
  });

  test("blanks the price/value columns for an unpriced part (R2-11 honesty rule)", () => {
    const row = inventoryPartToCsvRow(makePart({ last_unit_price: null }));
    expect(row[12]).toBe("");
    expect(row[13]).toBe("");
  });

  test("renders '—' when the part has no physical location", () => {
    const row = inventoryPartToCsvRow(makePart({ locations: [] }));
    expect(row[11]).toBe("—");
  });
});
