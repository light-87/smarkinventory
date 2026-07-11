import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTime } from "@/lib/format";
import { computeMovementTotals, formatMovementLine, groupMovementsByActor, type MovementDailyRow } from "@/lib/daily/compute";

export interface MovementsCardProps {
  rows: MovementDailyRow[] | null;
  error?: string | null;
  nameById: ReadonlyMap<string, string>;
}

/** Section 2 — Movements today (FEATURES.md §5.13): grouped-by-person feed + totals strip. */
export function MovementsCard({ rows, error, nameById }: MovementsCardProps) {
  return (
    <Card padding="none">
      <CardHeader title="Movements today" />

      {error || !rows ? (
        <div className="px-5 py-6 text-body-sm text-smoke">{error ?? "Movements unavailable."}</div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-5">
          <EmptyState tone="subtle" title="No movements" description="Stock picks, receives and adjustments will show up here." />
        </div>
      ) : (
        <>
          <TotalsStrip rows={rows} />
          <div>
            {groupMovementsByActor(rows, nameById).map((group) => (
              <div key={group.actorId} className="border-b border-border-faint px-5 py-3 last:border-b-0">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[14px] font-medium text-snow">{group.actorName}</span>
                  <Chip tone="default" size="sm">
                    {group.rows.length}
                  </Chip>
                </div>
                <div className="flex flex-col gap-1.5">
                  {group.rows.map((row) => (
                    <div key={row.id} className="flex items-baseline gap-2.5 text-body-sm text-silver-mist">
                      <span className="w-11 flex-none font-mono text-[13px] text-smoke">{formatTime(row.occurredAt)}</span>
                      <span className="min-w-0">{formatMovementLine(row)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function TotalsStrip({ rows }: { rows: MovementDailyRow[] }) {
  const totals = computeMovementTotals(rows);
  return (
    <div className="grid grid-cols-3 gap-3 border-b border-border-divider px-5 py-3.5">
      <TotalTile label="Items out" value={totals.itemsOut} tone="accent" />
      <TotalTile label="Items in" value={totals.itemsIn} />
      <TotalTile label="Adjustments" value={totals.adjustments} />
    </div>
  );
}

function TotalTile({ label, value, tone }: { label: string; value: number; tone?: "accent" }) {
  return (
    <div>
      <div className={`font-mono text-[20px] leading-none ${tone === "accent" ? "text-smark-orange" : "text-snow"}`}>{value}</div>
      <div className="mt-1 text-caption text-smoke">{label}</div>
    </div>
  );
}
