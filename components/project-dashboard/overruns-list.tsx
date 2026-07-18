import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { formatNumber } from "@/lib/format";
import type { OverrunRow } from "@/lib/pm/dashboard";

/** Tasks whose logged hours (holds excluded) exceed their estimated hours — current-state, not date-scoped. */
export function OverrunsList({ rows }: { rows: OverrunRow[] }) {
  return (
    <Card padding="none">
      <CardHeader title="Est vs actual overruns" meta={`${rows.length} task${rows.length === 1 ? "" : "s"}`} />
      <div className="px-5 py-[18px]">
        {rows.length === 0 ? (
          <EmptyState tone="subtle" title="No tasks are over their estimate" description="Every estimated task is within its hours (hold windows excluded)." />
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.taskId} className="flex flex-col gap-2 rounded-xl border border-charcoal bg-surface-panel px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-[15px] font-medium text-snow">{row.title}</div>
                    <div className="text-caption text-smoke">{row.projectName}</div>
                  </div>
                  <Chip tone="warn" size="sm" mono>
                    +{formatNumber(row.overrunHours, { decimals: 1 })}h over
                  </Chip>
                </div>
                <p className="text-caption text-smoke">
                  {formatNumber(row.actualHours, { decimals: 1 })}h logged of {formatNumber(row.estimatedHours, { decimals: 1 })}h estimated
                </p>
                {row.assignees.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {row.assignees.map((name) => (
                      <Chip key={name} tone="neutral" size="sm">
                        {name}
                      </Chip>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
