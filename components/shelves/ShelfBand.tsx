import { BigBoxCard } from "./BigBoxCard";
import type { RackShelfBand } from "@/app/(app)/shelves/queries";

export interface ShelfBandProps {
  shelf: RackShelfBand;
}

/**
 * One rack band (prototype: shelf header tile + name + box count, thick
 * bottom "plank" border, horizontal row of big-box cards).
 */
export function ShelfBand({ shelf }: ShelfBandProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-charcoal bg-surface-panel">
      <div className="flex items-center gap-3.5 border-b border-border-divider bg-surface-raised px-[18px] py-3.5">
        <span className="flex size-9 flex-none items-center justify-center rounded-lg border-[1.5px] border-graphite text-[18px] text-snow">
          {shelf.code}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] text-snow">{shelf.name ?? `Shelf ${shelf.code}`}</div>
          <div className="mt-0.5 text-caption text-smoke">
            Shelf {shelf.code} · {shelf.boxCount} big box{shelf.boxCount === 1 ? "" : "es"}
          </div>
        </div>
      </div>

      <div className="border-b-[3px] border-ash px-[18px] pt-[18px] pb-5">
        {shelf.boxes.length === 0 ? (
          <div className="py-3 text-center text-caption text-smoke">No big boxes on this shelf yet.</div>
        ) : (
          <div className="flex gap-3.5 overflow-x-auto pb-1.5">
            {shelf.boxes.map((box) => (
              <BigBoxCard key={box.id} box={box} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
