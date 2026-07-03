import { describe, expect, test } from "bun:test";
import { buildContestedMessage, buildContestedStock } from "@/lib/part-events/contested";
import type { PartDemandRow } from "@/types/db";

/**
 * lib/part-events/contested.ts — R2-10 contested-stock strip. Includes the
 * client's own permanent fixture (plan/SCHEMA.md / plan/TESTING.md §5):
 * "500 avail, A needs 400 + B needs 200 → shortfall exactly 100".
 */

function makeDemand(overrides: Partial<PartDemandRow>): PartDemandRow {
  return {
    part_id: "part-1",
    demand: 0,
    available: 0,
    shortfall: 0,
    breakdown: [],
    ...overrides,
  };
}

describe("buildContestedStock", () => {
  test("the permanent 500/400+200→100 fixture", () => {
    const demand = makeDemand({
      demand: 600,
      available: 500,
      shortfall: 100,
      breakdown: [
        { project_id: "proj-a", bom_id: "bom-a", bom_line_id: "line-a", qty: 400 },
        { project_id: "proj-b", bom_id: "bom-b", bom_line_id: "line-b", qty: 200 },
      ],
    });

    const contested = buildContestedStock(demand, 0);
    expect(contested).toEqual({
      partId: "part-1",
      demand: 600,
      available: 500,
      shortfall: 100,
      projectCount: 2,
      inCartQty: 0,
    });
  });

  test("counts distinct projects even with multiple BOM lines from the same project", () => {
    const demand = makeDemand({
      demand: 900,
      available: 500,
      shortfall: 400,
      breakdown: [
        { project_id: "proj-a", bom_id: "bom-a", bom_line_id: "line-a", qty: 300 },
        { project_id: "proj-a", bom_id: "bom-a2", bom_line_id: "line-a2", qty: 300 },
        { project_id: "proj-b", bom_id: "bom-b", bom_line_id: "line-b", qty: 300 },
      ],
    });
    expect(buildContestedStock(demand, 0).projectCount).toBe(2);
  });
});

describe("buildContestedMessage", () => {
  test("renders the exact client-quoted phrasing shape", () => {
    const message = buildContestedMessage({
      partId: "part-1",
      demand: 600,
      available: 500,
      shortfall: 100,
      projectCount: 2,
      inCartQty: 100,
    });
    expect(message).toBe("Demanded 600 across 2 projects · 500 available · 100 in cart");
  });

  test("omits the 'in cart' clause when nothing is in cart yet", () => {
    const message = buildContestedMessage({
      partId: "part-1",
      demand: 600,
      available: 500,
      shortfall: 100,
      projectCount: 2,
      inCartQty: 0,
    });
    expect(message).toBe("Demanded 600 across 2 projects · 500 available");
  });

  test("uses singular 'project' for a single project", () => {
    const message = buildContestedMessage({
      partId: "part-1",
      demand: 400,
      available: 300,
      shortfall: 100,
      projectCount: 1,
      inCartQty: 0,
    });
    expect(message).toBe("Demanded 400 across 1 project · 300 available");
  });
});
