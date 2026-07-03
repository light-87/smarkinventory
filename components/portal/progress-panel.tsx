import { Chip, type ChipTone } from "@/components/ui/chip";
import { computeOnTrack, computeProgressPct } from "@/lib/portal/phase-math";
import type { PortalPhase } from "@/lib/portal/types";

/**
 * Same label/tone scheme as `components/projects/progress-on-track-card.tsx`
 * (the internal hub) — duplicated at this presentational layer exactly the
 * way that component duplicates it too, so the two surfaces read identically
 * (FEATURES §10) while each stays a plain, dependency-free component.
 */
const ON_TRACK_LABEL: Record<ReturnType<typeof computeOnTrack>["status"], string> = {
  on_track: "On track",
  late: "Running late",
  done: "Complete",
  not_started: "Not started",
};

const ON_TRACK_TONE: Record<ReturnType<typeof computeOnTrack>["status"], ChipTone> = {
  on_track: "success",
  late: "accent",
  done: "success",
  not_started: "default",
};

/** Completion % (duration-weighted done phases, Q-07) + on-track chip. */
export function ProgressPanel({ phases }: { phases: PortalPhase[] }) {
  const progress = computeProgressPct(phases);
  const onTrack = computeOnTrack(phases);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-body-sm text-silver-mist">Progress</span>
        <span className="font-mono text-[15px] text-snow">{progress.pct}%</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface-well"
        role="progressbar"
        aria-valuenow={progress.pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-smark-orange transition-[width]" style={{ width: `${progress.pct}%` }} />
      </div>
      <div>
        <Chip tone={ON_TRACK_TONE[onTrack.status]} size="md">
          {onTrack.status === "late" ? `${ON_TRACK_LABEL.late} · ${onTrack.lateDays}d` : ON_TRACK_LABEL[onTrack.status]}
        </Chip>
      </div>
    </div>
  );
}
