import { StatCard } from "@/components/ui/stat-card";
import type { AggregatedEmployeeKpi } from "@/lib/pm/kpi";

/** Engineer's own KPI rollup — efficiency (/10, over done tasks with an estimate) + effectiveness (/5). */
export function KpiSummary({ kpi }: { kpi: AggregatedEmployeeKpi }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatCard
        value={kpi.efficiencyAvg != null ? kpi.efficiencyAvg.toFixed(1) : "—"}
        label={`Efficiency /10${kpi.efficiencyTaskCount ? ` · ${kpi.efficiencyTaskCount} tasks` : ""}`}
        tone="accent"
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
