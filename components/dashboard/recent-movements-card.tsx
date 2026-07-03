import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import type { MovementFeedRow } from "@/lib/dashboard/queries";

/**
 * Prototype lays movements out as one dense row (time · PID · delta · reason
 * · box). At 360px that's too many fixed-width columns for one line without
 * horizontal scroll, so this stacks into two lines below `sm` and recombines
 * into the single-row layout at `sm+` (matches spec visually on desktop).
 */
export function RecentMovementsCard({
  movements,
  error,
}: {
  movements: MovementFeedRow[] | null;
  error?: string | null;
}) {
  return (
    <Card padding="none">
      <CardHeader
        title="Recent movements"
        meta={
          <Link
            href="/daily"
            className="text-smark-orange transition-colors hover:text-smark-orange-soft"
          >
            today&rsquo;s report →
          </Link>
        }
      />
      {error || !movements ? (
        <div className="px-5 py-6 text-body-sm text-smoke">
          {error ?? "Movements unavailable."}
        </div>
      ) : movements.length === 0 ? (
        <div className="px-5 py-5">
          <EmptyState
            tone="subtle"
            title="No movements yet"
            description="Stock picks, receives and adjustments will show up here."
          />
        </div>
      ) : (
        <div>
          {movements.map((m) => (
            <div
              key={m.id}
              className="flex flex-col gap-1.5 border-b border-border-faint px-5 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-3"
            >
              <div className="flex items-center gap-3">
                <span className="w-11 flex-none font-mono text-[12px] text-smoke">{m.time}</span>
                {m.pid === "—" ? (
                  <span className="flex-none truncate font-mono text-[13px] text-snow sm:w-28">
                    {m.pid}
                  </span>
                ) : (
                  <Link
                    href={`/part/${m.pid}`}
                    className="flex-none truncate font-mono text-[13px] text-snow transition-colors hover:text-smark-orange sm:w-28"
                  >
                    {m.pid}
                  </Link>
                )}
                <Chip tone={m.deltaTone} mono>
                  {m.delta}
                </Chip>
              </div>
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-body-sm text-silver-mist">
                  {m.reason}
                </span>
                <Chip tone="default" mono className="max-w-[104px] flex-none truncate">
                  {m.box}
                </Chip>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
