"use client";

import { smk } from "@/lib/theme";
import { formatINR } from "@/lib/format";
import { CHART_TOOLTIP_BG, CHART_TOOLTIP_BORDER } from "@/lib/expenses/chart-theme";

export interface TooltipRow {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface ChartTooltipProps {
  active?: boolean;
  label?: string;
  rows: TooltipRow[];
}

/**
 * Shared dark tooltip body (dataviz skill references/interaction.md: "values
 * lead, labels follow" — the ₹ figure is the strong element, the series name
 * is secondary; a short line-key swatch carries identity, never a filled
 * box). Charts pass their own `rows` (already-resolved label/value/color per
 * series at the hovered point) via a small adapter around recharts'
 * `<Tooltip content={...}>` render-prop.
 */
export function ChartTooltip({ active, label, rows }: ChartTooltipProps) {
  if (!active || rows.length === 0) return null;

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-none"
      style={{ background: CHART_TOOLTIP_BG, borderColor: CHART_TOOLTIP_BORDER, borderWidth: 1 }}
    >
      {label && <div className="mb-1 text-[11px] text-smoke">{label}</div>}
      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2">
            <span aria-hidden className="h-[2px] w-3 flex-none rounded-full" style={{ background: row.color }} />
            <span className="text-smoke">{row.label}</span>
            <span className="ml-auto font-mono font-medium text-snow tabular-nums">{formatINR(row.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Cursor fill for bar charts (subtle lighten instead of a hard rect). */
export const CHART_CURSOR_FILL = "rgba(255,255,255,0.03)";
export const CHART_ACTIVE_DOT_STROKE = smk.surface;
