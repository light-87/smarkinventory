import { StatCard, type StatTone } from "@/components/ui/stat-card";
import { formatNumber } from "@/lib/format";
import type { DashboardStatTiles } from "@/lib/pm/dashboard";

interface Tile {
  key: string;
  label: string;
  value: string;
  tone?: StatTone;
}

function formatScore(value: number | null, suffix: string): string {
  return value === null ? "—" : `${value.toFixed(1)}${suffix}`;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

/** Owner-only stat tiles (active projects, tasks by status, hours in range, on-time rate, confirmed bugs, avg efficiency/effectiveness) — same 2-col mobile / auto-fit desktop grid as components/dashboard/stat-grid.tsx. */
export function StatTiles({ stats }: { stats: DashboardStatTiles }) {
  const tiles: Tile[] = [
    { key: "active_projects", label: "Active projects", value: formatNumber(stats.activeProjects) },
    { key: "tasks_open", label: "Tasks open", value: formatNumber(stats.tasksOpen), tone: "accent" },
    { key: "tasks_submitted", label: "Tasks submitted", value: formatNumber(stats.tasksSubmitted) },
    { key: "tasks_done", label: "Tasks done", value: formatNumber(stats.tasksDone), tone: "success" },
    { key: "hours_in_range", label: "Hours logged in range", value: formatNumber(stats.hoursLoggedInRange, { decimals: 1 }) },
    { key: "on_time_rate", label: "On-time rate", value: formatPercent(stats.onTimeRate) },
    { key: "confirmed_bugs", label: "Confirmed bugs", value: formatNumber(stats.confirmedBugs), tone: stats.confirmedBugs > 0 ? "accent" : "default" },
    { key: "avg_efficiency", label: "Avg efficiency /10", value: formatScore(stats.avgEfficiency, "") },
    { key: "avg_effectiveness", label: "Avg effectiveness /5", value: formatScore(stats.avgEffectiveness, "") },
  ];

  return (
    <div className="grid grid-cols-2 gap-3.5 md:grid-cols-[repeat(auto-fit,minmax(158px,1fr))]">
      {tiles.map((tile) => (
        <StatCard key={tile.key} value={tile.value} label={tile.label} tone={tile.tone} />
      ))}
    </div>
  );
}
