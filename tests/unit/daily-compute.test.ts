import { describe, expect, test } from "bun:test";
import {
  computeMovementTotals,
  dateRangeToIsoBounds,
  dayToIsoBounds,
  filterActivityForActor,
  formatInOutRange,
  formatMovementLine,
  groupMovementsByActor,
  isValidDateOnly,
  movementVerb,
  needsHoursPrompt,
  shiftDateOnly,
  sumHours,
  todayDateOnly,
  type MovementDailyRow,
  type OrderingActivityItem,
} from "@/lib/daily/compute";

/**
 * lib/daily/compute — pure rules behind Daily Reports (plan/tab-daily-
 * reports.md R2-07). DB-free by design; lib/daily/queries.ts is the only
 * caller that touches Supabase. Covers the "employee sees self only"
 * visibility filter (FEATURES.md §2/§5.13) and the movement/date helpers.
 */

function movement(overrides: Partial<MovementDailyRow> = {}): MovementDailyRow {
  return {
    id: "m1",
    occurredAt: "2026-07-03T10:00:00.000Z",
    actorId: "user-a",
    deltaQty: -145,
    reason: "bulk_pick",
    reasonDetail: null,
    pid: "SMK-000101",
    boxLabel: "B · B-12",
    bomName: "TMCS Mainboard",
    ...overrides,
  };
}

describe("date helpers — finding #4: anchored to Asia/Kolkata (IST), not server-local", () => {
  test("todayDateOnly formats YYYY-MM-DD for the IST calendar day containing a given reference instant", () => {
    // 2026-07-03T05:30:00Z = 11:00 IST, 3 Jul — well inside the IST day of 3 Jul.
    expect(todayDateOnly(new Date("2026-07-03T05:30:00.000Z"))).toBe("2026-07-03");
  });

  test("an event just after midnight IST (before 05:30 IST) resolves to TODAY's IST date, not the earlier UTC calendar day", () => {
    // 2026-07-02T20:00:00Z = 01:30 IST on 3 Jul. The pre-fix server-local/UTC
    // implementation would read this instant's UTC calendar date (2 Jul) —
    // e.g. an employee clocking in at 01:30 IST would be logged against
    // YESTERDAY's work_date instead of today's.
    expect(todayDateOnly(new Date("2026-07-02T20:00:00.000Z"))).toBe("2026-07-03");
  });

  test("shiftDateOnly steps forward/back across month boundaries", () => {
    expect(shiftDateOnly("2026-07-01", -1)).toBe("2026-06-30");
    expect(shiftDateOnly("2026-06-30", 1)).toBe("2026-07-01");
  });

  test("dateRangeToIsoBounds is [from 00:00 IST, to+1day 00:00 IST)", () => {
    const { startIso, endIso } = dateRangeToIsoBounds("2026-07-01", "2026-07-03");
    expect(startIso).toBe("2026-06-30T18:30:00.000Z"); // 00:00 IST 1 Jul
    expect(endIso).toBe("2026-07-03T18:30:00.000Z"); // 00:00 IST 4 Jul
  });

  test("dayToIsoBounds is the single-day special case of a range", () => {
    expect(dayToIsoBounds("2026-07-03")).toEqual(dateRangeToIsoBounds("2026-07-03", "2026-07-03"));
  });

  test("isValidDateOnly rejects malformed strings", () => {
    expect(isValidDateOnly("2026-07-03")).toBe(true);
    expect(isValidDateOnly("07/03/2026")).toBe(false);
    expect(isValidDateOnly("not-a-date")).toBe(false);
  });
});

describe("needsHoursPrompt — clock-out prompt", () => {
  test("prompts when nothing was logged", () => {
    expect(needsHoursPrompt(0)).toBe(true);
  });

  test("does not prompt once at least one entry exists", () => {
    expect(needsHoursPrompt(1)).toBe(false);
    expect(needsHoursPrompt(3)).toBe(false);
  });
});

describe("sumHours", () => {
  test("sums and rounds to one decimal", () => {
    expect(sumHours([{ hours: 3.3 }, { hours: 2.2 }])).toBeCloseTo(5.5);
  });

  test("empty list sums to 0", () => {
    expect(sumHours([])).toBe(0);
  });
});

describe("movementVerb / formatMovementLine", () => {
  test("negative delta reads as took/bulk-took", () => {
    expect(movementVerb("pick", -5)).toBe("took");
    expect(movementVerb("bulk_pick", -145)).toBe("took");
  });

  test("positive delta reads as added", () => {
    expect(movementVerb("receive", 500)).toBe("added");
  });

  test("adjust reads up/down by sign", () => {
    expect(movementVerb("adjust", 5)).toBe("adjusted up");
    expect(movementVerb("adjust", -5)).toBe("adjusted down");
  });

  test("undo always reads as undid", () => {
    expect(movementVerb("undo", 5)).toBe("undid");
  });

  test("matches the FEATURES.md §5.13 example: 'took 145 × SMK-000101 (Box B-12) · bulk pick · TMCS Mainboard'", () => {
    expect(formatMovementLine(movement())).toBe("took 145 × SMK-000101 (B · B-12) · bulk pick · TMCS Mainboard");
  });

  test("receive with no box/bom omits both segments", () => {
    const row = movement({ reason: "receive", deltaQty: 500, pid: "SMK-000203", boxLabel: null, bomName: null });
    expect(formatMovementLine(row)).toBe("added 500 × SMK-000203 · receive");
  });

  test("audit-tagged adjust surfaces the reason_detail", () => {
    const row = movement({ reason: "adjust", reasonDetail: "audit", deltaQty: -3, boxLabel: null, bomName: null });
    expect(formatMovementLine(row)).toBe("adjusted down 3 × SMK-000101 · adjust audit");
  });
});

describe("computeMovementTotals — totals strip", () => {
  test("splits out / in and counts adjustments", () => {
    const rows = [
      movement({ id: "1", deltaQty: -145, reason: "bulk_pick" }),
      movement({ id: "2", deltaQty: 500, reason: "receive" }),
      movement({ id: "3", deltaQty: -3, reason: "adjust" }),
      movement({ id: "4", deltaQty: 5, reason: "adjust" }),
    ];
    expect(computeMovementTotals(rows)).toEqual({ itemsOut: 148, itemsIn: 505, adjustments: 2 });
  });

  test("empty day totals to zero", () => {
    expect(computeMovementTotals([])).toEqual({ itemsOut: 0, itemsIn: 0, adjustments: 0 });
  });
});

describe("groupMovementsByActor", () => {
  test("groups by actor, newest group and newest row first", () => {
    const rows = [
      movement({ id: "1", actorId: "a", occurredAt: "2026-07-03T09:00:00.000Z" }),
      movement({ id: "2", actorId: "b", occurredAt: "2026-07-03T11:00:00.000Z" }),
      movement({ id: "3", actorId: "a", occurredAt: "2026-07-03T10:00:00.000Z" }),
    ];
    const names = new Map([
      ["a", "Suresh"],
      ["b", "Priya"],
    ]);
    const groups = groupMovementsByActor(rows, names);

    expect(groups.map((g) => g.actorName)).toEqual(["Priya", "Suresh"]);
    expect(groups[1]!.rows.map((r) => r.id)).toEqual(["3", "1"]); // newest first within Suresh's group
  });

  test("an unknown actor id falls back to 'Unknown'", () => {
    const groups = groupMovementsByActor([movement({ actorId: "ghost" })], new Map());
    expect(groups[0]!.actorName).toBe("Unknown");
  });
});

describe("filterActivityForActor — 'employee sees self only' visibility rule", () => {
  function item(overrides: Partial<OrderingActivityItem> = {}): OrderingActivityItem {
    return { id: "1", occurredAt: "2026-07-03T10:00:00.000Z", actorId: "user-a", kind: "cart_add", label: "x", ...overrides };
  }

  test("null actorFilter (owner 'all people') passes everything through", () => {
    const items = [item({ id: "1", actorId: "a" }), item({ id: "2", actorId: "b" }), item({ id: "3", actorId: null })];
    expect(filterActivityForActor(items, null)).toHaveLength(3);
  });

  test("a specific actorFilter keeps only that actor's rows", () => {
    const items = [item({ id: "1", actorId: "a" }), item({ id: "2", actorId: "b" })];
    const filtered = filterActivityForActor(items, "a");
    expect(filtered.map((i) => i.id)).toEqual(["1"]);
  });

  test("null-actor rows (e.g. arrivals) are dropped under self-scope — never shown as 'mine' or anyone else's", () => {
    const items = [item({ id: "1", actorId: null }), item({ id: "2", actorId: "a" })];
    const filtered = filterActivityForActor(items, "a");
    expect(filtered.map((i) => i.id)).toEqual(["2"]);
  });
});

describe("formatInOutRange", () => {
  test("both present joins with an en dash", () => {
    expect(formatInOutRange("9:02 AM", "6:14 PM")).toBe("9:02 AM – 6:14 PM");
  });

  test("neither present renders a single em dash", () => {
    expect(formatInOutRange("—", "—")).toBe("—");
  });

  test("only check-in present still shows the pending check-out dash", () => {
    expect(formatInOutRange("9:02 AM", "—")).toBe("9:02 AM – —");
  });
});
