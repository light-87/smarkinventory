import { describe, expect, test } from "bun:test";
import {
  auditCompletionCount,
  computeDelta,
  deriveBoxLastAuditedAt,
  isAuditComplete,
  isVariance,
  nextPendingLocationId,
} from "@/lib/audit";

/**
 * lib/audit/variance — pure decision logic for the guided box audit
 * (FEATURES.md §5.4/§9, plan/tab-shelves.md R2-25/Q-10). No Supabase here —
 * the DB-writing half (`confirmAuditCount`) is covered at the API/route
 * layer (plan/TESTING.md §2) once auth-shell's login + seeded fixtures land.
 */

describe("computeDelta / isVariance", () => {
  test("counted higher than recorded → positive delta, a variance", () => {
    expect(computeDelta(100, 112)).toBe(12);
    expect(isVariance(100, 112)).toBe(true);
  });

  test("counted lower than recorded → negative delta, a variance", () => {
    expect(computeDelta(100, 88)).toBe(-12);
    expect(isVariance(100, 88)).toBe(true);
  });

  test("counted equals recorded → zero delta, NOT a variance (no movement row)", () => {
    expect(computeDelta(100, 100)).toBe(0);
    expect(isVariance(100, 100)).toBe(false);
  });

  test("counting an empty ESD as 0 confirms cleanly (no variance)", () => {
    expect(computeDelta(0, 0)).toBe(0);
    expect(isVariance(0, 0)).toBe(false);
  });
});

describe("deriveBoxLastAuditedAt — box header \"last audited {date}\"", () => {
  test("empty box → null (nothing to audit)", () => {
    expect(deriveBoxLastAuditedAt([])).toBeNull();
  });

  test("any never-counted location → null, even if every other location has a stamp", () => {
    const locations = [
      { last_counted_at: "2026-06-18T10:00:00+00:00" },
      { last_counted_at: null },
      { last_counted_at: "2026-06-19T10:00:00+00:00" },
    ];
    expect(deriveBoxLastAuditedAt(locations)).toBeNull();
  });

  test("all counted → the EARLIEST timestamp (box is only as fresh as its stalest ESD)", () => {
    const locations = [
      { last_counted_at: "2026-06-20T10:00:00+00:00" },
      { last_counted_at: "2026-06-12T09:30:00+00:00" }, // earliest
      { last_counted_at: "2026-06-18T10:00:00+00:00" },
    ];
    expect(deriveBoxLastAuditedAt(locations)).toBe("2026-06-12T09:30:00+00:00");
  });

  test("single location → its own timestamp", () => {
    const locations = [{ last_counted_at: "2026-06-20T10:00:00+00:00" }];
    expect(deriveBoxLastAuditedAt(locations)).toBe("2026-06-20T10:00:00+00:00");
  });
});

describe("nextPendingLocationId / auditCompletionCount / isAuditComplete", () => {
  const items = [{ locationId: "loc-1" }, { locationId: "loc-2" }, { locationId: "loc-3" }];

  test("nothing done yet → first item in walk order", () => {
    expect(nextPendingLocationId(items, new Set())).toBe("loc-1");
  });

  test("first done → second item next", () => {
    expect(nextPendingLocationId(items, new Set(["loc-1"]))).toBe("loc-2");
  });

  test("all done → null (walk complete)", () => {
    expect(nextPendingLocationId(items, new Set(["loc-1", "loc-2", "loc-3"]))).toBeNull();
  });

  test("empty item list → null immediately", () => {
    expect(nextPendingLocationId([], new Set())).toBeNull();
  });

  test("auditCompletionCount counts done vs total", () => {
    expect(auditCompletionCount(items, new Set())).toEqual({ done: 0, total: 3 });
    expect(auditCompletionCount(items, new Set(["loc-1", "loc-3"]))).toEqual({ done: 2, total: 3 });
    expect(auditCompletionCount(items, new Set(["loc-1", "loc-2", "loc-3"]))).toEqual({ done: 3, total: 3 });
  });

  test("isAuditComplete is true only once every item is done, never for an empty box", () => {
    expect(isAuditComplete({ done: 0, total: 0 })).toBe(false);
    expect(isAuditComplete({ done: 2, total: 3 })).toBe(false);
    expect(isAuditComplete({ done: 3, total: 3 })).toBe(true);
  });
});
