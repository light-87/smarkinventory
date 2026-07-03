import { StatCard } from "@/components/ui/stat-card";
import { formatINRCompact } from "@/lib/format";
import type { SummaryTiles as SummaryTilesData } from "@/lib/expenses/rollups";

/** "This month in/out/net · this year in/out/net" (FEATURES.md §5.14) — always both, independent of the chart period switcher. */
export function SummaryTiles({ tiles }: { tiles: SummaryTilesData }) {
  const rows = [
    { key: "monthIn", label: "This month · in", value: tiles.monthIn, tone: "success" as const },
    { key: "monthOut", label: "This month · out", value: -tiles.monthOut, tone: "default" as const },
    { key: "monthNet", label: "This month · net", value: tiles.monthNet, tone: tiles.monthNet >= 0 ? ("success" as const) : ("accent" as const) },
    { key: "yearIn", label: "This year · in", value: tiles.yearIn, tone: "success" as const },
    { key: "yearOut", label: "This year · out", value: -tiles.yearOut, tone: "default" as const },
    { key: "yearNet", label: "This year · net", value: tiles.yearNet, tone: tiles.yearNet >= 0 ? ("success" as const) : ("accent" as const) },
  ];

  return (
    <div className="grid grid-cols-3 gap-3.5 md:grid-cols-6">
      {rows.map((row) => (
        <StatCard key={row.key} value={formatINRCompact(row.value)} label={row.label} tone={row.tone} />
      ))}
    </div>
  );
}
