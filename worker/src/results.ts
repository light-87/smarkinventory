/**
 * worker/src/results.ts — IDEMPOTENT writes to `smark_agent_results`.
 *
 * `supabase/migrations/0004_ordering_finance.sql`'s own comment on this
 * table is explicit: "idempotent upserts keyed (run_id, bom_line_id,
 * distributor_id) — app-level, no DB unique constraint (multiple
 * non-selected candidate rows are expected per line)." So a re-claimed job
 * (stale-claim release + re-pickup, or a retried item-agent call) must
 * UPDATE its existing row for that key instead of INSERTing a duplicate —
 * enforced here in application code, one row read-then-write at a time
 * (this table's write volume is small: a handful of distributor candidates
 * per line, not a hot path needing a bulk upsert).
 */

import type { DistributorListingResult } from "../../types/worker";
import type { AgentResultInsert, ServiceRoleClient } from "./db";

/**
 * `smark_agent_results` has no dedicated column for the AI "why" narration
 * (`item-agent.ts` computes it — Sonnet's rationale live, matcher-lite's
 * objective rationale in mock mode — but the schema is frozen for this
 * package; a real column needs an integrator-owned migration, see
 * notes-for-integrator). Interim: stash it under `raw.why` — `raw` is
 * otherwise just the original distributor listing payload (an object for
 * every real client, see distributors/*.ts), and `lib/runs/queries.ts`'s
 * `resultWhy` already checks `raw.why` FIRST before falling back to a
 * synthesized one-liner, specifically to pick this up once it's written.
 */
function withWhy(raw: unknown, why: string): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>), why };
  }
  return { rawValue: raw, why };
}

function toInsertRow(runId: string, result: DistributorListingResult): AgentResultInsert {
  return {
    run_id: runId,
    bom_line_id: result.bomLineId,
    part_id: null, // resolved by the app at cart-add time (part_id may not exist yet for never-catalogued lines)
    distributor_id: result.distributorId,
    price: result.price,
    qty_breaks: result.qtyBreaks.length > 0 ? result.qtyBreaks.map((b) => ({ qty: b.qty, unit_price: b.unitPrice })) : null,
    stock_qty: result.stockQty,
    mpn_match: result.mpnMatch,
    package_match: result.packageMatch,
    part_status: result.partStatus,
    order_link: result.orderLink,
    is_recommended: result.isRecommended,
    raw: withWhy(result.raw, result.why),
    confidence: result.confidence,
  };
}

export async function upsertResult(client: ServiceRoleClient, runId: string, result: DistributorListingResult): Promise<void> {
  const existing = await client
    .from("smark_agent_results")
    .select("id")
    .eq("run_id", runId)
    .eq("bom_line_id", result.bomLineId)
    .eq("distributor_id", result.distributorId)
    .maybeSingle();

  if (existing.error) {
    throw new Error(`worker/results: existence check failed (${runId}/${result.bomLineId}/${result.distributorId}): ${existing.error.message}`);
  }

  const row = toInsertRow(runId, result);
  const existingRow = existing.data as { id: string } | null;

  if (existingRow) {
    const update = await client.from("smark_agent_results").update(row).eq("id", existingRow.id);
    if (update.error) {
      throw new Error(`worker/results: update failed for existing result ${existingRow.id}: ${update.error.message}`);
    }
    return;
  }

  const insert = await client.from("smark_agent_results").insert(row);
  if (insert.error) {
    throw new Error(`worker/results: insert failed (${runId}/${result.bomLineId}/${result.distributorId}): ${insert.error.message}`);
  }
}

export async function upsertResults(client: ServiceRoleClient, runId: string, results: DistributorListingResult[]): Promise<void> {
  for (const result of results) {
    await upsertResult(client, runId, result);
  }
}
