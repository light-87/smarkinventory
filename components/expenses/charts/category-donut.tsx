"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { CategorySlice } from "@/lib/expenses/rollups";
import { formatINR, formatINRCompact } from "@/lib/format";
import { colorForCategory } from "@/lib/expenses/chart-theme";
import { smk } from "@/lib/theme";
import { ChartCard } from "@/components/expenses/chart-card";
import { ChartTooltip } from "./chart-tooltip";

/**
 * Expense-by-category donut for the current period. ≥2 series ALWAYS needs
 * an identity channel beyond color alone (dataviz skill) — the palette's
 * worst-case adjacent CVD separation is a WARN band (see chart-theme.ts), so
 * this renders an explicit swatch+label+₹ legend list beside the ring rather
 * than leaning on the wedge colors by themselves.
 */
export function CategoryDonut({ slices, periodLabel }: { slices: CategorySlice[]; periodLabel: string }) {
  const total = slices.reduce((acc, s) => acc + s.total, 0);
  const hasData = slices.length > 0 && total > 0;

  return (
    <ChartCard title="By category" meta={<span className="text-smoke">{periodLabel}</span>} hasData={hasData}>
      <div className="flex h-full items-center gap-4">
        <div className="h-full min-w-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="total"
                nameKey="category"
                innerRadius="58%"
                outerRadius="88%"
                paddingAngle={slices.length > 1 ? 2 : 0}
                stroke={smk.surface}
                strokeWidth={2}
              >
                {slices.map((s) => (
                  <Cell key={s.category} fill={colorForCategory(s.category)} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => (
                  <ChartTooltip
                    active={active}
                    rows={
                      payload && payload.length > 0
                        ? [
                            {
                              key: "value",
                              label: String(payload[0]?.name ?? ""),
                              value: Number(payload[0]?.value ?? 0),
                              color: colorForCategory(String(payload[0]?.name ?? "")),
                            },
                          ]
                        : []
                    }
                  />
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="flex w-[136px] flex-none flex-col gap-2 overflow-y-auto">
          {slices.map((s) => (
            <li key={s.category} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden
                className="size-2 flex-none rounded-full"
                style={{ background: colorForCategory(s.category) }}
              />
              <span className="min-w-0 flex-1 truncate text-silver-mist">{s.category}</span>
              <span className="flex-none font-mono text-smoke">{formatINRCompact(s.total)}</span>
            </li>
          ))}
        </ul>
      </div>
      <span className="sr-only">Total {formatINR(total)}</span>
    </ChartCard>
  );
}
