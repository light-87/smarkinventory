import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  dedupeStockParts,
  fillMergedCells,
  looksLikeMpn,
  parseStockListWorkbook,
  splitValueVoltage,
} from "@/lib/import/stocklist";
import XLSX from "xlsx";

/**
 * lib/import/stocklist.ts — real-fixture tests (FEATURES.md §14: "per-sheet
 * column-map importer → smark_parts with category + source_sheet, unmapped →
 * attributes, dedupe by MPN/LCSC, needs_review flags, value/voltage split").
 * Counts below were captured from the actual checked-in fixture
 * (tests/fixtures/Stock List.xlsx, copied verbatim from the client file) —
 * not guessed. Re-verify with a fresh run if the parser changes.
 */

const STOCKLIST_PATH = resolve(__dirname, "../fixtures/Stock List.xlsx");

describe("splitValueVoltage — [R2-24]", () => {
  test("splits the spec's own example", () => {
    expect(splitValueVoltage("0.1µF/50V")).toEqual({ value: "0.1µF", voltage: "50V" });
  });

  test("splits a plain-ASCII µ/u variant with a decimal voltage", () => {
    expect(splitValueVoltage("10uF/35V")).toEqual({ value: "10uF", voltage: "35V" });
  });

  test("does NOT split two capacitance notations for the same value", () => {
    // "100nF" is not voltage-shaped (ends in F, not V) — both sides describe
    // the same 0.1uF, so splitting would be wrong.
    expect(splitValueVoltage("0.1uF/100nF")).toEqual({ value: "0.1uF/100nF", voltage: null });
  });

  test("does NOT split a resistor value with a dual ohm notation", () => {
    expect(splitValueVoltage("0.01R/10mΩ")).toEqual({ value: "0.01R/10mΩ", voltage: null });
  });

  test("passes through a value with no slash at all", () => {
    expect(splitValueVoltage("4.7nF")).toEqual({ value: "4.7nF", voltage: null });
  });

  test("null/blank input", () => {
    expect(splitValueVoltage(null)).toEqual({ value: null, voltage: null });
    expect(splitValueVoltage("   ")).toEqual({ value: null, voltage: null });
  });
});

describe("looksLikeMpn", () => {
  test("real MPNs from the fixture read as MPN-shaped", () => {
    expect(looksLikeMpn("MINISMDC014F-2")).toBe(true);
    expect(looksLikeMpn("V275LA4P")).toBe(true);
    expect(looksLikeMpn("0ZCJ0020FF2E")).toBe(true);
  });

  test("value-shaped tokens (ratings, not part numbers) are rejected", () => {
    expect(looksLikeMpn("500mA")).toBe(false);
    expect(looksLikeMpn("5A")).toBe(false);
    expect(looksLikeMpn("1.25A")).toBe(false);
  });

  test("bare numbers and multi-word text are rejected", () => {
    expect(looksLikeMpn("100")).toBe(false);
    expect(looksLikeMpn("32.765 KHz")).toBe(false);
    expect(looksLikeMpn("")).toBe(false);
  });
});

describe("fillMergedCells", () => {
  test("fills a narrow (<=2 column) vertical merge forward", () => {
    const wb = XLSX.readFile(STOCKLIST_PATH);
    const grid = fillMergedCells(wb.Sheets["S2 - SMD IC"]!);
    // S2's "ADC" category merge spans rows 4-15 (0-based), cols 0-1.
    for (let r = 4; r <= 15; r += 1) {
      expect(grid[r]![0]).toBe("ADC");
    }
  });

  test("does NOT fill a wide (>2 column) banner/section merge into data columns", () => {
    const wb = XLSX.readFile(STOCKLIST_PATH);
    const grid = fillMergedCells(wb.Sheets["S9-Misc Elec"]!);
    // The "OLED DISPLAY" section title merges cols 8-12 on row 9 — filling it
    // forward would corrupt row 9's QTY cell (col 10), which must stay null.
    expect(grid[9]![10]).toBe(null);
  });
});

describe("parseStockListWorkbook — Stock List.xlsx (15 real sheets)", () => {
  const result = parseStockListWorkbook(STOCKLIST_PATH);

  test("scans every sheet in the workbook", () => {
    expect(result.sheetSummary).toHaveLength(15);
  });

  test("Index and S12-Stencils are recognized as non-part sheets and skipped", () => {
    const index = result.sheetSummary.find((s) => s.sheet === "Index");
    const stencils = result.sheetSummary.find((s) => s.sheet === "S12-Stencils");
    expect(index).toMatchObject({ rowCount: 0, skipped: true });
    expect(stencils).toMatchObject({ rowCount: 0, skipped: true });
  });

  test("real per-sheet row counts", () => {
    const counts = Object.fromEntries(result.sheetSummary.map((s) => [s.sheet, s.rowCount]));
    expect(counts).toEqual({
      Index: 0,
      "S2 - SMD IC": 476,
      "S3 - Res": 435,
      "S4- Cap": 270,
      "S5-Ind+Diode": 218,
      "S6-MiscElec": 93,
      "Material List": 30,
      "S7-SMD Modules": 54,
      "S8-TH IC": 30,
      "S9-Misc Elec": 64,
      "S10-Conectors1": 150,
      "S11-Conectors2": 133,
      "S12-Stencils": 0,
      SMPS: 107,
      "VOLTAGE PROTECTOR": 4,
    });
  });

  test("parses 2064 part rows across all sheets combined", () => {
    expect(result.parts).toHaveLength(2064);
  });

  test("every row carries its source sheet and a needs_review flag", () => {
    expect(result.parts.every((p) => typeof p.source_sheet === "string" && p.source_sheet.length > 0)).toBe(true);
    expect(result.parts.every((p) => typeof p.needs_review === "boolean")).toBe(true);
  });

  test("needs_review flags a large, honest fraction of the messy sheets (1421 rows)", () => {
    expect(result.parts.filter((p) => p.needs_review)).toHaveLength(1421);
  });

  test("S3-Res and S4-Cap are 100% needs_review — no package tracked for bulk R/C stock", () => {
    const s3 = result.parts.filter((p) => p.source_sheet === "S3 - Res");
    const s4 = result.parts.filter((p) => p.source_sheet === "S4- Cap");
    expect(s3.every((p) => p.needs_review)).toBe(true);
    expect(s4.every((p) => p.needs_review)).toBe(true);
    // S4-Cap has no MPN column anywhere in the sheet; S3-Res mostly doesn't
    // either, EXCEPT a handful of secondary sub-tables further down the
    // sheet (trimmer pots, resistor networks, varistors) that repeat the
    // header with a real MPN column — the generic engine picks those up too.
    expect(s4.filter((p) => p.mpn === null)).toHaveLength(270);
    expect(s3.filter((p) => p.mpn === null)).toHaveLength(415);
    expect(s3.filter((p) => p.mpn !== null)).toHaveLength(20);
  });

  test("spot-check: the real SMK-000101 source row (S4-Cap, LCSC C14663)", () => {
    // This is the exact row the SmarkStock-prototype's canonical SMK-000101
    // fixture (0.1uF/50V, 0603, Samsung CL10B104MB8NNNC) was seeded from —
    // same LCSC C-number, same package, same qty (2568).
    const row = result.parts.find((p) => p.lcsc_pn === "C14663");
    expect(row).toMatchObject({
      category: "Capacitor",
      package: "0603",
      voltage: "50V",
      qty: 2568,
      source_sheet: "S4- Cap",
    });
  });

  test("spot-check: S2-SMD IC's AD7684BRMZ row (full MPN, category fill-down via merge)", () => {
    const row = result.parts.find((p) => p.mpn === "AD7684BRMZ");
    expect(row).toMatchObject({
      category: "IC",
      package: "MSOP8",
      qty: 1,
      source_sheet: "S2 - SMD IC",
      needs_review: false,
    });
    expect(row?.attributes.subcategory).toBe("ADC");
  });

  test("S5-Ind+Diode: rows whose description says 'diode' are reclassified to category Diode", () => {
    const diodes = result.parts.filter((p) => p.category === "Diode");
    expect(diodes).toHaveLength(70);
    expect(diodes.every((p) => p.source_sheet === "S5-Ind+Diode")).toBe(true);
  });

  test("S6-MiscElec: in-cell subheadings ('A) FUSE' style) land in attributes.subcategory", () => {
    const fuse = result.parts.find((p) => p.mpn === "MINISMDC014F-2");
    expect(fuse).toMatchObject({ category: "Other", package: "1812", source_sheet: "S6-MiscElec" });
    expect(fuse?.attributes.subcategory).toBe("FUSE");
  });

  test("S9-Misc Elec: side-by-side tables resolve independently on the same physical rows", () => {
    // Row 6 (0-based) carries BOTH a left-cluster SWITCH row (nothing yet,
    // still header) and eventually distinct right-cluster LCD DISPLAY data —
    // the two tables must not bleed into each other.
    const lcdRow = result.parts.find((p) => p.source_sheet === "S9-Misc Elec" && p.value === "20 X 4");
    expect(lcdRow?.attributes.subcategory).toBe("LCD DISPLAY");
    expect(lcdRow?.qty).toBe(3);
  });
});

describe("dedupeStockParts", () => {
  const { parts } = parseStockListWorkbook(STOCKLIST_PATH);
  const deduped = dedupeStockParts(parts);

  test("collapses to 1958 rows with 48 merges", () => {
    expect(deduped.parts).toHaveLength(1958);
    expect(deduped.merges).toHaveLength(48);
  });

  test("no two kept rows share a normalized MPN", () => {
    const seen = new Set<string>();
    for (const p of deduped.parts) {
      if (!p.mpn) continue;
      const key = p.mpn.toUpperCase().replace(/[^A-Z0-9]/g, "");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test("real duplicate MPN 'PC817' (appears twice in S2) merges qty and fills gaps", () => {
    const raw = parts.filter((p) => p.mpn === "PC817");
    expect(raw).toHaveLength(2);
    const rawQtySum = raw.reduce((sum, p) => sum + (p.qty ?? 0), 0);

    const merged = deduped.parts.filter((p) => p.mpn === "PC817");
    expect(merged).toHaveLength(1);
    expect(merged[0]?.qty).toBe(rawQtySum);
  });

  test("rows with neither MPN nor LCSC never merge with each other", () => {
    const keyless = parts.filter((p) => !p.mpn && !p.lcsc_pn);
    const keptKeyless = deduped.parts.filter((p) => !p.mpn && !p.lcsc_pn);
    expect(keptKeyless).toHaveLength(keyless.length);
  });
});
