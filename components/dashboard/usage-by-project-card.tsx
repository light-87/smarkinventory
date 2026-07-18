import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatNumber } from "@/lib/format";
import type { ProjectUsageBar } from "@/lib/dashboard/queries";

/** Distinct parts touched per project — bars scaled to the largest count. */
export function UsageByProjectCard({
  bars,
  error,
}: {
  bars: ProjectUsageBar[] | null;
  error?: string | null;
}) {
  return (
    <Card>
      <div className="mb-4 text-[17px] font-medium text-snow">Usage by project</div>
      {error || !bars ? (
        <div className="text-body-sm text-smoke">{error ?? "Usage data unavailable."}</div>
      ) : bars.length === 0 ? (
        <EmptyState
          tone="subtle"
          title="No usage yet"
          description="Parts picked or received against a project will show up here."
        />
      ) : (
        <div className="flex flex-col gap-3.5">
          {bars.map((bar) => (
            <div key={bar.projectId}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[14px]">
                <span className="truncate text-silver-mist">{bar.name}</span>
                <span className="flex-none font-mono text-smoke">
                  {formatNumber(bar.count)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ash">
                <div
                  className="relative h-full rounded-full bg-graphite"
                  style={{ width: `${bar.pct}%` }}
                >
                  <span className="absolute inset-y-0 right-0 w-1 rounded-full bg-smark-orange" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
