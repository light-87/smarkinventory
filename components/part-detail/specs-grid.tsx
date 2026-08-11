import { cn } from "@/lib/cn";
import type { SpecEntry } from "@/lib/part-events/types";

export interface SpecsGridProps {
  specs: SpecEntry[];
  className?: string;
}

/**
 * The 2-column specifications grid (tab-part-detail.md §2 + R2-11 Last price /
 * Stock value rows).
 *
 * Values WRAP rather than truncate (client report, 2026-08-11: "description is
 * clipped", on "IC ADC 24BIT SIGMA-DELT…"). This is the detail view — the one
 * place that exists to show a part in full — so cutting the field the client is
 * here to read defeats it. The Inventory grid still truncates, because a column
 * has to hold its width; there the full text is a hover away and this drawer is
 * where it resolves.
 *
 * `break-words` rather than plain wrapping: part numbers and package codes are
 * long unbroken tokens ("X096-2864KLBAG01-H30") that would otherwise push the
 * cell wider than its column.
 */
export function SpecsGrid({ specs, className }: SpecsGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 items-start gap-px overflow-hidden rounded-lg border border-border-divider bg-border-divider",
        className,
      )}
    >
      {specs.map((spec) => (
        <div key={spec.label} className="h-full bg-surface px-3.5 py-[11px]">
          <div className="mb-1 text-[13px] text-smoke">{spec.label}</div>
          <div className="text-sm break-words text-snow">{spec.value}</div>
        </div>
      ))}
    </div>
  );
}
