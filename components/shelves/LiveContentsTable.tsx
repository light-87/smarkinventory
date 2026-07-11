import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { isLowState, stockStateForPart } from "./stock-state";
import type { AuditContentItem } from "@/lib/audit";

export interface LiveContentsTableProps {
  items: readonly AuditContentItem[];
}

/**
 * Right panel on box detail (prototype "Live contents"): PID · MPN · value ·
 * qty, low = orange, rows → part drawer.
 */
export function LiveContentsTable({ items }: LiveContentsTableProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-charcoal">
      <div className="flex items-center justify-between border-b border-border-divider px-[18px] py-3.5">
        <span className="text-[14px] font-medium text-snow">Live contents</span>
        <span className="text-caption text-smoke">
          {items.length} part type{items.length === 1 ? "" : "s"}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="px-[18px] py-10 text-center text-[14px] text-smoke">Nothing in this box yet.</div>
      ) : (
        items.map((item) => {
          const low = isLowState(stockStateForPart({ total_qty: item.totalQty, reorder_point: item.reorderPoint }));
          return (
            <Link
              key={item.locationId}
              href={`/part/${item.pid}`}
              className="flex items-center gap-3 border-b border-border-hairline px-[18px] py-[11px] transition-colors last:border-b-0 hover:bg-surface-hover"
            >
              <span className="w-28 flex-none truncate font-mono text-[14px] text-snow">{item.pid}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-caption text-smoke">{item.mpn ?? "—"}</span>
              <span className="w-24 flex-none truncate text-right text-[14px] text-silver-mist">
                {item.value ?? "—"}
              </span>
              <span
                className={cn("w-16 flex-none text-right font-mono text-[14px]", low ? "text-smark-orange" : "text-snow")}
              >
                {formatNumber(item.recordedQty)}
              </span>
            </Link>
          );
        })
      )}
    </div>
  );
}
