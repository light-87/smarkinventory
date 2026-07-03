import { describe, expect, test } from "bun:test";
import { istDateOnly, istDateRangeToIsoBounds, istDayBoundsIso } from "@/lib/timezone";

/**
 * lib/timezone.ts — the shared IST day-boundary helper (finding #4).
 * `lib/dashboard/compute.ts` (`todayBoundsIso`) and `lib/daily/compute.ts`
 * (`todayDateOnly` / `dateRangeToIsoBounds`) both delegate here so "today"
 * agrees across both surfaces, anchored to Asia/Kolkata (fixed +05:30, no
 * DST) instead of the server process's own local timezone.
 */

describe("istDateOnly", () => {
  test("returns the IST calendar date for an instant well inside the IST day", () => {
    expect(istDateOnly(new Date("2026-07-03T10:00:00.000Z"))).toBe("2026-07-03"); // 15:30 IST
  });

  test("an instant just after IST midnight resolves to the NEW IST day, even though the UTC calendar day hasn't rolled yet", () => {
    // 2026-07-02T20:00:00Z = 01:30 IST on 3 Jul.
    expect(istDateOnly(new Date("2026-07-02T20:00:00.000Z"))).toBe("2026-07-03");
  });

  test("an instant just before IST midnight still resolves to the day that is ending", () => {
    // 2026-07-03T18:20:00Z = 23:50 IST on 3 Jul.
    expect(istDateOnly(new Date("2026-07-03T18:20:00.000Z"))).toBe("2026-07-03");
  });

  test("an instant at exactly IST midnight resolves to the NEW day", () => {
    // 2026-07-02T18:30:00Z = 00:00:00 IST on 3 Jul, exactly.
    expect(istDateOnly(new Date("2026-07-02T18:30:00.000Z"))).toBe("2026-07-03");
  });
});

describe("istDayBoundsIso", () => {
  test("[IST midnight, next IST midnight) for the day containing the reference instant", () => {
    const { start, end } = istDayBoundsIso(new Date("2026-07-03T10:00:00.000Z"));
    expect(start).toBe("2026-07-02T18:30:00.000Z");
    expect(end).toBe("2026-07-03T18:30:00.000Z");
  });

  test("spans exactly 24 hours", () => {
    const { start, end } = istDayBoundsIso(new Date("2026-01-15T00:00:00.000Z"));
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(24 * 60 * 60 * 1000);
  });

  test("the reference instant always falls inside its own [start, end) bounds", () => {
    const references = [
      "2026-07-02T20:00:00.000Z", // 01:30 IST — just after IST midnight
      "2026-07-03T18:29:59.000Z", // 23:59:59 IST — just before IST midnight
      "2026-01-01T00:00:00.000Z",
      "2026-12-31T23:59:59.000Z",
    ];
    for (const iso of references) {
      const reference = new Date(iso);
      const { start, end } = istDayBoundsIso(reference);
      expect(reference.getTime()).toBeGreaterThanOrEqual(new Date(start).getTime());
      expect(reference.getTime()).toBeLessThan(new Date(end).getTime());
    }
  });
});

describe("istDateRangeToIsoBounds", () => {
  test("[from 00:00 IST, to+1day 00:00 IST) for a multi-day range", () => {
    const { start, end } = istDateRangeToIsoBounds("2026-07-01", "2026-07-03");
    expect(start).toBe("2026-06-30T18:30:00.000Z");
    expect(end).toBe("2026-07-03T18:30:00.000Z");
  });

  test("a single-day range (from === to) is exactly one IST day wide", () => {
    const { start, end } = istDateRangeToIsoBounds("2026-07-03", "2026-07-03");
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(24 * 60 * 60 * 1000);
  });

  test("correctly rolls over a month/year boundary", () => {
    const { start, end } = istDateRangeToIsoBounds("2025-12-31", "2025-12-31");
    expect(start).toBe("2025-12-30T18:30:00.000Z");
    expect(end).toBe("2025-12-31T18:30:00.000Z");
  });
});
