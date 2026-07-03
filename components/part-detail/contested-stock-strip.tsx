import Link from "next/link";
import { cn } from "@/lib/cn";
import { buildContestedMessage } from "@/lib/part-events/contested";
import type { ContestedStock } from "@/lib/part-events/types";

export interface ContestedStockStripProps {
  contested: ContestedStock;
  className?: string;
}

/** R2-10: cross-project demand exceeds this part's stock — links through to the cart line. */
export function ContestedStockStrip({ contested, className }: ContestedStockStripProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-smark-orange bg-surface-accent px-4 py-3",
        className,
      )}
    >
      <span aria-hidden className="mt-0.5 flex-none text-smark-orange">
        ⚠
      </span>
      <p className="min-w-0 text-[13px] text-snow">
        {buildContestedMessage(contested)}{" "}
        <Link href={`/cart?part_id=${contested.partId}`} className="text-smark-orange-soft hover:underline">
          Cart →
        </Link>
      </p>
    </div>
  );
}
