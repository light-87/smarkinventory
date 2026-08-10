import { describe, expect, test } from "bun:test";
import { matchPart, packageKey, type MatchCatalogEntry } from "@/lib/matcher";
import { reconcileLines } from "@/lib/bom/reconcile";

/**
 * `packageKey` + reconcile's rung 3 (exact value + package).
 *
 * The reason both exist: the client's catalog and the client's BOMs describe
 * the same chip size in two vocabularies, and 880 of the 1999 catalog rows have
 * no MPN and no LCSC number, so keyed identity can never reach them.
 *
 * The reason rung 3 is strict: manual-test finding F-002. A *fuzzy* value match
 * linked BOM lines to genuinely different components. The cases below marked
 * "F-002" are real pairs from the client's own BOMs that scored 0.87–0.99 under
 * the old threshold and must never match.
 */

describe("packageKey", () => {
  test("bridges a KiCad footprint and a stock-sheet package for the same size", () => {
    expect(packageKey("SMARKKicadLib:C0603")).toBe("0603");
    expect(packageKey("0603 (1608 Metric)")).toBe("0603");
    expect(packageKey("SMARKKicadLib:C0603")).toBe(packageKey("0603 (1608 Metric)"));
  });

  test("handles every imperial size on both sides", () => {
    for (const [kicad, sheet] of [
      ["SMARKKicadLib:C0402", "0402 (1005 Metric)"],
      ["SMARKKicadLib:R0805", "0805 (2012 Metric)"],
      ["SMARKKicadLib:C1206", "1206 (3216 Metric)"],
      ["SMARKKicadLib:C1210", "1210"],
    ] as const) {
      expect(packageKey(kicad)).toBe(packageKey(sheet));
    }
  });

  test("pads a 3-digit code, the same repair the stock sheets already need", () => {
    // misc_led.csv really does carry "603" for a 0603 LED.
    expect(packageKey("603")).toBe("0603");
    expect(packageKey("805")).toBe("0805");
  });

  test("a number that is not an imperial size is left alone", () => {
    // 1234 isn't a chip size — don't invent one.
    expect(packageKey("1234")).toBe("1234");
    expect(packageKey("12345")).toBe("12345");
  });

  test("non-chip packages fall through to the old normalization unchanged", () => {
    expect(packageKey("SOT-23-6")).toBe("SOT236");
    expect(packageKey("sot_23")).toBe(packageKey("SOT 23"));
    expect(packageKey("SMA")).toBe("SMA");
    expect(packageKey("TH,P=5mm")).toBe("THP5MM");
  });

  test("blank in, blank out", () => {
    expect(packageKey(null)).toBe("");
    expect(packageKey("")).toBe("");
  });
});

const catalog: (MatchCatalogEntry & { total_qty: number })[] = [
  { id: "cap-100n", value: "100 nF", package: "0402 (1005 Metric)", part_status: "active", total_qty: 255 },
  { id: "res-100k", value: "100 kΩ", package: "0603 (1608 Metric)", part_status: "active", total_qty: 500 },
  { id: "res-115k", value: "115 kΩ", package: "0603 (1608 Metric)", part_status: "active", total_qty: 50 },
  { id: "res-9k1", value: "9.1 kΩ", package: "0603 (1608 Metric)", part_status: "active", total_qty: 80 },
  { id: "res-22k", value: "22 kΩ", package: "0603 (1608 Metric)", part_status: "active", total_qty: 60 },
  { id: "zero-a", value: "0 Ω", package: "0402 (1005 Metric)", part_status: "active", total_qty: 145 },
  { id: "zero-b", value: "0 Ω", package: "0402 (1005 Metric)", part_status: "active", total_qty: 30 },
];

const STRICT = { minValueSimilarity: 1, requireUnambiguous: true };

describe("rung 3 under reconcile's strict options", () => {
  test("the same capacitor written two ways matches", () => {
    // "0.1uF" and "100 nF" are one part. This is the whole point.
    const hit = matchPart({ value: "0.1uF", package: "SMARKKicadLib:C0402" }, catalog, STRICT);
    expect(hit?.part.id).toBe("cap-100n");
    expect(hit?.method).toBe("value_pkg");
    expect(hit?.confidence).toBe(88);
  });

  test("an exactly-equal resistor matches", () => {
    expect(matchPart({ value: "100K", package: "SMARKKicadLib:R0603" }, catalog, STRICT)?.part.id).toBe("res-100k");
  });

  test("F-002: a near-miss resistor does NOT match", () => {
    // Each of these scored well above the old 0.6 threshold against a
    // genuinely different part, and each is a real pair from GCU/TMCS.
    expect(matchPart({ value: "105K", package: "SMARKKicadLib:R0603" }, catalog, STRICT)).toBeNull(); // vs 100k/115k
    expect(matchPart({ value: "10K", package: "SMARKKicadLib:R0603" }, catalog, STRICT)).toBeNull(); // vs 9.1k
    expect(matchPart({ value: "22.1K", package: "SMARKKicadLib:R0603" }, catalog, STRICT)).toBeNull(); // vs 22k, E96 vs E24
  });

  test("F-002: those same near-misses DO match under the default loose threshold", () => {
    // Proves the strictness is what protects reconcile, not some accident of
    // the data — the other matcher consumers still get their fuzzy suggestions.
    expect(matchPart({ value: "10K", package: "SMARKKicadLib:R0603" }, catalog)?.part.id).toBe("res-9k1");
  });

  test("two catalog rows tying on value+package match NOTHING under reconcile", () => {
    // Picking one would attribute the line's whole demand to an arbitrary
    // half of the stock (145 vs 30).
    expect(matchPart({ value: "0R", package: "SMARKKicadLib:R0402" }, catalog, STRICT)).toBeNull();
    // ...but the duplicate guard still gets a candidate to show a human.
    expect(matchPart({ value: "0R", package: "SMARKKicadLib:R0402" }, catalog)).not.toBeNull();
  });

  test("package is still mandatory, and a missing value still blocks the rung", () => {
    expect(matchPart({ value: "100 nF", package: null }, catalog, STRICT)).toBeNull();
    expect(matchPart({ value: null, package: "SMARKKicadLib:C0402" }, catalog, STRICT)).toBeNull();
  });

  test("keyed identity still outranks rung 3", () => {
    const withMpn = [{ id: "keyed", mpn: "CL05B104KO5NNNC", value: "1 nF", package: "0402 (1005 Metric)", part_status: "active" as const, total_qty: 1 }, ...catalog];
    const hit = matchPart({ mpn: "CL05B104KO5NNNC", value: "100 nF", package: "SMARKKicadLib:C0402" }, withMpn, STRICT);
    expect(hit?.part.id).toBe("keyed");
    expect(hit?.method).toBe("mpn");
  });
});

describe("reconcileLines wiring", () => {
  const line = (over: Partial<Parameters<typeof reconcileLines>[0][number]>) => ({
    id: "l1", qty: 10, mpn: null, lcsc_pn: null, dnp: false, value: null, footprint: null, ...over,
  });

  test("a passive with no part number now resolves against stock", () => {
    const [out] = reconcileLines([line({ value: "0.1uF", footprint: "SMARKKicadLib:C0402" })], catalog, 1);
    expect(out).toMatchObject({ matchedPartId: "cap-100n", matchState: "in_stock", matchMethod: "value_pkg" });
  });

  test("a near-miss stays unresolved rather than claiming false stock", () => {
    const [out] = reconcileLines([line({ value: "10K", footprint: "SMARKKicadLib:R0603" })], catalog, 1);
    expect(out).toMatchObject({ matchedPartId: null, matchState: "unresolved", matchMethod: null });
  });

  test("need still beats stock: 300 needed against 255 held is to_order", () => {
    const [out] = reconcileLines([line({ qty: 100, value: "0.1uF", footprint: "SMARKKicadLib:C0402" })], catalog, 3);
    expect(out).toMatchObject({ matchedPartId: "cap-100n", matchState: "to_order", need: 300 });
  });

  test("cross-sibling netting still applies to rung-3 matches", () => {
    // Two lines onto the same 255-piece part: 200 fits, the next 100 does not.
    const outs = reconcileLines(
      [
        line({ id: "a", qty: 200, value: "0.1uF", footprint: "SMARKKicadLib:C0402" }),
        line({ id: "b", qty: 100, value: "100nF", footprint: "SMARKKicadLib:C0402" }),
      ],
      catalog,
      1,
    );
    expect(outs[0]).toMatchObject({ matchState: "in_stock" });
    expect(outs[1]).toMatchObject({ matchState: "to_order" });
  });

  test("lines with neither identity nor value+package are untouched", () => {
    const [out] = reconcileLines([line({})], catalog, 1);
    expect(out).toMatchObject({ matchedPartId: null, matchState: "unresolved" });
  });
});
