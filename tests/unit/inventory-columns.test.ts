import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseFormattedCsvFolder, type FormattedCsvPart } from "@/lib/import/formatted-csv";
import { minWidthFor, visibleColumns } from "@/lib/inventory/columns";
import { filterInventoryParts } from "@/lib/inventory/filter";
import { stockStateOf } from "@/lib/inventory/stock-state";
import type { InventoryPart } from "@/lib/inventory/types";

/**
 * Which columns the Inventory grid shows, against the client's real catalog.
 *
 * From his 2026-08-11 report, sent with `ic_smd.csv` open in Excel beside the
 * app: "'V' and 'Value' is not part of the source file (here for category -
 * IC). Instead other important values should be displayed here. So this header
 * needs to change as per the category selection."
 */

const FIXTURE_DIR = resolve(__dirname, "../fixtures/formatted-output");

function asInventoryPart(part: FormattedCsvPart, i: number): InventoryPart {
  const qty = part.qty ?? 0;
  return {
    id: `id-${i}`,
    internal_pid: `SMK-${String(i + 1).padStart(6, "0")}`,
    mpn: part.mpn,
    manufacturer: part.manufacturer,
    lcsc_pn: part.lcsc_pn,
    description: part.description,
    category: part.category,
    value: part.value,
    package: part.package,
    voltage: part.voltage,
    part_status: "active",
    datasheet_url: null,
    default_distributor: part.distributor,
    attributes: part.attributes,
    total_qty: qty,
    reorder_point: null,
    source_sheet: part.source_sheet,
    needs_review: true,
    last_unit_price: null,
    currency: "INR",
    created_by: null,
    created_at: "2026-08-11T00:00:00Z",
    updated_at: null,
    locations: [{ id: `loc-${i}`, qty, boxName: "U-IMPORT", shelfCode: "U", lastCountedAt: null }],
    stockState: stockStateOf(qty, null),
    distributorNames: [],
    projectNames: [],
  };
}

const catalog = parseFormattedCsvFolder(FIXTURE_DIR).parts.map(asInventoryPart);

/** The grid as it renders for a category: filter first, then pick columns. */
function labelsFor(categories: string[]): string[] {
  const rows = categories.length === 0 ? catalog : filterInventoryParts(catalog, "", { Category: categories });
  return visibleColumns(rows, categories).map((c) => c.label);
}

describe("the header follows the category", () => {
  test("IC drops Value and V, and shows what ic_smd.csv actually has", () => {
    const labels = labelsFor(["IC"]);

    // The complaint, verbatim: those two columns are not in the source file, so
    // every cell read "—".
    expect(labels).not.toContain("Value");
    expect(labels).not.toContain("V");

    // The columns his spreadsheet screenshot showed instead.
    expect(labels).toContain("Sub-category");
    expect(labels).toContain("Manufacturer");
    expect(labels).toContain("Package");
    expect(labels).toContain("Project");
  });

  test("Resistor shows resistance, tolerance and power", () => {
    const labels = labelsFor(["Resistor"]);
    expect(labels).toContain("Resistance");
    expect(labels).toContain("Tolerance");
    expect(labels).toContain("Power");
    expect(labels).toContain("Mount");
    expect(labels).not.toContain("V");
  });

  test("Capacitor keeps voltage, which resistors do not have", () => {
    const labels = labelsFor(["Capacitor"]);
    expect(labels).toContain("Capacitance");
    expect(labels).toContain("Voltage");
    expect(labels).not.toContain("Resistance");
  });

  test("the material list shows its price tiers, and nothing else does", () => {
    expect(labelsFor(["Hardware"])).toEqual(
      expect.arrayContaining(["Group", "CP ₹", "SP@100 ₹", "SP@25 ₹"]),
    );
    expect(labelsFor(["Resistor"])).not.toContain("CP ₹");
  });

  test("a mixed view falls back to the general-purpose header", () => {
    const labels = labelsFor([]);
    // Tolerance and Distributor joined this set on 2026-08-13 at the client's
    // request ("as much data as possible on the main screen"). They appear only
    // when some part in view actually carries one — `visibleColumns` drops a
    // column nothing populates — so a fixture without them stays short.
    expect(labels).toEqual([
      "PID",
      "MPN",
      "Description",
      "Value",
      "V",
      "Package",
      "Category",
      "Sub-category",
      "Tolerance",
      "Distributor",
      "Qty",
      "Location",
    ]);
  });

  test("two categories at once show the union of their columns", () => {
    const labels = labelsFor(["Resistor", "Capacitor"]);
    expect(labels).toContain("Resistance");
    expect(labels).toContain("Capacitance");
    expect(labels).toContain("Mount");
  });
});

describe("columns with no data in view are dropped", () => {
  test("a scoped column that the source never filled in does not render", () => {
    // Resistor networks carry no Tolerance_Percent at all (the client's
    // Filter_Specification says so, and the data agrees), so the column that is
    // right for resistors disappears when the view is only networks.
    expect(labelsFor(["Resistor"])).toContain("Tolerance");
    expect(labelsFor(["Resistor Network"])).not.toContain("Tolerance");
  });

  test("every rendered column has at least one non-empty cell", () => {
    for (const category of ["IC", "Capacitor", "Diode", "Inductor", "SMPS", "Hardware"]) {
      const rows = filterInventoryParts(catalog, "", { Category: [category] });
      for (const column of visibleColumns(rows, [category])) {
        if (column.scope === "always") continue;
        expect(rows.some((part) => column.value(part) !== null)).toBe(true);
      }
    }
  });

  test("identity and action columns survive even when empty", () => {
    // 401 parts have no MPN at all; the column still renders, because a blank
    // MPN is information and the row still has to be identifiable.
    const rows = filterInventoryParts(catalog, "", { Category: ["Resistor"] });
    expect(rows.every((p) => p.mpn === null)).toBe(false);
    for (const always of ["PID", "MPN", "Description", "Qty", "Location"]) {
      expect(labelsFor(["Resistor"])).toContain(always);
    }
  });
});

describe("layout", () => {
  test("the table's minimum width tracks the columns actually shown", () => {
    // Crystal has one spec column (Package); Capacitor has five. The table
    // should not reserve the same width for both.
    const widthFor = (category: string) => {
      const rows = filterInventoryParts(catalog, "", { Category: [category] });
      return minWidthFor(visibleColumns(rows, [category]));
    };
    expect(widthFor("Capacitor")).toBeGreaterThan(widthFor("Crystal"));
    expect(widthFor("Crystal")).toBeGreaterThan(600);
    expect(minWidthFor(visibleColumns(catalog, []))).toBeGreaterThan(800);
  });

  test("no category produces a header wide enough to be unusable", () => {
    for (const category of ["IC", "Resistor", "Capacitor", "Diode", "Hardware", "SMPS"]) {
      expect(labelsFor([category]).length).toBeLessThanOrEqual(12);
    }
  });
});
