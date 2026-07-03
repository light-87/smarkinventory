"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProjectIncomeSlice } from "@/lib/expenses/rollups";
import { formatINRCompact } from "@/lib/format";
import { BAR_MAX_SIZE, BAR_RADIUS_HORIZONTAL, CHART_GRID_COLOR, CHART_TICK_STYLE, PROJECT_INCOME_COLOR } from "@/lib/expenses/chart-theme";
import { ChartCard } from "@/components/expenses/chart-card";
import { ChartTooltip, CHART_CURSOR_FILL } from "./chart-tooltip";

/** Ranked single-measure bars, income context → the app's positive/success hue. */
export function TopProjectsIncome({ slices, periodLabel }: { slices: ProjectIncomeSlice[]; periodLabel: string }) {
  const hasData = slices.length > 0;
  const height = Math.max(180, slices.length * 34 + 40);

  return (
    <ChartCard title="Top projects (income)" meta={<span className="text-smoke">{periodLabel}</span>} hasData={hasData} height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={slices} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid horizontal={false} stroke={CHART_GRID_COLOR} />
          <XAxis
            type="number"
            tick={CHART_TICK_STYLE}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => formatINRCompact(v, { fallback: "0" })}
          />
          <YAxis type="category" dataKey="label" tick={CHART_TICK_STYLE} axisLine={false} tickLine={false} width={96} />
          <Tooltip
            cursor={{ fill: CHART_CURSOR_FILL }}
            content={({ active, payload }) => (
              <ChartTooltip
                active={active}
                rows={
                  payload && payload.length > 0
                    ? [
                        {
                          key: "total",
                          label: String(payload[0]?.payload?.label ?? ""),
                          value: Number(payload[0]?.value ?? 0),
                          color: PROJECT_INCOME_COLOR,
                        },
                      ]
                    : []
                }
              />
            )}
          />
          <Bar dataKey="total" fill={PROJECT_INCOME_COLOR} radius={BAR_RADIUS_HORIZONTAL} maxBarSize={BAR_MAX_SIZE} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
