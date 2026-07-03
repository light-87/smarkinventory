import { describe, expect, test } from "bun:test";
import {
  groupOrderLines,
  mapReceiptLinesToOrderGroups,
  type OrderLineGroup,
  type ReceiptOrderLineInput,
} from "@/lib/orders/receipt-map";
import type { ReceiptExtractLine } from "@/lib/ai";

function line(overrides: Partial<ReceiptOrderLineInput> & Pick<ReceiptOrderLineInput, "orderLineId">): ReceiptOrderLineInput {
  return {
    cartItemId: null,
    mpn: null,
    lcscPn: null,
    value: null,
    package: null,
    internalPid: null,
    qtyOrdered: 0,
    unitPrice: null,
    ...overrides,
  };
}

function extracted(desc: string, qty: number, unit_price: number): ReceiptExtractLine {
  return { desc, qty, unit_price };
}

describe("lib/orders/receipt-map — groupOrderLines", () => {
  test("collapses sibling split lines (same cart_item_id) into one group, summing qty", () => {
    const groups = groupOrderLines([
      line({ orderLineId: "ol-1", cartItemId: "cart-1", mpn: "STM32F103C8T6", qtyOrdered: 67 }),
      line({ orderLineId: "ol-2", cartItemId: "cart-1", mpn: "STM32F103C8T6", qtyOrdered: 33 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.orderLineIds).toEqual(["ol-1", "ol-2"]);
    expect(groups[0]!.qtyOrdered).toBe(100);
    expect(groups[0]!.cartItemId).toBe("cart-1");
  });

  test("lines with different cart_item_id (or none) never collapse into each other", () => {
    const groups = groupOrderLines([
      line({ orderLineId: "ol-1", cartItemId: "cart-1", qtyOrdered: 10 }),
      line({ orderLineId: "ol-2", cartItemId: "cart-2", qtyOrdered: 20 }),
      line({ orderLineId: "ol-3", cartItemId: null, qtyOrdered: 5 }),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.qtyOrdered).sort((a, b) => a - b)).toEqual([5, 10, 20]);
  });
});

describe("lib/orders/receipt-map — mapReceiptLinesToOrderGroups", () => {
  test("exact MPN match wins at full confidence", () => {
    const groups = groupOrderLines([line({ orderLineId: "ol-1", cartItemId: "cart-1", mpn: "STM32F103C8T6", qtyOrdered: 100 })]);
    const [mapping] = mapReceiptLinesToOrderGroups([extracted("STM32F103C8T6", 100, 42.5)], groups);

    expect(mapping!.groupKey).toBe("cart-1");
    expect(mapping!.matchMethod).toBe("mpn");
    expect(mapping!.confidence).toBe(100);
  });

  test("MPN embedded in a longer receipt description still matches", () => {
    const groups = groupOrderLines([line({ orderLineId: "ol-1", cartItemId: "cart-1", mpn: "STM32F103C8T6", qtyOrdered: 100 })]);
    const [mapping] = mapReceiptLinesToOrderGroups([extracted("STM32F103C8T6 MCU 100 units", 100, 42.5)], groups);

    expect(mapping!.groupKey).toBe("cart-1");
    expect(mapping!.matchMethod).toBe("mpn");
  });

  test("no MPN on either side falls back to a fuzzy value+package match", () => {
    const groups = groupOrderLines([
      line({ orderLineId: "ol-1", cartItemId: "cart-1", value: "4.7k", package: "0603", qtyOrdered: 500 }),
    ]);
    const [mapping] = mapReceiptLinesToOrderGroups([extracted("0603 4.7k 1% resistor", 500, 0.35)], groups);

    expect(mapping!.groupKey).toBe("cart-1");
    expect(mapping!.matchMethod).toBe("fuzzy");
    expect(mapping!.confidence).toBeGreaterThan(0);
  });

  test("a receipt line matching nothing on the order comes back unmatched, never guessed", () => {
    const groups = groupOrderLines([line({ orderLineId: "ol-1", cartItemId: "cart-1", mpn: "STM32F103C8T6", qtyOrdered: 100 })]);
    const [mapping] = mapReceiptLinesToOrderGroups([extracted("Shipping & handling", 1, 250)], groups);

    expect(mapping!.groupKey).toBeNull();
    expect(mapping!.matchMethod).toBeNull();
    expect(mapping!.confidence).toBe(0);
  });

  test("each order-line group is claimed by at most one extracted line — the better match wins, the loser stays unmatched", () => {
    const groups = groupOrderLines([line({ orderLineId: "ol-1", cartItemId: "cart-1", mpn: "STM32F103C8T6", qtyOrdered: 100 })]);
    const mappings = mapReceiptLinesToOrderGroups(
      [extracted("STM32F103C8T6", 100, 42.5), extracted("STM32F103C8T6 (duplicate OCR line)", 100, 42.5)],
      groups,
    );

    const claimed = mappings.filter((m) => m.groupKey === "cart-1");
    expect(claimed).toHaveLength(1);
    const unclaimed = mappings.find((m) => m.groupKey === null);
    expect(unclaimed).toBeDefined();
  });

  test("package is part of the fuzzy identity — a same-value line in the wrong package scores lower and loses", () => {
    const groups = groupOrderLines([
      line({ orderLineId: "ol-1", cartItemId: "cart-1", value: "4.7k", package: "0603", qtyOrdered: 500 }),
      line({ orderLineId: "ol-2", cartItemId: "cart-2", value: "4.7k", package: "0805", qtyOrdered: 200 }),
    ]);
    const mappings = mapReceiptLinesToOrderGroups([extracted("0603 4.7k 1% resistor", 500, 0.35)], groups);

    expect(mappings).toHaveLength(1);
    expect(mappings[0]!.groupKey).toBe("cart-1");
  });

  test("multiple receipt lines map independently to their own groups (the canonical mock fixture shape)", () => {
    const groups = groupOrderLines([
      line({ orderLineId: "ol-1", cartItemId: "cart-1", mpn: "STM32F103C8T6", qtyOrdered: 100 }),
      line({ orderLineId: "ol-2", cartItemId: "cart-2", value: "4.7k", package: "0603", qtyOrdered: 500 }),
      line({ orderLineId: "ol-3", cartItemId: "cart-3", value: "0.1uF", qtyOrdered: 500 }),
    ]);
    const mappings = mapReceiptLinesToOrderGroups(
      [
        extracted("STM32F103C8T6", 100, 42.5),
        extracted("0603 4.7k 1% resistor", 500, 0.35),
        extracted("0.1uF 50V X7R capacitor", 500, 1.1),
      ],
      groups,
    );

    expect(mappings.map((m) => m.groupKey)).toEqual(["cart-1", "cart-2", "cart-3"]);
    expect(mappings.every((m) => m.matchMethod !== null)).toBe(true);
  });

  test("an empty group list leaves every extracted line unmatched instead of throwing", () => {
    const mappings = mapReceiptLinesToOrderGroups([extracted("anything", 1, 1)], []);
    expect(mappings).toEqual([
      { extractedIndex: 0, desc: "anything", qty: 1, unitPrice: 1, groupKey: null, matchMethod: null, confidence: 0 },
    ]);
  });

  test("preserves extracted order and carries qty/unit_price through untouched", () => {
    const groups: OrderLineGroup[] = [];
    const mappings = mapReceiptLinesToOrderGroups([extracted("a", 2, 10), extracted("b", 3, 20)], groups);
    expect(mappings.map((m) => [m.desc, m.qty, m.unitPrice])).toEqual([
      ["a", 2, 10],
      ["b", 3, 20],
    ]);
  });
});
