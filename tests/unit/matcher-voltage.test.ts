/**
 * Value/voltage splitting and the tie-break it enables.
 *
 * These cover the two things that made 35 of 113 lines on the client's real
 * ordering sheet (`XE-U6632_V1.1`) miss stock that was on the shelf:
 *
 *  1. the voltage is written INTO the value (`0.1uF/100V`), so the value parsed
 *     to nothing and the line found no candidate at all;
 *  2. two stock rows share a value and a package and differ only by voltage, so
 *     the ambiguity rule refused to pick — reported to the operator as "not in
 *     stock" while 1,604 pieces sat in the box.
 */

import { describe, expect, test } from "bun:test";
import { extractVoltage, matchPart, splitValueVoltage, valuePackageCandidates } from "@/lib/matcher";
import { candidatesForLine, type ReconcileCatalogPart } from "@/lib/bom/reconcile";

describe("splitValueVoltage", () => {
  test("splits a combined value into value + voltage", () => {
    expect(splitValueVoltage("0.1uF/100V")).toEqual({ value: "0.1uF", voltage: "100V" });
    expect(splitValueVoltage("10uF/6.3V")).toEqual({ value: "10uF", voltage: "6.3V" });
    expect(splitValueVoltage("1nF/2kV")).toEqual({ value: "1nF", voltage: "2kV" });
  });

  test("drops a qualifier that is not a voltage, keeping the value", () => {
    expect(splitValueVoltage("0R/DNP")).toEqual({ value: "0R", voltage: null });
  });

  test("leaves an MPN-shaped string alone", () => {
    // `24AA025E48T-E/OT` is a part number; its suffix is part of its name.
    expect(splitValueVoltage("24AA025E48T-E/OT").value).toBe("24AA025E48T-E/OT");
  });

  test("a plain value is unchanged", () => {
    expect(splitValueVoltage("100nF")).toEqual({ value: "100nF", voltage: null });
    expect(splitValueVoltage(null)).toEqual({ value: "", voltage: null });
  });
});

describe("extractVoltage", () => {
  test("finds the rating inside a BOM description", () => {
    expect(extractVoltage("CAP CER 100nF 25V X7R 0603")).toBe("25V");
    expect(extractVoltage("RES 0Ω ±1% 1/10W 0603")).toBeNull();
  });
});

/** Two 100nF 0603 rows that differ only by voltage — the client's exact case. */
const CATALOG: ReconcileCatalogPart[] = [
  { id: "p-25v", value: "100 nF", package: "0603 (1608 Metric)", voltage: "25V", part_status: "active", total_qty: 104 },
  { id: "p-50v", value: "100 nF", package: "0603 (1608 Metric)", voltage: "50V", part_status: "active", total_qty: 1500 },
] as unknown as ReconcileCatalogPart[];

const STRICT = { minValueSimilarity: 1, requireUnambiguous: true } as const;

describe("voltage as the tie-breaker", () => {
  test("without a voltage, two rows tie and nothing is matched", () => {
    expect(matchPart({ value: "100nF", package: "C0603" }, CATALOG, STRICT)).toBeNull();
  });

  test("a voltage in the value picks the right row", () => {
    const hit = matchPart({ value: "0.1uF/50V", package: "C0603" }, CATALOG, STRICT);
    expect(hit?.part.id).toBe("p-50v");
  });

  test("a voltage supplied separately picks the right row", () => {
    const hit = matchPart({ value: "100nF", package: "C0603", voltage: "25V" }, CATALOG, STRICT);
    expect(hit?.part.id).toBe("p-25v");
  });

  test("reconcile reads the voltage out of the line's description", () => {
    const candidates = candidatesForLine(
      {
        id: "l1",
        qty: 1,
        mpn: null,
        lcsc_pn: null,
        dnp: false,
        value: "100nF",
        footprint: "C0603",
        description: "CAP CER 100nF 25V X7R 0603",
      },
      CATALOG,
    );
    // Resolved outright — no choice needed.
    expect(candidates).toEqual([]);
  });

  test("a genuine tie is offered as a choice rather than reported missing", () => {
    const candidates = candidatesForLine(
      { id: "l2", qty: 1, mpn: null, lcsc_pn: null, dnp: false, value: "100nF", footprint: "C0603", description: "CAP CER 100nF 0603" },
      CATALOG,
    );
    expect(candidates.map((c) => c.id).sort()).toEqual(["p-25v", "p-50v"]);
  });
});

describe("valuePackageCandidates", () => {
  test("reports every tied row, best first", () => {
    const { best, tied } = valuePackageCandidates({ value: "100nF", package: "C0603" }, CATALOG, STRICT);
    expect(best).not.toBeNull();
    expect(tied).toHaveLength(2);
  });

  test("a combined value finds candidates that the raw string could not", () => {
    // "0.1uF/100V" parses to nothing as a whole; split, it is a 100nF part.
    const raw = valuePackageCandidates({ value: "0.1uF/100V", package: "C0603" }, CATALOG, STRICT);
    expect(raw.best).not.toBeNull();
  });
});
