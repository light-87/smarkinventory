"use client";

/**
 * components/review/order-remark-card.tsx — whole-order remark
 * (plan/tab-order-review.md §2/§3): textarea → "Save remark to AI Memory"
 * (suggested rule, scope Project — see lib/runs/feedback.ts's module doc for
 * why "scope Order" maps onto the run's own project) · "↺ Re-run whole
 * order" (a fresh run for the same BOM — types/worker.ts's Opus-plans-once
 * model means this pays for a new planning call, unlike a per-item re-run).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { reRunWholeOrderAction, submitOrderRemarkAction } from "@/app/(app)/projects/[projectId]/runs/[runId]/actions";
import type { ReviewFeedbackEntry } from "@/lib/runs/types";
import type { ConcurrencyPreset } from "@/types/worker";

export interface OrderRemarkCardProps {
  projectId: string;
  bomId: string;
  runId: string;
  writable: boolean;
  currentTier: ConcurrencyPreset;
  remarks: ReviewFeedbackEntry[];
}

export function OrderRemarkCard({ projectId, bomId, runId, writable, currentTier, remarks }: OrderRemarkCardProps) {
  const router = useRouter();
  const [remark, setRemark] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();
  const [isReRunning, startReRun] = useTransition();

  function saveRemark() {
    if (!remark.trim()) return;
    setError(null);
    startSave(async () => {
      const result = await submitOrderRemarkAction({ runId, comment: remark.trim() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setRemark("");
      router.refresh();
    });
  }

  function reRunWholeOrder() {
    setError(null);
    startReRun(async () => {
      const result = await reRunWholeOrderAction({ bomId, tier: currentTier });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/projects/${projectId}/runs/${result.runId}`);
    });
  }

  return (
    <Card padding="lg">
      <div className="mb-1 text-[16px] font-medium text-snow">Remark on the whole order</div>
      <div className="mb-3.5 text-caption text-smoke">Saved as a suggested rule, scope: this project</div>
      <textarea
        value={remark}
        onChange={(e) => {
          setRemark(e.target.value);
          setSaved(false);
        }}
        disabled={!writable}
        placeholder="e.g. always prefer LCSC for this client's connectors"
        className="min-h-[64px] w-full resize-y rounded-lg border border-charcoal bg-surface-well px-3.5 py-3 text-sm leading-normal text-snow outline-none placeholder:text-smoke focus:border-smark-orange disabled:opacity-50"
      />
      {writable && (
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <Button size="sm" variant="outline" onClick={saveRemark} loading={isSaving}>
            Save remark to AI Memory
          </Button>
          <Button size="sm" variant="ghost" onClick={reRunWholeOrder} loading={isReRunning}>
            ↺ Re-run whole order
          </Button>
          {saved && <span className="text-caption text-phosphor-green">Saved ✓</span>}
        </div>
      )}
      {remarks.length > 0 && (
        <div className="mt-3.5 flex flex-col gap-1.5 border-t border-border-hairline pt-3.5">
          {remarks.map((r) => (
            <div key={r.id} className="text-caption text-smoke">
              &ldquo;{r.comment}&rdquo;
            </div>
          ))}
        </div>
      )}
      {error && <div className="mt-3 text-caption text-smark-orange-soft">{error}</div>}
    </Card>
  );
}
