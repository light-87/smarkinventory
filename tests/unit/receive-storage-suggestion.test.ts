import { describe, expect, test } from "bun:test";
import {
  FALLBACK_SHELF_CODE,
  suggestStorageBox,
  type BoxOption,
} from "@/lib/receive/storage-suggestion";

/**
 * lib/receive/storage-suggestion — "AI-suggested storage" (plan/tab-receive.md
 * §2A). Pure, no AI call yet — category+package match over Big Boxes, with a
 * deterministic fallback ("Unsorted" shelf) so a New-part save never leaves
 * qty un-homed.
 */

const boxes: BoxOption[] = [
  { id: "box-caps-0603", name: "Capacitors 0603", shelfCode: "B", category: "Capacitor" },
  { id: "box-caps-general", name: "Capacitors", shelfCode: "B", category: "Capacitor" },
  { id: "box-resistors", name: "Resistors", shelfCode: "C", category: "Resistor" },
];

describe("suggestStorageBox", () => {
  test("prefers a box whose name hints at the package over a general category box", () => {
    const result = suggestStorageBox("Capacitor", "0603", boxes);
    expect(result.kind).toBe("existing");
    expect(result.kind === "existing" && result.boxId).toBe("box-caps-0603");
    expect(result.label).toContain("Capacitors 0603");
    expect(result.label).toContain("Shelf B");
  });

  test("falls back to the first category match when no box name hints at the package", () => {
    const result = suggestStorageBox("Capacitor", "0805", boxes);
    expect(result.kind).toBe("existing");
    expect(result.kind === "existing" && result.boxId).toBe("box-caps-0603");
  });

  test("matches category case-insensitively", () => {
    const result = suggestStorageBox("resistor", "0603", boxes);
    expect(result.kind).toBe("existing");
    expect(result.kind === "existing" && result.boxId).toBe("box-resistors");
  });

  test("proposes a NEW box on the fallback shelf when no category matches", () => {
    const result = suggestStorageBox("Inductor", "1210", boxes);
    expect(result.kind).toBe("new");
    expect(result.kind === "new" && result.shelfCode).toBe(FALLBACK_SHELF_CODE);
    expect(result.kind === "new" && result.boxName).toBe("Inductor 1210");
  });

  test("proposes a NEW box named 'General' when category is missing entirely", () => {
    const result = suggestStorageBox(null, null, boxes);
    expect(result.kind).toBe("new");
    expect(result.kind === "new" && result.boxName).toBe("General");
  });

  test("is deterministic — same input, same output, regardless of call order", () => {
    const a = suggestStorageBox("Capacitor", "0603", boxes);
    const b = suggestStorageBox("Capacitor", "0603", boxes);
    expect(a).toEqual(b);
  });
});
