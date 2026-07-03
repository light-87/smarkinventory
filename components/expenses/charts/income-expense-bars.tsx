"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { IncomeExpensePoint } from "@/lib/expenses/rollups";
import { formatINRCompact } from "@/lib/format";
import {
  BAR_MAX_SIZE,
  BAR_RADIUS,
  CHART_GRID_COLOR,
  CHART_TICK_STYLE,
  EXPENSE_COLOR,
  INCOME_COLOR,
} from "@/lib/expenses/chart-theme";
import { ChartCard } from "@/components/expenses/chart-card";
import { ChartTooltip, CHART_CURSOR_FILL } from "./chart-tooltip";

/** Two-series grouped bars (income vs expense) — a legend is mandatory at ≥2 series (dataviz skill). */
export function IncomeExpenseBars({ series }: { series: IncomeExpensePoint[] }) {
  const hasData = series.some((p) => p.income > 0 || p.expense > 0);

  return (
    <ChartCard title="Income vs expense" hasData={hasData}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series} barCategoryGap="28%" barGap={2}>
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
                  label: p.dataKey === "income" ? "Income" : "Expense",
                  value: Number(p.value ?? 0),
                  color: p.dataKey === "income" ? INCOME_COLOR : EXPENSE_COLOR,
                }))}
              />
            )}
          />
          <Legend
            formatter={(value: string) => <span className="text-xs text-smoke">{value === "income" ? "Income" : "Expense"}</span>}
            iconType="circle"
            iconSize={8}
          />
          <Bar dataKey="income" name="income" fill={INCOME_COLOR} radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} />
          <Bar dataKey="expense" name="expense" fill={EXPENSE_COLOR} radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
