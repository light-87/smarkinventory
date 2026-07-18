import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { formatDate, formatNumber } from "@/lib/format";
import type { PartDetailLocation } from "@/lib/part-events/types";

export interface LocationsTableProps {
  locations: PartDetailLocation[];
  className?: string;
}

/** Shelf · Big Box · ESD plastic · qty + last-counted (supports the rare two-location reel/working-box case). */
export function LocationsTable({ locations, className }: LocationsTableProps) {
  if (locations.length === 0) {
    return (
      <EmptyState
        tone="subtle"
        className={className}
        description="No physical location assigned yet — this part is waiting in Receive's onboarding queue."
      />
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-lg border border-charcoal", className)}>
      <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2 border-b border-border-divider bg-surface-raised px-3.5 py-2.5 text-[13px] tracking-[0.04em] text-smoke uppercase">
        <span>Shelf · Big Box</span>
        <span>ESD plastic</span>
        <span className="text-right">Qty · counted</span>
      </div>
      {locations.map((location) => (
        <div
          key={location.id}
          className="grid grid-cols-[1.4fr_1fr_1fr] items-center gap-2 border-b border-border-hairline px-3.5 py-[11px] last:border-b-0"
        >
          <span className="truncate text-[15px] text-snow">
            Shelf {location.shelfCode} · <span className="font-mono text-silver-mist">{location.boxName}</span>
          </span>
          <span className="font-mono text-xs text-silver-mist">{location.esdNote ?? "—"}</span>
          <span className="text-right font-mono text-[15px] text-snow">
            {formatNumber(location.qty)}
            <span className="mt-0.5 block text-[13px] text-faint">
              {location.lastCountedAt ? formatDate(location.lastCountedAt) : "not counted"}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
