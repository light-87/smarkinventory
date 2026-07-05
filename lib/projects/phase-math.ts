/**
 * lib/projects/phase-math.ts — pure phase-timeline math (FEATURES.md §10,
 * plan/tab-orders-projects.md R2-30).
 *
 * INTENTIONALLY SURVIVES the old-PM-layer removal (rest of `lib/projects/**`
 * and `components/projects/**` deleted, replaced by `lib/pm/**` — see
 * migration 0010): `lib/portal/phase-math.ts` (client-portal package, outside
 * this rebuild's scope) re-exports `computeOnTrack`/`computeProgressPct`/
 * `isTimelineComplete` straight from this file rather than duplicating them.
 * Deleting it would silently break that fenced, do-not-edit package. No other
 * file in this module survives — this is a pure, dependency-free leaf with no
 * import of anything else in `lib/projects/**`, so keeping it costs nothing.
 *
 * No Supabase, no Next.js, no Date.now() default side effects beyond an
 * injectable `today` — every function here is a plain data transform so it's
 * exhaustively unit-testable (tests/unit/phases-math.test.ts) without a DB.
 *
 * The rules, verbatim from FEATURES.md §10:
 *   - "Completion % = duration-weighted done phases."
 *   - "On-track chip = today vs active phase end date; buffer rows absorb
 *     delay before 'late' shows."
 *   - "Parallel/footnote rows sit outside the math."
 *   - "Project done = last phase done + owner confirm."
 *   - Exactly one ACTIVE phase at a time (DB also enforces this with a
 *     partial unique index — smark_project_phases_one_active_per_project).
 */

import { differenceInCalendarDays, isValid, parseISO, startOfDay } from "date-fns";
import type { PhaseRowKind, PhaseStatus } from "@/types/db";

/** The columns phase-math actually needs — callers pass a full ProjectPhaseRow or this slice. */
export interface PhaseMathRow {
  id: string;
  sort_order: number;
  start_date: string | null;
  end_date: string | null;
  row_kind: PhaseRowKind;
  status: PhaseStatus;
}

/** Row kinds that count toward completion %/on-track math — parallel & footnote sit outside it. */
const COUNTED_KINDS: readonly PhaseRowKind[] = ["phase", "buffer"];

export function isCountedRow(row: Pick<PhaseMathRow, "row_kind">): boolean {
  return (COUNTED_KINDS as readonly string[]).includes(row.row_kind);
}

function parseDateOnly(value: string | null): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

/**
 * Duration weight in whole days for one phase/buffer row: the inclusive span
 * between `start_date` and `end_date` when both are set, else `1` (equal
 * weight) — a row with only a free-text `duration_text` ("9-10 days",
 * "Running parallel with design") has no reliably parseable number, so it
 * counts the same as any other undated row rather than being silently
 * dropped from the math.
 */
export function phaseWeightDays(row: Pick<PhaseMathRow, "start_date" | "end_date">): number {
  const start = parseDateOnly(row.start_date);
  const end = parseDateOnly(row.end_date);
  if (start && end) {
    const span = differenceInCalendarDays(end, start) + 1;
    return span > 0 ? span : 1;
  }
  return 1;
}

export interface ProgressResult {
  /** 0–100, rounded. */
  pct: number;
  /** How many rows counted toward the math (phase + buffer only). */
  countedRows: number;
  doneWeightDays: number;
  totalWeightDays: number;
}

/**
 * Completion % = duration-weighted done phases; `parallel`/`footnote` rows
 * are excluded entirely (FEATURES.md §10). Empty/all-excluded input → 0%.
 */
export function computeProgressPct<T extends PhaseMathRow>(phases: readonly T[]): ProgressResult {
  const counted = phases.filter(isCountedRow);
  if (counted.length === 0) {
    return { pct: 0, countedRows: 0, doneWeightDays: 0, totalWeightDays: 0 };
  }

  const totalWeightDays = counted.reduce((sum, row) => sum + phaseWeightDays(row), 0);
  const doneWeightDays = counted
    .filter((row) => row.status === "done")
    .reduce((sum, row) => sum + phaseWeightDays(row), 0);

  const pct = totalWeightDays === 0 ? 0 : Math.round((doneWeightDays / totalWeightDays) * 100);
  return { pct, countedRows: counted.length, doneWeightDays, totalWeightDays };
}

export type OnTrackStatus = "on_track" | "late" | "done" | "not_started";

/**
 * Generic over the row type so callers passing a richer row (e.g. a full
 * `ProjectPhaseRow` with `name`) get `activePhase` typed with those extra
 * fields intact, instead of narrowed down to just the `PhaseMathRow` slice.
 */
export interface OnTrackResult<T extends PhaseMathRow = PhaseMathRow> {
  status: OnTrackStatus;
  /** Calendar days overdue AFTER buffer absorption; 0 unless `status === "late"`. */
  lateDays: number;
  activePhase: T | null;
}

/**
 * On-track chip: compares `today` against the ACTIVE phase's end date. If
 * overdue, not-done `buffer` rows that sit AFTER the active phase (by
 * `sort_order`) absorb the delay first — their combined duration weight is
 * subtracted from the overdue day count before "late" is allowed to show
 * (FEATURES.md §10: "buffer rows absorb delay before 'late' shows").
 *
 * No active phase at all: `done` when every counted row is done (and there
 * is at least one), else `not_started` (timeline not begun / nothing to
 * judge yet).
 */
export function computeOnTrack<T extends PhaseMathRow>(phases: readonly T[], today: Date = new Date()): OnTrackResult<T> {
  const ordered = [...phases].sort((a, b) => a.sort_order - b.sort_order);
  const counted = ordered.filter(isCountedRow);
  const active = counted.find((row) => row.status === "active") ?? null;

  if (!active) {
    const allDone = counted.length > 0 && counted.every((row) => row.status === "done");
    return { status: allDone ? "done" : "not_started", lateDays: 0, activePhase: null };
  }

  const end = parseDateOnly(active.end_date);
  if (!end) return { status: "on_track", lateDays: 0, activePhase: active };

  const overdueDays = differenceInCalendarDays(startOfDay(today), startOfDay(end));
  if (overdueDays <= 0) return { status: "on_track", lateDays: 0, activePhase: active };

  const bufferCapacityDays = counted
    .filter((row) => row.row_kind === "buffer" && row.status !== "done" && row.sort_order > active.sort_order)
    .reduce((sum, row) => sum + phaseWeightDays(row), 0);

  const remaining = overdueDays - bufferCapacityDays;
  if (remaining <= 0) return { status: "on_track", lateDays: 0, activePhase: active };
  return { status: "late", lateDays: remaining, activePhase: active };
}

/** How many rows are currently `active` — should never exceed 1 (DB partial-unique-index invariant); exposed for tests + defensive UI checks. */
export function countActivePhases(phases: readonly PhaseMathRow[]): number {
  return phases.filter((row) => row.status === "active").length;
}

/**
 * The next row to activate when the owner advances past `currentActiveId`:
 * the nearest counted (`phase`/`buffer`) row after it, by `sort_order`, that
 * isn't already `done`. `null` when there's nothing left — the timeline is
 * complete (project-done confirmation is a separate, explicit owner action).
 */
export function findNextPhaseId(phases: readonly PhaseMathRow[], currentActiveId: string): string | null {
  const ordered = [...phases].sort((a, b) => a.sort_order - b.sort_order).filter(isCountedRow);
  const idx = ordered.findIndex((row) => row.id === currentActiveId);
  if (idx === -1) return null;
  const next = ordered.slice(idx + 1).find((row) => row.status !== "done");
  return next ? next.id : null;
}

/** True once every counted (`phase`/`buffer`) row is `done` — gates the "confirm project complete" action. Empty timeline is NOT complete. */
export function isTimelineComplete(phases: readonly PhaseMathRow[]): boolean {
  const counted = phases.filter(isCountedRow);
  return counted.length > 0 && counted.every((row) => row.status === "done");
}

/** Pure array reorder (drag/move a row from one position to another) — caller re-derives `sort_order` from the returned index. */
export function reorderRows<T>(rows: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= rows.length) return [...rows];
  const copy = [...rows];
  const [moved] = copy.splice(fromIndex, 1);
  const clampedTarget = Math.max(0, Math.min(toIndex, copy.length));
  copy.splice(clampedTarget, 0, moved as T);
  return copy;
}
