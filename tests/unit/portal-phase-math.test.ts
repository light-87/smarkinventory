import { describe, expect, test } from "bun:test";
import { lastPhaseEndDate, projectStatusLabel } from "@/lib/portal/phase-math";
import type { PortalPhase } from "@/lib/portal/types";

/**
 * Unit coverage for lib/portal/phase-math.ts's OWN additions —
 * `computeProgressPct`/`computeOnTrack` are re-exported straight from
 * `lib/projects/phase-math.ts` and already covered by
 * tests/unit/phases-math.test.ts (projects-hub package); duplicating that
 * suite here would just be testing someone else's file twice.
 */

function phase(overrides: Partial<PortalPhase>): PortalPhase {
  return {
    id: "id",
    sort_order: 0,
    name: "Phase",
    start_date: null,
    end_date: null,
    duration_text: null,
    notes: null,
    row_kind: "phase",
    status: "pending",
    version_label: 1,
    ...overrides,
  };
}

describe("lib/portal/phase-math", () => {
  describe("lastPhaseEndDate", () => {
    test("returns the highest-sort_order phase/buffer row's end_date", () => {
      const phases = [
        phase({ id: "1", sort_order: 1, row_kind: "phase", end_date: "2026-01-05" }),
        phase({ id: "2", sort_order: 2, row_kind: "buffer", end_date: "2026-01-10" }),
        phase({ id: "3", sort_order: 3, row_kind: "phase", end_date: null }),
      ];
      expect(lastPhaseEndDate(phases)).toBe("2026-01-10");
    });

    test("ignores parallel/footnote rows even if they carry the highest sort_order", () => {
      const phases = [
        phase({ id: "1", sort_order: 1, row_kind: "phase", end_date: "2026-01-05" }),
        phase({ id: "2", sort_order: 2, row_kind: "footnote", end_date: "2099-01-01" }),
      ];
      expect(lastPhaseEndDate(phases)).toBe("2026-01-05");
    });

    test("null when no phase/buffer row carries an end_date", () => {
      const phases = [phase({ id: "1", row_kind: "parallel", end_date: null })];
      expect(lastPhaseEndDate(phases)).toBeNull();
    });

    test("empty timeline -> null", () => {
      expect(lastPhaseEndDate([])).toBeNull();
    });
  });

  describe("projectStatusLabel", () => {
    test("completed -> 'Completed'", () => {
      expect(projectStatusLabel("completed")).toBe("Completed");
    });

    test("in_progress -> 'In progress'", () => {
      expect(projectStatusLabel("in_progress")).toBe("In progress");
    });
  });
});
