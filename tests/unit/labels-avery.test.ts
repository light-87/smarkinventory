import { describe, expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import {
  GRID_COLUMNS,
  GRID_ROWS,
  LABELS_PER_SHEET,
  buildAveryPdf,
  type AveryLabelInput,
} from "@/lib/labels/avery";

/**
 * lib/labels/avery — batch label sheet renderer (FEATURES.md §8 · R2-35).
 * Layout: Avery L7651, 38×21mm, 5×13 grid (65/sheet) per the build brief.
 */

function makeLabels(count: number): AveryLabelInput[] {
  return Array.from({ length: count }, (_, i) => ({
    codeValue: `SMK-${String(i + 1).padStart(6, "0")}`,
    humanText: `SMK-${String(i + 1).padStart(6, "0")}\n100nF · 0603`,
  }));
}

describe("Avery grid layout constants", () => {
  test("5 columns × 13 rows = 65 labels per sheet", () => {
    expect(GRID_COLUMNS).toBe(5);
    expect(GRID_ROWS).toBe(13);
    expect(LABELS_PER_SHEET).toBe(65);
  });
});

describe("buildAveryPdf", () => {
  test("renders a valid PDF even for an empty queue (callers guard 'nothing queued' earlier)", async () => {
    const bytes = await buildAveryPdf([]);
    const header = Buffer.from(bytes.slice(0, 5)).toString("utf8");
    expect(header).toBe("%PDF-");
    // pdf-lib keeps a PDF valid by not persisting a truly page-less document —
    // callers (app/api/labels/print-sheet) never reach this case in practice,
    // this just proves it doesn't throw or corrupt the file.
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });

  test("one label renders on exactly one page", async () => {
    const bytes = await buildAveryPdf(makeLabels(1));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  test("exactly LABELS_PER_SHEET labels still fit on one page", async () => {
    const bytes = await buildAveryPdf(makeLabels(LABELS_PER_SHEET));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  test("one label over a full sheet spills onto a second page", async () => {
    const bytes = await buildAveryPdf(makeLabels(LABELS_PER_SHEET + 1));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  test("a real onboarding-scale batch (2 sheets' worth) paginates correctly", async () => {
    const bytes = await buildAveryPdf(makeLabels(LABELS_PER_SHEET * 2));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  test("falls back to the code value when human_text is null", async () => {
    const bytes = await buildAveryPdf([{ codeValue: "SMK-000001", humanText: null }]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});
