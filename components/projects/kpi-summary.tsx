import { StatCard, type StatTone } from "@/components/ui/stat-card";
import type { AggregatedEmployeeKpi } from "@/lib/pm/kpi";

/** Efficiency → colour by band: strong ≥7 green, mid 4–6.9 amber, weak <4 red; muted when there's no score yet. */
function efficiencyTone(avg: number | null): StatTone {
  if (avg == null) return "muted";
  if (avg >= 7) return "success";
  if (avg >= 4) return "warn";
  return "danger";
}

/**
 * Engineer's own KPI rollup — efficiency (over done tasks with an estimate) +
 * effectiveness (/5).
 *
 * The efficiency label deliberately does NOT say "/10": beating your estimate
 * scores above 10 (lib/pm/kpi.ts caps it at 13), so an engineer who finished
 * early was shown "13.0" under a "/10" heading and reasonably read it as a
 * bug. "10 = on estimate" states the scale it actually uses.
 */
export function KpiSummary({ kpi }: { kpi: AggregatedEmployeeKpi }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatCard
        value={kpi.efficiencyAvg != null ? kpi.efficiencyAvg.toFixed(1) : "—"}
        label={`Efficiency · 10 = on estimate${kpi.efficiencyTaskCount ? ` · ${kpi.efficiencyTaskCount} tasks` : ""}`}
        tone={efficiencyTone(kpi.efficiencyAvg)}
      />
      <StatCard
        value={kpi.effectivenessAvg != null ? kpi.effectivenessAvg.toFixed(1) : "—"}
        label="Effectiveness /5"
        tone="default"
      />
      <StatCard value={kpi.taskCount} label="Done tasks" tone="muted" />
    </div>
  );
}
