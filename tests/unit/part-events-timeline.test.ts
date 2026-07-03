import { describe, expect, test } from "bun:test";
import { distinctEventTypes, distinctProjects, filterTimeline, shapePartTimeline } from "@/lib/part-events/timeline";
import type { PartEventRow } from "@/types/db";

/**
 * lib/part-events/timeline.ts — R2-13 "everything written on it with
 * timestamps" living-record shaping. Pure — no DB, per plan/TESTING.md §2.
 */

function makeEvent(overrides: Partial<PartEventRow>): PartEventRow {
  return {
    id: "e1",
    created_at: "2026-07-01T10:00:00Z",
    updated_at: null,
    part_id: "part-1",
    event_type: "received",
    distributor: null,
    order_link: null,
    project_id: null,
    reason: null,
    qty: null,
    unit_price: null,
    location_big_box_id: null,
    actor: null,
    source_run_id: null,
    occurred_at: "2026-07-01T10:00:00Z",
    price_old: null,
    price_new: null,
    order_id: null,
    ...overrides,
  };
}

const CONTEXT = {
  usersById: new Map([["u1", "Rohit Talekar"]]),
  projectsById: new Map([["proj-1", { name: "TMCS_96x32", client: "Acme Robotics" }]]),
  ordersById: new Map([["order-1", "PO-4821"]]),
};

describe("shapePartTimeline", () => {
  test("signs the qty and resolves actor/project/client/PO through the context maps", () => {
    const entries = shapePartTimeline(
      [
        makeEvent({
          id: "e1",
          event_type: "received",
          qty: 240,
          actor: "u1",
          project_id: "proj-1",
          order_id: "order-1",
          distributor: "LCSC",
        }),
      ],
      CONTEXT,
    );
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.qtySigned).toBe("+240");
    expect(entry.actorName).toBe("Rohit Talekar");
    expect(entry.projectName).toBe("TMCS_96x32");
    expect(entry.clientName).toBe("Acme Robotics");
    expect(entry.poNumber).toBe("PO-4821");
    expect(entry.distributor).toBe("LCSC");
  });

  test("negative qty stays signed with its minus", () => {
    const entries = shapePartTimeline([makeEvent({ event_type: "picked", qty: -6 })], CONTEXT);
    expect(entries[0]!.qtySigned).toBe("-6");
  });

  test("a null actor renders as System (auto-logged price_change rows)", () => {
    const entries = shapePartTimeline(
      [makeEvent({ event_type: "price_change", actor: null, price_old: 2, price_new: 2.5 })],
      CONTEXT,
    );
    const entry = entries[0]!;
    expect(entry.actorName).toBe("System");
    expect(entry.priceOld).toBe(2);
    expect(entry.priceNew).toBe(2.5);
  });

  test("an unresolvable actor id still renders (never throws)", () => {
    const entries = shapePartTimeline([makeEvent({ actor: "ghost" })], CONTEXT);
    expect(entries[0]!.actorName).toBe("Unknown user");
  });
});

describe("filterTimeline", () => {
  const entries = shapePartTimeline(
    [
      makeEvent({ id: "a", event_type: "received", project_id: "proj-1" }),
      makeEvent({ id: "b", event_type: "picked", project_id: null }),
      makeEvent({ id: "c", event_type: "adjusted", project_id: "proj-1" }),
    ],
    CONTEXT,
  );

  test("no filter => everything passes", () => {
    expect(filterTimeline(entries, { eventTypes: [], projectId: null })).toHaveLength(3);
  });

  test("filters by event type", () => {
    const result = filterTimeline(entries, { eventTypes: ["received", "adjusted"], projectId: null });
    expect(result.map((e) => e.id)).toEqual(["a", "c"]);
  });

  test("filters by project", () => {
    const result = filterTimeline(entries, { eventTypes: [], projectId: "proj-1" });
    expect(result.map((e) => e.id)).toEqual(["a", "c"]);
  });

  test("combines both filters", () => {
    const result = filterTimeline(entries, { eventTypes: ["received"], projectId: "proj-1" });
    expect(result.map((e) => e.id)).toEqual(["a"]);
  });
});

describe("distinctEventTypes / distinctProjects", () => {
  test("distinctEventTypes preserves first-seen order without duplicates", () => {
    const entries = shapePartTimeline(
      [
        makeEvent({ id: "a", event_type: "received" }),
        makeEvent({ id: "b", event_type: "picked" }),
        makeEvent({ id: "c", event_type: "received" }),
      ],
      CONTEXT,
    );
    expect(distinctEventTypes(entries)).toEqual(["received", "picked"]);
  });

  test("distinctProjects lists each referenced project once", () => {
    const entries = shapePartTimeline(
      [
        makeEvent({ id: "a", project_id: "proj-1" }),
        makeEvent({ id: "b", project_id: null }),
        makeEvent({ id: "c", project_id: "proj-1" }),
      ],
      CONTEXT,
    );
    expect(distinctProjects(entries)).toEqual([{ id: "proj-1", name: "TMCS_96x32" }]);
  });
});
