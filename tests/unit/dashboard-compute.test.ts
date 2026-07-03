import { describe, expect, test } from "bun:test";
import {
  buildProjectUsageBars,
  composeBoxLabel,
  computeInventoryValue,
  deltaTone,
  formatDelta,
  movementReasonLabel,
  stockStateFor,
  todayBoundsIso,
  uniq,
} from "@/lib/dashboard/compute";

/**
 * lib/dashboard/compute — pure rules behind the Dashboard tiles/feed/bars
 * (plan/tab-dashboard.md). DB-free by design; lib/dashboard/queries.ts is the
 * only caller that touches Supabase.
 */

describe("stockStateFor", () => {
  test("0 units is always out, regardless of reorder point", () => {
    expect(stockStateFor(0, 500)).toBe("out");
    expect(stockStateFor(0, null)).toBe("out");
  });

  test("negative qty (shouldn't happen, but be defensive) reads as out", () => {
    expect(stockStateFor(-3, 10)).toBe("out");
  });

  test("qty at or below reorder point is low", () => {
    expect(stockStateFor(500, 500)).toBe("low");
    expect(stockStateFor(1, 500)).toBe("low");
  });

  test("qty above reorder point is ok", () => {
    expect(stockStateFor(501, 500)).toBe("ok");
  });

  test("null reorder point never triggers low (treated as 0)", () => {
    expect(stockStateFor(1, null)).toBe("ok");
    expect(stockStateFor(1_000_000, null)).toBe("ok");
  });
});

describe("computeInventoryValue", () => {
  test("sums qty × price across priced parts", () => {
    const { value } = computeInventoryValue([
      { total_qty: 100, last_unit_price: 0.5 },
      { total_qty: 10, last_unit_price: 2 },
    ]);
    expect(value).toBeCloseTo(100 * 0.5 + 10 * 2);
  });

  test("excludes unpriced parts from the sum", () => {
    const { value, unpricedCount } = computeInventoryValue([
      { total_qty: 100, last_unit_price: 0.5 },
      { total_qty: 50, last_unit_price: null },
    ]);
    expect(value).toBeCloseTo(50);
    expect(unpricedCount).toBe(1);
  });

  test("unpriced parts with zero stock don't count toward the honesty label", () => {
    const { unpricedCount } = computeInventoryValue([{ total_qty: 0, last_unit_price: null }]);
    expect(unpricedCount).toBe(0);
  });

  test("empty catalog yields zero value and zero unpriced", () => {
    expect(computeInventoryValue([])).toEqual({ value: 0, unpricedCount: 0 });
  });
});

describe("formatDelta / deltaTone", () => {
  test("positive delta gets a plus sign and neutral tone", () => {
    expect(formatDelta(50)).toBe("+50");
    expect(deltaTone(50)).toBe("neutral");
  });

  test("negative delta gets a real minus sign and accent tone", () => {
    expect(formatDelta(-145)).toBe("−145");
    expect(deltaTone(-145)).toBe("accent");
  });

  test("zero reads as a positive (+0), never negative", () => {
    expect(formatDelta(0)).toBe("+0");
    expect(deltaTone(0)).toBe("neutral");
  });
});

describe("movementReasonLabel", () => {
  test("bare reason when no BOM or detail", () => {
    expect(movementReasonLabel("receive")).toBe("receive");
    expect(movementReasonLabel("undo")).toBe("undo");
  });

  test("bulk_pick renders with a space, not an underscore", () => {
    expect(movementReasonLabel("bulk_pick")).toBe("bulk pick");
  });

  test("BOM name is appended when present", () => {
    expect(movementReasonLabel("pick", { bomName: "TMCS_96x32" })).toBe("pick · TMCS_96x32");
  });

  test("reason_detail is appended when there is no BOM name", () => {
    expect(movementReasonLabel("adjust", { reasonDetail: "audit" })).toBe("adjust · audit");
  });

  test("BOM name takes priority over reason_detail if both are somehow set", () => {
    expect(
      movementReasonLabel("pick", { bomName: "GCU_V1.1", reasonDetail: "audit" }),
    ).toBe("pick · GCU_V1.1");
  });
});

describe("composeBoxLabel", () => {
  test("prefixes the shelf code when known", () => {
    expect(composeBoxLabel({ name: "Data-converter ICs", shelfCode: "B" })).toBe(
      "B · Data-converter ICs",
    );
  });

  test("falls back to the bare box name without a shelf code", () => {
    expect(composeBoxLabel({ name: "Data-converter ICs", shelfCode: null })).toBe(
      "Data-converter ICs",
    );
  });
});

describe("todayBoundsIso", () => {
  test("spans exactly local midnight to the next local midnight", () => {
    const reference = new Date(2026, 6, 3, 14, 22, 0); // 3 Jul 2026, 14:22 local
    const { start, end } = todayBoundsIso(reference);
    const startDate = new Date(start);
    const endDate = new Date(end);
    expect(startDate.getFullYear()).toBe(2026);
    expect(startDate.getMonth()).toBe(6);
    expect(startDate.getDate()).toBe(3);
    expect(startDate.getHours()).toBe(0);
    expect(endDate.getTime() - startDate.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe("buildProjectUsageBars", () => {
  test("sorts descending by count and scales pct to the max", () => {
    const bars = buildProjectUsageBars([
      { projectId: "p1", name: "Power Breezer", count: 182 },
      { projectId: "p2", name: "GCU", count: 713 },
      { projectId: "p3", name: "DAQ", count: 146 },
    ]);
    expect(bars.map((b) => b.projectId)).toEqual(["p2", "p1", "p3"]);
    expect(bars[0]?.pct).toBe(100);
    expect(bars[1]?.pct).toBe(Math.round((182 / 713) * 100));
  });

  test("caps at the given limit", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      projectId: `p${i}`,
      name: `Project ${i}`,
      count: i,
    }));
    expect(buildProjectUsageBars(rows, 4)).toHaveLength(4);
  });

  test("empty input yields empty output with no division-by-zero NaN", () => {
    expect(buildProjectUsageBars([])).toEqual([]);
  });
});

describe("uniq", () => {
  test("de-dupes and drops null/undefined", () => {
    expect(uniq(["a", "b", "a", null, "c", undefined])).toEqual(["a", "b", "c"]);
  });

  test("empty input yields empty output", () => {
    expect(uniq([])).toEqual([]);
  });
});
