/**
 * lib/desktop/sync.ts — server-side half of the desktop companion app's sync
 * (plan: SmarkStock Desktop, F-013 pivot). The desktop runner executes the
 * browser agent on the user's PC and posts its results here; this module
 * validates them against the SAME `types/worker.ts` contracts the worker
 * uses and lands them in `smark_agent_results` with the worker's own
 * idempotent upsert semantics (keyed run/line/distributor, app-level — see
 * worker/src/results.ts header; the small duplication is deliberate, the
 * app doesn't import worker runtime modules).
 *
 * SERVICE-ROLE writes by design: `smark_agent_results` is service-role-only
 * RLS (migration 0004). Callers (app/api/desktop/**) MUST authorize the
 * bearer user first (owner/employee via smark_role) before invoking these.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";
import type { ClaudeMasterPlan, WorkerRunConfig } from "@/types/worker";
import { ensureBomSourced } from "@/lib/runs/lifecycle";

type DB = SupabaseClient<Database>;

export const DesktopResultSchema = z.object({
  bomLineId: z.uuid(),
  distributorId: z.uuid(),
  distributorName: z.string().min(1),
  price: z.number().nullable(),
  currency: z.string().default("USD"),
  qtyBreaks: z.array(z.object({ qty: z.number().int().min(1), unitPrice: z.number() })).default([]),
  stockQty: z.number().int().nullable(),
  mpnMatch: z.enum(["exact", "approx", "none"]),
  packageMatch: z.boolean(),
  partStatus: z.enum(["active", "nrnd", "eol"]).nullable(),
  orderLink: z.string().nullable(),
  isRecommended: z.boolean(),
  confidence: z.number().min(0).max(100).default(0),
  why: z.string().default(""),
  raw: z.unknown().nullable().default(null),
});
export type DesktopResult = z.infer<typeof DesktopResultSchema>;

export const DesktopResultsPayloadSchema = z.object({
  runId: z.uuid(),
  results: z.array(DesktopResultSchema).max(2000),
  /** The agent's per-line plan/skip narration — stored as the run's masterPlan so /ai_orc + review narration work. */
  masterPlan: z
    .object({
      narration: z.string().default(""),
      searches: z.array(z.object({ bomLineId: z.uuid(), distributorOrder: z.array(z.string()), searchTerm: z.string().nullable().default(null), notes: z.string().nullable().default(null), ruleHit: z.null().default(null) })).default([]),
      skip: z.array(z.object({ bomLineId: z.uuid(), reason: z.string(), ruleHit: z.null().default(null) })).default([]),
    })
    .nullable()
    .default(null),
});
export type DesktopResultsPayload = z.infer<typeof DesktopResultsPayloadSchema>;

function withWhy(raw: unknown, why: string): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return { ...(raw as Record<string, unknown>), why };
  return { rawValue: raw, why };
}

/** Idempotent upsert keyed (run, line, distributor) — mirrors worker/src/results.ts. */
async function upsertOne(service: DB, runId: string, r: DesktopResult): Promise<void> {
  const row = {
    run_id: runId,
    bom_line_id: r.bomLineId,
    part_id: null,
    distributor_id: r.distributorId,
    price: r.price,
    qty_breaks: r.qtyBreaks.length > 0 ? r.qtyBreaks.map((b) => ({ qty: b.qty, unit_price: b.unitPrice })) : null,
    stock_qty: r.stockQty,
    mpn_match: r.mpnMatch,
    package_match: r.packageMatch,
    part_status: r.partStatus,
    order_link: r.orderLink,
    is_recommended: r.isRecommended,
    raw: withWhy(r.raw, r.why) as never,
    confidence: r.confidence,
  };
  const existing = await service
    .from(TABLES.agent_results)
    .select("id")
    .eq("run_id", runId)
    .eq("bom_line_id", r.bomLineId)
    .eq("distributor_id", r.distributorId)
    .maybeSingle();
  if (existing.error) throw new Error(`desktop/sync: existence check failed: ${existing.error.message}`);
  if (existing.data) {
    const update = await service.from(TABLES.agent_results).update(row).eq("id", (existing.data as { id: string }).id);
    if (update.error) throw new Error(`desktop/sync: update failed: ${update.error.message}`);
    return;
  }
  const insert = await service.from(TABLES.agent_results).insert(row);
  if (insert.error) throw new Error(`desktop/sync: insert failed: ${insert.error.message}`);
}

export type IngestOutcome = { ok: true; written: number } | { ok: false; error: string };

/**
 * Validates the run is a DESKTOP run (executor stamp) and still open, writes
 * all results idempotently, stores the masterPlan into the plan envelope
 * (preserving config + appMeta), and flips the run to "review".
 */
export async function ingestDesktopResults(service: DB, payload: DesktopResultsPayload): Promise<IngestOutcome> {
  const { data: run, error: runError } = await service
    .from(TABLES.agent_runs)
    .select("id, status, plan")
    .eq("id", payload.runId)
    .maybeSingle();
  if (runError) return { ok: false, error: runError.message };
  if (!run) return { ok: false, error: "That run does not exist." };

  const envelope = (run.plan ?? {}) as { config?: WorkerRunConfig; masterPlan?: ClaudeMasterPlan | null; appMeta?: Record<string, unknown> | null };
  if (envelope.appMeta?.["executor"] !== "desktop") {
    return { ok: false, error: "That run is not a desktop-executed run." };
  }
  if (run.status === "done") return { ok: false, error: "That run is already finalized." };

  const config = envelope.config;
  const validLineIds = new Set((config?.lines ?? []).map((l) => l.bomLineId));
  const validDistributorIds = new Set((config?.distributorSequence ?? []).map((d) => d.id));
  for (const r of payload.results) {
    if (!validLineIds.has(r.bomLineId)) return { ok: false, error: `Result references a line not in this run: ${r.bomLineId}` };
    if (!validDistributorIds.has(r.distributorId)) return { ok: false, error: `Result references a distributor not in this run: ${r.distributorId}` };
  }

  for (const r of payload.results) await upsertOne(service, payload.runId, r);

  const newEnvelope = {
    config: envelope.config,
    masterPlan: payload.masterPlan ?? envelope.masterPlan ?? null,
    appMeta: envelope.appMeta ?? null,
  };
  const { error: updateError } = await service
    .from(TABLES.agent_runs)
    .update({ plan: newEnvelope as never, status: "review", actual_cost: null })
    .eq("id", payload.runId);
  if (updateError) return { ok: false, error: `Results written but the run couldn't be finalized: ${updateError.message}` };

  // Mark the BOM "sourced" now that results exist, so the review CTAs surface
  // immediately — the review page's ensureBomSourced only runs on first open,
  // which the owner may never reach if the run later drifts off "review".
  // Best-effort: results are already written, so a failure here is not fatal.
  if (config?.bomId) await ensureBomSourced(service, config.bomId);

  return { ok: true, written: payload.results.length };
}
