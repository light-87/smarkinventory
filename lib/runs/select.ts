/**
 * lib/runs/select.ts — Order Review's radio-select ("confirm/override the
 * recommended option") writes onto `smark_agent_results.selected` (R2-08).
 * Service-role client required — see the "SERVICE ROLE ONLY" comment on
 * `smark_agent_results` in supabase/migrations/0004_ordering_finance.sql.
 *
 * Two-step unset-then-set (never a single UPDATE) because
 * `idx_smark_agent_results_one_selected_per_line` is a partial UNIQUE index
 * on `(run_id, bom_line_id) WHERE selected` — at most one selected row per
 * line at any instant. Unsetting first always leaves a valid (zero-selected)
 * intermediate state, so the two statements can never conflict with it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";

type DB = SupabaseClient<Database>;

export interface SelectReviewOptionParams {
  runId: string;
  bomLineId: string;
  resultId: string;
  actorId: string;
}

export async function selectReviewOption(service: DB, params: SelectReviewOptionParams): Promise<{ ok: true } | { ok: false; error: string }> {
  const unset = await service
    .from(TABLES.agent_results)
    .update({ selected: false, selected_by: null, selected_at: null })
    .eq("run_id", params.runId)
    .eq("bom_line_id", params.bomLineId)
    .eq("selected", true);
  if (unset.error) return { ok: false, error: unset.error.message };

  const set = await service
    .from(TABLES.agent_results)
    .update({ selected: true, selected_by: params.actorId, selected_at: new Date().toISOString() })
    .eq("id", params.resultId)
    .eq("run_id", params.runId)
    .eq("bom_line_id", params.bomLineId);
  if (set.error) return { ok: false, error: set.error.message };

  return { ok: true };
}
