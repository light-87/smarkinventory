import { describe, expect, test } from "bun:test";
import {
  computeOnTrack,
  computeProgressPct,
  countActivePhases,
  findNextPhaseId,
  isTimelineComplete,
  phaseWeightDays,
  reorderRows,
  type PhaseMathRow,
} from "@/lib/projects/phase-math";

/**
 * lib/projects/phase-math — pure timeline math (FEATURES.md §10,
 * plan/tab-orders-projects.md R2-30/R2-14). Fixtures model their real
 * estimate-sheet shape: named phases with dates, a trailing buffer row, a
 * parallel row, and a footnote.
 */

function row(overrides: Partial<PhaseMathRow> & Pick<PhaseMathRow, "id" | "sort_order">): PhaseMathRow {
  return {
    start_date: null,
    end_date: null,
    row_kind: "phase",
    status: "pending",
    ...overrides,
  };
}

describe("phaseWeightDays", () => {
  test("both dates set → inclusive day span", () => {
    expect(phaseWeightDays({ start_date: "2026-07-01", end_date: "2026-07-10" })).toBe(10);
  });

  test("same start/end → 1 day, never 0", () => {
    expect(phaseWeightDays({ start_date: "2026-07-01", end_date: "2026-07-01" })).toBe(1);
  });

  test("missing either date → falls back to equal weight of 1", () => {
    expect(phaseWeightDays({ start_date: null, end_date: null })).toBe(1);
    expect(phaseWeightDays({ start_date: "2026-07-01", end_date: null })).toBe(1);
  });
});

describe("computeProgressPct — duration-weighted done phases, parallel/footnote excluded", () => {
  test("two equal-weight phases, one done → 50%", () => {
    const phases = [
      row({ id: "p1", sort_order: 0, start_date: "2026-01-01", end_date: "2026-01-05", status: "done" }),
      row({ id: "p2", sort_order: 1, start_date: "2026-01-06", end_date: "2026-01-10", status: "pending" }),
    ];
    expect(computeProgressPct(phases).pct).toBe(50);
  });

  test("weighted by duration — a long done phase dominates a short pending one", () => {
    const phases = [
      // 20-day phase, done
      row({ id: "p1", sort_order: 0, start_date: "2026-01-01", end_date: "2026-01-20", status: "done" }),
      // 5-day phase, pending
      row({ id: "p2", sort_order: 1, start_date: "2026-01-21", end_date: "2026-01-25", status: "pending" }),
    ];
    // 20 / (20+5) = 80%
    expect(computeProgressPct(phases).pct).toBe(80);
  });

  test("parallel and footnote rows never enter the denominator, regardless of their status", () => {
    const withoutExtras = computeProgressPct([
      row({ id: "p1", sort_order: 0, start_date: "2026-01-01", end_date: "2026-01-10", status: "done" }),
    ]);
    const withExtras = computeProgressPct([
      row({ id: "p1", sort_order: 0, start_date: "2026-01-01", end_date: "2026-01-10", status: "done" }),
      row({ id: "par", sort_order: 1, row_kind: "parallel", status: "pending" }),
      row({ id: "fn", sort_order: 2, row_kind: "footnote", status: "done" }),
    ]);
    expect(withExtras.pct).toBe(withoutExtras.pct);
    expect(withExtras.countedRows).toBe(1);
  });

  test("buffer rows DO count toward the math (only parallel/footnote sit outside it)", () => {
    const phases = [
      row({ id: "p1", sort_order: 0, start_date: "2026-01-01", end_date: "2026-01-10", status: "done" }),
      row({ id: "buf", sort_order: 1, row_kind: "buffer", start_date: "2026-01-11", end_date: "2026-01-15", status: "pending" }),
    ];
    const result = computeProgressPct(phases);
    expect(result.countedRows).toBe(2);
    expect(result.pct).toBe(Math.round((10 / (10 + 5)) * 100));
  });

  test("no counted rows at all → 0%, not NaN", () => {
    expect(computeProgressPct([]).pct).toBe(0);
    expect(computeProgressPct([row({ id: "par", sort_order: 0, row_kind: "parallel" })]).pct).toBe(0);
  });
});

describe("computeOnTrack — buffer absorption before 'late'", () => {
  const today = new Date("2026-01-20T00:00:00Z");

  test("today before active phase's end date → on_track", () => {
    const phases = [row({ id: "active", sort_order: 0, status: "active", end_date: "2026-01-25" })];
    const result = computeOnTrack(phases, today);
    expect(result.status).toBe("on_track");
    expect(result.lateDays).toBe(0);
  });

  test("overdue with no buffer row → late, full overdue day count", () => {
    const phases = [row({ id: "active", sort_order: 0, status: "active", end_date: "2026-01-15" })];
    const result = computeOnTrack(phases, today);
    expect(result.status).toBe("late");
    expect(result.lateDays).toBe(5); // 20th vs 15th
  });

  test("a not-done buffer row after the active phase absorbs the delay fully", () => {
    const phases = [
      row({ id: "active", sort_order: 0, status: "active", end_date: "2026-01-15" }), // 5 days overdue
      row({ id: "buf", sort_order: 1, row_kind: "buffer", start_date: "2026-01-16", end_date: "2026-01-22", status: "pending" }), // 7-day buffer
    ];
    const result = computeOnTrack(phases, today);
    expect(result.status).toBe("on_track");
    expect(result.lateDays).toBe(0);
  });

  test("buffer only PARTIALLY absorbs → still late, with the reduced remainder", () => {
    const phases = [
      row({ id: "active", sort_order: 0, status: "active", end_date: "2026-01-10" }), // 10 days overdue
      row({ id: "buf", sort_order: 1, row_kind: "buffer", start_date: "2026-01-11", end_date: "2026-01-13", status: "pending" }), // 3-day buffer
    ];
    const result = computeOnTrack(phases, today);
    expect(result.status).toBe("late");
    expect(result.lateDays).toBe(7); // 10 - 3
  });

  test("a DONE buffer row no longer offers capacity (already consumed)", () => {
    const phases = [
      row({ id: "active", sort_order: 0, status: "active", end_date: "2026-01-15" }),
      row({ id: "buf", sort_order: 1, row_kind: "buffer", start_date: "2026-01-16", end_date: "2026-01-22", status: "done" }),
    ];
    const result = computeOnTrack(phases, today);
    expect(result.status).toBe("late");
    expect(result.lateDays).toBe(5);
  });

  test("a buffer row BEFORE the active phase never counts as capacity", () => {
    const phases = [
      row({ id: "buf", sort_order: 0, row_kind: "buffer", start_date: "2026-01-01", end_date: "2026-01-10", status: "pending" }),
      row({ id: "active", sort_order: 1, status: "active", end_date: "2026-01-15" }),
    ];
    const result = computeOnTrack(phases, today);
    expect(result.status).toBe("late");
    expect(result.lateDays).toBe(5);
  });

  test("no active phase, all counted rows done → done", () => {
    const phases = [row({ id: "p1", sort_order: 0, status: "done" })];
    expect(computeOnTrack(phases, today).status).toBe("done");
  });

  test("no active phase, nothing done yet → not_started", () => {
    const phases = [row({ id: "p1", sort_order: 0, status: "pending" })];
    expect(computeOnTrack(phases, today).status).toBe("not_started");
  });

  test("active phase with no end_date (parallel-style dateless row) → on_track, can't be late", () => {
    const phases = [row({ id: "active", sort_order: 0, status: "active", end_date: null })];
    expect(computeOnTrack(phases, today).status).toBe("on_track");
  });
});

describe("countActivePhases / findNextPhaseId / isTimelineComplete — single-active invariant support", () => {
  test("countActivePhases counts exactly the active rows (DB partial-unique-index caps this at 1 in practice)", () => {
    expect(countActivePhases([row({ id: "a", sort_order: 0, status: "active" })])).toBe(1);
    expect(countActivePhases([row({ id: "a", sort_order: 0, status: "pending" })])).toBe(0);
  });

  test("findNextPhaseId skips already-done rows and parallel/footnote rows", () => {
    const phases = [
      row({ id: "p1", sort_order: 0, status: "active" }),
      row({ id: "par", sort_order: 1, row_kind: "parallel", status: "pending" }),
      row({ id: "p2", sort_order: 2, status: "done" }),
      row({ id: "p3", sort_order: 3, status: "pending" }),
    ];
    expect(findNextPhaseId(phases, "p1")).toBe("p3");
  });

  test("findNextPhaseId → null when the active row is the last counted one", () => {
    const phases = [row({ id: "p1", sort_order: 0, status: "active" })];
    expect(findNextPhaseId(phases, "p1")).toBeNull();
  });

  test("isTimelineComplete requires at least one counted row", () => {
    expect(isTimelineComplete([])).toBe(false);
    expect(isTimelineComplete([row({ id: "par", sort_order: 0, row_kind: "parallel", status: "done" })])).toBe(false);
  });

  test("isTimelineComplete true only once every counted row is done", () => {
    const phases = [
      row({ id: "p1", sort_order: 0, status: "done" }),
      row({ id: "p2", sort_order: 1, status: "done" }),
    ];
    expect(isTimelineComplete(phases)).toBe(true);
    expect(isTimelineComplete([...phases, row({ id: "p3", sort_order: 2, status: "pending" })])).toBe(false);
  });
});

describe("reorderRows — pure array move for the drag-reorder editor", () => {
  test("moves an item from one index to another", () => {
    expect(reorderRows(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(reorderRows(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  test("no-op when from === to", () => {
    expect(reorderRows(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });

  test("out-of-range fromIndex returns an unchanged copy", () => {
    expect(reorderRows(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
});
