"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip } from "recharts";
import type { AiSpendSummary } from "@/lib/expenses/rollups";
import { formatINR, formatINRCompact } from "@/lib/format";
import { BAR_RADIUS, MAGNITUDE_COLOR } from "@/lib/expenses/chart-theme";
import { Card, CardHeader } from "@/components/ui/card";
import { ChartTooltip } from "./chart-tooltip";

/**
 * AI spend meter (R2-37) — a trust surface for the sourcing agent, not a
 * full chart card: two figures (₹/run, this month) + a small monthly
 * sparkline. Renders an explicit, honest zero-state until the worker/
 * ai-memory packages start writing `smark_agent_runs.actual_cost` — never a
 * fake flat line.
 */
export function AiSpendMeter({ summary }: { summary: AiSpendSummary }) {
  return (
    <Card padding="none">
      <CardHeader title="AI sourcing cost" meta={<span className="text-smoke">last 6 months</span>} />
      <div className="flex items-center gap-5 px-5 py-[18px]">
        <div className="flex flex-1 gap-6">
          <div>
            <div className="text-2xl leading-none font-normal text-snow tabular-nums">
              {summary.hasData ? formatINR(summary.thisMonthTotal) : "—"}
            </div>
            <div className="mt-1.5 text-caption text-smoke">This month</div>
          </div>
          <div>
            <div className="text-2xl leading-none font-normal text-snow tabular-nums">
              {summary.avgPerRun != null ? formatINR(summary.avgPerRun) : "—"}
            </div>
            <div className="mt-1.5 text-caption text-smoke">₹ / run</div>
          </div>
        </div>
        <div className="h-14 w-[136px] flex-none">
          {summary.hasData ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.monthly}>
                <Tooltip
                  cursor={false}
                  content={({ active, label, payload }) => (
                    <ChartTooltip
                      active={active}
                      label={label as string}
                      rows={
                        payload && payload.length > 0
                          ? [{ key: "total", label: "AI spend", value: Number(payload[0]?.value ?? 0), color: MAGNITUDE_COLOR }]
                          : []
                      }
                    />
                  )}
                />
                <Bar dataKey="total" fill={MAGNITUDE_COLOR} radius={BAR_RADIUS} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-charcoal text-[11px] text-smoke">
              No AI runs yet
            </div>
          )}
        </div>
      </div>
      {summary.hasData && (
        <div className="border-t border-border-divider px-5 py-2 text-[11px] text-faint">
          Peak month {formatINRCompact(Math.max(...summary.monthly.map((m) => m.total), 0))}
        </div>
      )}
    </Card>
  );
}
