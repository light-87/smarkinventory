import { describe, expect, test } from "bun:test";
import { INVENTORY_EXPORT_HEADERS, inventoryPartToCsvRow, sanitizeForSpreadsheet, toCsv, toCsvValue } from "@/lib/inventory/csv";
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

/**
 * Finding #1 / #7 — CSV/formula (spreadsheet) injection (CWE-1236). A
 * free-text part field (MPN/manufacturer/value/package/datasheet URL, or a
 * box name) starting with `=`/`+`/`-`/`@` (or a leading tab/CR) must never
 * reach the exported CSV cell unescaped — Excel/Sheets can interpret it as a
 * formula on open. Mirrors tests/unit/expenses-csv.test.ts.
 */
describe("sanitizeForSpreadsheet — finding #1/#7 CSV/formula injection", () => {
  test.each([
    ["=SUM(A1:A9)", "'=SUM(A1:A9)"],
    ["+1+1", "'+1+1"],
    ["-cmd|' /C calc'!A0", "'-cmd|' /C calc'!A0"],
    ["@SUM(1+1)", "'@SUM(1+1)"],
    ["\tsneaky", "'\tsneaky"],
    ["\rsneaky", "'\rsneaky"],
  ])("prefixes a value starting with a dangerous character: %s", (input, expected) => {
    expect(sanitizeForSpreadsheet(input)).toBe(expected);
  });

  test("leaves an ordinary value untouched", () => {
    expect(sanitizeForSpreadsheet("Murata")).toBe("Murata");
    expect(sanitizeForSpreadsheet("")).toBe("");
  });
});

describe("toCsvValue — sanitizes a raw formula-like value before quoting", () => {
  test("a raw formula-like string value is prefixed before quoting", () => {
    expect(toCsvValue("=cmd")).toBe("'=cmd");
  });

  test("a formula-like value that also needs RFC 4180 quoting gets both", () => {
    expect(toCsvValue("=A1,B1")).toBe('"\'=A1,B1"');
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

  /**
   * Look cells up BY HEADER, not by index. These assertions used to hardcode
   * positions and every one of them broke when Description, Distributor,
   * Sub-category and Mount type were added on 2026-08-11 — a column list that
   * is meant to grow should not make its own tests fail.
   */
  const cell = (row: (string | number)[], header: (typeof INVENTORY_EXPORT_HEADERS)[number]) =>
    row[INVENTORY_EXPORT_HEADERS.indexOf(header)];

  test("matches the documented column order and computes stock value", () => {
    const row = inventoryPartToCsvRow(makePart());
    expect(row.length).toBe(INVENTORY_EXPORT_HEADERS.length);
    expect(cell(row, "PID")).toBe("SMK-000101");
    expect(cell(row, "MPN")).toBe("GRM188R71H104KA93D");
    expect(cell(row, "Manufacturer")).toBe("Murata");
    expect(cell(row, "LCSC PN")).toBe("C1525");
    expect(cell(row, "Category")).toBe("Capacitor");
    expect(cell(row, "Value")).toBe("100nF");
    expect(cell(row, "Voltage")).toBe("50V");
    expect(cell(row, "Package")).toBe("0603");
    expect(cell(row, "Qty")).toBe(1200);
    expect(cell(row, "Reorder point")).toBe(100);
    expect(cell(row, "Status")).toBe("active");
    expect(cell(row, "Location")).toBe("Shelf B · B-12 (1200)");
    expect(cell(row, "Last unit price (INR)")).toBe(2.5);
    expect(cell(row, "Stock value (INR)")).toBe(3000); // 1200 * 2.50
    expect(cell(row, "Datasheet URL")).toBe("https://example.com/ds.pdf");
  });

  test("carries the fields the client asked to see on screen", () => {
    // Description, Distributor and Sub-category are what he checks the export
    // against his own spreadsheets with; omitting them made it unusable for that.
    const row = inventoryPartToCsvRow(
      makePart({
        description: "0.1uF/100nF",
        default_distributor: "LCSC",
        attributes: { sub_category: "MLCC", mount_type: "SMD" } as never,
      }),
    );
    expect(cell(row, "Description")).toBe("0.1uF/100nF");
    expect(cell(row, "Distributor")).toBe("LCSC");
    expect(cell(row, "Sub-category")).toBe("MLCC");
    expect(cell(row, "Mount type")).toBe("SMD");
  });

  test("blanks the price/value columns for an unpriced part (R2-11 honesty rule)", () => {
    const row = inventoryPartToCsvRow(makePart({ last_unit_price: null }));
    expect(cell(row, "Last unit price (INR)")).toBe("");
    expect(cell(row, "Stock value (INR)")).toBe("");
  });

  test("renders '—' when the part has no physical location", () => {
    const row = inventoryPartToCsvRow(makePart({ locations: [] }));
    expect(cell(row, "Location")).toBe("—");
  });

  test("finding #1/#7 — free-text fields are sanitized at the row-array level (protects a future xlsx/aoa_to_sheet path)", () => {
    const row = inventoryPartToCsvRow(
      makePart({
        mpn: "=HYPERLINK(\"http://evil\")",
        manufacturer: "=cmd",
        category: "+1+1",
        value: "-100nF",
        package: "@SUM(1)",
        datasheet_url: "=B1",
        locations: [{ id: "l1", qty: 5, boxName: "=EVIL", shelfCode: "=A", lastCountedAt: null }],
      }),
    );
    expect(cell(row, "MPN")).toBe('\'=HYPERLINK("http://evil")');
    expect(cell(row, "Manufacturer")).toBe("'=cmd");
    expect(cell(row, "Category")).toBe("'+1+1");
    expect(cell(row, "Value")).toBe("'-100nF");
    expect(cell(row, "Package")).toBe("'@SUM(1)");
    expect(cell(row, "Datasheet URL")).toBe("'=B1");
    expect(cell(row, "Location")).toBe("Shelf '=A · '=EVIL (5)");
  });
});
