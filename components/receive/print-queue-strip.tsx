"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

export interface PrintQueueStripProps {
  initialCount: number;
}

interface PrintSheetResponse {
  url?: string;
  count?: number;
  error?: string;
}

/**
 * Label print queue strip [R2-35] — every "Save & print" / onboarding assign
 * QUEUES a label instead of printing one-by-one; "Print sheet" renders every
 * queued label onto one Avery-layout PDF (app/api/labels/print-sheet) and
 * marks them printed.
 */
export function PrintQueueStrip({ initialCount }: PrintQueueStripProps) {
  const { push } = useToast();
  const [count, setCount] = useState(initialCount);
  const [isPending, startTransition] = useTransition();

  function handlePrint() {
    startTransition(async () => {
      const response = await fetch("/api/labels/print-sheet", { method: "POST" });
      const body = (await response.json()) as PrintSheetResponse;
      if (!response.ok || !body.url) {
        push({ msg: body.error ?? "Could not render the print sheet." });
        return;
      }
      window.open(body.url, "_blank", "noopener,noreferrer");
      push({ msg: `Printed ${body.count ?? 0} label${body.count === 1 ? "" : "s"} — sheet downloaded` });
      setCount(0);
    });
  }

  return (
    <Card padding="md" className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-[15px] text-snow">Print queue</div>
        <div className="mt-0.5 text-caption text-smoke">
          {count === 0 ? "Nothing queued" : `${count} label${count === 1 ? "" : "s"} queued`}
        </div>
      </div>
      <Button onClick={handlePrint} loading={isPending} disabled={count === 0} variant="accent-outline">
        Print sheet
      </Button>
    </Card>
  );
}
