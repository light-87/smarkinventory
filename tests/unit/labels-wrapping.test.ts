/**
 * Label text wraps instead of being cut (lib/labels/avery.ts).
 *
 * Client, 2026-08-21, photographing a Big-Box label that read "BOX Conne…":
 * "The text should not be cut off… It can be wrapped down." The renderer used
 * to truncate any line wider than the ~15mm of text space beside the QR, which
 * on a box label was its own name.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { buildAveryPdf, layoutLabelText, wrapToWidth } from "@/lib/labels/avery";

/** The same embedded Noto Sans the sheet renders with, so widths are the real ones. */
async function loadFont(): Promise<PDFFont> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  return doc.embedFont(readFileSync(path.join(process.cwd(), "lib", "runs", "fonts", "NotoSans-Regular.ttf")));
}

const font = await loadFont();

/** Text box on a 38×21mm label once the QR is capped at 14mm: ~55pt × ~53pt. */
const MAX_WIDTH = 55;
const MAX_HEIGHT = 53.5;

describe("wrapToWidth", () => {
  test("leaves a line that already fits untouched", () => {
    expect(wrapToWidth(font, "1 kΩ · 0805", MAX_WIDTH, 6.5)).toEqual(["1 kΩ · 0805"]);
  });

  test("wraps a long IC description instead of cutting it", () => {
    const lines = wrapToWidth(font, "IC OSC SGL TIMER 100KHZ 8-SOIC", MAX_WIDTH, 5);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe("IC OSC SGL TIMER 100KHZ 8-SOIC");
    expect(lines.some((line) => line.includes("…"))).toBe(false);
  });

  test("keeps the whole box name — the exact string the client saw truncated", () => {
    expect(wrapToWidth(font, "BOX Connector", MAX_WIDTH, 6.5).join(" ")).toBe("BOX Connector");
  });

  test("breaks a single unbroken token that is wider than the label", () => {
    const lines = wrapToWidth(font, "IHLP4040DZER150M5AVERYLONGSUFFIX", 30, 6.5);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("IHLP4040DZER150M5AVERYLONGSUFFIX");
  });

  test("never returns an empty result", () => {
    expect(wrapToWidth(font, "x", 0.1, 6.5).join("")).toBe("x");
  });
});

describe("layoutLabelText", () => {
  test("uses the largest size for a short resistor label", () => {
    const layout = layoutLabelText(font, ["SMK-001477", "1 kΩ · 0805", "400V · 500mW"], MAX_WIDTH, MAX_HEIGHT);
    expect(layout.fontSize).toBe(6.5);
    expect(layout.lines).toHaveLength(3);
  });

  test("keeps every line of a wordy IC label, shrinking the type to fit", () => {
    const layout = layoutLabelText(
      font,
      ["SMK-000863", "LM555CMX/NOPB", "IC OSC SGL TIMER 100KHZ 8-SOIC"],
      MAX_WIDTH,
      MAX_HEIGHT,
    );
    expect(layout.lines.join(" ")).toContain("IC OSC SGL TIMER 100KHZ 8-SOIC");
    expect(layout.lines[0]).toBe("SMK-000863");
    expect(layout.fontSize).toBeLessThanOrEqual(6.5);
  });

  test("the rendered block always fits inside the label's text box", () => {
    const layout = layoutLabelText(
      font,
      ["SMK-000001", "A very long description that goes on and on and on for a while", "50V · 500mW"],
      MAX_WIDTH,
      MAX_HEIGHT,
    );
    expect(layout.lines.length * layout.fontSize * 1.22).toBeLessThanOrEqual(MAX_HEIGHT);
  });

  test("drops trailing lines rather than overflowing onto the next label", () => {
    const absurd = Array.from({ length: 40 }, (_, i) => `line number ${i} with several words in it`);
    const layout = layoutLabelText(font, absurd, MAX_WIDTH, MAX_HEIGHT);
    expect(layout.lines.length * layout.fontSize * 1.22).toBeLessThanOrEqual(MAX_HEIGHT);
    expect(layout.lines[0]).toStartWith("line number 0");
  });
});

describe("buildAveryPdf with the new multi-line labels", () => {
  test("a full resistor + IC + box mix renders one valid page", async () => {
    const bytes = await buildAveryPdf([
      { codeValue: "SMK-001477", humanText: "SMK-001477\n1 kΩ · 0805\n400V · 500mW" },
      { codeValue: "SMK-000863", humanText: "SMK-000863\nLM555CMX/NOPB\nIC OSC SGL TIMER 100KHZ 8-SOIC" },
      { codeValue: "Connector", humanText: "BOX Connector\nShelf U" },
    ]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});
