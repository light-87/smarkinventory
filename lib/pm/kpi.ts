/**
 * lib/pm/kpi.ts — pure KPI math for the Project-Management module. No
 * Supabase, no React, no Date.now() — kept dependency-free so
 * tests/unit/pm-kpi.test.ts can exercise every branch without a database,
 * mirroring lib/attendance/status.ts's convention. lib/pm/queries.ts is the
 * only caller that fetches the numbers these functions are given.
 *
 * Efficiency is computed PER ENGINEER, PER TASK: the engineer's own
 * `smark_task_assignees.estimated_hours` against their own logged hours
 * (`smark_time_logs`, summed) — never a whole-task total — and EXCLUDING any
 * hours logged while the task had an open `smark_task_holds` row (the caller
 * is responsible for that exclusion before calling `efficiency()`; see this
 * module's header and lib/pm/queries.ts).
 *
 * Effectiveness is computed PER ENGINEER from the count of bugs against their
 * assigned tasks that are BOTH `status = 'confirmed'` AND
 * `classification = 'bug'` — every other bug/status/classification
 * combination (dismissed, resolved-without-confirm, reclassified as a change
 * request, etc.) is excluded (supabase/migrations/0010_pm.sql header).
 */

/**
 * Efficiency score for one engineer on one task, base 10, scaled by how their
 * logged hours compare to their own estimate:
 *   - `estimatedHours <= 0` → `null` (NA — legacy/estimate-less task; no KPI).
 *   - `actualHours > estimatedHours` (over): `10 * (1 - (actual - est) / est)`,
 *     floored at 0 (never negative).
 *   - `actualHours <= estimatedHours` (on-time or under): `10 * (1 + (est - actual) / est)`,
 *     capped at 13 (finishing well under estimate can't inflate the score
 *     indefinitely).
 */
export function efficiency(estimatedHours: number, actualHoursExcludingHolds: number): number | null {
  if (estimatedHours <= 0) return null;

  const actual = Math.max(actualHoursExcludingHolds, 0);

  if (actual > estimatedHours) {
    const score = 10 * (1 - (actual - estimatedHours) / estimatedHours);
    return Math.max(score, 0);
  }

  const score = 10 * (1 + (estimatedHours - actual) / estimatedHours);
  return Math.min(score, 13);
}

/**
 * Effectiveness score from the count of CONFIRMED bugs (classification='bug',
 * status='confirmed') against an engineer's tasks:
 *   - fewer than 5 confirmed bugs → 5
 *   - 5 to 10 (inclusive) → 4
 *   - more than 10 → 3
 */
export function effectiveness(confirmedBugCount: number): number {
  if (confirmedBugCount < 5) return 5;
  if (confirmedBugCount <= 10) return 4;
  return 3;
}

/** Project completion percent — 0..100, 0 when there are no tasks yet. */
export function projectProgress(totalTasks: number, doneTasks: number): number {
  if (totalTasks <= 0) return 0;
  return Math.round((100 * doneTasks) / totalTasks);
}

/** One task-assignment's KPI inputs feeding `aggregateEmployeeKpi`. */
export interface TaskKpiScore {
  /** `null` when the task/assignment has no usable estimate (efficiency() returned null). */
  efficiency: number | null;
  /** Always a number — effectiveness() never returns null. */
  effectiveness: number;
}

export interface AggregatedEmployeeKpi {
  /** Average of the non-null `efficiency` scores (x/10 scale, same units `efficiency()` returns) — `null` when every score was NA. */
  efficiencyAvg: number | null;
  /** Average of every `effectiveness` score (x/5 scale). `null` when given zero scores. */
  effectivenessAvg: number | null;
  /** How many scores fed `effectivenessAvg` (= perTaskScores.length). */
  taskCount: number;
  /** How many scores fed `efficiencyAvg` (excludes NA/null entries). */
  efficiencyTaskCount: number;
}

/**
 * Running averages of efficiency (/10) and effectiveness (/5) across an
 * engineer's completed-task assignments. `efficiency: null` entries (no
 * estimate — legacy/estimate-less tasks) are excluded from the efficiency
 * average but still count toward the effectiveness average (a bug can be
 * confirmed against a task regardless of whether it carried an estimate).
 */
export function aggregateEmployeeKpi(perTaskScores: readonly TaskKpiScore[]): AggregatedEmployeeKpi {
  const effectivenessScores = perTaskScores.map((s) => s.effectiveness);
  const efficiencyScores = perTaskScores.map((s) => s.efficiency).filter((v): v is number => v !== null);

  const average = (values: readonly number[]): number | null =>
    values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

  return {
    efficiencyAvg: average(efficiencyScores),
    effectivenessAvg: average(effectivenessScores),
    taskCount: perTaskScores.length,
    efficiencyTaskCount: efficiencyScores.length,
  };
}
