/**
 * lib/runs/lifecycle.ts — small, idempotent BOM-lifecycle side effects that
 * the worker itself never performs (worker/src/runs.ts's own doc: "review →
 * done is an app-side action... never written by the worker"; the worker
 * also never touches `smark_boms` at all — bom-pipeline owns that table).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";

type DB = SupabaseClient<Database>;

/**
 * Flips a BOM `draft → sourced` once its saved run has produced a reviewable
 * result set (FEATURES §5.8 "sourcing status"). Safe to call on every review
 * page load — only writes when the BOM is still `draft`, so it's a no-op on
 * repeat visits. Never regresses `sourced`/`ordered` back to `draft`
 * (statuses only walk forward, A3 invariant).
 */
export async function ensureBomSourced(supabase: DB, bomId: string): Promise<void> {
  await supabase.from(TABLES.boms).update({ sourcing_status: "sourced" }).eq("id", bomId).eq("sourcing_status", "draft");
}

/** Run statuses that mean "the run produced output the user can review". */
export const REVIEWABLE_RUN_STATUSES: ReadonlySet<string> = new Set(["review", "done"]);

/**
 * Whether a BOM's saved run has reviewable output that must always be
 * reachable — true when the run itself is in a reviewable state OR the BOM is
 * already `sourced`. The review page renders for any run status; this only
 * decides whether the "In review →" CTA is surfaced. Gating on this (not on
 * `status === "review"` alone) keeps sourced output visible even after the run
 * drifts off `review` — e.g. a desktop "re-run this item" that never
 * re-completes because there is no worker on the user's PC (Krunal feedback).
 */
export function hasReviewableResults(
  runStatus: string | null | undefined,
  sourcingStatus: string | null | undefined,
): boolean {
  return (runStatus != null && REVIEWABLE_RUN_STATUSES.has(runStatus)) || sourcingStatus === "sourced";
}
