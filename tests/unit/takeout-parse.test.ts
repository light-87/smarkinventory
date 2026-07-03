import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePastedTakeoutText, parseTakeoutGrid, parseUploadedTakeoutFile } from "@/lib/takeout/parse";

/**
 * lib/takeout/parse.ts — ad-hoc BOM parsing (plan/tab-bulk-pick.md §1
 * "upload/paste zone"). Exercises the SAME real client BOM fixtures import
 * uses (tests/fixtures/*.xlsx) so takeout's independent parser (see the
 * module header on why it doesn't import lib/import/bom.ts) is checked
 * against real data, not just synthetic rows — plus the paste-text path,
 * which has no analogue in lib/import.
 */

const TMCS_PATH = resolve(__dirname, "../fixtures/TMCS_96x32_Matrix_V1.2.xlsx");
const GCU_PATH = resolve(__dirname, "../fixtures/GCU_V1.1_BOM.xlsx");

function readBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

describe("parseUploadedTakeoutFile — TMCS_96x32_Matrix_V1.2.xlsx", () => {
  const lines = parseUploadedTakeoutFile(readBytes(TMCS_PATH));

  test("parses exactly 122 lines", () => {
    expect(lines).toHaveLength(122);
  });

  test("spot-check line 1 (C1, value-only archetype)", () => {
    const line1 = lines.find((l) => l.lineNo === 1);
    expect(line1).toMatchObject({
      references: "C1",
      qty: 1,
      value: "220uF/50V",
      dnp: false,
      mpn: null,
      lcscPn: null,
    });
  });

  test("spot-check line 2 (C2/C3/C5/C6, full-MPN archetype)", () => {
    const line2 = lines.find((l) => l.lineNo === 2);
    expect(line2).toMatchObject({
      references: "C2,C3,C5,C6",
      qty: 4,
      value: "10uF/35V",
      mpn: "GRM319R6YA106KA12D",
      lcscPn: "C92797",
    });
  });

  test("DNP lines flagged (3 in the real sheet)", () => {
    expect(lines.filter((l) => l.dnp)).toHaveLength(3);
  });
});

describe("parseUploadedTakeoutFile — GCU_V1.1_BOM.xlsx (no LCSC column at all)", () => {
  const lines = parseUploadedTakeoutFile(readBytes(GCU_PATH));

  test("parses exactly 100 lines", () => {
    expect(lines).toHaveLength(100);
  });

  test("every line has lcscPn null — the sheet has no LCSC column", () => {
    expect(lines.every((l) => l.lcscPn === null)).toBe(true);
  });
});

describe("parseTakeoutGrid — column detection + blank-row skipping", () => {
  test("locates columns by header text regardless of order", () => {
    const grid = [
      ["Value", "Qty", "Reference", "MPN"],
      ["4.7k", "2", "R1,R2", "RC0402JR-070RL"],
    ];
    expect(parseTakeoutGrid(grid)).toEqual([
      {
        lineNo: 1,
        references: "R1,R2",
        qty: 2,
        value: "4.7k",
        footprint: null,
        dnp: false,
        description: null,
        mpn: "RC0402JR-070RL",
        manufacturer: null,
        lcscPn: null,
      },
    ]);
  });

  test("drops fully-blank trailing rows", () => {
    const grid = [
      ["Reference", "Qty", "Value"],
      ["R1", "2", "4.7k"],
      [null, null, null],
      ["", "", ""],
    ];
    expect(parseTakeoutGrid(grid)).toHaveLength(1);
  });

  test("a DNP column truthy value flags the line", () => {
    const grid = [
      ["Reference", "Qty", "Value", "DNP"],
      ["R65", "1", "NC", "DNP"],
    ];
    expect(parseTakeoutGrid(grid)[0]).toMatchObject({ dnp: true });
  });
});

describe("parsePastedTakeoutText", () => {
  test("tab-separated paste (Excel/Sheets copy) resolves the same as a grid", () => {
    const text = "Reference\tQty\tValue\tMPN\nC3,C69\t2\t0.1µF\tCL10B104MB8NNNC";
    expect(parsePastedTakeoutText(text)).toEqual([
      {
        lineNo: 1,
        references: "C3,C69",
        qty: 2,
        value: "0.1µF",
        footprint: null,
        dnp: false,
        description: null,
        mpn: "CL10B104MB8NNNC",
        manufacturer: null,
        lcscPn: null,
      },
    ]);
  });

  test("falls back to comma-separated for a plain CSV paste", () => {
    const text = "Reference,Qty,Value\nR1,4,10k";
    expect(parsePastedTakeoutText(text)).toEqual([
      {
        lineNo: 1,
        references: "R1",
        qty: 4,
        value: "10k",
        footprint: null,
        dnp: false,
        description: null,
        mpn: null,
        manufacturer: null,
        lcscPn: null,
      },
    ]);
  });

  test("empty paste resolves to no lines", () => {
    expect(parsePastedTakeoutText("   \n  \n")).toEqual([]);
  });
});
