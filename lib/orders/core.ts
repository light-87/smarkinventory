/**
 * lib/orders/core.ts — Cart surface DB writes that aren't checkout/arrival
 * (those get their own files: lib/orders/checkout.ts, lib/orders/arrivals.ts).
 *
 * Same split as lib/receive: `lib/orders/actions.ts` ("use server") wraps
 * these for the app using the per-request RLS client; tests call the SAME
 * functions with a service-role client against the local stack — no
 * `next/headers` import here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CartItemRow, Database } from "@/types/db";
import { TABLES } from "@/types/db";
import { isUniqueViolation } from "@/lib/labels/queue";
import type { ManualAddInput, UpdateCartLineInput } from "./types";
import { withLineDistributorId } from "./types";

type DB = SupabaseClient<Database>;

/* ────────────────────────────────────────────────────────────────────────────
 * Manual add — search any part → add with qty (§3-A)
 * ──────────────────────────────────────────────────────────────────────────── */

export type ManualAddResult =
  | { ok: true; cartItemId: string; merged: boolean }
  | { ok: false; error: string };

/**
 * Adds a catalogued part to the cart. `smark_cart_items` allows at most one
 * active (open/dismissed) row per part (`idx_smark_cart_items_one_active_per_part`)
 * — if one already exists this BUMPS its qty instead of erroring (and
 * revives a dismissed auto-shortfall line back to `open`, since the user just
 * explicitly asked for it), rather than making the user hunt for the
 * existing line to edit.
 */
export async function addManualCartLine(supabase: DB, actorId: string, input: ManualAddInput): Promise<ManualAddResult> {
  const { data: part, error: partError } = await supabase
    .from(TABLES.parts)
    .select("id, internal_pid")
    .eq("id", input.partId)
    .maybeSingle();
  if (partError) throw partError;
  if (!part) return { ok: false, error: "Part not found." };

  const { data: existing, error: existingError } = await supabase
    .from(TABLES.cart_items)
    .select("*")
    .eq("part_id", input.partId)
    .in("status", ["open", "dismissed"])
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    const { error } = await supabase
      .from(TABLES.cart_items)
      .update({ status: "open", qty_to_order: existing.qty_to_order + input.qty })
      .eq("id", existing.id);
    if (error) throw error;
    return { ok: true, cartItemId: existing.id, merged: true };
  }

  const { data: created, error: insertError } = await supabase
    .from(TABLES.cart_items)
    .insert({
      part_id: input.partId,
      source: "manual",
      demand: [],
      qty_to_order: input.qty,
      status: "open",
      created_by: actorId,
    })
    .select("id")
    .single();
  if (insertError) {
    if (isUniqueViolation(insertError)) {
      return { ok: false, error: `${part.internal_pid} was just added to the cart by someone else — refresh and edit it there.` };
    }
    throw insertError;
  }

  return { ok: true, cartItemId: created.id, merged: false };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Edit an open line — qty / price / distributor (§3-A)
 * ──────────────────────────────────────────────────────────────────────────── */

export type UpdateCartLineResult = { ok: true } | { ok: false; error: string };

export async function updateCartLine(supabase: DB, input: UpdateCartLineInput): Promise<UpdateCartLineResult> {
  const { data: item, error } = await supabase.from(TABLES.cart_items).select("*").eq("id", input.cartItemId).maybeSingle();
  if (error) throw error;
  if (!item) return { ok: false, error: "Cart line not found." };
  if (item.status === "ordered") return { ok: false, error: "This line has already been ordered." };

  const patch: Partial<CartItemRow> = {};
  if (input.qtyToOrder != null) patch.qty_to_order = input.qtyToOrder;
  if (input.unitPrice !== undefined) patch.unit_price = input.unitPrice;
  if (input.distributorId !== undefined) {
    patch.descriptor = withLineDistributorId(item.descriptor, input.distributorId ?? null);
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error: updateError } = await supabase.from(TABLES.cart_items).update(patch).eq("id", input.cartItemId);
  if (updateError) throw updateError;
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Remove / dismiss a line (§3-A/B)
 * ──────────────────────────────────────────────────────────────────────────── */

export type RemoveCartLineResult = { ok: true } | { ok: false; error: string };

/**
 * "Remove" is one user-facing verb over two DB-level behaviors (SCHEMA.md
 * `smark_cart_items.status` comment: "dismissed applies to auto_shortfall
 * lines only"): an auto-shortfall line is DISMISSED (kept, so Q-05's
 * resurrect-above-threshold rule has something to compare against); a
 * manual/review line is DELETED outright (nothing to resurrect — re-adding
 * is one search or one "Add to cart" away).
 */
export async function removeCartLine(supabase: DB, cartItemId: string): Promise<RemoveCartLineResult> {
  const { data: item, error } = await supabase.from(TABLES.cart_items).select("*").eq("id", cartItemId).maybeSingle();
  if (error) throw error;
  if (!item) return { ok: false, error: "Cart line not found." };
  if (item.status === "ordered") return { ok: false, error: "This line has already been ordered." };

  if (item.source === "auto_shortfall") {
    if (item.status === "dismissed") return { ok: true };
    const { error: dismissError } = await supabase.from(TABLES.cart_items).update({ status: "dismissed" }).eq("id", cartItemId);
    if (dismissError) throw dismissError;
    return { ok: true };
  }

  const { error: deleteError } = await supabase.from(TABLES.cart_items).delete().eq("id", cartItemId);
  if (deleteError) throw deleteError;
  return { ok: true };
}
