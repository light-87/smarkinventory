"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { computeOnTrack, computeProgressPct, isTimelineComplete } from "@/lib/projects/phase-math";
import { confirmProjectCompleteAction } from "@/lib/projects/actions";
import type { ProjectPhaseRow } from "@/types/db";

const ON_TRACK_LABEL: Record<ReturnType<typeof computeOnTrack>["status"], string> = {
  on_track: "On track",
  late: "Late",
  done: "Complete",
  not_started: "Not started",
};

const ON_TRACK_TONE: Record<ReturnType<typeof computeOnTrack>["status"], ChipTone> = {
  on_track: "success",
  late: "accent",
  done: "success",
  not_started: "default",
};

export interface ProgressOnTrackCardProps {
  projectId: string;
  phases: readonly ProjectPhaseRow[];
  completedAt: string | null;
  /** Only the owner can confirm project completion (Q-07 final). */
  canConfirm: boolean;
}

/**
 * Progress % (duration-weighted done phases) + on-track chip (today vs the
 * active phase's end date, buffer rows absorb delay) — FEATURES.md §10. Same
 * pure math renders identically on the client portal (R2-38, deferred).
 */
export function ProgressOnTrackCard({ projectId, phases, completedAt, canConfirm }: ProgressOnTrackCardProps) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();

  const progress = computeProgressPct(phases);
  const onTrack = computeOnTrack(phases);
  const complete = isTimelineComplete(phases);

  function confirmComplete() {
    startTransition(async () => {
      try {
        await confirmProjectCompleteAction(projectId);
        router.refresh();
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't confirm completion." });
      }
    });
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <SectionLabel>Progress</SectionLabel>
        <Chip tone={ON_TRACK_TONE[onTrack.status]}>
          {onTrack.status === "late" ? `${ON_TRACK_LABEL.late} · ${onTrack.lateDays}d` : ON_TRACK_LABEL[onTrack.status]}
        </Chip>
      </div>

      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-ash">
          <div
            className="h-full rounded-full bg-smark-orange transition-[width]"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
        <span className="w-11 flex-none text-right font-mono text-[13px] text-snow tabular-nums">
          {progress.pct}%
        </span>
      </div>

      {onTrack.activePhase && (
        <div className="text-caption text-smoke">
          Active: <span className="text-silver-mist">{onTrack.activePhase.name}</span>
        </div>
      )}

      {completedAt ? (
        <div className="text-caption text-phosphor-green">Project confirmed complete {formatDate(completedAt)}.</div>
      ) : (
        canConfirm &&
        complete && (
          <Button size="sm" variant="outline" onClick={confirmComplete} loading={isPending} className="self-start">
            Confirm project complete
          </Button>
        )
      )}
    </Card>
  );
}
