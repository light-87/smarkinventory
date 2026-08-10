import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseFormattedCsvFolder, type FormattedCsvPart } from "@/lib/import/formatted-csv";
import { buildFacetGroups, filterInventoryParts, matchesSearch } from "@/lib/inventory/filter";
import { stockStateOf } from "@/lib/inventory/stock-state";
import type { InventoryPart } from "@/lib/inventory/types";

/**
 * The Inventory surface driven by the REAL imported catalog.
 *
 * `lib/inventory/query.ts` loads the catalog and `lib/inventory/filter.ts`
 * turns it into the table + facet sidebar. The loader's own failure mode
 * (PostgREST truncating at 1000 rows) is verified against a live database; this
 * file covers the half that is pure logic, using the client's actual 1,999-part
 * drop rather than a toy fixture — because the interesting properties here only
 * appear at real scale and with real messiness (880 parts with no MPN, 27
 * distinct distributor spellings, 28 categories).
 */

const FIXTURE_DIR = resolve(__dirname, "../fixtures/formatted-output");

/** Mirrors what lib/inventory/query.ts hands the filter layer after an import. */
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
    created_at: "2026-08-10T00:00:00Z",
    updated_at: null,
    // Freshly imported: nothing ordered or picked through the app yet, and
    // every part sits in the one staging box.
    locations: [{ id: `loc-${i}`, qty, boxName: "U-IMPORT", shelfCode: "U", lastCountedAt: null }],
    stockState: stockStateOf(qty, null),
    distributorNames: [],
    projectNames: [],
  };
}

const catalog = parseFormattedCsvFolder(FIXTURE_DIR).parts.map(asInventoryPart);

describe("Inventory facets over the real catalog", () => {
  const groups = buildFacetGroups(catalog, "", {});
  const group = (name: string) => groups.find((g) => g.name === name);

  test("Category offers all 28 imported categories, and the counts add up", () => {
    const category = group("Category");
    expect(category?.values).toHaveLength(28);
    expect(category!.values.reduce((sum, v) => sum + v.count, 0)).toBe(1999);

    const resistor = category!.values.find((v) => v.value === "Resistor");
    expect(resistor?.count).toBe(450);
  });

  test("Distributor is populated from the part's own distributor, not order history", () => {
    // This is the regression the facet change exists for: `distributorNames`
    // is empty for every imported part (nothing has been ordered through the
    // app), so before the fix this whole group was absent from the sidebar.
    const distributor = group("Distributor");
    expect(distributor).toBeDefined();

    const values = Object.fromEntries(distributor!.values.map((v) => [v.value, v.count]));
    expect(values.LCSC).toBe(879);
    expect(values.Element14).toBe(158);
    expect(values.Mouser).toBe(85);
    expect(values.Digikey).toBe(59);
  });

  test("Stock reads honestly — 1,855 in stock, the rest genuinely out", () => {
    const stock = Object.fromEntries(group("Stock")!.values.map((v) => [v.value, v.count]));
    expect(stock["In stock"]).toBe(1855);
    expect(stock.Out).toBe(1999 - 1855);
  });

  test("Shelf shows the staging box every imported part starts in", () => {
    const shelf = group("Shelf");
    expect(shelf!.values).toEqual([{ value: "U", count: 1999, selected: false }]);
  });

  test("Package facet is built from the data, keeping leading zeros intact", () => {
    const packages = group("Package")!.values.map((v) => v.value);
    // If a spreadsheet parser had touched these, "0402 (1005 Metric)" would be
    // long gone. Guards the same property the CSV reader tests cover, but at
    // the surface the client actually sees.
    expect(packages).toContain("0402 (1005 Metric)");
    expect(packages).toContain("0603 (1608 Metric)");
  });
});

describe("Inventory search over the real catalog", () => {
  test("finds parts by description — the only handle most passives have", () => {
    // 880 rows have no MPN at all, so without description in SEARCH_FIELDS
    // these are unreachable by search.
    const fuse = catalog.find((p) => p.description === "RS485 Fuse 0.14A");
    expect(fuse).toBeDefined();
    expect(matchesSearch(fuse!, "rs485 fuse")).toBe(true);

    expect(filterInventoryParts(catalog, "Microcontroller", {}).length).toBeGreaterThan(0);
  });

  test("still finds parts by LCSC number, MPN and value", () => {
    expect(filterInventoryParts(catalog, "C105882", {})).toHaveLength(1);
    expect(filterInventoryParts(catalog, "1N4007", {}).length).toBeGreaterThan(0);
    expect(filterInventoryParts(catalog, "100 nF", {}).length).toBeGreaterThan(0);
  });

  test("search and facets compose", () => {
    const smdCaps = filterInventoryParts(catalog, "nF", { Category: ["Capacitor"] });
    expect(smdCaps.length).toBeGreaterThan(0);
    expect(smdCaps.every((p) => p.category === "Capacitor")).toBe(true);
  });
});
