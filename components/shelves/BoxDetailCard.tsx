"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { printBigBoxLabel } from "@/app/(app)/shelves/actions";

export interface BoxDetailCardProps {
  boxId: string;
  boxCode: string;
  shelfCode: string;
  qrDataUrl: string;
  labelText: string;
  lastAuditedAt: string | null;
  /** Owner/employee only (FEATURES.md §2 — accountant is read-only on Shelves). */
  canPrint: boolean;
}

/**
 * Left card on box detail (prototype): box code + shelf, real-encoded
 * Big-Box QR, label text, "Print Big-Box label" → queue.
 */
export function BoxDetailCard({
  boxId,
  boxCode,
  shelfCode,
  qrDataUrl,
  labelText,
  lastAuditedAt,
  canPrint,
}: BoxDetailCardProps) {
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();

  function handlePrint() {
    startTransition(async () => {
      try {
        const result = await printBigBoxLabel(boxId);
        push({
          msg:
            result.status === "requeued"
              ? "Big-Box label re-queued for printing"
              : "Big-Box label queued for printing",
        });
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Could not queue the label." });
      }
    });
  }

  return (
    <div className="w-full flex-none rounded-2xl border border-charcoal p-5 sm:w-80">
      <div className="font-mono text-xl text-snow">Box {boxCode}</div>
      <div className="mt-1 text-[13px] text-smoke">Shelf {shelfCode}</div>
      <div className="mt-1 text-caption text-smoke">
        {lastAuditedAt ? `Last audited ${formatDate(lastAuditedAt)}` : "Not yet audited"}
      </div>

      <div className="mt-4 inline-block rounded-[10px] bg-snow p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, no next/image loader needed */}
        <img src={qrDataUrl} alt={`Box ${boxCode} QR code`} width={160} height={160} className="block" />
      </div>

      <div className="mt-3.5 font-mono text-caption leading-relaxed break-words text-silver-mist">{labelText}</div>

      {canPrint && (
        <Button variant="outline" fullWidth className="mt-4" loading={isPending} onClick={handlePrint}>
          Print Big-Box label
        </Button>
      )}
    </div>
  );
}
