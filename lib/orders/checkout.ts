/**
 * lib/orders/checkout.ts — checkout: select cart lines → group by distributor
 * → confirm creates ONE `smark_orders` row + fanned-out `smark_order_lines`
 * per group (plan/tab-on-order.md §3-C · Q-06 FINAL).
 *
 * No cross-table transaction is available here (PostgREST, one statement per
 * call — same constraint lib/movements/service.ts documents for its own
 * write path). Each group is processed sequentially and reports its own
 * ok/error so ONE distributor group's failure (duplicate PO, etc.) never
 * blocks the others (FEATURES.md §16 invariant: "one missing/duplicate value
 * blocks only that group's order, not the whole checkout"). Within a group,
 * the PO-unique order INSERT happens strictly before any side effect
 * (order_lines, cart-item flip, draft expense) — a rejected duplicate never
 * leaves an orphaned draft expense (§16 invariant).
 *
 * ── Draft-expense privilege gap (verified findings #1/#3/#5 — read before
 * touching the branch below) ──
 * `smark_expenses` INSERT is owner+accountant ONLY
 * (0004_ordering_finance.sql:911-913), but "Cart & checkout" is a FULL area
 * for employees too (FEATURES.md §2) — an employee's RLS-bound client can
 * place the order (`smark_orders`/`smark_order_lines`/cart-item flip all
 * allow owner+employee) but can never insert the draft-expense row. The
 * previous version of this file found that out AFTER committing the order +
 * lines + cart-item flip, by letting the INSERT hit RLS and throwing —
 * corrupting the group (order placed, PO number burned, cart line gone, but
 * the action reports failure and there's no draft). Fixed by checking
 * `canWriteExpenseDraft(role)` (./expense-write.ts — a standalone stand-in
 * for the removed Expenses tab's `ROLE_MATRIX.expenses` gate) BEFORE
 * attempting the insert (never rely on RLS to tell us; decide the same way
 * the policy would, and never throw afterwards) — the order still places
 * cleanly and every active owner is notified to log the spend manually
 * instead. The real bridge (a SECURITY DEFINER function, or an
 * `is_draft`-scoped INSERT policy admitting employee) would let the employee
 * create the draft directly — flagged notes-for-integrator; migrations
 * 0001–0005 are frozen for this package (docs/OWNERSHIP.md), so that part of
 * the fix can't land here.
 *
 * The same privilege gap made an UNPRICED order (total === 0 — common; "we
 * will ask them to add price for it, manual now" per plan/tab-on-order.md
 * §3-A/§3-C) skip the draft too, for EVERY role: `smark_expenses.amount` has
 * a DB CHECK (`amount > 0`) that rejects a ₹0 placeholder row outright.
 * Rather than silently drop the R2-12 "placing an order auto-creates a draft
 * expense entry (owner confirms)" promise, every active owner still gets
 * notified that an unpriced PO landed and needs a manual entry once its
 * price is known. The real fix (relaxing the CHECK for `is_draft` rows, or
 * spawning/filling the draft at receipt-extraction/arrival time) is a
 * schema/design call — flagged notes-for-integrator.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CartItemRow, Database } from "@/types/db";
import { TABLES } from "@/types/db";
import type { Role } from "@/lib/auth/roles";
import { canWriteExpenseDraft, insertDraftExpense } from "./expense-write";
import type { CheckoutGroupInput } from "./types";
import { splitQtyAcrossDemand } from "./split";

type DB = SupabaseClient<Database>;

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505");
}

export interface CheckoutGroupResult {
  distributorId: string;
  poNumber: string;
  ok: boolean;
  orderId?: string;
  draftExpenseCreated?: boolean;
  /** A draft SHOULD exist (R2-12) but couldn't be auto-created this time — see module doc. Every active owner was notified instead. */
  draftExpensePending?: boolean;
  error?: string;
}

export interface CheckoutResult {
  results: CheckoutGroupResult[];
}

async function fetchOpenCartItems(supabase: DB, ids: readonly string[]): Promise<CartItemRow[]> {
  const { data, error } = await supabase.from(TABLES.cart_items).select("*").in("id", ids).eq("status", "open");
  if (error) throw error;
  return data ?? [];
}

async function checkoutOneGroup(supabase: DB, actorId: string, role: Role, group: CheckoutGroupInput): Promise<CheckoutGroupResult> {
  const poNumber = group.poNumber.trim();
  if (!poNumber) {
    return { distributorId: group.distributorId, poNumber, ok: false, error: "Enter the distributor's order number." };
  }

  const items = await fetchOpenCartItems(supabase, group.cartItemIds);
  if (items.length === 0) {
    return { distributorId: group.distributorId, poNumber, ok: false, error: "None of these lines are open anymore." };
  }

  // The PO-unique INSERT runs before any other write (§16 invariant above).
  const { data: order, error: orderError } = await supabase
    .from(TABLES.orders)
    .insert({ distributor_id: group.distributorId, po_number: poNumber, placed_by: actorId, status: "ordered" })
    .select("*")
    .single();
  if (orderError) {
    if (isUniqueViolation(orderError)) {
      return { distributorId: group.distributorId, poNumber, ok: false, error: `Order number "${poNumber}" is already used.` };
    }
    throw orderError;
  }

  const orderLineInserts = items.flatMap((item) =>
    splitQtyAcrossDemand(item.demand, item.qty_to_order).map((split) => ({
      order_id: order.id,
      cart_item_id: item.id,
      bom_line_id: split.bom_line_id,
      project_id: split.project_id,
      part_id: item.part_id,
      chosen_distributor_id: group.distributorId,
      chosen_result_id: item.chosen_result_id,
      qty_ordered: split.qty,
      unit_price: item.unit_price,
    })),
  );

  const { error: linesError } = await supabase.from(TABLES.order_lines).insert(orderLineInserts);
  if (linesError) throw linesError;

  const { error: flipError } = await supabase
    .from(TABLES.cart_items)
    .update({ status: "ordered" })
    .in("id", items.map((i) => i.id));
  if (flipError) throw flipError;

  // Draft expense [Q-09 / R2-12] — total across this group's lines.
  const total = orderLineInserts.reduce((sum, line) => sum + line.qty_ordered * (line.unit_price ?? 0), 0);
  let draftExpenseCreated = false;
  let draftExpensePending = false;

  if (total > 0 && canWriteExpenseDraft(role)) {
    const { data: distributor, error: distributorError } = await supabase
      .from(TABLES.distributors)
      .select("name")
      .eq("id", group.distributorId)
      .maybeSingle();
    if (distributorError) throw distributorError;

    const lineProjectIds = new Set(orderLineInserts.map((l) => l.project_id).filter((id): id is string => Boolean(id)));
    const singleProjectId = lineProjectIds.size === 1 ? Array.from(lineProjectIds)[0]! : null;

    await insertDraftExpense(supabase, {
      amount: total,
      vendor: distributor?.name ?? null,
      projectId: singleProjectId,
      poNumber,
      orderId: order.id,
      actorId,
    });
    draftExpenseCreated = true;
  } else if (total > 0) {
    // Role can't write the cost record (e.g. employee) — RLS would reject the
    // insert above. The order still places; the cost just isn't auto-captured.
    // (The old owner FYI + "add it in Expenses" prompt was dropped when the
    // Expenses UI was removed — there's no surface to complete a draft in.)
    draftExpensePending = true;
  } else {
    // total === 0 — unpriced order; the DB CHECK (amount > 0) blocks a draft
    // for any role, so nothing is inserted until prices land.
    draftExpensePending = true;
  }

  return { distributorId: group.distributorId, poNumber, ok: true, orderId: order.id, draftExpenseCreated, draftExpensePending };
}

/** Places every group independently — see module doc for the isolation contract. */
export async function checkoutCart(
  supabase: DB,
  actorId: string,
  role: Role,
  groups: readonly CheckoutGroupInput[],
): Promise<CheckoutResult> {
  const results: CheckoutGroupResult[] = [];
  for (const group of groups) {
    results.push(await checkoutOneGroup(supabase, actorId, role, group));
  }
  return { results };
}
