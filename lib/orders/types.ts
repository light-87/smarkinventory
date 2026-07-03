/**
 * lib/orders/types.ts — form/input contracts + shared shapes for the Cart
 * surface (plan/tab-on-order.md · FEATURES.md §5.12).
 *
 * Every server action validates its payload against one of these zod schemas
 * before touching the DB (CLAUDE.md / OWNERSHIP.md convention).
 *
 * ── distributor-on-a-cart-line, a schema gap (read before touching this) ──
 * `smark_cart_items` has NO plain `distributor_id` column — only
 * `chosen_result_id → smark_agent_results` (SCHEMA.md §4). That table works
 * for `review_add` lines (a real run+bom_line always backs them) but not for
 * `manual` or `auto_shortfall` lines, which never have an agent run at all.
 * Migrations are frozen for this package (docs/OWNERSHIP.md — only the
 * portal package owns 0006), so this package stores the user's distributor
 * *choice* in `smark_cart_items.descriptor` — a jsonb column the DB already
 * allows to coexist with a non-null `part_id` (the identity CHECK is an OR,
 * not an XOR) — under a `distributor_id` key that `types/db.ts`'s
 * `CartDescriptorSchema` doesn't type (that file is integrator-locked; this
 * is an intentionally loose, additive use of the same jsonb column, not a
 * schema change).
 *
 * There's a second, harder wrinkle: `smark_agent_results` has RLS enabled
 * with NO policies for `authenticated` at all (0004 — "all client-facing
 * reads/writes MUST go through server-side code using the service-role
 * client"; this package's mission explicitly forbids the service-role client
 * in app routes). That means a `review_add` cart line's `chosen_result_id`
 * is a write-only pointer from this package's point of view — we can store
 * it (for bom-pipeline / a future service-role screen to dereference) but we
 * can never read `.distributor_id` or `.order_link` off of it ourselves.
 * So `descriptor.distributor_id` is treated as the ONE source of truth for
 * "what distributor is this cart line going to" — regardless of source —
 * and whoever inserts a `review_add` row (bom-pipeline's "Add to cart"
 * action, not built yet) should copy the selected result's `distributor_id`
 * into `descriptor.distributor_id` at insert time so it shows up here.
 * Flagged in this package's report as notes-for-integrator; a real
 * `smark_cart_items.distributor_id` column would retire this workaround.
 */

import { z } from "zod";
import type { CartDescriptor, CartItemRow } from "@/types/db";

/* ────────────────────────────────────────────────────────────────────────────
 * The descriptor jsonb extension (see module doc above)
 * ──────────────────────────────────────────────────────────────────────────── */

/** `smark_cart_items.descriptor`, plus the locally-owned `distributor_id` key. */
export interface CartLineDescriptor extends CartDescriptor {
  distributor_id?: string | null;
}

/** Reads the effective chosen-distributor for a cart line — see module doc. */
export function getLineDistributorId(item: Pick<CartItemRow, "descriptor">): string | null {
  const descriptor = item.descriptor as CartLineDescriptor | null;
  return descriptor?.distributor_id ?? null;
}

/** Merges a distributor choice into a line's descriptor without dropping other keys. */
export function withLineDistributorId(
  current: CartDescriptor | null,
  distributorId: string | null,
): CartLineDescriptor {
  return { ...(current ?? {}), distributor_id: distributorId };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Input schemas
 * ──────────────────────────────────────────────────────────────────────────── */

/** Manual add: search any catalogued part → add with qty (§3-A). */
export const ManualAddInputSchema = z.object({
  partId: z.uuid(),
  qty: z.coerce.number().int().positive("Quantity must be a positive whole number"),
});
export type ManualAddInput = z.infer<typeof ManualAddInputSchema>;

/** Edits to an OPEN cart line — qty / price / distributor, each independently optional. */
export const UpdateCartLineInputSchema = z.object({
  cartItemId: z.uuid(),
  qtyToOrder: z.coerce.number().int().positive("Quantity must be a positive whole number").nullish(),
  unitPrice: z.coerce.number().nonnegative("Price can't be negative").nullish(),
  distributorId: z.uuid().nullish(),
});
export type UpdateCartLineInput = z.infer<typeof UpdateCartLineInputSchema>;

export const CartItemIdInputSchema = z.object({ cartItemId: z.uuid() });
export type CartItemIdInput = z.infer<typeof CartItemIdInputSchema>;

/** One distributor group at checkout (Q-06: PO number = the distributor website's order number). */
export const CheckoutGroupInputSchema = z.object({
  distributorId: z.uuid(),
  cartItemIds: z.array(z.uuid()).min(1),
  poNumber: z.string().trim().min(1, "Enter the distributor's order number"),
});
export type CheckoutGroupInput = z.infer<typeof CheckoutGroupInputSchema>;

export const CheckoutInputSchema = z.object({
  groups: z.array(CheckoutGroupInputSchema).min(1),
});
export type CheckoutInput = z.infer<typeof CheckoutInputSchema>;

export const OrderLineIdInputSchema = z.object({ orderLineId: z.uuid() });
export type OrderLineIdInput = z.infer<typeof OrderLineIdInputSchema>;

export const OrderIdInputSchema = z.object({ orderId: z.uuid() });
export type OrderIdInput = z.infer<typeof OrderIdInputSchema>;

/**
 * Confirm step for "Extract prices" (§3-C, lib/orders/receipt-extract.ts).
 * `raw` is the AI's original proposal (round-tripped from the client so the
 * server never has to re-derive it, and so `receipt_extracted` can carry the
 * exact thing that was reviewed) — `lines` is the user-confirmed mapping
 * that actually gets written.
 */
const ReceiptExtractedLineInputSchema = z.object({
  desc: z.string(),
  qty: z.number(),
  unit_price: z.number(),
});

export const ConfirmReceiptExtractionInputSchema = z.object({
  orderId: z.uuid(),
  raw: z.object({
    lines: z.array(ReceiptExtractedLineInputSchema),
    total: z.number().nullable(),
  }),
  lines: z
    .array(
      z.object({
        orderLineIds: z.array(z.uuid()).min(1),
        cartItemId: z.uuid().nullable(),
        unitPrice: z.coerce.number().nonnegative("Price can't be negative"),
      }),
    )
    .min(1, "Map at least one line to a part before confirming."),
});
export type ConfirmReceiptExtractionInput = z.infer<typeof ConfirmReceiptExtractionInputSchema>;
