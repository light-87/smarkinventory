import { describe, expect, test } from "bun:test";
import {
  buildResolvedLines,
  computePickQty,
  derivePackageFromFootprint,
  matchAgainstCatalog,
  resolveTakeoutLines,
  type TakeoutCatalogPart,
  type TakeoutLocationRow,
} from "@/lib/takeout/resolve";
import type { TakeoutRawLine } from "@/lib/takeout/types";

/**
 * lib/takeout/resolve.ts — pure matching + ×N pick-quantity math
 * (plan/tab-bulk-pick.md · FEATURES.md §5.6/§7). Catalog fixture values are
 * lifted from tests/fixtures/canonical-seed-data.ts (SMK-000101 family) so
 * this exercises the SAME real identities the e2e suite/demo seed use.
 */

function rawLine(overrides: Partial<TakeoutRawLine> = {}): TakeoutRawLine {
  return {
    lineNo: 1,
    references: "C1",
    qty: 2,
    value: null,
    footprint: null,
    dnp: false,
    description: null,
    mpn: null,
    manufacturer: null,
    lcscPn: null,
    ...overrides,
  };
}

const CATALOG: TakeoutCatalogPart[] = [
  {
    id: "part-101",
    internal_pid: "SMK-000101",
    mpn: "CL10B104MB8NNNC",
    lcsc_pn: "C14663",
    value: "0.1µF",
    package: "0603",
    voltage: null,
    part_status: "active",
    total_qty: 2968,
  },
  {
    id: "part-104",
    internal_pid: "SMK-000104",
    mpn: "C0603C472F5GACAUTO",
    lcsc_pn: null,
    value: "4.7nF",
    package: "0603",
    voltage: null,
    part_status: "active",
    total_qty: 0, // matched but out of stock everywhere — a "miss" for picking
  },
];

const LOCATIONS = new Map<string, TakeoutLocationRow[]>([
  [
    "part-101",
    [
      { id: "loc-b12", partId: "part-101", bigBoxId: "box-b12", qty: 2568, boxName: "Capacitors 0603", shelfCode: "B" },
      { id: "loc-b05", partId: "part-101", bigBoxId: "box-b05", qty: 400, boxName: "Capacitors (bulk)", shelfCode: "B" },
    ],
  ],
]);

describe("computePickQty [R2-27]", () => {
  test("multiplies raw qty by the build multiplier", () => {
    expect(computePickQty(2, 3)).toBe(6);
  });
  test("defaults a non-positive/non-integer multiplier to ×1", () => {
    expect(computePickQty(5, 0)).toBe(5);
    expect(computePickQty(5, -2)).toBe(5);
    expect(computePickQty(5, Number.NaN)).toBe(5);
  });
  test("floors a fractional multiplier", () => {
    expect(computePickQty(10, 2.9)).toBe(20);
  });
  test("null/undefined raw qty is treated as 0", () => {
    expect(computePickQty(null, 5)).toBe(0);
    expect(computePickQty(undefined, 5)).toBe(0);
  });
});

describe("derivePackageFromFootprint", () => {
  test("extracts a metric package code as a standalone token after the library prefix", () => {
    expect(derivePackageFromFootprint("Capacitor_SMD:C_0805_2012Metric")).toBe("0805");
  });
  test("extracts SOT-23 variants", () => {
    expect(derivePackageFromFootprint("Package_TO_SOT_SMD:SOT-23-6")).toBe("SOT-23-6");
  });
  test("does not false-positive on digits embedded in an unrelated token", () => {
    // "10x10" isn't a package token at all — must not be mistaken for one.
    expect(derivePackageFromFootprint("SMARKKicadLib:CAP_AE_10x10.5")).toBeNull();
  });
  test("returns null for no footprint at all", () => {
    expect(derivePackageFromFootprint(null)).toBeNull();
    expect(derivePackageFromFootprint(undefined)).toBeNull();
  });
});

describe("matchAgainstCatalog", () => {
  test("matches by MPN (rung 1)", () => {
    const [result] = matchAgainstCatalog([rawLine({ mpn: "CL10B104MB8NNNC" })], CATALOG);
    expect(result!.hit?.part.id).toBe("part-101");
    expect(result!.hit?.method).toBe("mpn");
  });

  test("matches by LCSC PN (rung 2) when MPN is absent", () => {
    const [result] = matchAgainstCatalog([rawLine({ lcscPn: "C14663" })], CATALOG);
    expect(result!.hit?.part.id).toBe("part-101");
    expect(result!.hit?.method).toBe("lcsc");
  });

  test("matches by value + footprint-derived package (rung 3) when no MPN/LCSC", () => {
    const [result] = matchAgainstCatalog(
      [rawLine({ value: "0.1uF", footprint: "Capacitor_SMD:C_0603_1608Metric" })],
      CATALOG,
    );
    expect(result!.hit?.part.id).toBe("part-101");
    expect(result!.hit?.method).toBe("value_pkg");
  });

  test("no hit for a line with nothing the ladder can key on", () => {
    const [result] = matchAgainstCatalog([rawLine({ value: "22nF", footprint: null })], CATALOG);
    expect(result!.hit).toBeNull();
  });

  test("drops DNP lines entirely — nothing to physically pick", () => {
    const results = matchAgainstCatalog([rawLine({ dnp: true, mpn: "CL10B104MB8NNNC" })], CATALOG);
    expect(results).toHaveLength(0);
  });

  test("drops zero/blank-qty lines entirely", () => {
    const results = matchAgainstCatalog([rawLine({ qty: 0 }), rawLine({ qty: null })], CATALOG);
    expect(results).toHaveLength(0);
  });
});

describe("buildResolvedLines", () => {
  test("in-stock line: picks the biggest-qty location and multiplies pick qty", () => {
    const matched = matchAgainstCatalog([rawLine({ lineNo: 7, references: "C10,C11", qty: 3, mpn: "CL10B104MB8NNNC" })], CATALOG);
    const [line] = buildResolvedLines(matched, 4, LOCATIONS);

    expect(line!.matchState).toBe("in_stock");
    expect(line!.pickQty).toBe(12); // 3 × 4
    expect(line!.matchedInternalPid).toBe("SMK-000101");
    expect(line!.location).toEqual({
      locationId: "loc-b12",
      bigBoxId: "box-b12",
      partId: "part-101",
      qty: 2568,
      label: "Shelf B · Capacitors 0603",
    });
  });

  test("matched but zero-stock everywhere renders as a miss (to_order), not in_stock", () => {
    const matched = matchAgainstCatalog([rawLine({ mpn: "C0603C472F5GACAUTO" })], CATALOG);
    const [line] = buildResolvedLines(matched, 1, new Map());

    expect(line!.matchState).toBe("to_order");
    expect(line!.location).toBeNull();
    // still surfaces the value even though it's a "miss", falling back to the matched part's value
    expect(line!.value).toBe("4.7nF");
  });

  test("unresolved line renders as a miss with no matched part", () => {
    const matched = matchAgainstCatalog([rawLine({ value: "22nF", footprint: null })], CATALOG);
    const [line] = buildResolvedLines(matched, 1, LOCATIONS);

    expect(line!.matchState).toBe("to_order");
    expect(line!.matchedPartId).toBeNull();
    expect(line!.location).toBeNull();
  });

  test("stable react key falls back to index when lineNo is null", () => {
    const matched = matchAgainstCatalog([rawLine({ lineNo: null, mpn: "CL10B104MB8NNNC" })], CATALOG);
    const [line] = buildResolvedLines(matched, 1, LOCATIONS);
    expect(line!.key).toBe("idx-0");
  });
});

describe("resolveTakeoutLines (composed)", () => {
  test("×N pick math end to end against a mixed BOM (hit / zero-stock miss / unresolved miss)", () => {
    const lines: TakeoutRawLine[] = [
      rawLine({ lineNo: 1, references: "C1,C2", qty: 5, mpn: "CL10B104MB8NNNC" }),
      rawLine({ lineNo: 2, references: "C3", qty: 1, mpn: "C0603C472F5GACAUTO" }),
      rawLine({ lineNo: 3, references: "C4", qty: 1, value: "22nF" }),
      rawLine({ lineNo: 4, references: "R1", qty: 2, dnp: true, mpn: "CL10B104MB8NNNC" }),
    ];

    const resolved = resolveTakeoutLines(lines, 10, CATALOG, LOCATIONS);

    // the DNP line never even reaches the table
    expect(resolved).toHaveLength(3);

    expect(resolved[0]).toMatchObject({ pickQty: 50, matchState: "in_stock" });
    expect(resolved[1]).toMatchObject({ pickQty: 10, matchState: "to_order" });
    expect(resolved[2]).toMatchObject({ pickQty: 10, matchState: "to_order", matchedPartId: null });
  });
});
