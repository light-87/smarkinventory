import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseFormattedCsvFolder, type FormattedCsvPart } from "@/lib/import/formatted-csv";
import {
  buildActiveChips,
  buildFacetGroups,
  decodeFiltersFromSearchParams,
  encodeFiltersToSearchParams,
  encodeRange,
  filterInventoryParts,
  matchesSearch,
  type InventoryFilters,
} from "@/lib/inventory/filter";
import { stockStateOf } from "@/lib/inventory/stock-state";
import type { InventoryPart } from "@/lib/inventory/types";

/**
 * Per-category filters, checked against the client's real catalog.
 *
 * The design comes from their `Filter_Specification.md` (shipped in the fixture
 * folder alongside the CSVs); `lib/inventory/facet-registry.ts` is that spec as
 * data. Every count below was measured from the actual files rather than
 * reasoned about, because the whole point of the spec is that it was written by
 * inspecting real distinct-value counts — a filter that looks right on a toy
 * fixture is exactly what shipped a sidebar full of dead options last time.
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
    created_at: "2026-08-10T00:00:00Z",
    updated_at: null,
    locations: [{ id: `loc-${i}`, qty, boxName: "U-IMPORT", shelfCode: "U", lastCountedAt: null }],
    stockState: stockStateOf(qty, null),
    distributorNames: [],
    projectNames: [],
  };
}

const catalog = parseFormattedCsvFolder(FIXTURE_DIR).parts.map(asInventoryPart);

const groupsFor = (filters: InventoryFilters) => buildFacetGroups(catalog, "", filters);
const groupNames = (filters: InventoryFilters) => groupsFor(filters).map((g) => g.name);
const findGroup = (filters: InventoryFilters, name: string) => groupsFor(filters).find((g) => g.name === name);
const countMatching = (filters: InventoryFilters) => filterInventoryParts(catalog, "", filters).length;

describe("category-scoped facets appear only for their categories", () => {
  test("engineering ranges stay hidden until you pick the part family", () => {
    // Resistance means nothing while you are looking at the whole catalog, or
    // at ICs. This is the difference between "detailed per-category filters"
    // and a sidebar that lists every column in the dataset at once.
    const unfiltered = groupNames({});
    expect(unfiltered).not.toContain("Resistance");
    expect(unfiltered).not.toContain("Capacitance");
    expect(unfiltered).not.toContain("Inductance");

    expect(groupNames({ Category: ["Resistor"] })).toContain("Resistance");
    expect(groupNames({ Category: ["Capacitor"] })).toContain("Capacitance");
    expect(groupNames({ Category: ["Inductor"] })).toContain("Inductance");

    expect(groupNames({ Category: ["IC"] })).not.toContain("Resistance");
  });

  test("picking two families surfaces the union of their filters", () => {
    const names = groupNames({ Category: ["Resistor", "Capacitor"] });
    expect(names).toContain("Resistance");
    expect(names).toContain("Capacitance");
    expect(names).toContain("Tolerance");
  });

  test("global filters are always available", () => {
    for (const name of ["Category", "Stock", "Sub-category", "Package", "Distributor", "Qty"]) {
      expect(groupNames({})).toContain(name);
    }
  });

  test("the category's own filters sit directly under Category, above the global ones", () => {
    // Registry order alone left Capacitance eleventh in the sidebar, under eight
    // global groups — picking Capacitor buried the filter you picked it for
    // below a scroll, which is the opposite of what per-category filtering is
    // for. Caught by looking at the real page, not by any assertion.
    const names = groupNames({ Category: ["Capacitor"] });
    expect(names[0]).toBe("Category");
    expect(names.indexOf("Capacitance")).toBeLessThan(names.indexOf("Package"));
    expect(names.indexOf("CaseSize")).toBeLessThan(names.indexOf("Distributor"));
  });

  test("resistor filters rank the same way", () => {
    const names = groupNames({ Category: ["Resistor"] });
    for (const scoped of ["Resistance", "Tolerance", "Power"]) {
      expect(names.indexOf(scoped)).toBeLessThan(names.indexOf("Package"));
    }
  });

  test("an applied filter never disappears when the category narrows away", () => {
    // Otherwise a filter still in force becomes invisible and unremovable.
    const filters: InventoryFilters = {
      Category: ["IC"],
      Resistance: [encodeRange({ min: "1", max: "10", unitId: "kohm" })],
    };
    expect(groupNames(filters)).toContain("Resistance");
  });
});

describe("range filters use the spec's unit maths", () => {
  test("resistance in kΩ matches the base-unit Ohms column", () => {
    // 252 of the 450 resistors carry a parsed Resistance_Ohms; 55 sit in 1k–10k.
    expect(findGroup({ Category: ["Resistor"] }, "Resistance")?.rangeCount).toBe(252);

    const inRange = countMatching({
      Category: ["Resistor"],
      Resistance: [encodeRange({ min: "1", max: "10", unitId: "kohm" })],
    });
    expect(inRange).toBe(55);
  });

  test("the same bounds in Ω instead of kΩ mean something different", () => {
    const asOhms = countMatching({
      Category: ["Resistor"],
      Resistance: [encodeRange({ min: "1", max: "10", unitId: "ohm" })],
    });
    const asKilohms = countMatching({
      Category: ["Resistor"],
      Resistance: [encodeRange({ min: "1", max: "10", unitId: "kohm" })],
    });
    expect(asOhms).not.toBe(asKilohms);
  });

  test("100 nF finds the parts stored as 1e-7 F", () => {
    // Import_Guide §2: "0.0000001 is unreadable" — the user types 100 nF.
    //
    // Regression: `100 * 1e-9` is 1.0000000000000001e-7 in IEEE 754, strictly
    // greater than the 1e-7 the importer parsed, so an exact comparison
    // returned ZERO parts for the single most likely search in the catalog.
    const exact = countMatching({
      Category: ["Capacitor"],
      Capacitance: [encodeRange({ min: "100", max: "100", unitId: "nF" })],
    });
    expect(exact).toBe(3);
  });

  test("every stored capacitance is findable by its own displayed value", () => {
    // The float-drift bug above is not specific to 100 nF, so this sweeps the
    // whole column: for each distinct capacitance, searching that exact value
    // in a sensible unit must return at least the parts holding it.
    const units = [
      { id: "pF", factor: 1e-12 },
      { id: "nF", factor: 1e-9 },
      { id: "uF", factor: 1e-6 },
    ];
    const capacitors = catalog.filter((p) => p.category === "Capacitor");
    const values = new Set(
      capacitors.map((p) => p.attributes.capacitance_farads).filter((v): v is number => typeof v === "number"),
    );

    for (const farads of values) {
      const unit = units.find((u) => farads / u.factor >= 1 && farads / u.factor < 1000) ?? units[2]!;
      const typed = String(farads / unit.factor);
      const hits = countMatching({
        Category: ["Capacitor"],
        Capacitance: [encodeRange({ min: typed, max: typed, unitId: unit.id })],
      });
      expect(hits).toBeGreaterThan(0);
    }
  });

  test("an open-ended bound filters on one side only", () => {
    const atLeast1k = countMatching({
      Category: ["Resistor"],
      Resistance: [encodeRange({ min: "1", max: "", unitId: "kohm" })],
    });
    const upTo1k = countMatching({
      Category: ["Resistor"],
      Resistance: [encodeRange({ min: "", max: "1", unitId: "kohm" })],
    });
    // Every resistor carrying a value falls on one side or the other, and the
    // two overlap only on the parts sitting exactly at 1 kΩ.
    expect(atLeast1k).toBeGreaterThan(0);
    expect(upTo1k).toBeGreaterThan(0);
    expect(atLeast1k + upTo1k).toBeGreaterThanOrEqual(252);
  });

  test("parts with no value for the column are excluded, not passed through", () => {
    // 198 of the 450 resistors have no parsed resistance. Letting them satisfy
    // a bound would overstate the catalog to whoever is sourcing a part.
    const all = countMatching({ Category: ["Resistor"] });
    const bounded = countMatching({
      Category: ["Resistor"],
      Resistance: [encodeRange({ min: "0", max: "999999999", unitId: "ohm" })],
    });
    expect(all).toBe(450);
    expect(bounded).toBe(252);
  });

  test("quantity is a plain range with no unit dropdown", () => {
    const qty = findGroup({}, "Qty");
    expect(qty?.kind).toBe("range");
    expect(qty?.units).toBeUndefined();

    const outOfStock = countMatching({ Qty: [encodeRange({ min: "", max: "0", unitId: "" })] });
    expect(outOfStock).toBe(catalog.filter((p) => p.total_qty === 0).length);
  });

  test("a blank range is inert rather than matching nothing", () => {
    expect(countMatching({ Resistance: [encodeRange({ min: "", max: "", unitId: "kohm" })] })).toBe(catalog.length);
  });
});

describe("the spec's per-category value filters", () => {
  test("Sub-category is the headline IC filter, with all 38 kinds", () => {
    const sub = findGroup({ Category: ["IC"] }, "Sub-category");
    expect(sub?.values).toHaveLength(38);
    expect(sub!.values.map((v) => v.value)).toContain("MOSFET");
    expect(sub!.values.map((v) => v.value)).toContain("EEPROM");
  });

  test("Tolerance offers the five fixed classes on resistors", () => {
    const tolerance = findGroup({ Category: ["Resistor"] }, "Tolerance");
    expect(tolerance?.values.map((v) => v.value).sort()).toEqual(["±0.5%", "±1%", "±10%", "±5%", "±50%"]);
  });

  test("Tolerance is absent for capacitors, where the source never fills it", () => {
    // Spec §2: "always blank on every row — don't offer this filter for
    // capacitors at all; showing an always-empty filter is worse than none."
    // No blocklist implements this; the column simply has nothing to show.
    expect(groupNames({ Category: ["Capacitor"] })).not.toContain("Tolerance");
  });

  test("Mount type separates SMD from through-hole", () => {
    const mount = findGroup({ Category: ["Resistor"] }, "Mount");
    expect(mount?.values.map((v) => v.value).sort()).toEqual(["SMD", "TH"]);

    const th = countMatching({ Category: ["Resistor"], Mount: ["TH"] });
    const smd = countMatching({ Category: ["Resistor"], Mount: ["SMD"] });
    expect(th + smd).toBe(450);
  });

  test("Group is the primary filter on the material list", () => {
    const group = findGroup({ Category: ["Hardware"] }, "Group");
    expect(group?.values).toHaveLength(6);
  });

  test("price ranges only offer themselves on the material list", () => {
    expect(groupNames({ Category: ["Hardware"] })).toContain("CostPrice");
    expect(groupNames({ Category: ["Resistor"] })).not.toContain("CostPrice");
    expect(findGroup({ Category: ["Hardware"] }, "CostPrice")?.rangeCount).toBe(11);
  });

  test("Diode type and Rating are scoped to the categories that carry them", () => {
    expect(groupNames({ Category: ["Diode"] })).toContain("DiodeType");
    expect(groupNames({ Category: ["IC"] })).not.toContain("DiodeType");
    expect(findGroup({ Category: ["Diode"] }, "Rating")?.values.length).toBeGreaterThan(0);
  });
});

describe("search reaches the columns the spec marks text-only", () => {
  test("a diode's compound Rating is searchable even though it has no filter", () => {
    // Spec: Rating is "text search only (not range)" — "1A/40V" mixes current
    // and voltage in one cell. The global box is where that gets reached.
    const diode = catalog.find((p) => p.category === "Diode" && p.attributes.rating === "75V 300mA");
    expect(diode).toBeDefined();
    expect(matchesSearch(diode!, "75V 300mA")).toBe(true);
  });

  test("provenance keys are not searchable", () => {
    // Every part carries source_file/source_row; matching on them would mean
    // typing a digit returns parts whose row number happens to contain it.
    const part = catalog.find((p) => p.attributes.source_file === "resistors.csv");
    expect(part).toBeDefined();
    expect(matchesSearch(part!, "resistors.csv")).toBe(false);
  });
});

describe("ranges survive the URL round trip", () => {
  test("an encoded range decodes back to the same filter and the same rows", () => {
    const filters: InventoryFilters = {
      Category: ["Resistor"],
      Resistance: [encodeRange({ min: "4.7", max: "10", unitId: "kohm" })],
    };
    const params = encodeFiltersToSearchParams("", filters);
    const decoded = decodeFiltersFromSearchParams(new URLSearchParams(params.toString()));

    expect(decoded.filters).toEqual(filters);
    expect(countMatching(decoded.filters)).toBe(countMatching(filters));
  });

  test("the chip reads in the unit the user typed, not base units", () => {
    const chips = buildActiveChips({
      Capacitance: [encodeRange({ min: "1", max: "100", unitId: "nF" })],
      Resistance: [encodeRange({ min: "4.7", max: "", unitId: "kohm" })],
    });
    expect(chips.map((c) => c.label)).toEqual(["Resistance: ≥ 4.7 kΩ", "Capacitance: 1 – 100 nF"]);
  });
});
