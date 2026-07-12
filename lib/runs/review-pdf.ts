/**
 * lib/runs/review-pdf.ts — "Save as PDF cart" snapshot (plan/tab-order-
 * review.md §2/§6 footer bar). Generated on demand from current review data —
 * no R2 storage, this is a point-in-time snapshot the user downloads, not a
 * persisted document.
 *
 * Uses an embedded Noto Sans (lib/runs/fonts) via `@pdf-lib/fontkit` rather
 * than a StandardFont — the amounts contain `₹` (U+20B9), which pdf-lib's
 * built-in Helvetica (WinAnsi) cannot encode (it threw, 500ing the route).
 * Noto Sans covers ₹ plus the ·/—/× the layout uses. The TTFs are traced into
 * the serverless function via `outputFileTracingIncludes` in next.config.ts.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { formatINR } from "@/lib/format";
import type { ReviewData } from "./types";

const PAGE_WIDTH = 595.28; // A4 pt
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;

const FONTS_DIR = path.join(process.cwd(), "lib", "runs", "fonts");
const REGULAR_TTF = () => readFileSync(path.join(FONTS_DIR, "NotoSans-Regular.ttf"));
const BOLD_TTF = () => readFileSync(path.join(FONTS_DIR, "NotoSans-Bold.ttf"));

function selectedRow(line: ReviewData["lines"][number]) {
  return line.rows.find((r) => r.selected) ?? line.rows.find((r) => r.isRecommended) ?? null;
}

export async function buildReviewPdf(review: ReviewData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(REGULAR_TTF(), { subset: true });
  const bold = await doc.embedFont(BOLD_TTF(), { subset: true });

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function text(value: string, size: number, useBold = false, color = rgb(0.1, 0.1, 0.1)) {
    ensureSpace(size + 6);
    page.drawText(value, { x: MARGIN, y, size, font: useBold ? bold : font, color });
    y -= size + 6;
  }

  text(`Order review — ${review.project.name} · ${review.bom.name}`, 16, true);
  text(`Run ${review.run.id.slice(0, 8)} · status ${review.run.status}`, 10, false, rgb(0.4, 0.4, 0.4));
  y -= 6;

  if (review.inStockLanes.length > 0) {
    text("Already in stock", 12, true);
    for (const lane of review.inStockLanes) {
      text(`${lane.ref}  ${lane.value} — ${lane.flag}`, 9, false, rgb(0.35, 0.35, 0.35));
    }
    y -= 6;
  }

  text("To order", 12, true);
  let total = 0;
  for (const line of review.lines) {
    const chosen = selectedRow(line);
    const qty = line.cartQtyNeeded;
    const lineTotal = chosen?.price != null ? chosen.price * qty : null;
    if (lineTotal != null) total += lineTotal;

    text(`${line.ref}  ${line.value}`, 10, true);
    if (line.aiSkipReason) {
      text(`  Skipped — ${line.aiSkipReason}`, 9, false, rgb(0.5, 0.5, 0.5));
    } else if (chosen) {
      text(
        `  ${chosen.distributorName} · ${formatINR(chosen.price)} × ${qty}${lineTotal != null ? ` = ${formatINR(lineTotal)}` : ""}${line.inCartQty != null ? " · in cart" : ""}`,
        9,
        false,
        rgb(0.3, 0.3, 0.3),
      );
    } else {
      text("  No option selected yet.", 9, false, rgb(0.6, 0.4, 0.1));
    }
  }

  y -= 10;
  text(`Estimated total: ${formatINR(total)}`, 12, true);
  text(`Added to cart: ${review.cartAddedCount} line${review.cartAddedCount === 1 ? "" : "s"}`, 10, false, rgb(0.4, 0.4, 0.4));

  return doc.save();
}
