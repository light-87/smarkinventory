"use server";

/**
 * lib/orders/actions.ts — Server Actions for the Cart surface.
 *
 * Thin wrappers: validate with zod (lib/orders/types.ts), resolve the
 * caller's session + role via the per-request RLS-bound client
 * (lib/supabase/server.ts — never the service client, per CLAUDE.md "Server
 * data via supabase server client + RLS"), then delegate to the pure
 * lib/orders/*.ts functions that do the actual writes. Role-gated the same
 * way RLS gates it (owner/employee full, accountant read-only —
 * FEATURES.md §2 "Cart & checkout") so a read-only caller gets a clear error
 * instead of an opaque RLS-denied Postgres error.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canSee, canWrite } from "@/lib/auth/roles";
import { getStorageAdapter } from "@/lib/storage";
import * as core from "./core";
import { recomputeShortfallCartItems, type RecomputeSummary } from "./demand";
import { checkoutCart, type CheckoutResult } from "./checkout";
import { markOrderLineArrived, type MarkOrderLineArrivedResult } from "./arrivals";
import { uploadReceipt, type UploadReceiptResult } from "./receipts";
import {
  applyReceiptExtraction,
  extractOrderReceipt,
  type ApplyReceiptExtractionResult,
  type ExtractOrderReceiptResult,
} from "./receipt-extract";
import { searchPartsForManualAdd, type PartSearchHit } from "./queries";
import {
  CartItemIdInputSchema,
  CheckoutInputSchema,
  ConfirmReceiptExtractionInputSchema,
  ManualAddInputSchema,
  OrderIdInputSchema,
  OrderLineIdInputSchema,
  UpdateCartLineInputSchema,
  type CartItemIdInput,
  type CheckoutInput,
  type ConfirmReceiptExtractionInput,
  type ManualAddInput,
  type OrderIdInput,
  type OrderLineIdInput,
  type UpdateCartLineInput,
} from "./types";

const CART_PATH = "/cart";

async function requireCartReader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canSee(role, "cart")) throw new Error("You don't have access to Cart.");
  return { supabase, actorId: user.id };
}

async function requireCartWriter() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canWrite(role, "cart")) throw new Error("You don't have permission to make changes on Cart.");
  return { supabase, actorId: user.id, role };
}

/** Manual-add search panel (read-only, so accountant's read-only Cart can still search). */
export async function searchPartsForManualAddAction(query: string): Promise<PartSearchHit[]> {
  const { supabase } = await requireCartReader();
  return searchPartsForManualAdd(supabase, query);
}

/**
 * Reconciles auto-shortfall cart lines against `v_part_demand` (Q-05).
 * Runs on every Cart page load (app/(app)/cart/page.tsx) and behind an
 * explicit "Refresh demand" affordance — see lib/orders/demand.ts's module
 * doc for why on-load is this package's v1 trigger choice. Read access is
 * enough to trigger it (it's a read-side reconciliation of a view, not a
 * user-authored write) — gated the same as the rest of Cart's reads.
 */
export async function recomputeShortfallAction(): Promise<RecomputeSummary> {
  const { supabase } = await requireCartReader();
  const summary = await recomputeShortfallCartItems(supabase);
  if (summary.created || summary.updated || summary.resurrected || summary.closed) {
    revalidatePath(CART_PATH);
  }
  return summary;
}

export async function addManualCartLineAction(input: ManualAddInput): Promise<core.ManualAddResult> {
  const parsed = ManualAddInputSchema.parse(input);
  const { supabase, actorId } = await requireCartWriter();
  const result = await core.addManualCartLine(supabase, actorId, parsed);
  if (result.ok) revalidatePath(CART_PATH);
  return result;
}

export async function updateCartLineAction(input: UpdateCartLineInput): Promise<core.UpdateCartLineResult> {
  const parsed = UpdateCartLineInputSchema.parse(input);
  const { supabase } = await requireCartWriter();
  const result = await core.updateCartLine(supabase, parsed);
  if (result.ok) revalidatePath(CART_PATH);
  return result;
}

export async function removeCartLineAction(input: CartItemIdInput): Promise<core.RemoveCartLineResult> {
  const parsed = CartItemIdInputSchema.parse(input);
  const { supabase } = await requireCartWriter();
  const result = await core.removeCartLine(supabase, parsed.cartItemId);
  if (result.ok) revalidatePath(CART_PATH);
  return result;
}

export async function checkoutCartAction(input: CheckoutInput): Promise<CheckoutResult> {
  const parsed = CheckoutInputSchema.parse(input);
  const { supabase, actorId, role } = await requireCartWriter();
  const result = await checkoutCart(supabase, actorId, role, parsed.groups);
  if (result.results.some((r) => r.ok)) revalidatePath(CART_PATH);
  return result;
}

export async function markOrderLineArrivedAction(input: OrderLineIdInput): Promise<MarkOrderLineArrivedResult> {
  const parsed = OrderLineIdInputSchema.parse(input);
  const { supabase } = await requireCartWriter();
  const result = await markOrderLineArrived(supabase, parsed.orderLineId);
  if (result.ok) revalidatePath(CART_PATH);
  return result;
}

/**
 * Receipt upload — takes `FormData` directly (Next.js Server Actions accept
 * `File` entries natively) so the client component can post a plain
 * `<form>`/`FormData` without a separate Route Handler.
 */
export async function uploadReceiptAction(formData: FormData): Promise<UploadReceiptResult> {
  const orderId = formData.get("orderId");
  const file = formData.get("file");
  if (typeof orderId !== "string" || !orderId) return { ok: false, error: "Missing order." };
  if (!(file instanceof File)) return { ok: false, error: "Choose a file to upload." };

  const { supabase } = await requireCartWriter();
  const body = new Uint8Array(await file.arrayBuffer());
  const result = await uploadReceipt(supabase, getStorageAdapter(), {
    orderId,
    fileName: file.name,
    contentType: file.type || null,
    body,
  });
  if (result.ok) revalidatePath(CART_PATH);
  return result;
}

/**
 * "Extract prices" (§3-C) step 1 — read-only, returns a proposal for the
 * confirm dialog. Never writes a price (lib/orders/receipt-extract.ts module
 * doc) — nothing to revalidate.
 */
export async function extractOrderReceiptAction(input: OrderIdInput): Promise<ExtractOrderReceiptResult> {
  const parsed = OrderIdInputSchema.parse(input);
  const { supabase } = await requireCartWriter();
  return extractOrderReceipt(supabase, parsed.orderId);
}

/** "Extract prices" step 2 — the user-confirmed mapping actually gets written here. */
export async function confirmReceiptExtractionAction(
  input: ConfirmReceiptExtractionInput,
): Promise<ApplyReceiptExtractionResult> {
  const parsed = ConfirmReceiptExtractionInputSchema.parse(input);
  const { supabase } = await requireCartWriter();
  const result = await applyReceiptExtraction(supabase, parsed.orderId, parsed.raw, parsed.lines);
  if (result.ok) revalidatePath(CART_PATH);
  return result;
}
