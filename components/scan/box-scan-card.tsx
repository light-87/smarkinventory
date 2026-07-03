"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatNumber } from "@/lib/format";
import type { ResolvedBox } from "@/lib/scan";

export interface BoxScanCardProps {
  data: ResolvedBox;
}

function isLowOrOut(qty: number, reorderPoint: number | null): boolean {
  if (qty <= 0) return true;
  return reorderPoint != null && qty <= reorderPoint;
}

/**
 * Box scan result card (plan/tab-scan.md: "contents preview, Count/audit →
 * link to shelves audit, Receive into this box → /receive?box= link").
 *
 * Route notes: "Receive into this box" is `/receive?box=<id>` verbatim per
 * this package's mission/spec. The guided-audit route (R2-25/Q-10, owned by
 * `shelves`) isn't finalized elsewhere yet, so this links to
 * `/shelves/box/<id>?audit=1` as a reasonable placeholder — confirm/adjust
 * with the `shelves` package owner at integration if their route differs.
 */
export function BoxScanCard({ data }: BoxScanCardProps) {
  const router = useRouter();
  const { box, shelf, contents } = data;

  return (
    <div className="overflow-hidden rounded-2xl border border-charcoal">
      <CardHeader
        title={
          <span>
            <span className="font-mono text-lg text-snow">Box {box.name}</span>
            {shelf && <span className="ml-2 text-body-sm text-smoke">Shelf {shelf.code}</span>}
          </span>
        }
      />

      {contents.length === 0 ? (
        <div className="p-5">
          <EmptyState tone="subtle" description="This box has no stock yet." />
        </div>
      ) : (
        <div>
          {contents.map((line) => {
            const low = isLowOrOut(line.qty, line.part.reorder_point);
            return (
              <div
                key={line.id}
                className="flex items-center gap-3 border-b border-border-hairline px-5 py-[11px] last:border-b-0"
              >
                <span className="w-28 flex-none truncate font-mono text-[13px] text-snow">
                  {line.part.internal_pid}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-caption text-smoke">
                  {line.part.mpn ?? "—"}
                </span>
                <span className={`flex-none font-mono text-[13px] ${low ? "text-smark-orange" : "text-snow"}`}>
                  {formatNumber(line.qty)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-3 p-5">
        <Button
          variant="outline"
          size="lg"
          fullWidth
          onClick={() => router.push(`/shelves/box/${box.id}?audit=1`)}
        >
          Count / audit
        </Button>
        <Button variant="outline" size="lg" fullWidth onClick={() => router.push(`/receive?box=${box.id}`)}>
          Receive into this box
        </Button>
      </div>
    </div>
  );
}
