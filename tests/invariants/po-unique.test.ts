import { afterAll, beforeAll, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../helpers/supabase";
import { type TestActor, type TestBox, createTestActor, createTestBox, createTestPart, describeDb } from "./fixtures";
import { addManualCartLine, updateCartLine } from "@/lib/orders/core";
import { checkoutCart } from "@/lib/orders/checkout";
import { TABLES } from "@/types/db";

/**
 * INVARIANT — order-number (PO) uniqueness (plan/TESTING.md §5.5 + §6 Q-06 ·
 * FEATURES.md §16 "order-number uniqueness"). Split out from the
 * forward-statuses bullet into its own file per the R2-29 skeleton list.
 * "Checkout groups by distributor → one order per group with its website
 * order number (required, unique)."
 * Canonical shape: SCHEMA.md `smark_orders.po_number` — "the website's order
 * number (required, UNIQUE — used to match deliveries)"; placing an order
 * auto-creates a draft `smark_expenses` row [Q-09] via `source_order_id`.
 * Applies at: DB (UNIQUE constraint — also covered from the migration angle
 * in tests/integration/db-schema.test.ts), API (checkout route — one
 * required po_number per distributor group).
 *
 * DB-backed (`describeDb`), exercised through `lib/orders/checkout.ts`'s
 * real `checkoutCart` — the only path this package's app code has to create
 * an order.
 */
describeDb("invariant: PO (order number) uniqueness", () => {
  let service: SupabaseClient;
  let actor: TestActor;
  let box: TestBox;

  beforeAll(async () => {
    service = createServiceClient();
    actor = await createTestActor(service, "owner");
    box = await createTestBox(service);
  });

  afterAll(async () => {
    await box.cleanup();
    await actor.cleanup();
  });

  function tag(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  async function createDistributor(): Promise<{ id: string; cleanup: () => Promise<void> }> {
    const { data, error } = await service
      .from(TABLES.distributors)
      .insert({ name: `PoUniqDist-${tag()}`, api_type: "none" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createDistributor failed: ${error?.message}`);
    return {
      id: data.id,
      cleanup: async () => {
        await service.from(TABLES.distributors).delete().eq("id", data.id);
      },
    };
  }

  /** A priced, open, distributor-assigned cart line — ready to check out. */
  async function createReadyCartLine(partId: string, distributorId: string, unitPrice = 12.5) {
    const added = await addManualCartLine(service, actor.id, { partId, qty: 4 });
    if (!added.ok) throw new Error(added.error);
    const updated = await updateCartLine(service, { cartItemId: added.cartItemId, distributorId, unitPrice });
    if (!updated.ok) throw new Error(updated.error);
    return added.cartItemId;
  }

  async function cleanupOrderTraces(cartItemIds: readonly string[], distributorId: string) {
    const { data: lines } = await service.from(TABLES.order_lines).select("order_id").in("cart_item_id", cartItemIds);
    const orderIds = Array.from(new Set((lines ?? []).map((l) => l.order_id)));
    if (orderIds.length > 0) {
      await service.from(TABLES.expenses).delete().in("source_order_id", orderIds);
      await service.from(TABLES.order_lines).delete().in("order_id", orderIds);
      await service.from(TABLES.orders).delete().in("id", orderIds);
    }
    await service.from(TABLES.cart_items).delete().in("id", cartItemIds);
    await service.from(TABLES.distributors).delete().eq("id", distributorId);
  }

  test(
    "checkout API rejects a distributor group submitted without a po_number (400 'PO required'), never creates a draft order",
    async () => {
      const part = await createTestPart(service);
      const distributor = await createDistributor();
      const cartItemId = await createReadyCartLine(part.id, distributor.id);

      try {
        const { data: ordersBefore } = await service.from(TABLES.orders).select("id").eq("distributor_id", distributor.id);
        expect(ordersBefore ?? []).toHaveLength(0);

        const { results } = await checkoutCart(service, actor.id, "owner", [
          { distributorId: distributor.id, cartItemIds: [cartItemId], poNumber: "   " },
        ]);
        expect(results[0]!.ok).toBe(false);
        expect(results[0]!.error).toBe("Enter the distributor's order number.");

        const { data: ordersAfter } = await service.from(TABLES.orders).select("id").eq("distributor_id", distributor.id);
        expect(ordersAfter ?? []).toHaveLength(0);

        const { data: line } = await service.from(TABLES.cart_items).select("status").eq("id", cartItemId).single();
        expect(line!.status).toBe("open");
      } finally {
        await cleanupOrderTraces([cartItemId], distributor.id);
        await part.cleanup();
      }
    },
  );

  test(
    "smark_orders.po_number is globally UNIQUE — a second order reusing an existing po_number is rejected, even across different distributors or unrelated checkout sessions",
    async () => {
      const partA = await createTestPart(service);
      const partB = await createTestPart(service);
      const distA = await createDistributor();
      const distB = await createDistributor();
      const itemA = await createReadyCartLine(partA.id, distA.id);
      const itemB = await createReadyCartLine(partB.id, distB.id);
      const poNumber = `SHARED-PO-${tag()}`;

      try {
        const first = await checkoutCart(service, actor.id, "owner", [{ distributorId: distA.id, cartItemIds: [itemA], poNumber }]);
        expect(first.results[0]!.ok).toBe(true);

        const second = await checkoutCart(service, actor.id, "owner", [{ distributorId: distB.id, cartItemIds: [itemB], poNumber }]);
        expect(second.results[0]!.ok).toBe(false);
        expect(second.results[0]!.error).toBe(`Order number "${poNumber}" is already used.`);

        // The rejected group's cart line stays open — never flipped.
        const { data: line } = await service.from(TABLES.cart_items).select("status").eq("id", itemB).single();
        expect(line!.status).toBe("open");
      } finally {
        await cleanupOrderTraces([itemA], distA.id);
        await cleanupOrderTraces([itemB], distB.id);
        await partA.cleanup();
        await partB.cleanup();
      }
    },
  );

  test(
    "a multi-distributor checkout [Q-06] requires N distinct po_numbers for N distributor groups — one missing/duplicate value blocks only that group's order, not the whole checkout",
    async () => {
      const partX = await createTestPart(service);
      const partY = await createTestPart(service);
      const distX = await createDistributor();
      const distY = await createDistributor();
      const itemX = await createReadyCartLine(partX.id, distX.id);
      const itemY = await createReadyCartLine(partY.id, distY.id);

      try {
        const { results } = await checkoutCart(service, actor.id, "owner", [
          { distributorId: distX.id, cartItemIds: [itemX], poNumber: `PO-OK-${tag()}` },
          { distributorId: distY.id, cartItemIds: [itemY], poNumber: "" },
        ]);
        expect(results[0]!.ok).toBe(true);
        expect(results[1]!.ok).toBe(false);

        const { data: itemXRow } = await service.from(TABLES.cart_items).select("status").eq("id", itemX).single();
        const { data: itemYRow } = await service.from(TABLES.cart_items).select("status").eq("id", itemY).single();
        expect(itemXRow!.status).toBe("ordered"); // placed
        expect(itemYRow!.status).toBe("open"); // stayed in cart
      } finally {
        await cleanupOrderTraces([itemX], distX.id);
        await cleanupOrderTraces([itemY], distY.id);
        await partX.cleanup();
        await partY.cleanup();
      }
    },
  );

  test(
    "editing an existing order's po_number to collide with a different order's po_number is rejected on UPDATE, not just on INSERT",
    async () => {
      const suffix = tag();
      const distributor = await createDistributor();
      const { data: orderA, error: aError } = await service
        .from(TABLES.orders)
        .insert({ distributor_id: distributor.id, po_number: `PO-A-${suffix}`, placed_by: actor.id })
        .select("id")
        .single();
      if (aError || !orderA) throw new Error(`order A insert failed: ${aError?.message}`);
      const { data: orderB, error: bError } = await service
        .from(TABLES.orders)
        .insert({ distributor_id: distributor.id, po_number: `PO-B-${suffix}`, placed_by: actor.id })
        .select("id")
        .single();
      if (bError || !orderB) throw new Error(`order B insert failed: ${bError?.message}`);

      try {
        const update = await service.from(TABLES.orders).update({ po_number: `PO-A-${suffix}` }).eq("id", orderB.id);
        expect(update.error).not.toBeNull();

        const { data: reread } = await service.from(TABLES.orders).select("po_number").eq("id", orderB.id).single();
        expect(reread!.po_number).toBe(`PO-B-${suffix}`); // unchanged
      } finally {
        await service.from(TABLES.orders).delete().in("id", [orderA.id, orderB.id]);
        await distributor.cleanup();
      }
    },
  );

  test(
    "a rejected duplicate-PO submission never creates the auto-draft smark_expenses row — the PO-unique check runs BEFORE the draft-expense side effect [Q-09], so a failed checkout leaves zero orphaned draft expenses",
    async () => {
      const partA = await createTestPart(service);
      const partB = await createTestPart(service);
      const distA = await createDistributor();
      const distB = await createDistributor();
      const itemA = await createReadyCartLine(partA.id, distA.id, 50);
      const itemB = await createReadyCartLine(partB.id, distB.id, 50);
      const poNumber = `DRAFT-PO-${tag()}`;

      try {
        const first = await checkoutCart(service, actor.id, "owner", [{ distributorId: distA.id, cartItemIds: [itemA], poNumber }]);
        expect(first.results[0]!.ok).toBe(true);
        const { count: expensesAfterFirst } = await service
          .from(TABLES.expenses)
          .select("id", { count: "exact", head: true })
          .eq("source_order_id", first.results[0]!.orderId!);
        expect(expensesAfterFirst).toBe(1);

        const second = await checkoutCart(service, actor.id, "owner", [{ distributorId: distB.id, cartItemIds: [itemB], poNumber }]);
        expect(second.results[0]!.ok).toBe(false);

        // The duplicate attempt created no order at all, so no draft expense could reference one.
        const { data: ordersB } = await service.from(TABLES.orders).select("id").eq("distributor_id", distB.id);
        expect(ordersB ?? []).toHaveLength(0);
        const { count: totalDrafts } = await service
          .from(TABLES.expenses)
          .select("id", { count: "exact", head: true })
          .eq("note", `PO ${poNumber}`);
        expect(totalDrafts).toBe(1); // only the first (successful) group's draft
      } finally {
        await cleanupOrderTraces([itemA], distA.id);
        await cleanupOrderTraces([itemB], distB.id);
        await partA.cleanup();
        await partB.cleanup();
      }
    },
  );

  test(
    "successful PO placement stamps source_order_id on its draft expense, and that link is 1:1 (no two draft expenses point at the same order)",
    async () => {
      const part = await createTestPart(service);
      const distributor = await createDistributor();
      const cartItemId = await createReadyCartLine(part.id, distributor.id, 25);

      try {
        const { results } = await checkoutCart(service, actor.id, "owner", [
          { distributorId: distributor.id, cartItemIds: [cartItemId], poNumber: `PO-${tag()}` },
        ]);
        expect(results[0]!.ok).toBe(true);
        const orderId = results[0]!.orderId!;

        const { data: drafts } = await service.from(TABLES.expenses).select("*").eq("source_order_id", orderId);
        expect(drafts).toHaveLength(1);
        expect(drafts![0]!.source_order_id).toBe(orderId);
        expect(drafts![0]!.is_draft).toBe(true);
        expect(drafts![0]!.amount).toBe(4 * 25);
      } finally {
        await cleanupOrderTraces([cartItemId], distributor.id);
        await part.cleanup();
      }
    },
  );
});
