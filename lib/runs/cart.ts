/**
 * lib/runs/cart.ts — Order Review's ONLY action (R2-08, supersedes the
 * baseline's "Mark ordered"): "Add to cart" takes the selected option +
 * needed qty and creates/updates a `smark_cart_items` row (source
 * `review_add`), aggregated per part the same way cart-orders' own checkout
 * flow expects (SCHEMA.md §4: "one cart line per part, aggregated across
 * projects"). `lib/orders/**` (cart-orders' own aggregation/demand helpers)
 * is NOT in bom-pipeline's cross-import allowlist (docs/OWNERSHIP.md), so
 * this is a deliberately MINIMAL, self-contained aggregation: find an open
 * cart line for the same part (or, for a never-catalogued part, the same
 * MPN descriptor), append this line's demand slice if it isn't already
 * there, else insert a new line. Flagged in this package's report for
 * cart-orders to audit against its own invariants (unit-price merge rules on
 * repeat adds, etc.) since its own richer helpers were intentionally not
 * reused here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BomLineRow, CartDemandSlice, CartDescriptor, Database } from "@/types/db";
import { TABLES } from "@/types/db";
import { derivePackageFromFootprint } from "@/lib/bom/footprint";
import { splitValueVoltage } from "@/lib/bom/footprint";

type DB = SupabaseClient<Database>;

export type AddToCartResult = { ok: true; cartItemId: string; alreadyInCart: boolean } | { ok: false; error: string };

interface AddToCartParams {
  runId: string;
  bomLineId: string;
  resultId: string;
  qty: number;
  actorId: string;
}

/**
 * `supabase` = the caller's per-request client (smark_cart_items has real
 * owner/employee RLS — no service client needed here). `service` = required
 * only to read the chosen `smark_agent_results` row (service-role-only RLS).
 */
export async function addReviewLineToCart(supabase: DB, service: DB, params: AddToCartParams): Promise<AddToCartResult> {
  const { data: result, error: resultError } = await service
    .from(TABLES.agent_results)
    .select("*")
    .eq("id", params.resultId)
    .eq("run_id", params.runId)
    .eq("bom_line_id", params.bomLineId)
    .maybeSingle();
  if (resultError) return { ok: false, error: resultError.message };
  if (!result) return { ok: false, error: "That option is no longer available — re-run this item and try again." };

  const { data: run, error: runError } = await supabase.from(TABLES.agent_runs).select("bom_id").eq("id", params.runId).maybeSingle();
  if (runError) return { ok: false, error: runError.message };
  if (!run) return { ok: false, error: "That run no longer exists." };

  const { data: bom, error: bomError } = await supabase.from(TABLES.boms).select("id, project_id").eq("id", run.bom_id).maybeSingle();
  if (bomError) return { ok: false, error: bomError.message };
  if (!bom) return { ok: false, error: "That BOM no longer exists." };

  const { data: line, error: lineError } = await supabase.from(TABLES.bom_lines).select("*").eq("id", params.bomLineId).maybeSingle();
  if (lineError) return { ok: false, error: lineError.message };
  if (!line) return { ok: false, error: "That BOM line no longer exists." };
  const bomLine = line as BomLineRow;

  const demandSlice: CartDemandSlice = { project_id: bom.project_id, bom_id: bom.id, bom_line_id: bomLine.id, qty: params.qty };
  const partId = bomLine.matched_part_id;

  const descriptor: CartDescriptor | null = partId
    ? null
    : {
        mpn: bomLine.mpn,
        lcsc_pn: bomLine.lcsc_pn,
        value: splitValueVoltage(bomLine.value).value,
        package: derivePackageFromFootprint(bomLine.footprint),
        voltage: splitValueVoltage(bomLine.value).voltage,
        description: bomLine.description,
      };

  const existing = partId
    ? await supabase.from(TABLES.cart_items).select("*").eq("part_id", partId).eq("status", "open").maybeSingle()
    : await supabase
        .from(TABLES.cart_items)
        .select("*")
        .is("part_id", null)
        .eq("status", "open")
        .contains("descriptor", { mpn: bomLine.mpn })
        .maybeSingle();
  if (existing.error) return { ok: false, error: existing.error.message };

  if (existing.data) {
    const row = existing.data;
    const demand = (row.demand as CartDemandSlice[]) ?? [];
    const alreadyThere = demand.some((d) => d.bom_line_id === demandSlice.bom_line_id);
    if (alreadyThere) return { ok: true, cartItemId: row.id, alreadyInCart: true };

    const nextDemand = [...demand, demandSlice];
    const nextQty = nextDemand.reduce((sum, d) => sum + d.qty, 0);
    const { error: updateError } = await supabase
      .from(TABLES.cart_items)
      .update({
        demand: nextDemand,
        qty_to_order: nextQty,
        chosen_result_id: params.resultId,
        unit_price: row.unit_price ?? result.price,
      })
      .eq("id", row.id);
    if (updateError) return { ok: false, error: updateError.message };
    return { ok: true, cartItemId: row.id, alreadyInCart: false };
  }

  const { data: inserted, error: insertError } = await supabase
    .from(TABLES.cart_items)
    .insert({
      part_id: partId,
      descriptor,
      source: "review_add",
      demand: [demandSlice],
      qty_to_order: params.qty,
      chosen_result_id: params.resultId,
      unit_price: result.price,
      status: "open",
      created_by: params.actorId,
    })
    .select("id")
    .single();
  if (insertError || !inserted) return { ok: false, error: insertError?.message ?? "Insert returned no row." };

  return { ok: true, cartItemId: inserted.id, alreadyInCart: false };
}
