"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { finishTakeoutAction, loadProjectBomAction, undoBulkTakeoutAction } from "@/lib/takeout/actions";
import type { PickableProject } from "@/lib/takeout/queries";
import { computePickQty } from "@/lib/takeout/resolve";
import type { LoadedTakeoutSession } from "@/lib/takeout/types";
import { MultiplierBanner } from "./multiplier-banner";
import { ProjectBomCard } from "./project-bom-card";
import { TakeoutTable } from "./takeout-table";
import { UploadPasteCard } from "./upload-paste-card";

export interface BulkTakeoutScreenProps {
  pickableProjects: readonly PickableProject[];
  canWrite: boolean;
}

/** Bulk takeout (plan/tab-bulk-pick.md · FEATURES.md §5.6) — the whole client-side state machine. */
export function BulkTakeoutScreen({ pickableProjects, canWrite }: BulkTakeoutScreenProps) {
  const { push } = useToast();
  const [session, setSession] = useState<LoadedTakeoutSession | null>(null);
  const [multiplier, setMultiplier] = useState(1);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, startLoadingTransition] = useTransition();
  const [manualLoading, setManualLoading] = useState(false);
  const [isFinishing, startFinishing] = useTransition();

  const loading = isLoading || manualLoading;

  // pickQty is recomputed live from each line's stored rawQty whenever the
  // ×N banner changes — no server round trip for that (lib/takeout/resolve's
  // computePickQty is the SAME math the server used for the initial load).
  const lines = useMemo(() => {
    if (!session) return [];
    return session.lines.map((line) => ({ ...line, pickQty: computePickQty(line.rawQty, multiplier) }));
  }, [session, multiplier]);

  const anyChecked = useMemo(
    () => lines.some((line) => line.matchState === "in_stock" && checked[line.key]),
    [lines, checked],
  );

  function handleLoaded(next: LoadedTakeoutSession) {
    setSession(next);
    setMultiplier(next.defaultMultiplier);
    setChecked({});
    setLoadError(null);
  }

  function handleLoadProjectBom(bomId: string) {
    startLoadingTransition(async () => {
      try {
        handleLoaded(await loadProjectBomAction(bomId));
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Could not load that BOM.");
      }
    });
  }

  function handleReset() {
    setSession(null);
    setChecked({});
    setMultiplier(1);
    setLoadError(null);
  }

  function toggleLine(key: string) {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleFinish() {
    if (!session) return;
    const toFinish = lines.filter((line) => line.matchState === "in_stock" && checked[line.key] && line.location);
    if (toFinish.length === 0) return;

    startFinishing(async () => {
      const result = await finishTakeoutAction({
        bomId: session.bomId,
        lines: toFinish.map((line) => ({
          partId: line.matchedPartId!,
          locationId: line.location!.locationId,
          bigBoxId: line.location!.bigBoxId,
          pickQty: line.pickQty,
          reference: line.references,
        })),
      });

      if (result.succeeded.length > 0) {
        setChecked((prev) => {
          const next = { ...prev };
          for (const line of toFinish) delete next[line.key];
          return next;
        });
        const movementIds = result.succeeded.map((s) => s.movementId);
        push({
          msg: `${result.succeeded.length} movement${result.succeeded.length === 1 ? "" : "s"} logged — takeout complete`,
          undo: true,
          onUndo: () => {
            void undoBulkTakeoutAction(movementIds).then((undoResult) => {
              if (undoResult.failed.length > 0) {
                push({
                  msg:
                    undoResult.failed.length === movementIds.length
                      ? "Couldn't undo — nothing was reversed."
                      : `Undid ${undoResult.succeeded} of ${movementIds.length} — ${undoResult.failed.length} couldn't be reversed.`,
                  dismissable: true,
                  timeout: 0,
                });
              }
            });
          },
        });
      }
      if (result.failed.length > 0) {
        push({
          msg:
            result.failed.length === 1
              ? `Couldn't log 1 line: ${result.failed[0]!.error}`
              : `Couldn't log ${result.failed.length} lines — ${result.failed[0]!.error}`,
          dismissable: true,
          timeout: 0,
        });
      }
    });
  }

  if (!canWrite) {
    return (
      <EmptyState
        tone="subtle"
        title="Read-only"
        description="Your role can view Bulk takeout but can't take out stock here."
      />
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          <UploadPasteCard onResolved={handleLoaded} onError={setLoadError} loading={loading} onLoadingChange={setManualLoading} />
          <ProjectBomCard projects={pickableProjects} onPick={handleLoadProjectBom} loading={loading} />
        </div>
        {loadError && <div className="text-[15px] text-smark-orange-soft">{loadError}</div>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[17px] text-snow">{session.sourceLabel}</div>
          <div className="mt-0.5 text-caption text-smoke">{lines.length} pickable line{lines.length === 1 ? "" : "s"}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={handleReset}>
          Start over
        </Button>
      </div>

      <MultiplierBanner value={multiplier} onChange={setMultiplier} locked={anyChecked} sourceKind={session.sourceKind} />

      <TakeoutTable lines={lines} checked={checked} onToggle={toggleLine} onFinish={handleFinish} finishing={isFinishing} />
    </div>
  );
}
