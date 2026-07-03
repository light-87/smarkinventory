import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, hasLocalSupabase } from "../helpers/supabase";
import { createTestActor, createTestPart, type TestActor } from "../invariants/fixtures";
import { addManualCartLine, updateCartLine } from "@/lib/orders/core";
import { checkoutCart } from "@/lib/orders/checkout";
import { TABLES } from "@/types/db";

/**
 * Finding #6 — money in notification bodies must go through the shared
 * `formatINR` (en-IN lakh/crore grouping), not a hand-rolled `₹${n.toFixed(2)}`.
 * `tests/unit/search-notifications-fanout.test.ts` already covers the
 * `notifyExpenseDraft` helper directly against a fake client; this exercises
 * the OTHER call site fixed alongside it — `lib/orders/checkout.ts`'s
 * "role can't write Expenses" notify branch (`checkoutOneGroup`), which
 * builds its own body string inline rather than through `notifyExpenseDraft`
 * — end to end against a real DB, so the actual `smark_notifications.body`
 * row is asserted, not just the string helper.
 *
 * `describe.skip` (not the sibling `describeDb`) mirrors
 * tests/integration/receive-core.test.ts's inline gate for the same reason
 * (a skipped describe's body still runs in Bun — building a service client
 * eagerly would throw with no local stack configured).
 */
const describeDb = hasLocalSupabase ? describe : describe.skip;

describeDb("lib/orders/checkout — draft-expense notify body money formatting", () => {
  let service: SupabaseClient;
  let employee: TestActor;

  beforeAll(async () => {
    service = createServiceClient();
    employee = await createTestActor(service, "employee");
  });

  afterAll(async () => {
    await employee.cleanup();
  });

  function tag(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  test(
    "a lakh-scale order total placed by a role that can't write Expenses notifies owners with full en-IN grouping, not a raw toFixed(2)",
    async () => {
      const part = await createTestPart(service);
      const { data: distributor, error: distError } = await service
        .from(TABLES.distributors)
        .insert({ name: `CheckoutFmtDist-${tag()}`, api_type: "none" })
        .select("id")
        .single();
      if (distError || !distributor) throw new Error(`createDistributor failed: ${distError?.message}`);

      // qty 100 × unit_price 1250 = ₹1,25,000 — a lakh-scale total, so a
      // correct fix must show "1,25,000.00" (en-IN grouping), while the old
      // `${total.toFixed(2)}` bug would have rendered the ungrouped "125000.00".
      const added = await addManualCartLine(service, employee.id, { partId: part.id, qty: 100 });
      if (!added.ok) throw new Error(added.error);
      const updated = await updateCartLine(service, {
        cartItemId: added.cartItemId,
        distributorId: distributor.id,
        unitPrice: 1250,
      });
      if (!updated.ok) throw new Error(updated.error);

      const poNumber = `PO-FMT-${tag()}`;

      try {
        const { results } = await checkoutCart(service, employee.id, "employee", [
          { distributorId: distributor.id, cartItemIds: [added.cartItemId], poNumber },
        ]);
        expect(results[0]!.ok).toBe(true);
        expect(results[0]!.draftExpensePending).toBe(true); // employee can't auto-create the draft

        const { data: notifications, error: notifyError } = await service
          .from(TABLES.notifications)
          .select("body")
          .eq("title", `PO ${poNumber} needs an expense entry`);
        if (notifyError) throw new Error(notifyError.message);
        expect(notifications!.length).toBeGreaterThan(0); // at least one active owner notified

        for (const n of notifications!) {
          expect(n.body).toBe("₹1,25,000.00 — placed by a role that can't draft it automatically; add it in Expenses.");
          expect(n.body).not.toContain("125000.00"); // the old ungrouped hand-rolled toFixed(2) output
        }
      } finally {
        await service.from(TABLES.notifications).delete().eq("title", `PO ${poNumber} needs an expense entry`);
        const { data: lines } = await service.from(TABLES.order_lines).select("order_id").eq("cart_item_id", added.cartItemId);
        const orderIds = Array.from(new Set((lines ?? []).map((l) => l.order_id)));
        if (orderIds.length > 0) {
          await service.from(TABLES.expenses).delete().in("source_order_id", orderIds);
          await service.from(TABLES.order_lines).delete().in("order_id", orderIds);
          await service.from(TABLES.orders).delete().in("id", orderIds);
        }
        await service.from(TABLES.cart_items).delete().eq("id", added.cartItemId);
        await service.from(TABLES.distributors).delete().eq("id", distributor.id);
        await part.cleanup();
      }
    },
  );
});
