import { describe, expect, test } from "bun:test";
import { read, utils } from "xlsx";
import { buildReviewRows, buildReviewXlsx } from "@/lib/runs/review-xlsx";
import type { LaneOptionRow, ReviewData, ReviewLineCard } from "@/lib/runs/types";

/**
 * lib/runs/review-xlsx — the Order Review comparison grid. `buildReviewRows` is
 * the pure header/row shaping (per-vendor pivot, vendorPn fallback, qty math);
 * `buildReviewXlsx` writes it to a workbook. Only `bom.buildQty` + `lines` are
 * read, so fixtures cast a minimal object.
 */

function opt(over: Partial<LaneOptionRow>): LaneOptionRow {
  return {
    resultId: "r",
    distributorId: "d",
    distributorName: "LCSC",
    price: 0.1,
    currency: "USD",
    stockQty: 1000,
    mpnMatch: "exact",
    packageMatch: true,
    partStatus: "active",
    orderLink: "https://lcsc.com/p",
    isRecommended: false,
    confidence: 90,
    why: "",
    selected: false,
    vendorPn: null,
    ...over,
  };
}

function line(over: Partial<ReviewLineCard>): ReviewLineCard {
  return {
    bomLineId: "b",
    ref: "C1",
    lineNo: 1,
    mpn: "MPN1",
    lcscPn: "C111",
    value: "0.1uF",
    package: "0402",
    jobStatus: "done",
    aiSkipReason: null,
    rows: [],
    cartQtyNeeded: 100,
    inCartQty: null,
    feedback: [],
    ...over,
  };
}

function review(lines: ReviewLineCard[], buildQty = 10): ReviewData {
  return { bom: { buildQty }, lines } as unknown as ReviewData;
}

const BASE = 8; // SrNr,Ref,Value,Size,MPN,LCSC PN,Unit Qty,Total Qty
/** First column index of a vendor's 4-col group [PN, Cost, Stock, Link], given the sorted vendor order. */
function vendorGroupStart(vendors: string[], name: string): number {
  return BASE + vendors.indexOf(name) * 4;
}

describe("buildReviewRows — header", () => {
  test("base + a 4-col group per vendor present + trailing summary", () => {
    const { header } = buildReviewRows(
      review([line({ rows: [opt({ distributorName: "LCSC" }), opt({ distributorName: "DigiKey" })] })]),
    );
    expect(header.slice(0, BASE)).toEqual(["SrNr", "Ref", "Value", "Size", "MPN", "LCSC PN", "Unit Qty", "Total Qty"]);
    expect(header).toContain("DigiKey PN");
    expect(header).toContain("DigiKey Stock");
    expect(header).toContain("DigiKey Link");
    expect(header.some((h) => h.startsWith("DigiKey Unit Cost"))).toBe(true);
    expect(header.slice(-4)).toEqual(["Recommended Vendor", "Total Cost", "Currency", "Note"]);
    expect(header).not.toContain("Status");
  });

  test("vendors are ordered LCSC, DigiKey, Mouser, element14", () => {
    const { header } = buildReviewRows(
      review([
        line({
          rows: [
            opt({ distributorName: "element14" }),
            opt({ distributorName: "DigiKey" }),
            opt({ distributorName: "LCSC" }),
          ],
        }),
      ]),
    );
    const pnCols = header.filter((h) => h.endsWith(" PN"));
    expect(pnCols).toEqual(["LCSC PN", "LCSC PN", "DigiKey PN", "element14 PN"]);
    // (first "LCSC PN" is the base BOM column, second is the LCSC vendor group)
  });
});

describe("buildReviewRows — cells", () => {
  test("unit qty = total / buildQty; total qty = cartQtyNeeded", () => {
    const { rows } = buildReviewRows(review([line({ cartQtyNeeded: 250 })], 25));
    expect(rows[0]![6]).toBe(10);
    expect(rows[0]![7]).toBe(250);
  });

  test("per-vendor pivot: a line missing a vendor gets blank cells there", () => {
    const r = review([
      line({ ref: "C1", rows: [opt({ distributorName: "LCSC" })] }),
      line({ ref: "C2", rows: [opt({ distributorName: "DigiKey" })] }),
    ]);
    const { header, rows } = buildReviewRows(r);
    const vendors = ["LCSC", "DigiKey"];
    const dkPn = vendorGroupStart(vendors, "DigiKey");
    expect(rows[0]![dkPn]).toBe(""); // C1 has no DigiKey option
    expect(rows[0]![dkPn + 1]).toBe(""); // cost
    expect(rows[1]![dkPn]).toBe("MPN1"); // C2 has DigiKey → MPN fallback
  });

  test("LCSC PN comes from the product URL when the BOM line has none, and never falls back to the MPN", () => {
    const r = review([
      line({
        mpn: "MPN1",
        lcscPn: null, // BOM line carries no LCSC PN (desktop/LCSC-sourced case)
        rows: [
          opt({ distributorName: "LCSC", vendorPn: null, orderLink: "https://www.lcsc.com/product-detail/foo_C17726.html" }),
          opt({ distributorName: "DigiKey", vendorPn: null, orderLink: "https://www.digikey.com/x" }),
        ],
      }),
    ]);
    const { rows } = buildReviewRows(r);
    const vendors = ["LCSC", "DigiKey"];
    // base + LCSC vendor column both show the extracted Cxxxxx, not the MPN
    expect(rows[0]![5]).toBe("C17726");
    expect(rows[0]![vendorGroupStart(vendors, "LCSC")]).toBe("C17726");
    // no LCSC PN anywhere → blank, NOT the MPN
    const r2 = review([line({ mpn: "MPN1", lcscPn: null, rows: [opt({ distributorName: "LCSC", vendorPn: null, orderLink: null })] })]);
    const out2 = buildReviewRows(r2);
    expect(out2.rows[0]![5]).toBe("");
    expect(out2.rows[0]![vendorGroupStart(["LCSC"], "LCSC")]).toBe("");
    // DigiKey still falls back to the MPN
    expect(rows[0]![vendorGroupStart(vendors, "DigiKey")]).toBe("MPN1");
  });

  test("per-vendor PN: vendorPn wins, LCSC falls back to lcscPn, others to mpn", () => {
    const r = review([
      line({
        mpn: "MPN1",
        lcscPn: "C999",
        rows: [
          opt({ distributorName: "LCSC", vendorPn: null }),
          opt({ distributorName: "Mouser", vendorPn: "MOU-123" }),
          opt({ distributorName: "DigiKey", vendorPn: null }),
        ],
      }),
    ]);
    const { header, rows } = buildReviewRows(r);
    const vendors = ["LCSC", "DigiKey", "Mouser"];
    expect(rows[0]![vendorGroupStart(vendors, "LCSC")]).toBe("C999"); // LCSC → lcscPn
    expect(rows[0]![vendorGroupStart(vendors, "Mouser")]).toBe("MOU-123"); // vendorPn wins
    expect(rows[0]![vendorGroupStart(vendors, "DigiKey")]).toBe("MPN1"); // fallback to mpn
    // base LCSC PN column untouched
    expect(rows[0]![5]).toBe("C999");
    // header sanity (silence unused)
    expect(header.length).toBeGreaterThan(BASE);
  });

  test("recommended vendor + total cost use selected, else the AI recommendation", () => {
    const { header, rows } = buildReviewRows(
      review([
        line({
          cartQtyNeeded: 100,
          rows: [
            opt({ distributorName: "LCSC", price: 0.1, isRecommended: true, selected: false }),
            opt({ distributorName: "DigiKey", price: 0.2, selected: true, currency: "USD" }),
          ],
        }),
      ]),
    );
    const recCol = header.indexOf("Recommended Vendor");
    expect(rows[0]![recCol]).toBe("DigiKey"); // selected wins over isRecommended
    expect(rows[0]![recCol + 1]).toBe(0.2 * 100); // total cost = chosen price × total qty
  });

  test("a skipped line shows '— skipped' and its reason in the Note column", () => {
    const { header, rows } = buildReviewRows(review([line({ rows: [], aiSkipReason: "already in stock" })]));
    const recCol = header.indexOf("Recommended Vendor");
    expect(rows[0]![recCol]).toBe("— skipped");
    expect(rows[0]![header.indexOf("Note")]).toBe("already in stock");
  });
});

describe("buildReviewXlsx — workbook", () => {
  test("produces a readable workbook whose first data row matches", () => {
    const buf = buildReviewXlsx(review([line({ ref: "C1", value: "0.1uF", rows: [opt({ distributorName: "LCSC" })] })]));
    expect(buf.length).toBeGreaterThan(0);
    const wb = read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const aoa = utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as (string | number)[][];
    expect(aoa[0]![0]).toBe("SrNr");
    expect(aoa[1]![1]).toBe("C1"); // Ref
    expect(aoa[1]![2]).toBe("0.1uF"); // Value
  });

  test("neutralizes a formula-injection value on write (round-trip)", () => {
    const buf = buildReviewXlsx(review([line({ ref: "C1", value: "=cmd|calc" })]));
    const wb = read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const aoa = utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as (string | number)[][];
    expect(String(aoa[1]![2]).startsWith("'=") || String(aoa[1]![2]).startsWith("=")).toBe(true);
    // the leading apostrophe guard was applied before write
    expect(String(aoa[1]![2])).toBe("'=cmd|calc");
  });
});
