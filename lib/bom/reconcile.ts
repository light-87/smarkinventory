/**
 * lib/bom/reconcile.ts — the BOM reconcile ladder (plan/tab-orders-projects.md
 * §2/§5 R2-03/R2-08/R2-10/R2-27, FEATURES.md §5.8/§6).
 *
 * Pure, DB-free: takes already-fetched lines + catalog + demand data and
 * returns per-line outcomes plus the stat trio. `lib/bom/service.ts` is the
 * thin I/O shell that fetches those inputs and writes the results back to
 * `smark_bom_lines` — kept pure here so the ×N math and matcher wiring are
 * unit-testable without a DB (plan/TESTING.md "unit: reconcile matcher
 * ladder, demand/shortfall math (× build_qty)").
 *
 * Matching is EXACT-IDENTITY ONLY (MPN → LCSC PN): the fuzzy value+package
 * rung of `lib/matcher` is deliberately not fed here. An uploaded BOM is
 * rendered as-is and its unmatched lines go to AI sourcing, which reads the
 * raw line — a fuzzy guess ("10uF/25V 1206" pinned to whatever similar cap
 * the catalog has) shows a wrong location in the Status column and quietly
 * shrinks the to-order list (manual-test finding F-002, GCU_V1.1_BOM.xlsx).
 * The fuzzy rung still serves the matcher's other consumers (Receive
 * duplicate guard, bulk-takeout resolution), where a human confirms the hit.
 *
 * Need math [R2-27]: every line's need = `qty × bom.build_qty`. DNP lines
 * contribute ZERO need — mirrors `v_part_demand`'s own
 * `bl.dnp = false and bl.qty > 0` join filter (supabase/migrations/
 * 0005_views_fks.sql) so a BOM's own reconcile view never disagrees with the
 * cross-project demand view about what a DNP line is worth.
 */

import { matchPart, type MatchCatalogEntry, type MatchMethod } from "@/lib/matcher";
import type { BomLineMatchState } from "@/types/db";

/** Minimal `smark_bom_lines` shape reconcile needs. */
export interface ReconcileLineInput {
  id: string;
  qty: number | null;
  mpn: string | null;
  lcsc_pn: string | null;
  dnp: boolean;
}

/** Minimal `smark_parts` shape reconcile needs — any `PartRow` slice satisfies this. */
export interface ReconcileCatalogPart extends MatchCatalogEntry {
  total_qty: number;
}

export interface ReconcileLineOutcome {
  id: string;
  matchedPartId: string | null;
  matchState: BomLineMatchState;
  matchConfidence: number | null;
  matchMethod: MatchMethod | null;
  /** `qty × build_qty` — 0 for DNP lines regardless of qty. */
  need: number;
}

/** Per-line reconcile: exact MPN/LCSC identity match, then compares `need` to the matched part's stock. */
export function reconcileLine(
  line: ReconcileLineInput,
  catalog: readonly ReconcileCatalogPart[],
  buildQty: number,
): ReconcileLineOutcome {
  const need = line.dnp ? 0 : (line.qty ?? 0) * buildQty;
  // No value/package/voltage passed — the fuzzy rung can't fire (see header).
  const hit = matchPart({ mpn: line.mpn, lcsc_pn: line.lcsc_pn }, catalog);

  if (!hit) {
    return { id: line.id, matchedPartId: null, matchState: "unresolved", matchConfidence: null, matchMethod: null, need };
  }

  // DNP lines need nothing — trivially "in stock" once identity is known (matches v_part_demand's
  // own DNP exclusion) rather than forcing a to-order status on a line nobody intends to buy.
  const matchState: BomLineMatchState = line.dnp || hit.part.total_qty >= need ? "in_stock" : "to_order";

  return {
    id: line.id,
    matchedPartId: hit.part.id,
    matchState,
    matchConfidence: hit.confidence,
    matchMethod: hit.method,
    need,
  };
}

/** Reconciles every line of a BOM against the catalog at the given build_qty. */
export function reconcileLines(
  lines: readonly ReconcileLineInput[],
  catalog: readonly ReconcileCatalogPart[],
  buildQty: number,
): ReconcileLineOutcome[] {
  return lines.map((line) => reconcileLine(line, catalog, buildQty));
}

export interface ReconcileStats {
  lines: number;
  inStock: number;
  /** `to_order` + `unresolved` combined — the UI's stat-trio "to order" bucket (FEATURES §5.8). */
  toOrder: number;
}

/** The BOM-detail stat trio: lines / in stock / to order. */
export function computeReconcileStats(outcomes: readonly { matchState: BomLineMatchState }[]): ReconcileStats {
  let inStock = 0;
  let toOrder = 0;
  for (const outcome of outcomes) {
    if (outcome.matchState === "in_stock") inStock += 1;
    else toOrder += 1;
  }
  return { lines: outcomes.length, inStock, toOrder };
}
