import { describe, expect, test } from "bun:test";
import { STOCK_STATE_LABEL, stockStateOf } from "@/lib/inventory/stock-state";

/**
 * lib/inventory/stock-state.ts — mission note: "Stock state rule: qty=0 out,
 * ≤reorder_point low (shared util in your files)". Shared with Dashboard
 * stats + Shelves low dots per FEATURES.md §5.
 */

describe("stockStateOf", () => {
  test("qty <= 0 is always out, regardless of reorder point", () => {
    expect(stockStateOf(0, 50)).toBe("out");
    expect(stockStateOf(0, null)).toBe("out");
    expect(stockStateOf(-1, 50)).toBe("out");
  });

  test("qty <= reorder_point (but > 0) is low", () => {
    expect(stockStateOf(50, 50)).toBe("low");
    expect(stockStateOf(1, 50)).toBe("low");
  });

  test("qty above reorder_point is ok", () => {
    expect(stockStateOf(51, 50)).toBe("ok");
  });

  test("a null/undefined reorder point never triggers low (no threshold set)", () => {
    expect(stockStateOf(1, null)).toBe("ok");
    expect(stockStateOf(1, undefined)).toBe("ok");
  });
});

describe("STOCK_STATE_LABEL", () => {
  test("matches the prototype's facet labels", () => {
    expect(STOCK_STATE_LABEL.ok).toBe("In stock");
    expect(STOCK_STATE_LABEL.low).toBe("Low");
    expect(STOCK_STATE_LABEL.out).toBe("Out");
  });
});
