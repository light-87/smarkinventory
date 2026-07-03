import { afterAll, beforeAll, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../helpers/supabase";
import {
  type TestBox,
  createTestBox,
  createTestPart,
  describeDb,
  readTotalQty,
  sumLocationQty,
} from "./fixtures";

/**
 * INVARIANT — qty rollup property (plan/TESTING.md §5.3 · CROSS-FEATURE.md
 * A3.4). "`total_qty` always equals Σ locations (property-based checks
 * after random op sequences)."
 * Canonical shape: SCHEMA.md `smark_parts.total_qty` (denormalized rollup
 * over `smark_stock_locations`), trigger-maintained by
 * `smark_sync_part_total_qty()` / `smark_recompute_part_total_qty()`
 * (0002_catalog_location.sql).
 *
 * DB-backed suite — this invariant is fully testable against the SCHEMA
 * alone (the trigger, not any app write-path, is what's under test), so
 * every test here writes directly to `smark_stock_locations` via the
 * service-role client and asserts `smark_parts.total_qty` against a
 * from-scratch `SUM(qty)` re-query — never trusting the same code path
 * twice.
 */
describeDb("invariant: qty rollup", () => {
  let service: SupabaseClient;
  let boxes: TestBox[];

  beforeAll(async () => {
    service = createServiceClient();
    // Five distinct boxes — enough locations for the property test's random
    // create/update/delete/move sequence and the multi-location case.
    boxes = await Promise.all([1, 2, 3, 4, 5].map(() => createTestBox(service)));
  });

  afterAll(async () => {
    await Promise.all(boxes.map((b) => b.cleanup()));
  });

  async function expectRollupInSync(partId: string) {
    const [total, sum] = await Promise.all([readTotalQty(service, partId), sumLocationQty(service, partId)]);
    expect(total).toBe(sum);
    return total;
  }

  test(
    "property: after any random sequence of receive/pick/adjust/bulk_pick/undo-shaped ops on a part, smark_parts.total_qty === SUM(smark_stock_locations.qty) for that part",
    async () => {
      const part = await createTestPart(service);
      // Deterministic PRNG (mulberry32) — reproducible failures, no test flake
      // from Math.random(), and no extra dependency.
      let state = 0x2f6e2b1;
      const rand = () => {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };

      // locationId per box slot — undefined until first "receive" creates it.
      const locationIds: (string | undefined)[] = boxes.map(() => undefined);
      const qtyInBox: number[] = boxes.map(() => 0);

      const OPS = 40;
      for (let i = 0; i < OPS; i += 1) {
        const slot = Math.floor(rand() * boxes.length);
        const box = boxes[slot]!;
        const existingId = locationIds[slot];

        if (existingId === undefined) {
          // "receive" — first stock into this box creates the location row.
          const qty = 1 + Math.floor(rand() * 20);
          const { data, error } = await service
            .from("smark_stock_locations")
            .insert({ part_id: part.id, big_box_id: box.boxId, qty })
            .select("id")
            .single();
          expect(error).toBeNull();
          locationIds[slot] = (data as { id: string }).id;
          qtyInBox[slot] = qty;
        } else {
          const action = rand();
          if (action < 0.6) {
            // "pick"/"adjust" — move qty up or down, never below zero.
            const current = qtyInBox[slot]!;
            const delta = Math.floor(rand() * 10) - 4; // -4..+5
            const next = Math.max(0, current + delta);
            const { error } = await service
              .from("smark_stock_locations")
              .update({ qty: next })
              .eq("id", existingId);
            expect(error).toBeNull();
            qtyInBox[slot] = next;
          } else {
            // "location cleared" — emptied box's ESD plastic removed.
            const { error } = await service.from("smark_stock_locations").delete().eq("id", existingId);
            expect(error).toBeNull();
            locationIds[slot] = undefined;
            qtyInBox[slot] = 0;
          }
        }

        // The invariant must hold after EVERY single op, not just at the end.
        const rolledUp = await expectRollupInSync(part.id);
        const expected = qtyInBox.reduce((sum, q) => sum + q, 0);
        expect(rolledUp).toBe(expected);
      }

      await part.cleanup();
    },
  );

  test(
    "multi-location part (reel + working box, the documented 2-row case) rolls up as the SUM across both rows, not just the primary one",
    async () => {
      const part = await createTestPart(service);
      await service
        .from("smark_stock_locations")
        .insert({ part_id: part.id, big_box_id: boxes[0]!.boxId, qty: 1000, esd_note: "reel" });
      await service
        .from("smark_stock_locations")
        .insert({ part_id: part.id, big_box_id: boxes[1]!.boxId, qty: 37, esd_note: "working box" });

      expect(await readTotalQty(service, part.id)).toBe(1037);
      expect(await sumLocationQty(service, part.id)).toBe(1037);

      await part.cleanup();
    },
  );

  test(
    "total_qty never goes negative — a pick that would exceed available stock is rejected before the mutation is written, not clamped after",
    async () => {
      const part = await createTestPart(service);
      await service.from("smark_stock_locations").insert({ part_id: part.id, big_box_id: boxes[0]!.boxId, qty: 5 });
      expect(await readTotalQty(service, part.id)).toBe(5);

      const { error } = await service
        .from("smark_stock_locations")
        .update({ qty: -1 })
        .eq("part_id", part.id)
        .eq("big_box_id", boxes[0]!.boxId);

      // smark_stock_locations_qty_nonnegative CHECK rejects the write outright —
      // it is never persisted, so the rollup keeps its last-good value (not
      // silently clamped to 0 after the fact).
      expect(error).not.toBeNull();
      expect(await readTotalQty(service, part.id)).toBe(5);

      await part.cleanup();
    },
  );

  test(
    "concurrent movements against different locations of the same part serialize correctly — no lost update leaves total_qty out of sync",
    async () => {
      const part = await createTestPart(service);
      // One location per box, distinct rows — concurrent single-statement
      // INSERTs on DIFFERENT rows each fire the sync trigger independently;
      // the trigger recomputes total_qty from a fresh SUM each time, so the
      // final value must reflect every concurrent write, not just one of
      // them (plan/TESTING.md §5.3 — "concurrent movements against the same
      // part serialize correctly — no lost-update race").
      //
      // FIXED (supabase/migrations/0002_catalog_location.sql): the original
      // `smark_recompute_part_total_qty` ran a single uncorrelated `SET
      // total_qty = (SELECT SUM(qty) ...)` with no serialization, which
      // raced under concurrent writers — the last AFTER-trigger UPDATE to
      // commit could clobber an earlier one with a SUM computed before it
      // saw its siblings' commits.
      //
      // A first fix attempt (locking the `smark_parts` row `FOR UPDATE`
      // inside the recompute) turned out to deadlock: `smark_stock_locations
      // .part_id` FKs to `smark_parts.id`, so every concurrent INSERT/UPDATE
      // already holds a `FOR KEY SHARE` lock on that row for the life of its
      // OWN transaction (Postgres's FK-check locking); N transactions each
      // holding `FOR KEY SHARE` and then each trying to upgrade to `FOR
      // UPDATE` deadlock on each other.
      //
      // Actual fix: a BEFORE-trigger (`smark_lock_part_for_stock_sync`)
      // takes a transaction-scoped advisory lock (`pg_advisory_xact_lock`,
      // keyed by part_id, sorted when two ids are touched) before the row —
      // and Postgres's internal FK-check lock — is ever taken. Advisory
      // locks live in a separate lock space from row locks, so this
      // serializes concurrent writers to the SAME part's locations with no
      // lock-conflict cycle possible, and the AFTER-trigger recompute stays
      // a plain fresh-snapshot SUM + UPDATE.
      await Promise.all(
        boxes.map((box) =>
          service.from("smark_stock_locations").insert({ part_id: part.id, big_box_id: box.boxId, qty: 10 }),
        ),
      );
      expect(await readTotalQty(service, part.id)).toBe(50);

      await Promise.all(
        boxes.map((box, i) =>
          service
            .from("smark_stock_locations")
            .update({ qty: 10 + (i + 1) * 5 })
            .eq("part_id", part.id)
            .eq("big_box_id", box.boxId),
        ),
      );

      // 15+20+25+30+35 = 125
      const expected = boxes.reduce((sum, _b, i) => sum + 10 + (i + 1) * 5, 0);
      expect(await expectRollupInSync(part.id)).toBe(expected);

      await part.cleanup();
    },
  );

  test(
    "adjust movements (positive or negative delta) keep total_qty in sync the same way pick/receive/bulk_pick do",
    async () => {
      const part = await createTestPart(service);
      await service.from("smark_stock_locations").insert({ part_id: part.id, big_box_id: boxes[0]!.boxId, qty: 40 });
      expect(await readTotalQty(service, part.id)).toBe(40);

      await service
        .from("smark_stock_locations")
        .update({ qty: 55 }) // +15 adjust (found extra stock during audit)
        .eq("part_id", part.id)
        .eq("big_box_id", boxes[0]!.boxId);
      expect(await readTotalQty(service, part.id)).toBe(55);

      await service
        .from("smark_stock_locations")
        .update({ qty: 48 }) // -7 adjust (shrinkage)
        .eq("part_id", part.id)
        .eq("big_box_id", boxes[0]!.boxId);
      expect(await readTotalQty(service, part.id)).toBe(48);

      await part.cleanup();
    },
  );

  test(
    "undo of a location-level mutation restores total_qty to exactly its pre-mutation value (rollup angle of the undo-pairing invariant)",
    async () => {
      const part = await createTestPart(service);
      await service.from("smark_stock_locations").insert({ part_id: part.id, big_box_id: boxes[0]!.boxId, qty: 30 });
      const before = await readTotalQty(service, part.id);

      await service
        .from("smark_stock_locations")
        .update({ qty: 12 })
        .eq("part_id", part.id)
        .eq("big_box_id", boxes[0]!.boxId);
      expect(await readTotalQty(service, part.id)).toBe(12);

      // Undo restores the exact pre-mutation qty.
      await service
        .from("smark_stock_locations")
        .update({ qty: 30 })
        .eq("part_id", part.id)
        .eq("big_box_id", boxes[0]!.boxId);
      expect(await readTotalQty(service, part.id)).toBe(before);

      await part.cleanup();
    },
  );

  test(
    "a location_moved event (box reassignment) changes which big_box_id holds the qty but leaves the part's total_qty unchanged",
    async () => {
      const part = await createTestPart(service);
      const { data: location } = await service
        .from("smark_stock_locations")
        .insert({ part_id: part.id, big_box_id: boxes[0]!.boxId, qty: 22 })
        .select("id")
        .single();
      const before = await readTotalQty(service, part.id);

      await service
        .from("smark_stock_locations")
        .update({ big_box_id: boxes[1]!.boxId })
        .eq("id", (location as { id: string }).id);

      expect(await readTotalQty(service, part.id)).toBe(before);
      expect(await sumLocationQty(service, part.id)).toBe(22);

      await part.cleanup();
    },
  );

  test.todo(
    "Inventory/Part-detail/Shelves/Dashboard/Scan all read the same total_qty — no surface computes its own separate rollup",
    () => {
      // Not testable until those surfaces' code exists (owned by inventory/
      // part-detail/shelves/dashboard/scan packages). Once they land, the
      // enforceable version of this check is: grep each surface's query for
      // `smark_parts.total_qty` and flag any local SUM(qty)/reduce recompute
      // as a regression.
    },
  );
});
