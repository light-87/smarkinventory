import { cn } from "@/lib/cn";
import { formatDateTime, formatINR } from "@/lib/format";
import { TIMELINE_EVENT_LABEL } from "@/lib/part-events/timeline";
import type { PartTimelineEntry } from "@/lib/part-events/types";

export interface TimelineListProps {
  entries: PartTimelineEntry[];
}

function metaLine(entry: PartTimelineEntry): string {
  const priceText =
    entry.priceOld != null && entry.priceNew != null
      ? `${formatINR(entry.priceOld)} → ${formatINR(entry.priceNew)}`
      : entry.unitPrice != null
        ? formatINR(entry.unitPrice)
        : null;

  return [
    entry.distributor,
    entry.poNumber ? `PO ${entry.poNumber}` : null,
    priceText,
    entry.projectName ? (entry.clientName ? `${entry.projectName} · ${entry.clientName}` : entry.projectName) : null,
    entry.reason,
    entry.actorName ? `by ${entry.actorName}` : null,
  ]
    .filter(Boolean)
    .join("   ·   ");
}

/** Dot-line living record (R2-13: "everything written on it with timestamps"). */
export function TimelineList({ entries }: TimelineListProps) {
  return (
    <div>
      {entries.map((entry, i) => (
        <div key={entry.id} className="flex gap-3.5">
          <div className="flex flex-none flex-col items-center">
            <span
              aria-hidden
              className={cn("mt-1 size-2 flex-none rounded-full", entry.eventType === "received" ? "bg-smark-orange" : "bg-graphite")}
            />
            {i < entries.length - 1 && <span aria-hidden className="mt-0.5 min-h-2 w-px flex-1 bg-ash" />}
          </div>
          <div className={cn("min-w-0 flex-1", i < entries.length - 1 && "pb-[18px]")}>
            <div className="flex items-baseline justify-between gap-2.5">
              <span className="text-sm text-snow">
                {TIMELINE_EVENT_LABEL[entry.eventType]}{" "}
                {entry.qtySigned && (
                  <span className={cn("font-mono", entry.qty != null && entry.qty < 0 ? "text-smark-orange" : "text-silver-mist")}>
                    {entry.qtySigned}
                  </span>
                )}
              </span>
              <span className="flex-none text-xs text-smoke">{formatDateTime(entry.occurredAt)}</span>
            </div>
            <div className="mt-1 text-xs leading-relaxed text-smoke">{metaLine(entry)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
