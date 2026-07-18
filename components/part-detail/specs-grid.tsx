import { cn } from "@/lib/cn";
import type { SpecEntry } from "@/lib/part-events/types";

export interface SpecsGridProps {
  specs: SpecEntry[];
  className?: string;
}

/** The 2-column specifications grid (tab-part-detail.md §2 + R2-11 Last price / Stock value rows). */
export function SpecsGrid({ specs, className }: SpecsGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border-divider bg-border-divider",
        className,
      )}
    >
      {specs.map((spec) => (
        <div key={spec.label} className="bg-surface px-3.5 py-[11px]">
          <div className="mb-1 text-[13px] text-smoke">{spec.label}</div>
          <div className="truncate text-sm text-snow">{spec.value}</div>
        </div>
      ))}
    </div>
  );
}
