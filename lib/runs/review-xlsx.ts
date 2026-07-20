/**
 * lib/runs/review-xlsx.ts — "Download Excel" for an Order Review run: one wide
 * per-vendor comparison grid (the xlsx sibling of lib/runs/review-pdf.ts's
 * "Save as PDF cart"). Generated on demand from the same `getReviewData`
 * snapshot — nothing persisted.
 *
 * Named imports (`{ utils, write }`), NOT `import XLSX from "xlsx"`: the ESM
 * build Turbopack resolves during `next build` has no default export, so a
 * default import passes tsc/dev but fails `bun run build` — see the long note in
 * lib/daily/export.ts. `sanitizeRow` guards free-text cells (vendor names,
 * refs, notes, links) against CSV/formula injection (CWE-1236), same as the
 * daily export.
 */

import { utils, write } from "xlsx";
import type { LaneOptionRow, ReviewData } from "./types";

const FORMULA_INJECTION_LEAD_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Prefixes a value with a leading apostrophe if it could be read as a spreadsheet formula. */
function sanitizeForSpreadsheet(value: string): string {
  return value.length > 0 && FORMULA_INJECTION_LEAD_CHARS.has(value[0]!) ? `'${value}` : value;
}

type Cell = string | number;

/** Neutralizes every string cell — numbers pass through untouched. */
function sanitizeRow(row: readonly Cell[]): Cell[] {
  return row.map((cell) => (typeof cell === "string" ? sanitizeForSpreadsheet(cell) : cell));
}

/** The chosen option for a line: the user's pick, else the AI recommendation (mirrors review-pdf's selectedRow). */
function selectedRow(rows: LaneOptionRow[]): LaneOptionRow | null {
  return rows.find((r) => r.selected) ?? rows.find((r) => r.isRecommended) ?? null;
}

// Stable vendor column order; anything unlisted sorts after, then alphabetically.
const VENDOR_ORDER = ["lcsc", "digikey", "mouser", "element14", "unikey"];
function vendorSortKey(name: string): number {
  const i = VENDOR_ORDER.indexOf(name.toLowerCase());
  return i === -1 ? VENDOR_ORDER.length : i;
}

function isLcsc(distributorName: string): boolean {
  return distributorName.toLowerCase().includes("lcsc");
}

/**
 * The LCSC part number (`Cxxxxx`) as it sits in an LCSC product URL, e.g.
 * `.../..._C17726.html`. Guarded to LCSC-shaped links so a stray "C…" inside a
 * regular URL isn't mistaken for one. This is the real LCSC PN "as extracted
 * after searching" — the desktop/worker records the LCSC product link, so we
 * read it back from there rather than showing the MPN.
 */
export function lcscPnFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /[_/]C(\d{3,})(?:\.html)?(?:[/?#]|$)/i.exec(url);
  return match ? `C${match[1]}` : null;
}

/** The real LCSC PN for a line: the BOM's own value, else pulled from that line's LCSC product link. */
export function resolveLcscPn(line: ReviewData["lines"][number]): string {
  if (line.lcscPn) return line.lcscPn;
  const lcscRow = line.rows.find((r) => isLcsc(r.distributorName));
  return lcscPnFromUrl(lcscRow?.orderLink) ?? "";
}

/**
 * Per-vendor PN. For LCSC it is the real LCSC PN (BOM value or extracted from
 * the product link) and NEVER the MPN — showing the MPN there is the bug
 * Krunal flagged. For other vendors it is the captured vendor SKU, else the
 * shared MPN as a searchable fallback.
 */
function vendorPnCell(row: LaneOptionRow, lineMpn: string | null, resolvedLcscPn: string): string {
  if (isLcsc(row.distributorName)) return resolvedLcscPn || lcscPnFromUrl(row.orderLink) || "";
  if (row.vendorPn) return row.vendorPn;
  return lineMpn ?? "";
}

/**
 * Build the rows (header + data) for the comparison grid. Kept separate from
 * the workbook write so it can be unit-tested without the `xlsx` runtime.
 */
export function buildReviewRows(review: ReviewData): { header: string[]; rows: Cell[][] } {
  // Vendor column set = union of distributors that returned a result on any line.
  const vendorNames = Array.from(new Set(review.lines.flatMap((l) => l.rows.map((r) => r.distributorName)))).sort(
    (a, b) => vendorSortKey(a) - vendorSortKey(b) || a.localeCompare(b),
  );

  // Each vendor's currency is consistent (USD for LCSC/DigiKey/Mouser, INR for
  // element14) — note it in that vendor's cost header. Read from the first row.
  const vendorCurrency = new Map<string, string>();
  for (const line of review.lines) {
    for (const r of line.rows) {
      if (!vendorCurrency.has(r.distributorName)) vendorCurrency.set(r.distributorName, r.currency);
    }
  }

  const buildQty = review.bom.buildQty || 1;

  const header: string[] = ["SrNr", "Ref", "Value", "Size", "MPN", "LCSC PN", "Unit Qty", "Total Qty"];
  for (const v of vendorNames) {
    const cur = vendorCurrency.get(v);
    header.push(`${v} PN`, `${v} Unit Cost${cur ? ` (${cur})` : ""}`, `${v} Stock`, `${v} Link`);
  }
  header.push("Recommended Vendor", "Total Cost", "Currency", "Note");

  const rows: Cell[][] = review.lines.map((line, i) => {
    const totalQty = line.cartQtyNeeded;
    const unitQty = buildQty ? Math.round(totalQty / buildQty) : totalQty;
    const rowByVendor = new Map(line.rows.map((r) => [r.distributorName, r] as const));
    const chosen = selectedRow(line.rows);
    const totalCost: Cell = chosen?.price != null ? chosen.price * totalQty : "";
    const lcscPn = resolveLcscPn(line);

    const cells: Cell[] = [
      line.lineNo ?? i + 1,
      line.ref,
      line.value,
      line.package ?? "",
      line.mpn ?? "",
      lcscPn,
      unitQty,
      totalQty,
    ];

    for (const v of vendorNames) {
      const r = rowByVendor.get(v);
      if (!r) {
        cells.push("", "", "", "");
        continue;
      }
      cells.push(vendorPnCell(r, line.mpn, lcscPn), r.price ?? "", r.stockQty ?? "", r.orderLink ?? "");
    }

    cells.push(
      chosen ? chosen.distributorName : line.aiSkipReason ? "— skipped" : "— none selected",
      totalCost,
      chosen?.currency ?? "",
      line.aiSkipReason ?? chosen?.why ?? "",
    );
    return cells;
  });

  return { header, rows };
}

export function buildReviewXlsx(review: ReviewData): Buffer {
  const { header, rows } = buildReviewRows(review);
  const sheet = utils.aoa_to_sheet([header, ...rows.map((r) => sanitizeRow(r))]);

  // Auto-ish column widths for readability (community build supports !cols).
  const all: Cell[][] = [header, ...rows];
  sheet["!cols"] = header.map((_, c) => ({
    wch: Math.min(48, Math.max(10, ...all.map((r) => String(r[c] ?? "").length))),
  }));

  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, "Order review");
  return write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
