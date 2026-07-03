"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AuditFlow } from "./AuditFlow";
import { auditCompletionCount, loadAuditProgress, type AuditContentItem } from "@/lib/audit";

export interface AuditLauncherProps {
  boxId: string;
  boxCode: string;
  items: readonly AuditContentItem[];
}

/**
 * "Count / audit" entry point on box detail (+ the same contract from Scan's
 * box card, plan/tab-shelves.md §4). Shows "Resume audit (N/M)" instead when
 * a paused session is found for this box (see `lib/audit/progress.ts`).
 */
export function AuditLauncher({ boxId, boxCode, items }: AuditLauncherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [resumable, setResumable] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    // Deliberately NOT derived during render: `loadAuditProgress` reads
    // `window.localStorage`, which doesn't exist during SSR — computing this
    // inline would make the server-rendered "Count / audit" label mismatch
    // the client's real "Resume audit (N/M)" on hydration. Effect-after-mount
    // is the standard fix for browser-only state; the cascading-render lint
    // this trips is a false positive for that specific, common case.
    const saved = loadAuditProgress(boxId);
    const completion =
      saved && saved.doneLocationIds.length > 0
        ? auditCompletionCount(items, new Set(saved.doneLocationIds))
        : null;
    const next = completion && completion.done < completion.total ? completion : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResumable(next);
  }, [boxId, items]);

  if (items.length === 0) return null;

  return (
    <>
      <Button variant="outline" fullWidth onClick={() => setOpen(true)}>
        {resumable ? `Resume audit (${resumable.done}/${resumable.total})` : "Count / audit"}
      </Button>

      {open && (
        <AuditFlow
          boxId={boxId}
          boxCode={boxCode}
          items={items}
          onClose={() => {
            setOpen(false);
            router.refresh();
          }}
          onFinished={() => {
            setOpen(false);
            setResumable(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
