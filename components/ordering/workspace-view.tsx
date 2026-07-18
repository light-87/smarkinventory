"use client";

/**
 * components/ordering/workspace-view.tsx — the Ordering Workspace shell that
 * app/(app)/projects/[projectId]/ordering/[bomId]/page.tsx renders
 * (plan/tab-ordering-workspace.md).
 *
 * Browser-agent sourcing itself now runs exclusively through the SmarkStock
 * Desktop app (`createDesktopRun`, `lib/runs/enqueue.ts`) — this workspace no
 * longer starts a run; it's setup only (distributor sequence, priorities,
 * dry-run estimate). See docs/desktop-web-handoff-prompt.md.
 */

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { DistributorSequenceCard } from "./distributor-sequence-card";
import { PrioritiesCard } from "./priorities-card";
import { MemoryContextCardView, StandardRulesCard } from "./memory-rules-cards";
import { formatNumber } from "@/lib/format";
import type { WorkspaceData } from "@/lib/runs/types";

export interface WorkspaceViewProps {
  projectId: string;
  data: WorkspaceData;
  writable: boolean;
}

export function WorkspaceView({ projectId, data, writable }: WorkspaceViewProps) {
  const nothingToOrder = data.toOrderLineCount === 0;
  const reviewRunId = data.savedRun?.status === "review" ? data.savedRun.id : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6">
      {/* Header */}
      <div>
        <div className="text-caption text-smoke">
          <Link href={`/projects/${projectId}/boms/${data.bom.id}`} className="text-smoke hover:text-snow">
            ← {data.project.name}
            {data.project.client ? ` · ${data.project.client}` : ""}
          </Link>
        </div>
        <h1 className="mt-1 text-xl font-semibold text-snow">{data.bom.name}</h1>
        <div className="mt-1 flex items-center gap-2 text-caption text-smoke">
          <span>Set up ordering</span>
          <span aria-hidden>·</span>
          <span className="font-mono text-silver-mist">{formatNumber(data.toOrderLineCount)} to order</span>
        </div>
      </div>

      {/* Saved run summary (if a run was already started for this BOM) */}
      {data.savedRun && (
        <Card padding="lg" tone="panel">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[17px] font-medium text-snow">Saved run</div>
              <div className="text-caption text-smoke">
                Status <span className="font-mono text-silver-mist">{data.savedRun.status}</span>
                {data.savedRun.isStale && " · build quantity changed since this run"}
              </div>
            </div>
            <div className="flex flex-none items-center gap-2">
              {data.savedRun.isStale && <Chip tone="warn">stale</Chip>}
              {reviewRunId && (
                <Link
                  href={`/projects/${projectId}/runs/${reviewRunId}/review`}
                  className="inline-flex h-8 items-center rounded-full bg-smark-orange/15 px-3 text-[15px] font-medium text-smark-orange transition-colors hover:bg-smark-orange/25"
                >
                  Review results →
                </Link>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Builds required — read-only here (build_qty is edited on the BOM page, where it re-splits reconcile). */}
      <Card padding="lg">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[17px] font-medium text-snow">Builds required</div>
            <div className="text-caption text-smoke">Line quantities are multiplied by this — change it on the BOM page</div>
          </div>
          <Chip mono>×{formatNumber(data.bom.buildQty)}</Chip>
        </div>
      </Card>

      <DistributorSequenceCard bomId={data.bom.id} initialSequence={data.distributorSequence} writable={writable} />
      <PrioritiesCard bomId={data.bom.id} initialPriorities={data.bom.priorityNotes} perLineNotes={data.perLineNotes} writable={writable} />
      <MemoryContextCardView memory={data.memory} />
      <StandardRulesCard rules={data.standardRules} />

      {/* How sourcing runs (desktop app) */}
      <Card padding="lg" tone="panel">
        <div className="mb-1 text-[17px] font-medium text-snow">How sourcing runs</div>
        {nothingToOrder ? (
          <div className="text-[15px] text-smoke">Every line is already in stock — nothing to order.</div>
        ) : (
          <div className="text-[15px] text-silver-mist">
            Source this BOM from the SmarkStock Desktop app on your computer. When the agent finishes, the results come back
            here for review.
          </div>
        )}
      </Card>
    </div>
  );
}
