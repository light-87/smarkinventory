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
  /** Newline-separated lines rendered beside the QR; falls back to the code itself. */
  humanText: string | null;
}

/**
 * Cap on the QR square, so the text column gets the rest of the label.
 *
 * It used to take the full label height (~18.7mm of a 38mm-wide label), leaving
 * ~15mm for text — about eleven characters at 6.5pt. That is why the client
 * photographed a box label reading "BOX Conne…". Every code we encode is short
 * (`SMK-001477`, `Resistor 1206`), which is QR version 1 — 21 modules across,
 * so 14mm is 0.67mm per module and still scans comfortably from a phone.
 */
const QR_MAX_MM = 14;

/** Tried largest-first; the first size whose wrapped block fits the label wins. */
const FONT_SIZES = [6.5, 6, 5.5, 5, 4.5, 4] as const;
const LINE_HEIGHT_RATIO = 1.22;

/** Text width, transliterating first if the font can't measure the string as-is. */
function widthOf(font: PDFFont, text: string, fontSize: number): number {
  try {
    return font.widthOfTextAtSize(text, fontSize);
  } catch {
    return font.widthOfTextAtSize(asciiFallback(text), fontSize);
  }
}

/**
 * Splits one line into as many as it takes to stay inside `maxWidth`.
 *
 * Replaces the old truncate-with-an-ellipsis, which silently dropped whatever
 * did not fit — including, on a box label, the box's own name. The client's
 * instruction was simply "it can be wrapped down".
 */
export function wrapToWidth(font: PDFFont, text: string, maxWidth: number, fontSize: number): string[] {
  if (widthOf(font, text, fontSize) <= maxWidth) return [text];

  const out: string[] = [];
  let current = "";

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (widthOf(font, candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      out.push(current);
      current = "";
    }
    if (widthOf(font, word, fontSize) <= maxWidth) {
      current = word;
      continue;
    }
    // One unbroken token wider than the label — a long MPN like
    // IHLP4040DZER150M5A. Break it by character; a part number split across two
    // lines is still readable, a part number cut short is not.
    let chunk = "";
    for (const char of word) {
      if (chunk && widthOf(font, chunk + char, fontSize) > maxWidth) {
        out.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    current = chunk;
  }

  if (current) out.push(current);
  return out.length > 0 ? out : [text];
}

export interface TextLayout {
  fontSize: number;
  lines: string[];
}

/**
 * Largest font size at which the wrapped block fits the label's text box.
 *
 * Shrinking beats clipping: a resistor now carries five facts and an IC's
 * description can run to thirty characters, so a fixed 6.5pt would put the
 * label back where it started. Only if even 4pt overflows does it drop whole
 * trailing lines, which keeps a label inside its own cut guide instead of
 * printing over its neighbour.
 */
export function layoutLabelText(font: PDFFont, lines: readonly string[], maxWidth: number, maxHeight: number): TextLayout {
  let layout: TextLayout = { fontSize: FONT_SIZES[FONT_SIZES.length - 1]!, lines: [...lines] };

  for (const fontSize of FONT_SIZES) {
    const wrapped = lines.flatMap((line) => wrapToWidth(font, line, maxWidth, fontSize));
    layout = { fontSize, lines: wrapped };
    if (wrapped.length * fontSize * LINE_HEIGHT_RATIO <= maxHeight) return layout;
  }

  const maxLines = Math.max(1, Math.floor(maxHeight / (layout.fontSize * LINE_HEIGHT_RATIO)));
  return { fontSize: layout.fontSize, lines: layout.lines.slice(0, maxLines) };
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
      const qrSize = Math.min(labelHeight - 8, QR_MAX_MM * MM_TO_PT);
      page.drawImage(qrImage, {
        x: cellX + 4,
        y: cellBottom + (labelHeight - qrSize) / 2,
        width: qrSize,
        height: qrSize,
      });

      const textX = cellX + 4 + qrSize + 5;
      const maxTextWidth = cellX + labelWidth - 4 - textX;
      const maxTextHeight = labelHeight - 6;
      const sourceLines = (label.humanText ?? label.codeValue).split("\n").filter(Boolean);
      const layout = layoutLabelText(font, sourceLines, maxTextWidth, maxTextHeight);

      const lineGap = layout.fontSize * LINE_HEIGHT_RATIO;
      const blockHeight = layout.lines.length * lineGap;
      let textY = cellBottom + (labelHeight + blockHeight) / 2 - layout.fontSize;

      for (const line of layout.lines) {
        drawTextSafely(page, line, {
          x: textX,
          y: textY,
          size: layout.fontSize,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
        textY -= lineGap;
      }
    }
  }

  return doc.save();
}
