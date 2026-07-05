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
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { DistributorSequenceCard } from "./distributor-sequence-card";
import { PrioritiesCard } from "./priorities-card";
import { MemoryContextCardView, StandardRulesCard } from "./memory-rules-cards";
import { computeDryRunEstimate } from "@/lib/runs/dry-run";
import { formatINR, formatNumber } from "@/lib/format";
import type { WorkspaceData } from "@/lib/runs/types";
import type { ConcurrencyPreset } from "@/types/worker";
import { useState } from "react";

const TIER_OPTIONS: readonly SegmentedOption<ConcurrencyPreset>[] = [
  { value: "economy", label: "Economy" },
  { value: "balanced", label: "Balanced" },
  { value: "thorough", label: "Thorough" },
];

export interface WorkspaceViewProps {
  projectId: string;
  data: WorkspaceData;
  writable: boolean;
}

export function WorkspaceView({ projectId, data, writable }: WorkspaceViewProps) {
  const [tier, setTier] = useState<ConcurrencyPreset>("balanced");

  const estimate = computeDryRunEstimate({ toOrderLineCount: data.toOrderLineCount, tier });
  const nothingToOrder = data.toOrderLineCount === 0;

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
              <div className="text-[15px] font-medium text-snow">Saved run</div>
              <div className="text-caption text-smoke">
                Status <span className="font-mono text-silver-mist">{data.savedRun.status}</span>
                {data.savedRun.isStale && " · build quantity changed since this run"}
              </div>
            </div>
            {data.savedRun.isStale && <Chip tone="accent">stale</Chip>}
          </div>
        </Card>
      )}

      {/* Builds required — read-only here (build_qty is edited on the BOM page, where it re-splits reconcile). */}
      <Card padding="lg">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[15px] font-medium text-snow">Builds required</div>
            <div className="text-caption text-smoke">Line quantities are multiplied by this — change it on the BOM page</div>
          </div>
          <Chip mono>×{formatNumber(data.bom.buildQty)}</Chip>
        </div>
      </Card>

      <DistributorSequenceCard bomId={data.bom.id} initialSequence={data.distributorSequence} writable={writable} />
      <PrioritiesCard bomId={data.bom.id} initialPriorities={data.bom.priorityNotes} perLineNotes={data.perLineNotes} writable={writable} />
      <MemoryContextCardView memory={data.memory} />
      <StandardRulesCard rules={data.standardRules} />

      {/* Search depth + dry-run ₹ estimate */}
      <Card padding="lg">
        <div className="mb-1 text-[15px] font-medium text-snow">Search depth</div>
        <div className="mb-3.5 text-caption text-smoke">More depth is more thorough and costs more — per-site caps always apply.</div>
        <SegmentedControl
          variant="accent"
          options={TIER_OPTIONS}
          value={tier}
          onChange={setTier}
          aria-label="Concurrency tier"
        />

        <div className="mt-4 flex items-end justify-between gap-3 border-t border-border-hairline pt-4">
          <div>
            <div className="text-caption text-smoke">Dry-run estimate</div>
            {nothingToOrder ? (
              <div className="text-[13px] text-smoke">Every line is already in stock — nothing to order.</div>
            ) : (
              <div className="font-mono text-lg text-snow">{formatINR(estimate.estimatedRupees)}</div>
            )}
          </div>
          {!nothingToOrder && (
            <div className="text-right font-mono text-caption text-graphite">
              ~{formatNumber(estimate.estimatedCalls)} AI calls
            </div>
          )}
        </div>

        {!nothingToOrder && (
          <div className="mt-4 rounded-lg border border-charcoal bg-surface-well px-3.5 py-3 text-[13px] text-silver-mist">
            Source this BOM from the SmarkStock Desktop app on your computer.
          </div>
        )}
      </Card>
    </div>
  );
}
