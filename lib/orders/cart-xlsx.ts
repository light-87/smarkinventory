/**
 * lib/orders/cart-xlsx.ts — "Download Excel" for the global Cart tab: one row
 * per open cart line with the CHOSEN vendor's data (the cart keeps only the
 * picked option, not the full per-vendor comparison — that lives on the Order
 * Review grid, lib/runs/review-xlsx.ts).
 *
 * Named imports (`{ utils, write }`), not a default `import XLSX from "xlsx"` —
 * the default import breaks `bun run build` under Turbopack (see the note in
 * lib/daily/export.ts). Row-shaping (`buildCartRows`) is pure/separate from the
 * workbook write so it can be unit-tested without the `xlsx` runtime.
 */

import { utils, write } from "xlsx";
import type { CartLineView } from "./queries";

const FORMULA_INJECTION_LEAD_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

function sanitizeForSpreadsheet(value: string): string {
  return value.length > 0 && FORMULA_INJECTION_LEAD_CHARS.has(value[0]!) ? `'${value}` : value;
}

type Cell = string | number;

function sanitizeRow(row: readonly Cell[]): Cell[] {
  return row.map((cell) => (typeof cell === "string" ? sanitizeForSpreadsheet(cell) : cell));
}

/** The chosen `smark_agent_results` row's vendor-side facts, resolved server-side (service client). */
export interface CartResultInfo {
  stockQty: number | null;
  orderLink: string | null;
}

export const CART_EXPORT_HEADER: readonly string[] = [
  "SrNr",
  "Internal PID",
  "Value",
  "Size",
  "MPN",
  "LCSC PN",
  "Vendor",
  "Qty to order",
  "Vendor Available Qty",
  "Unit Cost",
  "Total Cost",
  "Link",
  "Demand",
];

/**
 * Pure row-shaping for the cart export. `resultById`/`distributorNameById` are
 * resolved by the route via the service client (vendor stock + link live on the
 * chosen `smark_agent_results` row, which the per-request client can't read).
 */
export function buildCartRows(
  lines: readonly CartLineView[],
  resultById: Map<string, CartResultInfo>,
  distributorNameById: Map<string, string>,
): Cell[][] {
  return lines.map((line, i) => {
    const chosen = line.chosenResultId ? resultById.get(line.chosenResultId) : undefined;
    const vendor = line.distributorId ? (distributorNameById.get(line.distributorId) ?? "") : "";
    const totalCost: Cell = line.unitPrice != null ? line.unitPrice * line.qtyToOrder : "";
    const demand = line.demand.map((d) => `${d.projectName} / ${d.bomName} ×${d.qty}`).join("; ");

    return [
      i + 1,
      line.internalPid ?? "",
      line.value ?? "",
      line.package ?? "",
      line.mpn ?? "",
      line.lcscPn ?? "",
      vendor,
      line.qtyToOrder,
      chosen?.stockQty ?? "",
      line.unitPrice ?? "",
      totalCost,
      chosen?.orderLink ?? "",
      demand,
    ];
  });
}

export function buildCartXlsx(
  lines: readonly CartLineView[],
  resultById: Map<string, CartResultInfo>,
  distributorNameById: Map<string, string>,
): Buffer {
  const rows = buildCartRows(lines, resultById, distributorNameById);
  const sheet = utils.aoa_to_sheet([[...CART_EXPORT_HEADER], ...rows.map((r) => sanitizeRow(r))]);

  const all: Cell[][] = [[...CART_EXPORT_HEADER], ...rows];
  sheet["!cols"] = CART_EXPORT_HEADER.map((_, c) => ({
    wch: Math.min(48, Math.max(10, ...all.map((r) => String(r[c] ?? "").length))),
  }));

  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, "Cart");
  return write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
