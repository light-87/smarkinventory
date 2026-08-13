"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

export interface PrintQueueStripProps {
  initialCount: number;
}

interface PrintSheetResponse {
  url?: string;
  count?: number;
  remaining?: number;
  error?: string;
}

/**
 * Label print queue strip [R2-35] — every "Save & print" / onboarding assign
 * QUEUES a label instead of printing one-by-one; "Print sheet" renders every
 * queued label onto one Avery-layout PDF (app/api/labels/print-sheet) and
 * marks them printed.
 *
 * Two things here exist because of a client report, 2026-08-11: "Receive not
 * working — does not give any output for printing".
 *
 *  - The tab is opened SYNCHRONOUSLY, before the fetch. `window.open()` after
 *    an `await` has lost the user-gesture that permits it, so browsers block
 *    the popup — silently. From the operator's side the button just did
 *    nothing. Now the blank tab is claimed on the click itself and pointed at
 *    the PDF when it's ready; if even that is blocked, the sheet's link is
 *    rendered in the strip instead of being lost.
 *  - The count follows the server. It used to be seeded into state once, so
 *    after assigning a part the strip still read "Nothing queued" with the
 *    button greyed out — the queue had grown, the screen hadn't.
 */
export function PrintQueueStrip({ initialCount }: PrintQueueStripProps) {
  const { push } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isClearing, startClearing] = useTransition();
  // Server-owned, with a local override that lasts only until the next server
  // render — so a fresh count from a revalidated page always wins.
  const [printedCount, setPrintedCount] = useState<number | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  // Drop the local override the moment the server sends a new count (adjusted
  // during render — the React-recommended shape for resetting state on a prop
  // change).
  const [seenCount, setSeenCount] = useState(initialCount);
  if (seenCount !== initialCount) {
    setSeenCount(initialCount);
    setPrintedCount(null);
  }

  const count = printedCount ?? initialCount;

  function handleClear() {
    startClearing(async () => {
      try {
        const response = await fetch("/api/labels/clear-queue", { method: "POST" });
        const body = (await response.json()) as { cleared?: number; error?: string };
        if (!response.ok) {
          push({ msg: body.error ?? "Could not clear the queue." });
          return;
        }
        setPrintedCount(0);
        push({ msg: `Cleared ${body.cleared ?? 0} label${body.cleared === 1 ? "" : "s"} from the queue` });
        router.refresh();
      } catch {
        push({ msg: "Could not reach the server — check your connection and try again." });
      }
    });
  }

  function handlePrint() {
    // Claimed while the click is still trusted. About:blank first, real URL
    // later. No `noopener` in the feature string — it makes `window.open`
    // return null, and the handle is the entire point of opening early; the
    // back-reference is severed by hand once the URL is set instead.
    const sheetTab = window.open("", "_blank");
    setFallbackUrl(null);

    startTransition(async () => {
      let body: PrintSheetResponse;
      try {
        const response = await fetch("/api/labels/print-sheet", { method: "POST" });
        body = (await response.json()) as PrintSheetResponse;
        if (!response.ok || !body.url) {
          sheetTab?.close();
          push({ msg: body.error ?? "Could not render the print sheet." });
          return;
        }
      } catch {
        sheetTab?.close();
        push({ msg: "Could not reach the server — check your connection and try again." });
        return;
      }

      if (sheetTab) {
        sheetTab.opener = null;
        sheetTab.location.href = body.url;
      } else {
        // Popup blocked. The sheet exists and the labels are marked printed —
        // losing the link here would mean reprinting them by hand.
        setFallbackUrl(body.url);
      }

      const printed = body.count ?? 0;
      const left = body.remaining ?? 0;
      push({
        msg:
          left > 0
            ? `Sheet of ${printed} labels opened — ${left} more still queued`
            : `Sheet of ${printed} label${printed === 1 ? "" : "s"} opened in a new tab`,
      });
      // The queue is NOT emptied by viewing it — see the Clear button.
      router.refresh();
    });
  }

  return (
    <Card padding="md" className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-[15px] text-snow">Print queue</div>
        <div className="mt-0.5 text-caption text-smoke">
          {count === 0 ? "Nothing queued" : `${count} label${count === 1 ? "" : "s"} queued — stays until you clear it`}
        </div>
        {fallbackUrl && (
          <a
            href={fallbackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-caption font-medium text-smark-orange underline"
          >
            Open the sheet (your browser blocked the new tab)
          </a>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={handlePrint} loading={isPending} disabled={count === 0} variant="accent-outline">
          Print sheet
        </Button>
        {/* Emptying the queue is its own act. Opening the sheet used to do it
            silently, so checking what was waiting lost it. */}
        <Button onClick={handleClear} loading={isClearing} disabled={count === 0} variant="ghost">
          Clear queue
        </Button>
      </div>
    </Card>
  );
}
