import { describe, expect, test } from "bun:test";
import { aggregateEmployeeKpi, effectiveness, efficiency, projectProgress } from "@/lib/pm/kpi";

/**
 * lib/pm/kpi.ts — the Project-Management module's pure KPI math (efficiency
 * per engineer-per-task, effectiveness from confirmed bugs, project
 * completion %, and the running per-engineer aggregate). See
 * supabase/migrations/0010_pm.sql's header for how the inputs are sourced.
 */

describe("efficiency", () => {
  test("est <= 0 → null (NA, no KPI)", () => {
    expect(efficiency(0, 5)).toBeNull();
    expect(efficiency(-1, 5)).toBeNull();
  });

  test("on estimate exactly → base 10", () => {
    expect(efficiency(10, 10)).toBe(10);
  });

  test("over estimate: 10 * (1 - (actual - est) / est), floored at 0", () => {
    // est=10, actual=15 → 10 * (1 - 5/10) = 5
    expect(efficiency(10, 15)).toBe(5);
    // est=10, actual=20 → 10 * (1 - 10/10) = 0
    expect(efficiency(10, 20)).toBe(0);
    // est=10, actual=30 → would go negative, floored at 0
    expect(efficiency(10, 30)).toBe(0);
  });

  test("under estimate: 10 * (1 + (est - actual) / est), capped at 13", () => {
    // est=10, actual=5 → 10 * (1 + 5/10) = 15 → capped at 13
    expect(efficiency(10, 5)).toBe(13);
    // est=10, actual=8 → 10 * (1 + 2/10) = 12
    expect(efficiency(10, 8)).toBe(12);
    // est=10, actual=0 → 10 * (1 + 10/10) = 20 → capped at 13
    expect(efficiency(10, 0)).toBe(13);
  });

  test("negative actual hours clamps to 0 before scoring", () => {
    expect(efficiency(10, -5)).toBe(efficiency(10, 0));
  });
});

describe("effectiveness", () => {
  test("fewer than 5 confirmed bugs → 5", () => {
    expect(effectiveness(0)).toBe(5);
    expect(effectiveness(4)).toBe(5);
  });

  test("boundary: 5 confirmed bugs → 4 (not 5)", () => {
    expect(effectiveness(5)).toBe(4);
  });

  test("5 to 10 (inclusive) → 4", () => {
    expect(effectiveness(7)).toBe(4);
    expect(effectiveness(10)).toBe(4);
  });

  test("boundary: 11 confirmed bugs → 3 (not 4)", () => {
    expect(effectiveness(11)).toBe(3);
  });

  test("more than 10 → 3", () => {
    expect(effectiveness(15)).toBe(3);
  });
});

describe("projectProgress", () => {
  test("no tasks → 0", () => {
    expect(projectProgress(0, 0)).toBe(0);
  });

  test("percent of done tasks, rounded", () => {
    expect(projectProgress(4, 2)).toBe(50);
    expect(projectProgress(3, 1)).toBe(33);
    expect(projectProgress(3, 2)).toBe(67);
  });

  test("all done → 100", () => {
    expect(projectProgress(5, 5)).toBe(100);
  });
});

describe("aggregateEmployeeKpi", () => {
  test("empty input → both null, zero counts", () => {
    const result = aggregateEmployeeKpi([]);
    expect(result).toEqual({ efficiencyAvg: null, effectivenessAvg: null, taskCount: 0, efficiencyTaskCount: 0 });
  });

  test("averages efficiency and effectiveness across tasks", () => {
    const result = aggregateEmployeeKpi([
      { efficiency: 10, effectiveness: 5 },
      { efficiency: 8, effectiveness: 4 },
    ]);
    expect(result.efficiencyAvg).toBe(9);
    expect(result.effectivenessAvg).toBe(4.5);
    expect(result.taskCount).toBe(2);
    expect(result.efficiencyTaskCount).toBe(2);
  });

  test("null efficiency entries (estimate-less/legacy tasks) are excluded from the efficiency average but still count toward effectiveness", () => {
    const result = aggregateEmployeeKpi([
      { efficiency: null, effectiveness: 5 },
      { efficiency: 10, effectiveness: 4 },
    ]);
    expect(result.efficiencyAvg).toBe(10);
    expect(result.effectivenessAvg).toBe(4.5);
    expect(result.taskCount).toBe(2);
    expect(result.efficiencyTaskCount).toBe(1);
  });

  test("every entry null efficiency → efficiencyAvg null, effectiveness still averages", () => {
    const result = aggregateEmployeeKpi([
      { efficiency: null, effectiveness: 5 },
      { efficiency: null, effectiveness: 3 },
    ]);
    expect(result.efficiencyAvg).toBeNull();
    expect(result.effectivenessAvg).toBe(4);
    expect(result.efficiencyTaskCount).toBe(0);
  });
});
