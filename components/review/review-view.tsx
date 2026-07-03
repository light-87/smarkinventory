/**
 * components/review/review-view.tsx — Order Review (plan/tab-order-review.md,
 * prototype `isOrderReview`), persisted per run (R2-08). Rendered by
 * app/(app)/projects/[projectId]/runs/[runId]/review/page.tsx.
 *
 * Every option selection / feedback / cart-add already lives in the DB
 * (`smark_agent_results.selected`, `smark_agent_feedback`, `smark_cart_items`)
 * — this view is a plain server-data render, no client-side "unsaved draft"
 * state beyond each line card's own in-flight qty/radio interaction. Reopening
 * a sourced BOM later lands on exactly this same stored state.
 */

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { formatNumber } from "@/lib/format";
import type { ReviewData } from "@/lib/runs/types";
import { ReviewLineCard } from "./review-line-card";
import { OrderRemarkCard } from "./order-remark-card";

export interface ReviewViewProps {
  projectId: string;
  data: ReviewData;
  writable: boolean;
}

export function ReviewView({ projectId, data, writable }: ReviewViewProps) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-5 pb-28 sm:px-6">
      <div>
        <div className="text-caption text-smoke">
          <Link href={`/projects/${projectId}/runs/${data.run.id}`} className="text-smoke hover:text-snow">
            ← {data.project.name}
            {data.project.client ? ` · ${data.project.client}` : ""}
          </Link>
        </div>
        <h1 className="mt-1 text-xl font-semibold text-snow">{data.bom.name} — Review</h1>
        <div className="mt-1 flex items-center gap-2 text-caption text-smoke">
          <span>
            Run <span className="font-mono text-silver-mist">{data.run.id.slice(0, 8)}</span>
          </span>
          <span aria-hidden>·</span>
          <span className="font-mono text-silver-mist">{data.run.status}</span>
        </div>
      </div>

      {data.run.isStale && (
        <Card padding="lg" className="border-smark-orange/50">
          <div className="flex items-center gap-2.5">
            <Chip tone="accent">stale</Chip>
            <span className="text-[13px] text-snow">Build quantity changed since this run — consider re-running the whole order.</span>
          </div>
        </Card>
      )}

      {data.inStockLanes.length > 0 && (
        <Card padding="lg">
          <div className="mb-3 text-[15px] font-medium text-snow">Already in stock — skipped</div>
          <div className="flex flex-col gap-2">
            {data.inStockLanes.map((lane) => (
              <div key={lane.bomLineId} className="flex items-center gap-3 rounded-full border border-charcoal bg-surface px-3.5 py-2">
                <span className="w-20 flex-none font-mono text-[13px] text-snow">{lane.ref}</span>
                <span className="flex-1 truncate text-[13px] text-smoke">{lane.value}</span>
                <span className="flex-none text-caption text-phosphor-green">✓ {lane.flag}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.lines.length === 0 ? (
        <EmptyState title="Nothing to review" description="Every line on this BOM was already in stock." />
      ) : (
        <div className="flex flex-col gap-3.5">
          {data.lines.map((line) => (
            <ReviewLineCard key={line.bomLineId} projectId={projectId} runId={data.run.id} writable={writable} line={line} />
          ))}
        </div>
      )}

      <OrderRemarkCard
        projectId={projectId}
        bomId={data.bom.id}
        runId={data.run.id}
        writable={writable}
        currentTier={data.run.concurrencyPreset}
        remarks={data.orderRemarks}
      />

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-charcoal bg-surface/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="text-[13px] text-snow">
            Added to cart: <span className="font-mono">{formatNumber(data.cartAddedCount)}</span> item{data.cartAddedCount === 1 ? "" : "s"} ·{" "}
            <Link href="/cart" className="text-smark-orange hover:underline">
              Go to cart →
            </Link>
          </div>
          <a
            href={`/api/runs/${data.run.id}/review-pdf`}
            className="inline-flex h-9 items-center justify-center rounded-full border border-charcoal px-3.5 text-xs text-snow transition-colors hover:bg-ash"
          >
            Save as PDF cart
          </a>
        </div>
      </div>
    </div>
  );
}
