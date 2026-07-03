/**
 * worker/src/claim.ts — atomic job claim + heartbeat/stale-claim release for
 * `smark_order_jobs` (FEATURES.md §4/§6, SCHEMA.md §4 "claimed atomically via
 * FOR UPDATE SKIP LOCKED").
 *
 * ── The SQL (documented, not migrated by this package) ─────────────────────
 * `worker/**` does not own `supabase/migrations/**` (docs/OWNERSHIP.md —
 * migrations are integrator-only, 0001–0006 frozen). The IDEAL production
 * claim path is a single atomic statement via a SECURITY DEFINER RPC, which
 * this file calls FIRST and falls back from if it doesn't exist yet:
 *
 *   -- Proposed migration 0007_worker_claim_fn.sql (integrator adds):
 *   create or replace function public.smark_claim_next_order_jobs(p_limit int default 1)
 *   returns setof smark_order_jobs
 *   language plpgsql
 *   security definer
 *   set search_path = ''
 *   as $$
 *   begin
 *     return query
 *     update public.smark_order_jobs
 *     set status = 'claimed', claimed_at = now(), attempts = attempts + 1
 *     where id in (
 *       select id from public.smark_order_jobs
 *       where status = 'queued' and plan is not null
 *       order by created_at asc
 *       for update skip locked
 *       limit p_limit
 *     )
 *     returning *;
 *   end;
 *   $$;
 *   revoke all on function public.smark_claim_next_order_jobs(int) from public, anon, authenticated;
 *   grant execute on function public.smark_claim_next_order_jobs(int) to service_role;
 *
 * ── The fallback (works TODAY, no migration needed) ────────────────────────
 * PostgREST (what `@supabase/supabase-js` speaks) can only call functions or
 * do single-table operations — it cannot run a bare `SELECT ... FOR UPDATE
 * SKIP LOCKED` transaction. Until the RPC above exists, this file uses the
 * standard "conditional UPDATE as atomic claim" pattern instead, which is
 * ALSO race-free (not just "usually fine"): each candidate is claimed via
 * `UPDATE ... WHERE id = :id AND status = 'queued'`. Postgres serializes
 * concurrent UPDATEs targeting the same row — only the first to commit sees
 * its own WHERE clause still match; the second's WHERE no longer matches
 * (status already flipped) and it affects zero rows. Two workers can pick
 * the SAME candidate from their SELECT and both attempt the UPDATE, but only
 * one ever succeeds — no double-claim, just an occasional wasted read on
 * contention (acceptable at this queue's scale; the RPC above removes even
 * that once it lands). This is exactly what `tests/claim.test.ts` verifies
 * against local Supabase with two concurrent claimers.
 */

import type { ClaimedJob, PlannedSearch } from "../../types/worker";
import type { OrderJobRow, ServiceRoleClient } from "./db";

const CLAIM_RPC_NAME = "smark_claim_next_order_jobs";

/** A claim older than this with no progress is assumed to be a dead worker's — released back to `queued`. */
export const STALE_CLAIM_TIMEOUT_MS = 5 * 60_000; // 5 minutes

/** A job that has failed this many times is parked as `failed` instead of recycled forever. */
export const MAX_CLAIM_ATTEMPTS = 5;

function isUndefinedFunctionError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42883 = Postgres "undefined_function"; PGRST202 = PostgREST "function not found in schema cache".
  return error.code === "42883" || error.code === "PGRST202";
}

function parsePlan(raw: unknown): PlannedSearch | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return null;
  const candidate = raw as Partial<PlannedSearch>;
  if (typeof candidate.bomLineId !== "string" || !Array.isArray(candidate.distributorOrder)) {
    return null;
  }
  return {
    bomLineId: candidate.bomLineId,
    distributorOrder: candidate.distributorOrder.filter((v): v is string => typeof v === "string"),
    notes: typeof candidate.notes === "string" ? candidate.notes : null,
    ruleHit: candidate.ruleHit ?? null,
  };
}

function toClaimedJob(row: OrderJobRow): ClaimedJob {
  return {
    jobId: row.id,
    runId: row.run_id,
    bomLineId: row.bom_line_id,
    plannedSearch: parsePlan(row.plan),
    attempts: row.attempts,
  };
}

/**
 * Claims up to `limit` queued+planned jobs atomically. Tries the RPC first;
 * falls back to the conditional-update loop when the RPC isn't installed.
 */
export async function claimNextJobs(client: ServiceRoleClient, limit: number): Promise<ClaimedJob[]> {
  const rpcResult = await client.rpc(CLAIM_RPC_NAME, { p_limit: limit });
  if (!rpcResult.error) {
    const rows = (rpcResult.data ?? []) as OrderJobRow[];
    return rows.map(toClaimedJob);
  }
  if (!isUndefinedFunctionError(rpcResult.error)) {
    throw new Error(`worker/claim: RPC ${CLAIM_RPC_NAME} failed: ${rpcResult.error.message}`);
  }

  // ── Fallback path ──
  const candidates = await client
    .from("smark_order_jobs")
    .select("*")
    .eq("status", "queued")
    .not("plan", "is", null)
    .order("created_at", { ascending: true })
    .limit(Math.max(limit * 4, limit + 8)); // over-fetch: some candidates will lose the race

  if (candidates.error) {
    throw new Error(`worker/claim: candidate select failed: ${candidates.error.message}`);
  }

  const claimed: ClaimedJob[] = [];
  for (const row of (candidates.data ?? []) as OrderJobRow[]) {
    if (claimed.length >= limit) break;
    const attempt = await client
      .from("smark_order_jobs")
      .update({ status: "claimed", claimed_at: new Date().toISOString(), attempts: row.attempts + 1 })
      .eq("id", row.id)
      .eq("status", "queued") // the atomicity guard — see file header
      .select();

    if (attempt.error) {
      throw new Error(`worker/claim: conditional update failed for job ${row.id}: ${attempt.error.message}`);
    }
    const won = (attempt.data ?? []) as OrderJobRow[];
    if (won.length === 1 && won[0]) {
      claimed.push(toClaimedJob({ ...won[0], attempts: row.attempts + 1 }));
    }
    // won.length === 0 → another claimer won this row; move on to the next candidate.
  }
  return claimed;
}

/**
 * Crash recovery: any job stuck in `claimed` past `STALE_CLAIM_TIMEOUT_MS` is
 * assumed to belong to a worker that died mid-item — released back to
 * `queued` (under attempts cap) or parked `failed` (over the cap) so it's
 * never silently lost nor retried forever.
 */
export async function releaseStaleClaims(client: ServiceRoleClient): Promise<{ requeued: number; failed: number }> {
  const cutoff = new Date(Date.now() - STALE_CLAIM_TIMEOUT_MS).toISOString();

  const staleQuery = await client
    .from("smark_order_jobs")
    .select("*")
    .eq("status", "claimed")
    .lt("claimed_at", cutoff);

  if (staleQuery.error) {
    throw new Error(`worker/claim: stale-claim scan failed: ${staleQuery.error.message}`);
  }

  let requeued = 0;
  let failed = 0;
  for (const row of (staleQuery.data ?? []) as OrderJobRow[]) {
    const nextStatus = row.attempts >= MAX_CLAIM_ATTEMPTS ? "failed" : "queued";
    const update = await client
      .from("smark_order_jobs")
      .update({
        status: nextStatus,
        claimed_at: nextStatus === "queued" ? null : row.claimed_at,
      })
      .eq("id", row.id)
      .eq("status", "claimed"); // don't clobber a job that finished between the scan and this write

    if (update.error) {
      throw new Error(`worker/claim: stale-claim release failed for job ${row.id}: ${update.error.message}`);
    }
    if (nextStatus === "queued") requeued += 1;
    else failed += 1;
  }
  return { requeued, failed };
}

/** Marks a claimed job terminal (done/failed) after the item-agent finishes it. */
export async function completeJob(
  client: ServiceRoleClient,
  jobId: string,
  status: "done" | "failed",
): Promise<void> {
  const update = await client.from("smark_order_jobs").update({ status }).eq("id", jobId);
  if (update.error) {
    throw new Error(`worker/claim: completeJob(${jobId}, ${status}) failed: ${update.error.message}`);
  }
}

/** Writes this run's per-line planned search onto its job row (planner.ts, after the one Opus call). */
export async function attachPlanToJob(
  client: ServiceRoleClient,
  runId: string,
  bomLineId: string,
  plannedSearch: PlannedSearch,
): Promise<void> {
  const update = await client
    .from("smark_order_jobs")
    .update({ plan: plannedSearch })
    .eq("run_id", runId)
    .eq("bom_line_id", bomLineId);
  if (update.error) {
    throw new Error(`worker/claim: attachPlanToJob failed for ${runId}/${bomLineId}: ${update.error.message}`);
  }
}

/** Skip-decision lines never get an item-agent — mark the job done immediately (planner.ts). */
export async function markJobSkipped(client: ServiceRoleClient, runId: string, bomLineId: string): Promise<void> {
  const update = await client
    .from("smark_order_jobs")
    .update({ status: "done" })
    .eq("run_id", runId)
    .eq("bom_line_id", bomLineId);
  if (update.error) {
    throw new Error(`worker/claim: markJobSkipped failed for ${runId}/${bomLineId}: ${update.error.message}`);
  }
}
