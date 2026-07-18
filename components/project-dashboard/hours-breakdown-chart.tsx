import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { HoursBreakdownBucket, HoursGroupBy } from "@/lib/pm/dashboard";

const GROUP_OPTIONS: Array<{ value: HoursGroupBy; label: string }> = [
  { value: "project", label: "Project" },
  { value: "employee", label: "Employee" },
  { value: "client", label: "Client" },
];

export interface HoursBreakdownChartProps {
  buckets: HoursBreakdownBucket[];
  groupBy: HoursGroupBy;
  /** Every OTHER current query param (filters), so toggling `group` doesn't drop them — server-driven Link, no client JS, mirrors CalendarView's month-nav Links. */
  baseParams: Record<string, string>;
}

/**
 * Hand-rolled horizontal bar chart — plain divs, no chart library (recharts
 * exists in package.json for other features, but this widget intentionally
 * avoids it per the task brief). Track/fill styling matches
 * components/portal/pm-dashboard.tsx's progress bar (bg-surface-well track,
 * bg-smark-orange fill).
 */
export function HoursBreakdownChart({ buckets, groupBy, baseParams }: HoursBreakdownChartProps) {
  const max = Math.max(1, ...buckets.map((b) => b.hours));

  return (
    <Card padding="none">
      <CardHeader
        title="Hours breakdown"
        meta={
          <div className="inline-flex items-center gap-1 rounded-full border border-charcoal bg-surface-well p-[3px]">
            {GROUP_OPTIONS.map((opt) => {
              const params = new URLSearchParams({ ...baseParams, group: opt.value });
              const active = opt.value === groupBy;
              return (
                <Link
                  key={opt.value}
                  href={`/project-dashboard?${params.toString()}`}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs transition-colors select-none",
                    active ? "bg-ash text-snow" : "text-smoke hover:text-snow",
                  )}
                >
                  {opt.label}
                </Link>
              );
            })}
          </div>
        }
      />
      <div className="px-5 py-[18px]">
        {buckets.length === 0 ? (
          <EmptyState tone="subtle" title="No hours logged in this range" />
        ) : (
          <div className="flex flex-col gap-3">
            {buckets.map((bucket) => (
              <div key={bucket.key}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[14px]">
                  <span className="truncate text-silver-mist">{bucket.label}</span>
                  <span className="flex-none font-mono text-smoke">{formatNumber(bucket.hours, { decimals: 1 })}h</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-well">
                  <div
                    className="h-full rounded-full bg-smark-orange transition-[width]"
                    style={{ width: `${(100 * bucket.hours) / max}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
