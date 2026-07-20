/**
 * lib/runs/review-pdf.ts — "Save as PDF cart": a printable order table snapshot
 * of an Order Review run (plan/tab-order-review.md §2/§6). Generated on demand
 * from the current review data — nothing persisted; the user downloads a
 * point-in-time document.
 *
 * Rendered as a real LANDSCAPE table (one row per to-order line, aligned
 * columns, zebra striping, repeating header, per-currency totals) — the earlier
 * version drew flowing text with no columns, which read as one jammed paragraph
 * and dropped most fields. Columns mirror the Excel export's key fields
 * (lib/runs/review-xlsx.ts), narrowed to what fits a page: the chosen vendor,
 * its unit cost, and the line total.
 *
 * Uses an embedded Noto Sans (lib/runs/fonts) via `@pdf-lib/fontkit` rather than
 * a StandardFont — amounts contain `₹` (U+20B9), which pdf-lib's built-in
 * Helvetica (WinAnsi) cannot encode. Noto Sans covers ₹/$/·/—/… too. The TTFs
 * are traced into the serverless function via `outputFileTracingIncludes` in
 * next.config.ts.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { resolveLcscPn } from "./review-xlsx";
import type { ReviewData, LaneOptionRow } from "./types";

const PAGE_WIDTH = 841.89; // A4 landscape pt
const PAGE_HEIGHT = 595.28;
const MARGIN = 32;

const FONTS_DIR = path.join(process.cwd(), "lib", "runs", "fonts");
const REGULAR_TTF = () => readFileSync(path.join(FONTS_DIR, "NotoSans-Regular.ttf"));
const BOLD_TTF = () => readFileSync(path.join(FONTS_DIR, "NotoSans-Bold.ttf"));

function selectedRow(line: ReviewData["lines"][number]): LaneOptionRow | null {
  return line.rows.find((r) => r.selected) ?? line.rows.find((r) => r.isRecommended) ?? null;
}

/** Vendor-currency-aware money: ₹ for INR, $ for USD, else a trailing code. */
function money(value: number | null | undefined, currency: string): string {
  if (value == null) return "";
  const n = value.toFixed(2);
  if (currency === "INR") return `₹${n}`;
  if (currency === "USD") return `$${n}`;
  return `${n} ${currency}`;
}

type Align = "left" | "right";
interface Col {
  header: string;
  width: number;
  align: Align;
  cell: (line: ReviewData["lines"][number], chosen: LaneOptionRow | null, srNo: number) => string;
}

const COLS: Col[] = [
  { header: "Sr", width: 24, align: "right", cell: (l, _c, sr) => String(l.lineNo ?? sr) },
  { header: "Ref", width: 116, align: "left", cell: (l) => l.ref },
  { header: "Value", width: 82, align: "left", cell: (l) => l.value },
  { header: "Size", width: 104, align: "left", cell: (l) => l.package ?? "" },
  { header: "MPN", width: 104, align: "left", cell: (l) => l.mpn ?? "" },
  { header: "LCSC PN", width: 58, align: "left", cell: (l) => resolveLcscPn(l) },
  { header: "Qty", width: 32, align: "right", cell: (l) => String(l.cartQtyNeeded) },
  {
    header: "Vendor",
    width: 60,
    align: "left",
    cell: (l, c) => (c ? c.distributorName : l.aiSkipReason ? "— skipped" : "— none"),
  },
  { header: "Unit", width: 58, align: "right", cell: (_l, c) => money(c?.price, c?.currency ?? "") },
  {
    header: "Total",
    width: 66,
    align: "right",
    cell: (l, c) => money(c?.price != null ? c.price * l.cartQtyNeeded : null, c?.currency ?? ""),
  },
];
const TABLE_WIDTH = COLS.reduce((w, c) => w + c.width, 0);

const HEADER_BG = rgb(0.13, 0.15, 0.2);
const HEADER_FG = rgb(1, 1, 1);
const ZEBRA_BG = rgb(0.955, 0.965, 0.975);
const BODY_FG = rgb(0.12, 0.12, 0.12);
const MUTED_FG = rgb(0.5, 0.5, 0.5);

export async function buildReviewPdf(review: ReviewData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(REGULAR_TTF(), { subset: true });
  const bold = await doc.embedFont(BOLD_TTF(), { subset: true });

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  /** Trim a string with a trailing ellipsis so it fits maxWidth at the given size. */
  function fit(value: string, f: PDFFont, size: number, maxWidth: number): string {
    if (!value) return "";
    if (f.widthOfTextAtSize(value, size) <= maxWidth) return value;
    let s = value;
    while (s.length > 1 && f.widthOfTextAtSize(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
    return `${s}…`;
  }

  function drawText(value: string, x: number, size: number, f: PDFFont, color: RGB) {
    page.drawText(value, { x, y: y - size, size, font: f, color });
  }

  function newPage() {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  /** One table row across COLS. `bold`/`bg`/`color` style it (header vs body). */
  function drawTableRow(
    cellFor: (col: Col, i: number) => string,
    opts: { size: number; useBold: boolean; bg?: RGB; color: RGB },
  ) {
    const rowH = opts.size + 8;
    if (y - rowH < MARGIN) {
      newPage();
      drawHeaderRow();
    }
    if (opts.bg) page.drawRectangle({ x: MARGIN, y: y - rowH + 2, width: TABLE_WIDTH, height: rowH, color: opts.bg });
    const f = opts.useBold ? bold : font;
    let cx = MARGIN;
    COLS.forEach((col, i) => {
      const raw = cellFor(col, i);
      const s = fit(raw, f, opts.size, col.width - 6);
      const w = f.widthOfTextAtSize(s, opts.size);
      const tx = col.align === "right" ? cx + col.width - 3 - w : cx + 3;
      drawText(s, tx, opts.size, f, opts.color);
      cx += col.width;
    });
    y -= rowH;
  }

  function drawHeaderRow() {
    drawTableRow((col) => col.header, { size: 9, useBold: true, bg: HEADER_BG, color: HEADER_FG });
  }

  // ── Title ────────────────────────────────────────────────────────────────
  drawText(`Order review — ${review.project.name} · ${review.bom.name}`, MARGIN, 15, bold, BODY_FG);
  y -= 15 + 5;
  drawText(`Run ${review.run.id.slice(0, 8)} · status ${review.run.status}`, MARGIN, 9, font, MUTED_FG);
  y -= 9 + 10;

  // ── To-order table ─────────────────────────────────────────────────────────
  drawText(`To order (${review.lines.length} line${review.lines.length === 1 ? "" : "s"})`, MARGIN, 11, bold, BODY_FG);
  y -= 11 + 6;
  drawHeaderRow();

  const totalsByCur = new Map<string, number>();
  review.lines.forEach((line, i) => {
    const chosen = selectedRow(line);
    if (chosen?.price != null) {
      const t = chosen.price * line.cartQtyNeeded;
      totalsByCur.set(chosen.currency, (totalsByCur.get(chosen.currency) ?? 0) + t);
    }
    drawTableRow((col) => col.cell(line, chosen, i + 1), {
      size: 8.5,
      useBold: false,
      bg: i % 2 === 1 ? ZEBRA_BG : undefined,
      color: chosen ? BODY_FG : MUTED_FG,
    });
  });

  // ── Totals (grouped by currency — mixing vendors' currencies in one sum is wrong) ──
  y -= 10;
  const totalText =
    totalsByCur.size > 0
      ? Array.from(totalsByCur.entries())
          .map(([cur, amt]) => money(amt, cur))
          .join("   ")
      : "—";
  drawText(`Estimated total:  ${totalText}`, MARGIN, 11, bold, BODY_FG);
  y -= 11 + 4;
  drawText(
    `Added to cart: ${review.cartAddedCount} line${review.cartAddedCount === 1 ? "" : "s"}`,
    MARGIN,
    9,
    font,
    MUTED_FG,
  );
  y -= 9 + 10;

  // ── Already in stock (compact, optional) ────────────────────────────────────
  if (review.inStockLanes.length > 0) {
    if (y - 40 < MARGIN) newPage();
    drawText(`Already in stock (${review.inStockLanes.length})`, MARGIN, 11, bold, BODY_FG);
    y -= 11 + 6;
    for (const lane of review.inStockLanes) {
      if (y - 14 < MARGIN) newPage();
      drawText(fit(`${lane.ref}  ${lane.value} — ${lane.flag}`, font, 8.5, TABLE_WIDTH - 6), MARGIN + 3, 8.5, font, MUTED_FG);
      y -= 14;
    }
  }

  return doc.save();
}
