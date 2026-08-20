/**
 * lib/labels/avery.ts — batch label sheet renderer (FEATURES.md §8 · R2-35).
 *
 * Every queued label (ESD-plastic or Big-Box) renders onto ONE Avery-layout
 * PDF per print run — never one-by-one. Layout: **Avery L7651, 38×21mm,
 * 5 columns × 13 rows** (65 labels/A4 sheet) per the build brief; sizing is
 * computed from those three numbers rather than hand-copied from a vendor
 * template, so the geometry is exact, deterministic and unit-testable
 * (tests/unit/labels-avery.test.ts) without needing the literal Avery spec
 * sheet on hand. Settings' "label size" dropdown (plan/tab-settings.md) is
 * the seam to swap this for another Avery code once Settings exists — not
 * built yet, so this module is the only layout for now.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { renderQrPngBuffer } from "./qr";

/**
 * An embedded font, not a PDF standard one.
 *
 * The standard fonts are WinAnsi-encoded, which cannot represent `Ω`. The
 * catalogue writes resistance as `0 Ω` / `10 kΩ`, so the first resistor label
 * anyone queued threw `WinAnsi cannot encode "Ω"` and took the WHOLE sheet with
 * it (client, 2026-08-20: "a new tab opens and automatically closes, no file is
 * downloaded"). Since the queue survives printing now, that one label would have
 * jammed every future print too — it could never drain.
 *
 * Same Noto Sans the order-review PDF embeds for `₹` (lib/runs/review-pdf.ts).
 */
const FONT_PATH = () => path.join(process.cwd(), "lib", "runs", "fonts", "NotoSans-Regular.ttf");

/**
 * Last-resort transliteration for a glyph even Noto lacks.
 *
 * Belt and braces: a label is operator-entered free text, and one unprintable
 * character must never again be able to stop a whole sheet — the queue no
 * longer clears itself, so a poisoned label would block printing indefinitely
 * rather than for one attempt.
 */
function asciiFallback(text: string): string {
  return text
    .replace(/[Ωω]/g, "ohm")
    .replace(/[µμ]/g, "u")
    .replace(/±/g, "+/-")
    .replace(/[–—]/g, "-")
    .replace(/[^ -~]/g, ""); // anything left that is not plain ASCII
}

/** Draws `text`, falling back to a transliterated version if the font can't encode it. */
function drawTextSafely(
  page: { drawText: (t: string, o: Record<string, unknown>) => void },
  text: string,
  options: Record<string, unknown>,
): void {
  try {
    page.drawText(text, options);
  } catch {
    page.drawText(asciiFallback(text), options);
  }
}

const MM_TO_PT = 2.834645669; // 1mm in PDF points (72dpi)

export const PAGE_WIDTH_MM = 210; // A4
export const PAGE_HEIGHT_MM = 297;
export const LABEL_WIDTH_MM = 38;
export const LABEL_HEIGHT_MM = 21;
export const GRID_COLUMNS = 5;
export const GRID_ROWS = 13;
export const LABELS_PER_SHEET = GRID_COLUMNS * GRID_ROWS; // 65

/** Symmetric margins so the 5×13 grid centers on an A4 page. */
export const MARGIN_X_MM = (PAGE_WIDTH_MM - GRID_COLUMNS * LABEL_WIDTH_MM) / 2;
export const MARGIN_Y_MM = (PAGE_HEIGHT_MM - GRID_ROWS * LABEL_HEIGHT_MM) / 2;

export interface AveryLabelInput {
  /** QR payload — the label's short code (PID or box name). */
  codeValue: string;
  /** Plain-text lines rendered beside the QR; falls back to the code itself. */
  humanText: string | null;
}

function truncateToWidth(font: PDFFont, text: string, maxWidth: number, fontSize: number): string {
  if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, fontSize) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out.length < text.length ? `${out}…` : out;
}

/**
 * Renders every label in `labels` onto one or more Avery-grid A4 pages (65
 * per page) and returns the finished PDF bytes. Empty input still returns a
 * valid (blank) PDF — callers guard "nothing queued" earlier in the flow.
 */
export async function buildAveryPdf(labels: readonly AveryLabelInput[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(FONT_PATH()), { subset: true });

  const pageWidth = PAGE_WIDTH_MM * MM_TO_PT;
  const pageHeight = PAGE_HEIGHT_MM * MM_TO_PT;
  const labelWidth = LABEL_WIDTH_MM * MM_TO_PT;
  const labelHeight = LABEL_HEIGHT_MM * MM_TO_PT;
  const marginX = MARGIN_X_MM * MM_TO_PT;
  const marginY = MARGIN_Y_MM * MM_TO_PT;
  const fontSize = 6.5;
  const lineGap = fontSize + 1.5;

  for (let sheetStart = 0; sheetStart < labels.length; sheetStart += LABELS_PER_SHEET) {
    const page = doc.addPage([pageWidth, pageHeight]);
    const sheetLabels = labels.slice(sheetStart, sheetStart + LABELS_PER_SHEET);

    for (const [indexOnSheet, label] of sheetLabels.entries()) {
      const col = indexOnSheet % GRID_COLUMNS;
      const row = Math.floor(indexOnSheet / GRID_COLUMNS);
      const cellX = marginX + col * labelWidth;
      const cellTop = pageHeight - marginY - row * labelHeight;
      const cellBottom = cellTop - labelHeight;

      // Cut-guide hairline — this computed grid has no real die-cut sheet
      // behind it, so a faint border stands in for one.
      page.drawRectangle({
        x: cellX,
        y: cellBottom,
        width: labelWidth,
        height: labelHeight,
        borderColor: rgb(0.85, 0.85, 0.85),
        borderWidth: 0.5,
      });

      const qrPng = await renderQrPngBuffer(label.codeValue, 220);
      const qrImage = await doc.embedPng(qrPng);
      const qrSize = labelHeight - 8;
      page.drawImage(qrImage, {
        x: cellX + 4,
        y: cellBottom + (labelHeight - qrSize) / 2,
        width: qrSize,
        height: qrSize,
      });

      const textX = cellX + qrSize + 10;
      const maxTextWidth = labelWidth - (qrSize + 14);
      const lines = (label.humanText ?? label.codeValue).split("\n").filter(Boolean);
      const blockHeight = lines.length * lineGap;
      let textY = cellBottom + (labelHeight + blockHeight) / 2 - fontSize;

      for (const line of lines) {
        drawTextSafely(page, truncateToWidth(font, line, maxTextWidth, fontSize), {
          x: textX,
          y: textY,
          size: fontSize,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
        textY -= lineGap;
      }
    }
  }

  return doc.save();
}
