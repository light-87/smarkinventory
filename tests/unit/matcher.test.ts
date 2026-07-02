import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MIN_VALUE_SIMILARITY,
  MATCH_CONFIDENCE,
  type MatchCatalogEntry,
  matchPart,
  normalizeLcsc,
  normalizeMpn,
  normalizePackage,
  parseComponentValue,
  valueSimilarity,
} from "@/lib/matcher";
import type { PartRow } from "@/types/db";

/**
 * lib/matcher — the ONE catalog matcher (FEATURES.md §7, CROSS-FEATURE R2-31,
 * SCHEMA.md §3 "Reconcile: MPN → LCSC PN → value+package(+voltage) fuzzy").
 * Covers plan/TESTING.md §2 unit layer: "reconcile matcher ladder".
 */

interface TestPart extends MatchCatalogEntry {
  internal_pid: string;
}

// Fixture catalog — deliberately mirrors real SmarkStock parts (SMK-0001xx
// family per plan/TESTING.md §4 seed fixtures) so tests double as living
// documentation of the ladder.
const catalog: TestPart[] = [
  {
    id: "p1",
    internal_pid: "SMK-000101",
    mpn: "STM32F103C8T6",
    lcsc_pn: "C8734",
    value: null,
    package: "LQFP-48",
    voltage: null,
    part_status: "active",
  },
  {
    id: "p2",
    internal_pid: "SMK-000102",
    mpn: "CL21A106KOQNNNG",
    lcsc_pn: "C19702",
    value: "10uF",
    package: "0805",
    voltage: "25V",
    part_status: "active",
  },
  {
    id: "p3",
    internal_pid: "SMK-000103",
    mpn: null,
    lcsc_pn: null,
    value: "10uF",
    package: "0805",
    voltage: "16V",
    part_status: "nrnd",
  },
  {
    id: "p4",
    internal_pid: "SMK-000104",
    mpn: null,
    lcsc_pn: null,
    value: "4.7k",
    package: "0402",
    voltage: null,
    part_status: "active",
  },
  {
    id: "p5",
    internal_pid: "SMK-000105",
    mpn: "RC0402FR-074K7L",
    lcsc_pn: "C25804",
    value: "4.7k",
    package: "0402",
    voltage: null,
    part_status: "eol",
  },
];

describe("normalizeMpn", () => {
  test("uppercases and strips dashes/spaces/underscores", () => {
    expect(normalizeMpn("stm32-f103-c8t6")).toBe("STM32F103C8T6");
    expect(normalizeMpn("STM32_F103 C8T6")).toBe("STM32F103C8T6");
  });

  test("null/undefined/empty normalize to empty string", () => {
    expect(normalizeMpn(null)).toBe("");
    expect(normalizeMpn(undefined)).toBe("");
    expect(normalizeMpn("")).toBe("");
  });
});

describe("normalizeLcsc", () => {
  test("uppercases and strips separators", () => {
    expect(normalizeLcsc("c-19702")).toBe("C19702");
  });

  test("bare digits get a leading C (LCSC C-number strong key, FEATURES §15)", () => {
    expect(normalizeLcsc("19702")).toBe("C19702");
    expect(normalizeLcsc("  8734 ")).toBe("C8734");
  });

  test("already-prefixed values are untouched beyond casing", () => {
    expect(normalizeLcsc("C8734")).toBe("C8734");
  });
});

describe("normalizePackage", () => {
  test("SOT-23 / sot_23 / SOT 23 all normalize identically", () => {
    const target = normalizePackage("SOT-23");
    expect(normalizePackage("sot_23")).toBe(target);
    expect(normalizePackage("SOT 23")).toBe(target);
  });

  test("0805 stays 0805", () => {
    expect(normalizePackage("0805")).toBe("0805");
  });
});

describe("parseComponentValue", () => {
  test("standard SI-prefix notation", () => {
    expect(parseComponentValue("4.7k")).toBeCloseTo(4700);
    expect(parseComponentValue("100n")).toBeCloseTo(100e-9);
    expect(parseComponentValue("220")).toBeCloseTo(220);
  });

  test("unit noise (Ω, F, ohm) is stripped without affecting magnitude", () => {
    expect(parseComponentValue("4.7kΩ")).toBeCloseTo(4700);
    expect(parseComponentValue("4.7k ohm")).toBeCloseTo(4700);
    expect(parseComponentValue("0.1uF")).toBeCloseTo(0.1e-6);
    expect(parseComponentValue("0.1µF")).toBeCloseTo(0.1e-6);
  });

  test("letter-substitutes-for-decimal-point notation", () => {
    expect(parseComponentValue("4R7")).toBeCloseTo(4.7);
    expect(parseComponentValue("10R")).toBeCloseTo(10); // no substitution needed, standard rung
    expect(parseComponentValue("1K2")).toBeCloseTo(1200);
    expect(parseComponentValue("2M2")).toBeCloseTo(2_200_000);
    expect(parseComponentValue("4n7")).toBeCloseTo(4.7e-9);
  });

  test("milli (m) and mega (M) are case-sensitive and NOT interchangeable", () => {
    expect(parseComponentValue("5m")).toBeCloseTo(5e-3);
    expect(parseComponentValue("5M")).toBeCloseTo(5e6);
  });

  test("voltage tokens parse as plain magnitude, trailing V ignored as a unit", () => {
    expect(parseComponentValue("50V")).toBeCloseTo(50);
    expect(parseComponentValue("16V")).toBeCloseTo(16);
  });

  test("non-numeric tokens return null", () => {
    expect(parseComponentValue("DNP")).toBeNull();
    expect(parseComponentValue("Ferrite Bead")).toBeNull();
    expect(parseComponentValue("")).toBeNull();
    expect(parseComponentValue(null)).toBeNull();
    expect(parseComponentValue(undefined)).toBeNull();
  });
});

describe("valueSimilarity", () => {
  test("identical strings (case/spacing-insensitive) → 1", () => {
    expect(valueSimilarity("10k", "10K")).toBe(1);
    expect(valueSimilarity("4.7 k", "4.7k")).toBe(1);
  });

  test("numerically-equal but differently notated values → 1", () => {
    expect(valueSimilarity("4.7k", "4700")).toBe(1);
    expect(valueSimilarity("4k7", "4.7k")).toBe(1);
    expect(valueSimilarity("0.1uF", "100nF")).toBe(1);
  });

  test("close-but-not-equal numeric values score high but under 1", () => {
    const score = valueSimilarity("10k", "10.5k");
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThan(1);
  });

  test("wildly different magnitudes score near 0", () => {
    expect(valueSimilarity("4.7k", "10uF")).toBeLessThan(0.1);
  });

  test("free-text values fall back to edit-distance similarity", () => {
    expect(valueSimilarity("Ferrite Bead", "Ferrite Bead")).toBe(1);
    expect(valueSimilarity("Ferrite Bead", "Ferrite Beadx")).toBeGreaterThan(0.8);
  });

  test("missing input on either side → 0", () => {
    expect(valueSimilarity(null, "10k")).toBe(0);
    expect(valueSimilarity("10k", undefined)).toBe(0);
    expect(valueSimilarity("", "")).toBe(0);
  });
});

describe("matchPart — MPN rung", () => {
  test("exact MPN (normalized) matches regardless of formatting", () => {
    const result = matchPart({ mpn: "stm32-f103-c8t6" }, catalog);
    expect(result?.method).toBe("mpn");
    expect(result?.part.id).toBe("p1");
    expect(result?.confidence).toBe(MATCH_CONFIDENCE.mpnExact);
  });

  test("MPN rung wins even when the input's LCSC PN would ALSO match a different part", () => {
    // C19702 for real belongs to p2 — MPN must win outright, never even consult LCSC.
    const result = matchPart({ mpn: "STM32F103C8T6", lcsc_pn: "C19702" }, catalog);
    expect(result?.part.id).toBe("p1");
    expect(result?.method).toBe("mpn");
  });

  test("known equivalents hook resolves an alternate MPN at a lower confidence", () => {
    const result = matchPart(
      { mpn: "ALT-SOURCE-MPN" },
      catalog,
      { equivalents: [["ALT-SOURCE-MPN", "STM32F103C8T6"]] },
    );
    expect(result?.part.id).toBe("p1");
    expect(result?.method).toBe("mpn");
    expect(result?.confidence).toBe(MATCH_CONFIDENCE.mpnEquivalent);
    expect(result?.confidence).toBeLessThan(MATCH_CONFIDENCE.mpnExact);
  });

  test("unknown MPN with no equivalents configured falls through (not a match at this rung)", () => {
    const result = matchPart({ mpn: "TOTALLY-UNKNOWN" }, catalog);
    expect(result).toBeNull();
  });
});

describe("matchPart — LCSC rung (falls through when MPN draws a blank)", () => {
  test("exact LCSC PN matches", () => {
    const result = matchPart({ mpn: "not-a-real-mpn", lcsc_pn: "C19702" }, catalog);
    expect(result?.method).toBe("lcsc");
    expect(result?.part.id).toBe("p2");
    expect(result?.confidence).toBe(MATCH_CONFIDENCE.lcscExact);
  });

  test("bare-digit LCSC PN (no C prefix) still matches", () => {
    const result = matchPart({ lcsc_pn: "8734" }, catalog);
    expect(result?.part.id).toBe("p1");
    expect(result?.method).toBe("lcsc");
  });
});

describe("matchPart — value+package rung (package mandatory, A3 invariant)", () => {
  test("value+package-only line (no mpn/lcsc) resolves via fuzzy match", () => {
    const result = matchPart({ value: "4.7k", package: "0402" }, catalog);
    expect(result?.method).toBe("value_pkg");
    expect(result?.confidence).toBeLessThan(MATCH_CONFIDENCE.mpnExact);
  });

  test("package mismatch means NO match even when an identical value exists under a different package", () => {
    // 4.7k really is 0402 (p4/p5) — asking for 0805 must not fall back to them.
    const result = matchPart({ value: "4.7k", package: "0805" }, catalog);
    expect(result).toBeNull();
  });

  test("missing package on the input means the rung never runs at all", () => {
    const result = matchPart({ value: "4.7k" }, catalog);
    expect(result).toBeNull();
  });

  test("tie on value score breaks on part_status: Active beats NRND", () => {
    // p2 (active) and p3 (nrnd) both read exactly "10uF"/"0805"; no voltage given.
    const result = matchPart({ value: "10uF", package: "0805" }, catalog);
    expect(result?.part.id).toBe("p2");
  });

  test("voltage discriminates between otherwise-tied candidates, overriding the status tie-break", () => {
    // Same value+package tie as above, but this time voltage exactly picks p3 (16V) over p2 (25V).
    const result = matchPart({ value: "10uF", package: "0805", voltage: "16V" }, catalog);
    expect(result?.part.id).toBe("p3");
    expect(result?.method).toBe("value_pkg");
  });

  test("fuzzy confidence never reaches the exact-match ceiling", () => {
    const result = matchPart({ value: "4.7k", package: "0402" }, catalog);
    expect(result?.confidence).toBeLessThanOrEqual(MATCH_CONFIDENCE.valuePackageMax);
  });

  test("minValueSimilarity is tunable — a marginal match can be accepted or rejected by threshold", () => {
    // "5.6k" vs p4's "4.7k" (0402): default threshold accepts a middling match.
    const lenient = matchPart({ value: "5.6k", package: "0402" }, catalog, { minValueSimilarity: 0.5 });
    expect(lenient?.part.id).toBe("p4");

    const strict = matchPart({ value: "5.6k", package: "0402" }, catalog, { minValueSimilarity: 0.9 });
    expect(strict).toBeNull();
  });

  test("default threshold constant is exported and used when no option is passed", () => {
    expect(DEFAULT_MIN_VALUE_SIMILARITY).toBeGreaterThan(0);
    expect(DEFAULT_MIN_VALUE_SIMILARITY).toBeLessThan(1);
  });
});

describe("matchPart — no match anywhere (genuinely new part)", () => {
  test("returns null when nothing on any rung clears the bar", () => {
    const result = matchPart({ mpn: "BRAND-NEW-XYZ", package: "QFN-32", value: "100nF" }, catalog);
    expect(result).toBeNull();
  });

  test("empty input matches nothing", () => {
    expect(matchPart({}, catalog)).toBeNull();
  });
});

describe("duplicate-part guard (CROSS-FEATURE R2-31 — 'Looks like SMK-000101 — top up instead?')", () => {
  test("a new-part draft that repeats an existing MPN is flagged", () => {
    const draft = { mpn: "STM32F103C8T6", package: "LQFP-48" };
    const result = matchPart(draft, catalog);
    expect(result?.part.internal_pid).toBe("SMK-000101");
  });

  test("a new-part draft with no MPN but matching value+package+voltage is flagged", () => {
    const draft = { value: "10uF", package: "0805", voltage: "25V" };
    const result = matchPart(draft, catalog);
    expect(result?.part.internal_pid).toBe("SMK-000102");
  });

  test("a genuinely different part (different package) is NOT flagged", () => {
    const draft = { value: "10uF", package: "1206", voltage: "25V" };
    expect(matchPart(draft, catalog)).toBeNull();
  });
});

describe("Phase-0 spike line archetypes (FEATURES.md §0 — full-MPN / LCSC-PN-only / value+package-only)", () => {
  test("full-MPN line", () => {
    const result = matchPart({ mpn: "CL21A106KOQNNNG", lcsc_pn: "C19702", value: "10uF", package: "0805" }, catalog);
    expect(result?.method).toBe("mpn");
    expect(result?.part.id).toBe("p2");
  });

  test("LCSC-PN-only line", () => {
    const result = matchPart({ lcsc_pn: "C25804" }, catalog);
    expect(result?.method).toBe("lcsc");
    expect(result?.part.id).toBe("p5");
  });

  test("value+package-only line", () => {
    const result = matchPart({ value: "4.7k", package: "0402" }, catalog);
    expect(result?.method).toBe("value_pkg");
    expect(result).not.toBeNull();
    expect(["p4", "p5"]).toContain(result!.part.id);
  });
});

describe("integration: matchPart accepts real smark_parts rows (PartRow) with no adaptation", () => {
  function makePartRow(overrides: Partial<PartRow>): PartRow {
    return {
      id: "row-1",
      created_at: "2026-07-02T00:00:00+05:30",
      updated_at: null,
      internal_pid: "SMK-000999",
      mpn: null,
      manufacturer: null,
      lcsc_pn: null,
      description: null,
      category: "Resistor",
      value: null,
      package: null,
      voltage: null,
      part_status: "active",
      datasheet_url: null,
      default_distributor: null,
      attributes: {},
      total_qty: 0,
      reorder_point: null,
      source_sheet: null,
      needs_review: false,
      last_unit_price: null,
      currency: "INR",
      created_by: null,
      ...overrides,
    };
  }

  test("matches a PartRow[] catalog directly (structural compatibility)", () => {
    const rows: PartRow[] = [makePartRow({ id: "row-1", mpn: "ABC123" })];
    const result = matchPart({ mpn: "abc-123" }, rows);
    expect(result?.part.id).toBe("row-1");
    expect(result?.method).toBe("mpn");
  });
});
