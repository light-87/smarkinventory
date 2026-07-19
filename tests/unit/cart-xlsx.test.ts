import { describe, expect, test } from "bun:test";
import { read, utils } from "xlsx";
import { buildCartRows, buildCartXlsx, CART_EXPORT_HEADER, type CartResultInfo } from "@/lib/orders/cart-xlsx";
import type { CartLineView } from "@/lib/orders/queries";

/**
 * lib/orders/cart-xlsx — the global Cart tab export (chosen vendor per line).
 * `buildCartRows` is the pure shaping; the route resolves the chosen result's
 * vendor stock/link (`resultById`) and distributor name (`distributorNameById`)
 * via the service client and passes them in.
 */

function cartLine(over: Partial<CartLineView>): CartLineView {
  return {
    id: "c1",
    source: "review_add",
    status: "open",
    partId: "p1",
    internalPid: "SMK-000101",
    mpn: "MPN1",
    lcscPn: "C111",
    value: "0.1uF",
    package: "0402",
    description: null,
    availableQty: 50,
    qtyToOrder: 100,
    unitPrice: 0.2,
    demand: [{ projectId: "pr", projectName: "Proj", bomId: "bm", bomName: "BOM", qty: 100 }],
    distributorId: "d1",
    chosenResultId: "r1",
    createdAt: "2026-07-19T00:00:00Z",
    ...over,
  };
}

const H = CART_EXPORT_HEADER;

describe("buildCartRows", () => {
  test("maps chosen vendor, stock, cost, total, link, and demand", () => {
    const rows = buildCartRows(
      [cartLine({})],
      new Map<string, CartResultInfo>([["r1", { stockQty: 3000, orderLink: "https://lcsc.com/x" }]]),
      new Map([["d1", "LCSC"]]),
    );
    const row = rows[0]!;
    expect(row[H.indexOf("SrNr")]).toBe(1);
    expect(row[H.indexOf("Internal PID")]).toBe("SMK-000101");
    expect(row[H.indexOf("Size")]).toBe("0402");
    expect(row[H.indexOf("Vendor")]).toBe("LCSC");
    expect(row[H.indexOf("Qty to order")]).toBe(100);
    expect(row[H.indexOf("Vendor Available Qty")]).toBe(3000);
    expect(row[H.indexOf("Unit Cost")]).toBe(0.2);
    expect(row[H.indexOf("Total Cost")]).toBe(0.2 * 100);
    expect(row[H.indexOf("Link")]).toBe("https://lcsc.com/x");
    expect(String(row[H.indexOf("Demand")])).toContain("Proj / BOM ×100");
  });

  test("blank vendor/stock/link/total when there's no chosen result or price", () => {
    const rows = buildCartRows([cartLine({ chosenResultId: null, distributorId: null, unitPrice: null })], new Map(), new Map());
    const row = rows[0]!;
    expect(row[H.indexOf("Vendor")]).toBe("");
    expect(row[H.indexOf("Vendor Available Qty")]).toBe("");
    expect(row[H.indexOf("Total Cost")]).toBe("");
    expect(row[H.indexOf("Link")]).toBe("");
  });
});

describe("buildCartXlsx", () => {
  test("readable workbook + formula-injection guard on write", () => {
    const buf = buildCartXlsx(
      [cartLine({ value: "=danger" })],
      new Map<string, CartResultInfo>([["r1", { stockQty: 1, orderLink: null }]]),
      new Map([["d1", "LCSC"]]),
    );
    expect(buf.length).toBeGreaterThan(0);
    const wb = read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const aoa = utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as (string | number)[][];
    expect(aoa[0]![0]).toBe("SrNr");
    expect(String(aoa[1]![H.indexOf("Value")])).toBe("'=danger");
  });
});
