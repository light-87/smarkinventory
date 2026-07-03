import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, hasLocalSupabase } from "../helpers/supabase";
import { createTestActor, createTestBox, createTestPart, readTotalQty, type TestActor, type TestBox } from "../invariants/fixtures";
import { assignOnboardingLocation, createNewPart, putAwayArrivalLine, topUpExistingPart } from "@/lib/receive/core";
import { TABLES, type Database } from "@/types/db";

/**
 * Integration coverage for lib/receive/core.ts — the actual write path behind
 * the Receive surface's three flat cards + onboarding queue (plan/tab-receive.md).
 * tests/invariants/print-rule.test.ts already pins the DB-level guarantee
 * (`smark_qr_labels_one_per_target` unique index); this suite exercises the
 * real application code that walks up to that boundary (duplicate guard,
 * storage resolution, movement/event writes, last_unit_price stamping).
 *
 * `describe.skip` (not `describeDb`, which lives in ../invariants/fixtures —
 * a sibling package's file) mirrors the same gate inline so this file has no
 * cross-package import dependency beyond the shared, integrator-owned
 * tests/helpers/supabase.ts.
 */
const describeDb = hasLocalSupabase ? describe : describe.skip;

describeDb("lib/receive/core", () => {
  // Constructed inside `beforeAll`, NOT at the describe-body top level: Bun
  // still executes a skipped describe's callback body to collect its tests,
  // so building the service client eagerly here throws (no env → no local
  // stack) even when `describeDb` resolved to `describe.skip` — turning an
  // intentional skip into an unhandled error that fails the whole `bun test`
  // run. Every sibling DB suite (tests/invariants/*.test.ts) already does it
  // this way.
  let service: SupabaseClient<Database>;
  let actor: TestActor;
  let box: TestBox;

  /**
   * Deletes a part and every row that can reference it, in FK-safe order.
   * Every function under test here writes `smark_part_events` (the "receive"
   * event, a `price_change` event, or a `location_moved` event) alongside
   * `smark_movements` — `tests/invariants/fixtures.ts`'s own `TestPart.cleanup()`
   * doesn't delete `smark_part_events`, so it silently fails to delete the
   * parent `smark_parts` row (FK, no cascade — migration 0002) whenever a test
   * here has written one. Using this everywhere instead avoids leaking rows
   * into the shared local/dev database on every test run.
   */
  async function deletePart(partId: string): Promise<void> {
    await service.from(TABLES.qr_labels).delete().eq("target_type", "part").eq("target_id", partId);
    await service.from(TABLES.part_events).delete().eq("part_id", partId);
    await service.from(TABLES.movements).delete().eq("part_id", partId);
    await service.from(TABLES.stock_locations).delete().eq("part_id", partId);
    await service.from(TABLES.parts).delete().eq("id", partId);
  }

  beforeAll(async () => {
    service = createServiceClient() as SupabaseClient<Database>;
    actor = await createTestActor(service, "owner");
    box = await createTestBox(service);
    await service.from(TABLES.big_boxes).update({ category: "Capacitor" }).eq("id", box.boxId);
  });

  afterAll(async () => {
    await box.cleanup();
    await actor.cleanup();
  });

  test("createNewPart: creates the part, a stock location, a receive movement, and queues one label", async () => {
    const result = await createNewPart(service, actor.id, {
      category: "Capacitor",
      value: `${randomUUID()}nF`,
      voltage: "50V",
      package: "0603",
      qty: 250,
      mpn: null,
      manufacturer: null,
      customFields: { tolerance: "±5%" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await readTotalQty(service, result.partId)).toBe(250);

    const { data: part } = await service.from(TABLES.parts).select("attributes").eq("id", result.partId).single();
    expect((part?.attributes as Record<string, unknown>)?.tolerance).toBe("±5%");

    const { data: movements } = await service.from(TABLES.movements).select("*").eq("part_id", result.partId);
    expect(movements?.length).toBe(1);
    expect(movements?.[0]?.reason).toBe("receive");
    expect(movements?.[0]?.delta_qty).toBe(250);

    const { data: events } = await service.from(TABLES.part_events).select("*").eq("part_id", result.partId);
    expect(events?.length).toBe(1);
    expect(events?.[0]?.event_type).toBe("received");

    const { data: labels } = await service
      .from(TABLES.qr_labels)
      .select("*")
      .eq("target_type", "part")
      .eq("target_id", result.partId);
    expect(labels?.length).toBe(1);
    expect(labels?.[0]?.print_status).toBe("queued");

    await deletePart(result.partId);
  });

  test("createNewPart: duplicate guard blocks a value+package match, 'force' creates anyway flagged needs_review", async () => {
    const value = `${randomUUID()}pF`;
    const first = await createNewPart(service, actor.id, {
      category: "Capacitor",
      value,
      voltage: null,
      package: "0402",
      qty: 100,
      mpn: null,
      manufacturer: null,
      customFields: {},
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await createNewPart(service, actor.id, {
      category: "Capacitor",
      value,
      voltage: null,
      package: "0402",
      qty: 40,
      mpn: null,
      manufacturer: null,
      customFields: {},
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.duplicate.partId).toBe(first.partId);
    expect(second.duplicate.method).toBe("value_pkg");

    const forced = await createNewPart(
      service,
      actor.id,
      { category: "Capacitor", value, voltage: null, package: "0402", qty: 40, mpn: null, manufacturer: null, customFields: {} },
      { force: true },
    );
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.partId).not.toBe(first.partId);

    const { data: forcedPart } = await service.from(TABLES.parts).select("needs_review").eq("id", forced.partId).single();
    expect(forcedPart?.needs_review).toBe(true);

    await deletePart(first.partId);
    await deletePart(forced.partId);
  });

  test("topUpExistingPart: adds qty to the existing location, writes a movement, queues NO label", async () => {
    const part = await createTestPart(service, { category: "Resistor", value: "10k", package: "0603" });
    await service.from(TABLES.stock_locations).insert({ part_id: part.id, big_box_id: box.boxId, qty: 30 });
    await service.from(TABLES.qr_labels).insert({ target_type: "part", target_id: part.id, code_value: `SMKTEST-${part.id}` });

    const { data: partRow } = await service.from(TABLES.parts).select("internal_pid").eq("id", part.id).single();

    const result = await topUpExistingPart(service, actor.id, { code: partRow!.internal_pid, qty: 70 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newQty).toBe(100);
    expect(await readTotalQty(service, part.id)).toBe(100);

    const { data: labels } = await service.from(TABLES.qr_labels).select("id").eq("target_type", "part").eq("target_id", part.id);
    expect(labels?.length).toBe(1); // unchanged — no reprint

    await deletePart(part.id);
  });

  test("topUpExistingPart: reports a clear error for an unknown PID", async () => {
    const result = await topUpExistingPart(service, actor.id, { code: "SMK-DOES-NOT-EXIST", qty: 5 });
    expect(result.ok).toBe(false);
  });

  test("putAwayArrivalLine: existing part top-up stamps last_unit_price and closes the line out", async () => {
    const part = await createTestPart(service, { category: "Capacitor", value: "1uF", package: "0805", last_unit_price: 2 });
    await service.from(TABLES.stock_locations).insert({ part_id: part.id, big_box_id: box.boxId, qty: 10 });

    const { data: distributor } = await service.from(TABLES.distributors).select("id").limit(1).single();
    const { data: order } = await service
      .from(TABLES.orders)
      .insert({ distributor_id: distributor!.id, po_number: `RC-${randomUUID().slice(0, 12)}`, status: "ordered" })
      .select("id")
      .single();
    const { data: line } = await service
      .from(TABLES.order_lines)
      .insert({ order_id: order!.id, part_id: part.id, qty_ordered: 40, unit_price: 3.5, line_status: "arrived" })
      .select("id")
      .single();

    const result = await putAwayArrivalLine(service, actor.id, { orderLineId: line!.id, arrivedQty: 40 });
    expect(result.ok).toBe(true);

    expect(await readTotalQty(service, part.id)).toBe(50);

    const { data: updatedPart } = await service.from(TABLES.parts).select("last_unit_price").eq("id", part.id).single();
    expect(Number(updatedPart?.last_unit_price)).toBe(3.5);

    const { data: updatedLine } = await service
      .from(TABLES.order_lines)
      .select("line_status, arrived_qty, arrived_at")
      .eq("id", line!.id)
      .single();
    expect(updatedLine?.line_status).toBe("arrived");
    expect(updatedLine?.arrived_qty).toBe(40);
    expect(updatedLine?.arrived_at).not.toBeNull();

    const { data: priceEvents } = await service.from(TABLES.part_events).select("*").eq("part_id", part.id).eq("event_type", "price_change");
    expect(priceEvents?.length).toBe(1);
    expect(Number(priceEvents?.[0]?.price_old)).toBe(2);
    expect(Number(priceEvents?.[0]?.price_new)).toBe(3.5);

    await service.from(TABLES.order_lines).delete().eq("id", line!.id);
    await service.from(TABLES.orders).delete().eq("id", order!.id);
    await deletePart(part.id);
  });

  test("putAwayArrivalLine: a never-catalogued line creates one part + one queued label", async () => {
    const { data: distributor } = await service.from(TABLES.distributors).select("id").limit(1).single();
    const { data: order } = await service
      .from(TABLES.orders)
      .insert({ distributor_id: distributor!.id, po_number: `RC-${randomUUID().slice(0, 12)}`, status: "ordered" })
      .select("id")
      .single();
    const { data: cartItem } = await service
      .from(TABLES.cart_items)
      .insert({ part_id: null, descriptor: { mpn: `MPN-${randomUUID()}`, value: "22uF", package: "1206" }, source: "manual", qty_to_order: 60 })
      .select("id")
      .single();
    const { data: line } = await service
      .from(TABLES.order_lines)
      .insert({ order_id: order!.id, cart_item_id: cartItem!.id, part_id: null, qty_ordered: 60, unit_price: 1.1, line_status: "arrived" })
      .select("id")
      .single();

    const result = await putAwayArrivalLine(service, actor.id, { orderLineId: line!.id, arrivedQty: 60 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.labelQueued).toBe(true);
    expect(await readTotalQty(service, result.partId)).toBe(60);

    const { data: labels } = await service.from(TABLES.qr_labels).select("id").eq("target_type", "part").eq("target_id", result.partId);
    expect(labels?.length).toBe(1);

    await service.from(TABLES.order_lines).delete().eq("id", line!.id);
    await service.from(TABLES.cart_items).delete().eq("id", cartItem!.id);
    await service.from(TABLES.orders).delete().eq("id", order!.id);
    await deletePart(result.partId);
  });

  test("assignOnboardingLocation: places the imported qty, clears needs_review, queues one label — idempotent on retry", async () => {
    const part = await createTestPart(service, {
      category: "Capacitor",
      value: "4.7uF",
      package: "0805",
      total_qty: 500,
      needs_review: true,
    });

    const first = await assignOnboardingLocation(service, actor.id, { partId: part.id, boxId: box.boxId });
    expect(first.ok).toBe(true);

    const { data: locations } = await service.from(TABLES.stock_locations).select("qty").eq("part_id", part.id);
    expect(locations?.length).toBe(1);
    expect(locations?.[0]?.qty).toBe(500);

    const { data: reviewedPart } = await service.from(TABLES.parts).select("needs_review").eq("id", part.id).single();
    expect(reviewedPart?.needs_review).toBe(false);

    // Retry (e.g. a resubmitted request) must not double-place stock or double-queue the label.
    const second = await assignOnboardingLocation(service, actor.id, { partId: part.id, boxId: box.boxId });
    expect(second.ok).toBe(true);

    const { data: locationsAfter } = await service.from(TABLES.stock_locations).select("id").eq("part_id", part.id);
    expect(locationsAfter?.length).toBe(1);

    const { data: labels } = await service.from(TABLES.qr_labels).select("id").eq("target_type", "part").eq("target_id", part.id);
    expect(labels?.length).toBe(1);

    await deletePart(part.id);
  });
});
