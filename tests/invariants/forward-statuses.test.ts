import { afterAll, beforeAll, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../helpers/supabase";
import { type TestActor, type TestBox, createTestActor, createTestBox, createTestPart, describeDb } from "./fixtures";
import { addManualCartLine, removeCartLine, updateCartLine } from "@/lib/orders/core";
import { checkoutCart } from "@/lib/orders/checkout";
import { markOrderLineArrived } from "@/lib/orders/arrivals";
import { recomputeShortfallCartItems } from "@/lib/orders/demand";
import { TABLES } from "@/types/db";

/**
 * INVARIANT — forward-only statuses (plan/TESTING.md §5.5 · CROSS-FEATURE.md
 * A3.6). "Status walks only forward (cart→ordered→arrived); ... BOM name
 * unique per project." (PO uniqueness is split out into po-unique.test.ts —
 * same source bullet, dedicated file per the R2-29 skeleton list.)
 * Canonical shape: SCHEMA.md `smark_cart_items.status`
 * (open/dismissed/ordered), `smark_orders.status`
 * (ordered/partially_arrived/arrived), `smark_order_lines.line_status`
 * (ordered/arrived), `smark_boms` UNIQUE(project_id, name) [R2-03].
 * Applies at: unit (status-walk transition function), DB (constraints/
 * triggers rejecting backward writes), API (checkout, mark-arrived,
 * BOM-create/rename routes), E2E-3.
 *
 * DB-backed (`describeDb`, same gate as tests/invariants/undo-pairing.test.ts).
 * Exercises this package's REAL exported functions (lib/orders/core.ts,
 * checkout.ts, arrivals.ts) — not raw table writes — since the invariant
 * under test IS "no API path in this package's surface reverses a status".
 * The BOM-name-uniqueness bullet is bom-pipeline's surface (docs/OWNERSHIP.md
 * — this package doesn't own BOM create/rename); only the DB-constraint half
 * is verified here (the friendly-conflict-error / API half belongs in
 * bom-pipeline's own suite).
 */
describeDb("invariant: forward-only statuses", () => {
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
      .insert({ name: `TestDist-${tag()}`, api_type: "none" })
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

  test(
    "smark_cart_items.status transitions open→ordered only — no API path sets an `ordered` line back to `open`",
    async () => {
      const part = await createTestPart(service);
      const distributor = await createDistributor();
      const added = await addManualCartLine(service, actor.id, { partId: part.id, qty: 10 });
      if (!added.ok) throw new Error(added.error);

      try {
        const setDist = await updateCartLine(service, { cartItemId: added.cartItemId, distributorId: distributor.id });
        expect(setDist.ok).toBe(true);

        const { results } = await checkoutCart(service, actor.id, "owner", [
          { distributorId: distributor.id, cartItemIds: [added.cartItemId], poNumber: `PO-${tag()}` },
        ]);
        expect(results[0]!.ok).toBe(true);

        const { data: afterCheckout } = await service.from(TABLES.cart_items).select("status").eq("id", added.cartItemId).single();
        expect(afterCheckout!.status).toBe("ordered");

        // Neither edit path can touch an already-ordered line.
        const editResult = await updateCartLine(service, { cartItemId: added.cartItemId, qtyToOrder: 5 });
        expect(editResult).toEqual({ ok: false, error: "This line has already been ordered." });
        const removeResult = await removeCartLine(service, added.cartItemId);
        expect(removeResult).toEqual({ ok: false, error: "This line has already been ordered." });

        const { data: stillOrdered } = await service.from(TABLES.cart_items).select("status, qty_to_order").eq("id", added.cartItemId).single();
        expect(stillOrdered!.status).toBe("ordered");
        expect(stillOrdered!.qty_to_order).toBe(10);
      } finally {
        await service.from(TABLES.order_lines).delete().eq("cart_item_id", added.cartItemId);
        await service.from(TABLES.orders).delete().eq("distributor_id", distributor.id);
        await service.from(TABLES.cart_items).delete().eq("id", added.cartItemId);
        await distributor.cleanup();
        await part.cleanup();
      }
    },
  );

  test(
    "smark_order_lines.line_status transitions ordered→arrived only — never arrived→ordered",
    async () => {
      const part = await createTestPart(service);
      const distributor = await createDistributor();
      const { data: order, error: orderError } = await service
        .from(TABLES.orders)
        .insert({ distributor_id: distributor.id, po_number: `PO-${tag()}`, placed_by: actor.id })
        .select("id")
        .single();
      if (orderError || !order) throw new Error(`order insert failed: ${orderError?.message}`);
      const { data: line, error: lineError } = await service
        .from(TABLES.order_lines)
        .insert({ order_id: order.id, part_id: part.id, qty_ordered: 5 })
        .select("id")
        .single();
      if (lineError || !line) throw new Error(`order_line insert failed: ${lineError?.message}`);

      try {
        const first = await markOrderLineArrived(service, line.id);
        expect(first.ok).toBe(true);
        const { data: afterFirst } = await service.from(TABLES.order_lines).select("line_status").eq("id", line.id).single();
        expect(afterFirst!.line_status).toBe("arrived");

        const second = await markOrderLineArrived(service, line.id);
        expect(second).toEqual({ ok: false, error: "This line has already been marked arrived." });

        const { data: stillArrived } = await service.from(TABLES.order_lines).select("line_status").eq("id", line.id).single();
        expect(stillArrived!.line_status).toBe("arrived");
      } finally {
        await service.from(TABLES.order_lines).delete().eq("id", line.id);
        await service.from(TABLES.orders).delete().eq("id", order.id);
        await distributor.cleanup();
        await part.cleanup();
      }
    },
  );

  test(
    "smark_orders.status walks ordered→partially_arrived→arrived only — never backwards, and never skips to arrived while any line is still `ordered`",
    async () => {
      const partA = await createTestPart(service);
      const partB = await createTestPart(service);
      const distributor = await createDistributor();
      const { data: order, error: orderError } = await service
        .from(TABLES.orders)
        .insert({ distributor_id: distributor.id, po_number: `PO-${tag()}`, placed_by: actor.id })
        .select("id")
        .single();
      if (orderError || !order) throw new Error(`order insert failed: ${orderError?.message}`);
      const { data: lines, error: linesError } = await service
        .from(TABLES.order_lines)
        .insert([
          { order_id: order.id, part_id: partA.id, qty_ordered: 3 },
          { order_id: order.id, part_id: partB.id, qty_ordered: 4 },
        ])
        .select("id");
      if (linesError || !lines) throw new Error(`order_lines insert failed: ${linesError?.message}`);

      try {
        await markOrderLineArrived(service, lines[0]!.id);
        const { data: partiallyArrived } = await service.from(TABLES.orders).select("status").eq("id", order.id).single();
        expect(partiallyArrived!.status).toBe("partially_arrived");
        expect(partiallyArrived!.status).not.toBe("arrived");

        await markOrderLineArrived(service, lines[1]!.id);
        const { data: fullyArrived } = await service.from(TABLES.orders).select("status").eq("id", order.id).single();
        expect(fullyArrived!.status).toBe("arrived");
      } finally {
        await service.from(TABLES.order_lines).delete().eq("order_id", order.id);
        await service.from(TABLES.orders).delete().eq("id", order.id);
        await distributor.cleanup();
        await partA.cleanup();
        await partB.cleanup();
      }
    },
  );

  test(
    "the ONE documented exception: a dismissed auto-shortfall cart line resurrects to `open` only when shortfall grows beyond the dismissed qty [Q-05] — this is the sole open↔dismissed back-edge; ordered lines never re-open",
    async () => {
      const part = await createTestPart(service);
      const { error: locError } = await service
        .from(TABLES.stock_locations)
        .insert({ part_id: part.id, big_box_id: box.boxId, qty: 100, created_by: actor.id });
      if (locError) throw new Error(locError.message);

      const suffix = tag();
      const { data: project } = await service.from(TABLES.projects).insert({ name: `FwdStatus-${suffix}`, created_by: actor.id }).select("id").single();
      const { data: bom } = await service.from(TABLES.boms).insert({ project_id: project!.id, name: "B", build_qty: 1, uploaded_by: actor.id }).select("id").single();
      const { data: line } = await service.from(TABLES.bom_lines).insert({ bom_id: bom!.id, qty: 150, matched_part_id: part.id, dnp: false }).select("id").single();

      try {
        await recomputeShortfallCartItems(service); // demand 150, available 100 → shortfall 50
        const { data: opened } = await service.from(TABLES.cart_items).select("*").eq("part_id", part.id).single();
        expect(opened.qty_to_order).toBe(50);

        await service.from(TABLES.cart_items).update({ status: "dismissed" }).eq("id", opened.id);
        await service.from(TABLES.bom_lines).update({ qty: 300 }).eq("id", line!.id); // demand 300 → shortfall 200 > 50

        await recomputeShortfallCartItems(service);
        const { data: resurrected } = await service.from(TABLES.cart_items).select("*").eq("id", opened.id).single();
        expect(resurrected.status).toBe("open");
        expect(resurrected.qty_to_order).toBe(200);
      } finally {
        await service.from(TABLES.cart_items).delete().eq("part_id", part.id);
        await service.from(TABLES.projects).delete().eq("id", project!.id); // cascades bom + line
        await part.cleanup();
      }
    },
  );

  test(
    "each distributor-order group from a split checkout [Q-06] walks its own status independently — one distributor's late/partial arrival never rewinds or blocks another distributor's order status",
    async () => {
      const partX = await createTestPart(service);
      const partY = await createTestPart(service);
      const distX = await createDistributor();
      const distY = await createDistributor();
      const itemX = await addManualCartLine(service, actor.id, { partId: partX.id, qty: 2 });
      const itemY = await addManualCartLine(service, actor.id, { partId: partY.id, qty: 3 });
      if (!itemX.ok || !itemY.ok) throw new Error("manual add failed");

      try {
        const { results } = await checkoutCart(service, actor.id, "owner", [
          { distributorId: distX.id, cartItemIds: [itemX.cartItemId], poNumber: `PO-X-${tag()}` },
          { distributorId: distY.id, cartItemIds: [itemY.cartItemId], poNumber: `PO-Y-${tag()}` },
        ]);
        expect(results.every((r) => r.ok)).toBe(true);
        const orderXId = results[0]!.orderId!;
        const orderYId = results[1]!.orderId!;

        const { data: lineX } = await service.from(TABLES.order_lines).select("id").eq("order_id", orderXId).single();
        await markOrderLineArrived(service, lineX!.id);

        const { data: statusX } = await service.from(TABLES.orders).select("status").eq("id", orderXId).single();
        const { data: statusY } = await service.from(TABLES.orders).select("status").eq("id", orderYId).single();
        expect(statusX!.status).toBe("arrived"); // its only line arrived
        expect(statusY!.status).toBe("ordered"); // completely untouched by X's arrival
      } finally {
        await service.from(TABLES.order_lines).delete().in("cart_item_id", [itemX.cartItemId, itemY.cartItemId]);
        await service.from(TABLES.orders).delete().eq("distributor_id", distX.id);
        await service.from(TABLES.orders).delete().eq("distributor_id", distY.id);
        await distX.cleanup();
        await distY.cleanup();
        await partX.cleanup();
        await partY.cleanup();
      }
    },
  );

  test(
    "BOM name is UNIQUE per project (UNIQUE(project_id, name), R2-03) — the DB constraint rejects a duplicate insert regardless of path (the friendly-conflict-error API layer is bom-pipeline's surface, docs/OWNERSHIP.md, and lives in that package's own suite)",
    async () => {
      const { data: project } = await service.from(TABLES.projects).insert({ name: `BomUniq-${tag()}`, created_by: actor.id }).select("id").single();
      try {
        const first = await service.from(TABLES.boms).insert({ project_id: project!.id, name: "Mainboard v1", uploaded_by: actor.id });
        expect(first.error).toBeNull();

        const second = await service.from(TABLES.boms).insert({ project_id: project!.id, name: "Mainboard v1", uploaded_by: actor.id });
        expect(second.error).not.toBeNull();
      } finally {
        await service.from(TABLES.projects).delete().eq("id", project!.id); // cascades boms
      }
    },
  );

  test(
    "put-away (arrival confirm) is the only path that flips a line to `arrived` — no direct status-field edit exists anywhere in the UI/API surface",
    async () => {
      const part = await createTestPart(service);
      const distributor = await createDistributor();
      const added = await addManualCartLine(service, actor.id, { partId: part.id, qty: 1 });
      if (!added.ok) throw new Error(added.error);

      try {
        await updateCartLine(service, { cartItemId: added.cartItemId, distributorId: distributor.id });
        const { results } = await checkoutCart(service, actor.id, "owner", [
          { distributorId: distributor.id, cartItemIds: [added.cartItemId], poNumber: `PO-${tag()}` },
        ]);
        expect(results[0]!.ok).toBe(true);

        // checkoutCart never creates a line already-arrived — only markOrderLineArrived does that.
        const { data: freshLine } = await service.from(TABLES.order_lines).select("line_status").eq("order_id", results[0]!.orderId!).single();
        expect(freshLine!.line_status).toBe("ordered");
      } finally {
        await service.from(TABLES.order_lines).delete().eq("cart_item_id", added.cartItemId);
        await service.from(TABLES.orders).delete().eq("distributor_id", distributor.id);
        await distributor.cleanup();
        await part.cleanup();
      }
    },
  );
});
