/**
 * lib/projects/status.ts — derived project card status (FEATURES.md §5.8,
 * plan/tab-orders-projects.md R2-03): "draft (no BOM sourced) / sourcing (any
 * run active) / sourced (≥1 BOM sourced)". No stored column — `smark_projects`
 * carries no status field (types/db.ts `ProjectStatusSchema` note); this is
 * computed app-side from the project's BOMs + their latest runs.
 *
 * Pure — the actual Supabase reads live in `lib/projects/queries.ts`.
 */

import type { AgentRunStatus, BomSourcingStatus, ProjectStatus } from "@/types/db";

export interface BomStatusInput {
  sourcing_status: BomSourcingStatus;
}

export interface RunStatusInput {
  status: AgentRunStatus;
}

/** Run states that count as "still sourcing" — not yet settled either way. */
const ACTIVE_RUN_STATUSES: readonly AgentRunStatus[] = ["planning", "running", "review"];

/** `sourcing_status` values that count the project as having a sourced BOM ("ordered" implies it was sourced first). */
const SOURCED_BOM_STATUSES: readonly BomSourcingStatus[] = ["sourced", "ordered"];

export function deriveProjectStatus(
  boms: readonly BomStatusInput[],
  runs: readonly RunStatusInput[],
): ProjectStatus {
  const anyActiveRun = runs.some((run) => (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status));
  if (anyActiveRun) return "sourcing";

  const anySourced = boms.some((bom) => (SOURCED_BOM_STATUSES as readonly string[]).includes(bom.sourcing_status));
  if (anySourced) return "sourced";

  return "draft";
}
