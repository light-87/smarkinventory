"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CumulativeNetPoint } from "@/lib/expenses/rollups";
import { formatINRCompact } from "@/lib/format";
import { AREA_FILL_OPACITY, CHART_GRID_COLOR, CHART_TICK_STYLE, LINE_STROKE_WIDTH, NET_COLOR } from "@/lib/expenses/chart-theme";
import { ChartCard } from "@/components/expenses/chart-card";
import { ChartTooltip } from "./chart-tooltip";

/** Single series — no legend needed (dataviz skill: the title already names what's plotted). */
export function CumulativeNetLine({ series }: { series: CumulativeNetPoint[] }) {
  const hasData = series.some((p) => p.cumulative !== 0);
  const last = series.at(-1);

  return (
    <ChartCard
      title="Cumulative net"
      meta={last ? <span className="font-mono text-snow">{formatINRCompact(last.cumulative)}</span> : undefined}
      hasData={hasData}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series}>
          <defs>
            <linearGradient id="expenses-net-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={NET_COLOR} stopOpacity={AREA_FILL_OPACITY * 2} />
              <stop offset="100%" stopColor={NET_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>
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
            content={({ active, label, payload }) => (
              <ChartTooltip
                active={active}
                label={label as string}
                rows={
                  payload && payload.length > 0
                    ? [{ key: "cumulative", label: "Cumulative net", value: Number(payload[0]?.value ?? 0), color: NET_COLOR }]
                    : []
                }
              />
            )}
          />
          <Area
            type="monotone"
            dataKey="cumulative"
            stroke={NET_COLOR}
            strokeWidth={LINE_STROKE_WIDTH}
            fill="url(#expenses-net-fill)"
            dot={false}
            activeDot={{ r: 4, fill: NET_COLOR, stroke: "transparent" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
