/**
 * A resistor label must not take the whole print sheet with it.
 *
 * The catalogue writes resistance as `0 Ω` / `10 kΩ`, and the PDF used a
 * WinAnsi standard font, which cannot encode `Ω`. The first resistor anyone
 * queued threw `WinAnsi cannot encode "Ω" (0x03a9)` and the whole sheet failed
 * — the client saw a tab open and close with no file (2026-08-20). Worse, the
 * queue survives printing now, so that one label would have blocked every
 * future print rather than just its own.
 */

import { describe, expect, test } from "bun:test";
import { buildAveryPdf } from "@/lib/labels/avery";

const isPdf = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";

describe("label sheet with non-WinAnsi characters", () => {
  test("renders a resistor label containing Ω", async () => {
    const pdf = await buildAveryPdf([{ codeValue: "SMK-001307", humanText: "SMK-001307\n0 Ω · 0603" }]);
    expect(isPdf(pdf)).toBe(true);
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  test("renders the other symbols the catalogue actually uses", async () => {
    const pdf = await buildAveryPdf([
      { codeValue: "A", humanText: "10 µF · ±5%" },
      { codeValue: "B", humanText: "1 kΩ · 1206" },
      { codeValue: "C", humanText: "₹120 · 0402" },
    ]);
    expect(isPdf(pdf)).toBe(true);
  });

  test("one unprintable label does not stop the rest of the sheet", async () => {
    const pdf = await buildAveryPdf([
      { codeValue: "GOOD-1", humanText: "GOOD-1\n100 nF" },
      { codeValue: "ODD", humanText: "\u{10FFFF}\u{1F600} weird" },
      { codeValue: "GOOD-2", humanText: "GOOD-2\n0 Ω" },
    ]);
    expect(isPdf(pdf)).toBe(true);
  });
});
