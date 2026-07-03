import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseBomWorkbook } from "@/lib/import/bom";

/**
 * lib/import/bom.ts — real-fixture tests (FEATURES.md §14, plan/TESTING.md §4:
 * "Real BOM files... as parser fixtures"). Counts below were verified against
 * the actual checked-in fixtures (tests/fixtures/*.xlsx, copied verbatim from
 * the client-supplied workbooks) — not guessed.
 */

const TMCS_PATH = resolve(__dirname, "../fixtures/TMCS_96x32_Matrix_V1.2.xlsx");
const GCU_PATH = resolve(__dirname, "../fixtures/GCU_V1.1_BOM.xlsx");

describe("parseBomWorkbook — TMCS_96x32_Matrix_V1.2.xlsx", () => {
  const parsed = parseBomWorkbook(TMCS_PATH);

  test("parses the single sheet under its real name", () => {
    expect(parsed.sheet_name).toBe("TMCS_96x32_Matrix_V1.2");
  });

  test("parses exactly 122 lines", () => {
    expect(parsed.lines).toHaveLength(122);
  });

  test("mix of full-MPN / LCSC-only / value-only lines (Phase-0 spike archetypes)", () => {
    const fullMpn = parsed.lines.filter((l) => l.mpn !== null);
    const lcscOnly = parsed.lines.filter((l) => l.mpn === null && l.lcsc_pn !== null);
    const valueOnly = parsed.lines.filter((l) => l.mpn === null && l.lcsc_pn === null);

    expect(fullMpn).toHaveLength(61);
    expect(lcscOnly).toHaveLength(24);
    expect(valueOnly).toHaveLength(37);
    // Every line falls into exactly one archetype — none double-counted, none dropped.
    expect(fullMpn.length + lcscOnly.length + valueOnly.length).toBe(122);
  });

  test("DNP lines are flagged (3 in the real sheet)", () => {
    expect(parsed.lines.filter((l) => l.dnp)).toHaveLength(3);
  });

  test("spot-check line 1 (C1, no MPN — value-only archetype)", () => {
    const line1 = parsed.lines.find((l) => l.line_no === 1);
    expect(line1).toEqual({
      line_no: 1,
      references: "C1",
      qty: 1,
      value: "220uF/50V",
      footprint: "SMARKKicadLib:CAP_AE_10x10.5",
      dnp: false,
      description: "Polarized capacitor",
      mpn: null,
      manufacturer: null,
      part_link: null,
      lcsc_pn: null,
    });
  });

  test("spot-check line 2 (C2/C3/C5/C6, full-MPN archetype)", () => {
    const line2 = parsed.lines.find((l) => l.line_no === 2);
    expect(line2).toMatchObject({
      references: "C2,C3,C5,C6",
      qty: 4,
      value: "10uF/35V",
      mpn: "GRM319R6YA106KA12D",
      manufacturer: "Murata Electronics",
      lcsc_pn: "C92797",
    });
  });

  test("spot-check line 89 (R65, DNP + no MPN/LCSC)", () => {
    const line89 = parsed.lines.find((l) => l.line_no === 89);
    expect(line89).toMatchObject({
      references: "R65",
      value: "NC",
      dnp: true,
      mpn: null,
      lcsc_pn: null,
    });
  });

  test("total qty across all lines sums to 1249", () => {
    const total = parsed.lines.reduce((sum, l) => sum + (l.qty ?? 0), 0);
    expect(total).toBe(1249);
  });
});

describe("parseBomWorkbook — GCU_V1.1_BOM.xlsx (no LCSC column at all)", () => {
  const parsed = parseBomWorkbook(GCU_PATH);

  test("parses exactly 100 lines", () => {
    expect(parsed.lines).toHaveLength(100);
  });

  test("every line has lcsc_pn null — the sheet has no LCSC column", () => {
    expect(parsed.lines.every((l) => l.lcsc_pn === null)).toBe(true);
  });

  test("mostly full-MPN with a handful value-only (95 / 5 split)", () => {
    const fullMpn = parsed.lines.filter((l) => l.mpn !== null);
    const valueOnly = parsed.lines.filter((l) => l.mpn === null);
    expect(fullMpn).toHaveLength(95);
    expect(valueOnly).toHaveLength(5);
  });

  test("spot-check line 1 (C1, full-MPN)", () => {
    const line1 = parsed.lines.find((l) => l.line_no === 1);
    expect(line1).toMatchObject({
      references: "C1",
      qty: 1,
      value: "100uF/63V",
      mpn: "PCM1J101MCL1GS",
      manufacturer: "Nichicon",
      lcsc_pn: null,
    });
  });

  test("spot-check line 100 (U1, the sensor)", () => {
    const line100 = parsed.lines.find((l) => l.line_no === 100);
    expect(line100).toMatchObject({
      references: "U1",
      mpn: "AS5048A-HTSP-500",
      manufacturer: "ams-OSRAM USA INC.",
    });
  });

  test("DNP lines flagged (2 in the real sheet)", () => {
    expect(parsed.lines.filter((l) => l.dnp)).toHaveLength(2);
  });
});
