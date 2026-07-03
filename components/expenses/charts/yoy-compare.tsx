"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { YoyPoint } from "@/lib/expenses/rollups";
import { formatINRCompact } from "@/lib/format";
import { BAR_MAX_SIZE, BAR_RADIUS, CHART_GRID_COLOR, CHART_TICK_STYLE, LAST_YEAR_COLOR, THIS_YEAR_COLOR } from "@/lib/expenses/chart-theme";
import { ChartCard } from "@/components/expenses/chart-card";
import { ChartTooltip, CHART_CURSOR_FILL } from "./chart-tooltip";

/** Net (income − expense) per month, this year vs last — 2 series → legend mandatory. */
export function YoyCompare({ points, thisYearLabel, lastYearLabel }: { points: YoyPoint[]; thisYearLabel: string; lastYearLabel: string }) {
  const hasData = points.some((p) => p.thisYear !== 0 || p.lastYear !== 0);

  return (
    <ChartCard title="Year over year (net)" hasData={hasData}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} barCategoryGap="24%" barGap={2}>
          <CartesianGrid vertical={false} stroke={CHART_GRID_COLOR} />
          <XAxis dataKey="label" tick={CHART_TICK_STYLE} axisLine={{ stroke: CHART_GRID_COLOR }} tickLine={false} />
          <YAxis
            tick={CHART_TICK_STYLE}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(v: number) => formatINRCompact(v, { fallback: "0" })}
          />
          <Tooltip
            cursor={{ fill: CHART_CURSOR_FILL }}
            content={({ active, label, payload }) => (
              <ChartTooltip
                active={active}
                label={label as string}
                rows={(payload ?? []).map((p) => ({
                  key: String(p.dataKey),
                  label: p.dataKey === "thisYear" ? thisYearLabel : lastYearLabel,
                  value: Number(p.value ?? 0),
                  color: p.dataKey === "thisYear" ? THIS_YEAR_COLOR : LAST_YEAR_COLOR,
                }))}
              />
            )}
          />
          <Legend
            formatter={(value: string) => (
              <span className="text-xs text-smoke">{value === "thisYear" ? thisYearLabel : lastYearLabel}</span>
            )}
            iconType="circle"
            iconSize={8}
          />
          <Bar dataKey="lastYear" name="lastYear" fill={LAST_YEAR_COLOR} radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} />
          <Bar dataKey="thisYear" name="thisYear" fill={THIS_YEAR_COLOR} radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
