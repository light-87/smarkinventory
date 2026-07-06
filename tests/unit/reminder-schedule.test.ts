import { describe, expect, test } from "bun:test";
import { addDays, firstNextSendAt } from "@/lib/reminders/schedule";

/**
 * lib/reminders/schedule.ts — pure date math for the client-reminder cadence
 * (migration 0012). The drift-avoidance rule under test: bumping
 * `next_send_at` off its OWN previous value (not `now`) so a late-firing cron
 * run never creeps the schedule later each time.
 */

describe("addDays", () => {
  test("adds whole days to an ISO timestamp", () => {
    expect(addDays("2026-01-01T03:00:00.000Z", 3)).toBe("2026-01-04T03:00:00.000Z");
  });

  test("crosses a month boundary correctly", () => {
    expect(addDays("2026-01-30T12:00:00.000Z", 3)).toBe("2026-02-02T12:00:00.000Z");
  });

  test("crosses a year boundary correctly", () => {
    expect(addDays("2025-12-30T00:00:00.000Z", 5)).toBe("2026-01-04T00:00:00.000Z");
  });

  test("preserves time-of-day (no drift toward now)", () => {
    const bumped = addDays("2026-03-10T14:32:07.000Z", 7);
    expect(bumped).toBe("2026-03-17T14:32:07.000Z");
  });

  test("repeated bumps off the previous next_send_at stay exactly frequency_days apart, however late each run fires", () => {
    // Simulates the cron route: bump off the reminder's OWN next_send_at each
    // time, never off `now` — so cadence never drifts even if a run is late.
    let nextSendAt = "2026-01-01T03:00:00.000Z";
    const runs: string[] = [nextSendAt];
    for (let i = 0; i < 4; i++) {
      nextSendAt = addDays(nextSendAt, 3);
      runs.push(nextSendAt);
    }
    expect(runs).toEqual([
      "2026-01-01T03:00:00.000Z",
      "2026-01-04T03:00:00.000Z",
      "2026-01-07T03:00:00.000Z",
      "2026-01-10T03:00:00.000Z",
      "2026-01-13T03:00:00.000Z",
    ]);
  });
});

describe("firstNextSendAt", () => {
  test("bumps off `now` (no prior next_send_at exists yet) for the first send", () => {
    const now = new Date("2026-06-15T09:00:00.000Z");
    expect(firstNextSendAt(now, 1)).toBe("2026-06-16T09:00:00.000Z");
    expect(firstNextSendAt(now, 7)).toBe("2026-06-22T09:00:00.000Z");
  });
});
