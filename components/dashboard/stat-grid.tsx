import type { ReactNode } from "react";
import { StatCard, type StatTone } from "@/components/ui/stat-card";
import { formatINRCompact, formatNumber, formatUnpricedNote } from "@/lib/format";
import type { DashboardStats } from "@/lib/dashboard/queries";

interface Tile {
  key: string;
  label: ReactNode;
  value: string;
  tone?: StatTone;
}

/**
 * 7 stat tiles (plan/tab-dashboard.md R2-11 grew this from 6 → 7). Mobile:
 * fixed 2-column grid; desktop: auto-fit ≥158px columns, same as the
 * prototype's `statCols`.
 */
export function StatGrid({
  stats,
  error,
}: {
  stats: DashboardStats | null;
  error?: string | null;
}) {
  if (error || !stats) {
    return (
      <div className="rounded-2xl border border-charcoal bg-surface-panel px-5 py-4 text-body-sm text-smoke">
        {error ?? "Stats unavailable."}
      </div>
    );
  }

  const unpricedNote = formatUnpricedNote(stats.unpricedCount);
  const inventoryLabel = unpricedNote ? (
    <span className="flex flex-col gap-0.5">
      <span>Inventory value ₹</span>
      <span className="text-[13px] text-smoke/80">{unpricedNote}</span>
    </span>
  ) : (
    "Inventory value ₹"
  );

  const tiles: Tile[] = [
    { key: "units", label: "Units in stock", value: formatNumber(stats.unitsInStock) },
    { key: "skus", label: "Distinct SKUs", value: formatNumber(stats.distinctSkus) },
    { key: "low", label: "Low stock", value: formatNumber(stats.lowStock), tone: "warn" },
    { key: "out", label: "Out of stock", value: formatNumber(stats.outOfStock), tone: "danger" },
    { key: "onorder", label: "On order", value: formatNumber(stats.onOrder) },
    { key: "movements", label: "Movements today", value: formatNumber(stats.movementsToday) },
    { key: "value", label: inventoryLabel, value: formatINRCompact(stats.inventoryValue) },
  ];

  return (
    <div className="grid grid-cols-2 gap-3.5 md:grid-cols-[repeat(auto-fit,minmax(158px,1fr))]">
      {tiles.map((tile) => (
        <StatCard key={tile.key} value={tile.value} label={tile.label} tone={tile.tone} />
      ))}
    </div>
  );
}
