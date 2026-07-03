import { describe, expect, test } from "bun:test";
import {
  buildActiveChips,
  buildFacetGroups,
  decodeFiltersFromSearchParams,
  displayLabelForFacetValue,
  encodeFiltersToSearchParams,
  filterInventoryParts,
  matchesFilters,
  matchesSearch,
  type InventoryFilters,
} from "@/lib/inventory/filter";
import type { InventoryPart } from "@/lib/inventory/types";
import type { PartAttributes, PartRow } from "@/types/db";

/**
 * lib/inventory/filter.ts — tab-inventory.md §2 search/facet/count semantics,
 * kept in lockstep with the approved prototype (SmarkStock-prototype/
 * SmarkStock.dc.html `filteredParts`/`facetCounts`). Covers plan/TESTING.md
 * §6 R2-33/34 (export golden rows depend on this; search relevance smoke).
 */

function makePart(overrides: Partial<InventoryPart> & { internal_pid: string }): InventoryPart {
  const base: PartRow = {
    id: overrides.internal_pid,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
    internal_pid: overrides.internal_pid,
    mpn: null,
    manufacturer: null,
    lcsc_pn: null,
    description: null,
    category: null,
    value: null,
    package: null,
    voltage: null,
    part_status: "active",
    datasheet_url: null,
    default_distributor: null,
    attributes: {} as PartAttributes,
    total_qty: 0,
    reorder_point: null,
    source_sheet: null,
    needs_review: false,
    last_unit_price: null,
    currency: "INR",
    created_by: null,
  };

  return {
    ...base,
    locations: [],
    stockState: "ok",
    distributorNames: [],
    projectNames: [],
    ...overrides,
  };
}

const CAP_100N = makePart({
  internal_pid: "SMK-000101",
  mpn: "GRM188R71H104KA93D",
  value: "100nF",
  voltage: "50V",
  package: "0603",
  category: "Capacitor",
  manufacturer: "Murata",
  lcsc_pn: "C1525",
  total_qty: 1200,
  reorder_point: 100,
  stockState: "ok",
  attributes: { dielectric: "X7R" } as PartAttributes,
  locations: [{ id: "l1", qty: 1200, boxName: "B-12", shelfCode: "B", lastCountedAt: null }],
  distributorNames: ["LCSC"],
  projectNames: ["TMCS_96x32"],
});

const RESISTOR_LOW = makePart({
  internal_pid: "SMK-000142",
  mpn: "RC0603FR-0710KL",
  value: "10k",
  package: "0603",
  category: "Resistor",
  total_qty: 40,
  reorder_point: 50,
  stockState: "low",
  locations: [{ id: "l2", qty: 40, boxName: "B-05", shelfCode: "B", lastCountedAt: null }],
  distributorNames: ["Digikey"],
  projectNames: ["GCU"],
});

const IC_OUT = makePart({
  internal_pid: "SMK-000188",
  mpn: "TMCS1123A2BQDR",
  package: "SOIC-8",
  category: "IC",
  part_status: "nrnd",
  total_qty: 0,
  reorder_point: 10,
  stockState: "out",
  locations: [],
  distributorNames: [],
  projectNames: [],
});

const ALL_PARTS = [CAP_100N, RESISTOR_LOW, IC_OUT];

describe("matchesSearch", () => {
  test("empty term matches everything", () => {
    expect(matchesSearch(CAP_100N, "")).toBe(true);
    expect(matchesSearch(CAP_100N, "   ")).toBe(true);
  });

  test("matches PID, MPN, value, package, category, manufacturer, LCSC — case-insensitively", () => {
    expect(matchesSearch(CAP_100N, "smk-000101")).toBe(true);
    expect(matchesSearch(CAP_100N, "grm188")).toBe(true);
    expect(matchesSearch(CAP_100N, "100nf")).toBe(true);
    expect(matchesSearch(CAP_100N, "0603")).toBe(true);
    expect(matchesSearch(CAP_100N, "capacitor")).toBe(true);
    expect(matchesSearch(CAP_100N, "murata")).toBe(true);
    expect(matchesSearch(CAP_100N, "c1525")).toBe(true);
  });

  test("does not match an unrelated term", () => {
    expect(matchesSearch(CAP_100N, "inductor")).toBe(false);
  });
});

describe("matchesFilters", () => {
  test("no filters => everything matches", () => {
    expect(matchesFilters(CAP_100N, {})).toBe(true);
  });

  test("ANDs across groups, ORs within a group", () => {
    const filters: InventoryFilters = { Category: ["Capacitor", "Resistor"], Package: ["0603"] };
    expect(matchesFilters(CAP_100N, filters)).toBe(true); // Capacitor + 0603
    expect(matchesFilters(RESISTOR_LOW, filters)).toBe(true); // Resistor + 0603
    expect(matchesFilters(IC_OUT, filters)).toBe(false); // wrong category+package
  });

  test("Stock group maps to the shared stock-state rule", () => {
    expect(matchesFilters(RESISTOR_LOW, { Stock: ["Low"] })).toBe(true);
    expect(matchesFilters(RESISTOR_LOW, { Stock: ["Out"] })).toBe(false);
    expect(matchesFilters(IC_OUT, { Stock: ["Out"] })).toBe(true);
  });

  test("Shelf filter matches any of a part's locations", () => {
    expect(matchesFilters(CAP_100N, { Shelf: ["B"] })).toBe(true);
    expect(matchesFilters(IC_OUT, { Shelf: ["B"] })).toBe(false); // no locations at all
  });
});

describe("filterInventoryParts", () => {
  test("combines search + filters", () => {
    const result = filterInventoryParts(ALL_PARTS, "0603", { Category: ["Resistor"] });
    expect(result.map((p) => p.internal_pid)).toEqual(["SMK-000142"]);
  });
});

describe("buildFacetGroups", () => {
  test("Stock/Status render every fixed value even at zero count", () => {
    const groups = buildFacetGroups(ALL_PARTS, "", {});
    const stock = groups.find((g) => g.name === "Stock")!;
    expect(stock.values.map((v) => v.value)).toEqual(["In stock", "Low", "Out"]);
    expect(stock.values.find((v) => v.value === "In stock")!.count).toBe(1);
    expect(stock.values.find((v) => v.value === "Low")!.count).toBe(1);
    expect(stock.values.find((v) => v.value === "Out")!.count).toBe(1);
  });

  test("counts are computed against the CURRENT filtered set (prototype semantics), including the group's own filter", () => {
    // Selecting Category=Capacitor narrows the filtered set to just CAP_100N;
    // every group's counts (including Category's own row) reflect that.
    const groups = buildFacetGroups(ALL_PARTS, "", { Category: ["Capacitor"] });
    const category = groups.find((g) => g.name === "Category")!;
    const capacitorRow = category.values.find((v) => v.value === "Capacitor")!;
    const resistorRow = category.values.find((v) => v.value === "Resistor")!;
    expect(capacitorRow.count).toBe(1);
    expect(resistorRow.count).toBe(0); // excluded by the active Capacitor filter
    expect(capacitorRow.selected).toBe(true);
  });

  test("drops a group entirely when the full dataset has no values for it", () => {
    const groups = buildFacetGroups([IC_OUT], "", {});
    expect(groups.find((g) => g.name === "Dielectric")).toBeUndefined();
    expect(groups.find((g) => g.name === "Shelf")).toBeUndefined();
  });
});

describe("buildActiveChips / displayLabelForFacetValue", () => {
  test("renders 'Group: Value' with Status enum values titlecased", () => {
    const chips = buildActiveChips({ Status: ["nrnd"], Category: ["Capacitor"] });
    expect(chips).toContainEqual({ group: "Status", value: "nrnd", label: "Status: NRND" });
    expect(chips).toContainEqual({ group: "Category", value: "Capacitor", label: "Category: Capacitor" });
  });

  test("non-Status groups pass the value through unchanged", () => {
    expect(displayLabelForFacetValue("Package", "0603")).toBe("0603");
    expect(displayLabelForFacetValue("Status", "eol")).toBe("EOL");
  });
});

describe("URL encode/decode round-trip", () => {
  test("encodes search + multi-value filters and decodes them back", () => {
    const filters: InventoryFilters = { Category: ["Capacitor", "Resistor"], Stock: ["Low"] };
    const params = encodeFiltersToSearchParams("100nf", filters);
    const decoded = decodeFiltersFromSearchParams(params);
    expect(decoded.search).toBe("100nf");
    expect(decoded.filters.Category).toEqual(["Capacitor", "Resistor"]);
    expect(decoded.filters.Stock).toEqual(["Low"]);
  });

  test("empty search is omitted from the query string", () => {
    const params = encodeFiltersToSearchParams("", {});
    expect(params.toString()).toBe("");
  });
});
