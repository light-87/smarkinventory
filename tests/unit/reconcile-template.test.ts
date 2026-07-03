import { describe, expect, test } from "bun:test";
import {
  isStandardBomColumnKey,
  makeCustomColumn,
  mergeWithStandardColumns,
  STANDARD_BOM_COLUMNS,
} from "@/lib/bom/columns";
import { validateBomRows } from "@/lib/bom/validate";
import type { BomTemplateColumn } from "@/types/db";

/**
 * lib/bom/columns.ts + lib/bom/validate.ts — R2-19 "structure memory" (the
 * remembered company template merges standard + custom columns, order
 * preserved) and the Create-BOM grid's required-field validation
 * (Reference/Qty/Value at minimum). plan/TESTING.md "unit: … templates".
 */

describe("standard columns", () => {
  test("the 11 standard keys are exactly what R2-19/FEATURES §5.8 specify", () => {
    expect(STANDARD_BOM_COLUMNS.map((c) => c.key)).toEqual([
      "line_no",
      "references",
      "qty",
      "value",
      "footprint",
      "dnp",
      "description",
      "mpn",
      "manufacturer",
      "part_link",
      "lcsc_pn",
      "priority_note",
    ]);
  });

  test("Reference, Qty, Value are required; everything else isn't", () => {
    const required = STANDARD_BOM_COLUMNS.filter((c) => c.required).map((c) => c.key);
    expect(new Set(required)).toEqual(new Set(["references", "qty", "value"]));
  });

  test("isStandardBomColumnKey recognizes the standard set and rejects a custom key", () => {
    expect(isStandardBomColumnKey("mpn")).toBe(true);
    expect(isStandardBomColumnKey("tolerance")).toBe(false);
  });
});

describe("makeCustomColumn", () => {
  test("slugifies the label into a key and marks it custom", () => {
    const column = makeCustomColumn("Tolerance %", "text");
    expect(column).toEqual({ key: "tolerance", label: "Tolerance %", type: "text", required: false, is_custom: true });
  });

  test("refuses a label that slugifies to a standard column key", () => {
    expect(makeCustomColumn("Qty", "number")).toBeNull();
    expect(makeCustomColumn("  ", "text")).toBeNull();
  });
});

describe("mergeWithStandardColumns", () => {
  test("no saved template → just the standard columns", () => {
    expect(mergeWithStandardColumns(null)).toEqual([...STANDARD_BOM_COLUMNS]);
  });

  test("standard columns always come first, current label/type — saved custom columns appended in order", () => {
    const custom: BomTemplateColumn[] = [
      { key: "tolerance", label: "Tolerance", type: "text", required: false, is_custom: true },
      { key: "lead_time_days", label: "Lead time (days)", type: "number", required: false, is_custom: true },
    ];
    const merged = mergeWithStandardColumns([...STANDARD_BOM_COLUMNS, ...custom]);
    expect(merged.slice(0, STANDARD_BOM_COLUMNS.length)).toEqual([...STANDARD_BOM_COLUMNS]);
    expect(merged.slice(STANDARD_BOM_COLUMNS.length)).toEqual(custom);
  });

  test("a saved template that accidentally duplicated a standard key is de-duped in favor of the canonical definition", () => {
    const drifted: BomTemplateColumn[] = [{ key: "mpn", label: "MPN (old label)", type: "text", required: false, is_custom: false }];
    const merged = mergeWithStandardColumns(drifted);
    expect(merged.filter((c) => c.key === "mpn")).toHaveLength(1);
    expect(merged.find((c) => c.key === "mpn")?.label).toBe("MPN");
  });
});

describe("validateBomRows", () => {
  const columns = [...STANDARD_BOM_COLUMNS];

  test("empty grid is invalid", () => {
    expect(validateBomRows(columns, [])).toEqual(["Add at least one line."]);
  });

  test("missing Reference/Qty/Value are each reported, 1-indexed by row", () => {
    const errors = validateBomRows(columns, [{ references: "", qty: 5, value: "4.7k" }, { references: "R1", qty: null, value: "" }]);
    expect(errors).toEqual([
      "Row 1: Reference is required.",
      "Row 2: Qty is required.",
      "Row 2: Value is required.",
    ]);
  });

  test("a fully-filled row (with a custom column left blank) passes", () => {
    const withCustom = [...columns, { key: "tolerance", label: "Tolerance", type: "text" as const, required: false, is_custom: true }];
    const errors = validateBomRows(withCustom, [{ references: "R1", qty: 1, value: "4.7k", tolerance: "" }]);
    expect(errors).toEqual([]);
  });
});
