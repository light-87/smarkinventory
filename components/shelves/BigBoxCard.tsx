import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import type { RackBoxCard } from "@/app/(app)/shelves/queries";

export interface BigBoxCardProps {
  box: RackBoxCard;
}

/**
 * Horizontal big-box card (prototype: code mono, name/category chip, first-5
 * part chips w/ low dots, "+N more", orange low dot when anything inside is
 * low/out). Click → box detail.
 */
export function BigBoxCard({ box }: BigBoxCardProps) {
  return (
    <Link
      href={`/shelves/${box.id}`}
      className="relative w-[214px] flex-none overflow-hidden rounded-xl border border-charcoal bg-surface-raised transition-colors hover:border-smark-orange"
    >
      {box.low && (
        <span aria-hidden className="absolute top-3 right-3 z-10 size-2 rounded-full bg-smark-orange" />
      )}

      <div className="border-b border-border-faint bg-surface-hover px-3.5 py-3">
        <div className="truncate font-mono text-[16px] text-snow">{box.code}</div>
        {box.category && (
          <span className="mt-2 inline-block rounded-full border border-charcoal px-2.5 py-0.5 text-[10px] text-silver-mist">
            {box.category}
          </span>
        )}
      </div>

      <div className="px-2 py-2">
        {box.chips.length === 0 && box.moreCount === 0 ? (
          <div className="px-1.5 py-2 text-[11px] text-faint">Empty box</div>
        ) : (
          <>
            {box.chips.map((chip) => (
              <div key={chip.pid} className="flex items-center gap-1.5 rounded-md px-1.5 py-1">
                <span
                  aria-hidden
                  className={cn("size-1.5 flex-none rounded-full", chip.low ? "bg-smark-orange" : "bg-graphite")}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-silver-mist">{chip.pid}</span>
                <span
                  className={cn(
                    "flex-none font-mono text-[11px]",
                    chip.low ? "text-smark-orange" : "text-silver-mist",
                  )}
                >
                  {formatNumber(chip.qty)}
                </span>
              </div>
            ))}
            {box.moreCount > 0 && (
              <div className="px-1.5 pt-1 pb-0.5 text-[11px] text-faint">+ {box.moreCount} more types</div>
            )}
          </>
        )}
      </div>
    </Link>
  );
}
