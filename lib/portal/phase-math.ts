/**
 * lib/portal/phase-math.ts — the portal's phase-timeline math.
 *
 * Re-exports `lib/projects/phase-math.ts` (projects-hub package) rather than
 * duplicating it: FEATURES.md §10's closing line is explicit —
 * "Rendered identically in the hub and the portal" — and that file's own
 * `ProgressOnTrackCard` component says so too ("Same pure math renders
 * identically on the client portal (R2-38, deferred)"). `PortalPhase`
 * (lib/portal/types.ts) is structurally compatible with that module's
 * `PhaseMathRow` (same `row_kind`/`status` enums, sourced from the same
 * `types/db.ts`), so the SAME `computeProgressPct`/`computeOnTrack` run over
 * portal payloads with no adapter needed. Read-only cross-package import,
 * authorized by this package's mission brief ("import projects-hub's pure fn
 * read-only... when it exists").
 *
 * `lastPhaseEndDate` ("estimated delivery" — plan/tab-client-portal.md §2)
 * has no upstream equivalent yet, so it's added here, portal-only.
 */

import { computeOnTrack, computeProgressPct, isTimelineComplete, type PhaseMathRow } from "@/lib/projects/phase-math";
import type { PortalPhase } from "./types";

export { computeOnTrack, computeProgressPct, isTimelineComplete };

const ESTIMATE_ROW_KINDS = new Set<PhaseMathRow["row_kind"]>(["phase", "buffer"]);

/** "Estimated delivery" = the last `phase`/`buffer` row's end date, by sort_order. Null if none carry one. */
export function lastPhaseEndDate(phases: readonly PortalPhase[]): string | null {
  const dated = phases
    .filter((p) => ESTIMATE_ROW_KINDS.has(p.row_kind) && p.end_date)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
  return dated.length ? dated[dated.length - 1]!.end_date : null;
}

export function projectStatusLabel(status: "completed" | "in_progress"): string {
  return status === "completed" ? "Completed" : "In progress";
}
