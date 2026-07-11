import { StatCard, type StatTone } from "@/components/ui/stat-card";
import type { AggregatedEmployeeKpi } from "@/lib/pm/kpi";

/** Efficiency (/10) → colour by band: strong ≥7 green, mid 4–6.9 amber, weak <4 red; muted when there's no score yet. */
function efficiencyTone(avg: number | null): StatTone {
  if (avg == null) return "muted";
  if (avg >= 7) return "success";
  if (avg >= 4) return "warn";
  return "danger";
}

/** Engineer's own KPI rollup — efficiency (/10, over done tasks with an estimate) + effectiveness (/5). */
export function KpiSummary({ kpi }: { kpi: AggregatedEmployeeKpi }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatCard
        value={kpi.efficiencyAvg != null ? kpi.efficiencyAvg.toFixed(1) : "—"}
        label={`Efficiency /10${kpi.efficiencyTaskCount ? ` · ${kpi.efficiencyTaskCount} tasks` : ""}`}
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
