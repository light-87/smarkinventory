/**
 * lib/orders/demand.ts — Q-05 auto-shortfall cart line lifecycle (SCHEMA.md
 * §4/§8 `smark_cart_items` / `v_part_demand`, FEATURES.md §5.12/§16 client's
 * permanent example: 500 avail / 400+200 demanded → auto line of exactly 100).
 *
 * `v_part_demand` is a live view — it always reflects the truth instantly.
 * What can go stale is the SUGGESTION row in `smark_cart_items` (source
 * `auto_shortfall`) that the Cart UI shows/edits. This module reconciles
 * that suggestion against the view.
 *
 * Trigger choice (mission brief: "server action recompute + on-load refresh
 * is acceptable v1 — note your trigger choice"): **on-load only**. The
 * packages that change demand (bom-pipeline reconcile, takeout bulk-pick,
 * projects-hub archive, build_qty edits) are NOT in this package's allowed
 * cross-import list (docs/OWNERSHIP.md), so there is no seam to call this
 * from their mutations even if we wanted to. `app/(app)/cart/page.tsx` calls
 * `recomputeShortfallCartItems` on every render before reading cart lines,
 * and a manual "Refresh demand" action does the same on demand. Noted as a
 * decision in this package's report — a cross-package "recompute now" hook
 * is a reasonable v2 ask for the integrator.
 *
 * Lifecycle (Q-05 FINAL, SCHEMA.md `v_part_demand` comment):
 *  - shortfall > 0, no active (open/dismissed) auto line for the part → INSERT one, `open`.
 *  - shortfall > 0, an `open` auto line exists → refresh its qty_to_order + demand breakdown.
 *  - shortfall > 0, a `dismissed` auto line exists → resurrect to `open` ONLY if
 *    shortfall now EXCEEDS the qty it was dismissed at; otherwise leave it
 *    dismissed (refresh its demand breakdown only, not the qty — that qty
 *    IS the dismissal threshold).
 *  - shortfall <= 0 (or no demand row at all) and an active auto line exists
 *    → close it (delete — `smark_cart_items.status` has no "closed" value,
 *    and a suggestion for zero shortfall is nothing but noise).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CartDemandSlice, Database } from "@/types/db";
import { TABLES, VIEWS } from "@/types/db";
import { isUniqueViolation } from "@/lib/labels/queue";

type DB = SupabaseClient<Database>;

export interface RecomputeSummary {
  created: number;
  updated: number;
  resurrected: number;
  closed: number;
}

const ZERO_SUMMARY: RecomputeSummary = { created: 0, updated: 0, resurrected: 0, closed: 0 };

function sameBreakdown(a: readonly CartDemandSlice[], b: readonly CartDemandSlice[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Reconciles `smark_cart_items` (source=`auto_shortfall`) against
 * `v_part_demand`. Safe to call unconditionally and often (idempotent —
 * a second call with no demand change is a no-op); tolerates a duplicate
 * insert race under the DB's `idx_smark_cart_items_one_active_per_part`
 * unique index by treating it as "someone else just created it".
 */
export async function recomputeShortfallCartItems(supabase: DB): Promise<RecomputeSummary> {
  const { data: demandRows, error: demandError } = await supabase.from(VIEWS.part_demand).select("*");
  if (demandError) throw demandError;

  const { data: activeAuto, error: autoError } = await supabase
    .from(TABLES.cart_items)
    .select("*")
    .eq("source", "auto_shortfall")
    .in("status", ["open", "dismissed"]);
  if (autoError) throw autoError;

  const demand = demandRows ?? [];
  const demandByPart = new Map(demand.map((row) => [row.part_id, row]));
  const activeAutoByPart = new Map(
    (activeAuto ?? []).filter((item) => item.part_id).map((item) => [item.part_id as string, item]),
  );

  let created = 0;
  let updated = 0;
  let resurrected = 0;
  let closed = 0;

  // 1. Close active auto lines whose part no longer has a positive shortfall.
  for (const item of activeAuto ?? []) {
    if (!item.part_id) continue;
    const shortfall = demandByPart.get(item.part_id)?.shortfall ?? 0;
    if (shortfall <= 0) {
      const { error } = await supabase.from(TABLES.cart_items).delete().eq("id", item.id);
      if (error) throw error;
      closed += 1;
    }
  }

  // 2. Create / refresh / resurrect for every part with a positive shortfall.
  for (const row of demand) {
    if (row.shortfall <= 0) continue;
    const breakdown = row.breakdown ?? [];
    const existing = activeAutoByPart.get(row.part_id);

    if (!existing) {
      const { error } = await supabase.from(TABLES.cart_items).insert({
        part_id: row.part_id,
        source: "auto_shortfall",
        demand: breakdown,
        qty_to_order: row.shortfall,
        status: "open",
      });
      if (error) {
        if (isUniqueViolation(error)) continue; // another request just created it — fine
        throw error;
      }
      created += 1;
      continue;
    }

    if (existing.status === "open") {
      if (existing.qty_to_order !== row.shortfall || !sameBreakdown(existing.demand, breakdown)) {
        const { error } = await supabase
          .from(TABLES.cart_items)
          .update({ demand: breakdown, qty_to_order: row.shortfall })
          .eq("id", existing.id);
        if (error) throw error;
        updated += 1;
      }
      continue;
    }

    // dismissed — resurrect only if shortfall grew past the dismissed qty (Q-05).
    if (row.shortfall > existing.qty_to_order) {
      const { error } = await supabase
        .from(TABLES.cart_items)
        .update({ status: "open", qty_to_order: row.shortfall, demand: breakdown })
        .eq("id", existing.id);
      if (error) throw error;
      resurrected += 1;
    } else if (!sameBreakdown(existing.demand, breakdown)) {
      // Stays dismissed — refresh the breakdown for display accuracy without
      // touching qty_to_order (that value IS the resurrect threshold).
      const { error } = await supabase.from(TABLES.cart_items).update({ demand: breakdown }).eq("id", existing.id);
      if (error) throw error;
    }
  }

  if (created === 0 && updated === 0 && resurrected === 0 && closed === 0) return ZERO_SUMMARY;
  return { created, updated, resurrected, closed };
}
