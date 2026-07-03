import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../helpers/supabase";
import {
  type TestActor,
  type TestBox,
  createTestActor,
  createTestBox,
  createTestPart,
  describeDb,
  readTotalQty,
} from "./fixtures";
import { assertUndoable, MovementValidationError, recordMovement } from "@/lib/movements";
import type { MovementInput, UndoableMovement } from "@/lib/movements";
import { TABLES, type Database } from "@/types/db";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";

/**
 * INVARIANT — undo pairing (plan/TESTING.md §5.2 · CROSS-FEATURE.md A3.3 ·
 * FEATURES.md §9). "Every stock mutation writes a movement and is undoable
 * once (toast Undo / `undo_of` chain correct)."
 * Canonical shape: SCHEMA.md `smark_movements` (part_id, big_box_id,
 * delta_qty, reason: pick/receive/adjust/bulk_pick/undo, bom_id, actor,
 * undo_of nullable).
 *
 * DB-backed suite (SUPABASE_URL et al. required — `describeDb`, self-skips
 * without a local stack or with SKIP_DB_TESTS=1). Exercises the SCHEMA
 * guarantees directly (`smark_movements_undo_pairing`,
 * `smark_movements_undo_of_unique`, `smark_movements_reason_detail_check`,
 * the `smark_stock_locations` → `smark_parts.total_qty` sync trigger) by
 * writing rows the same shape the future `lib/movements` write path (scan
 * package, docs/OWNERSHIP.md) will produce. Once that module lands, the
 * scan package's own unit suite should additionally exercise it through the
 * real `lib/movements` import — these tests pin the DB-level half of the
 * contract, which holds regardless of which app code writes the rows.
 */
describeDb("invariant: undo pairing", () => {
  let service: SupabaseClient;
  let actorA: TestActor;
  let actorB: TestActor;
  let box: TestBox;

  beforeAll(async () => {
    service = createServiceClient();
    actorA = await createTestActor(service, "owner");
    actorB = await createTestActor(service, "employee");
    box = await createTestBox(service);
  });

  afterAll(async () => {
    await box.cleanup();
    await actorA.cleanup();
    await actorB.cleanup();
  });

  /** Inserts an original (non-undo) movement row. */
  async function insertMovement(opts: {
    partId: string;
    deltaQty: number;
    reason: "pick" | "receive" | "adjust" | "bulk_pick";
    actor: string;
    reasonDetail?: string | null;
  }) {
    const { data, error } = await service
      .from("smark_movements")
      .insert({
        part_id: opts.partId,
        big_box_id: box.boxId,
        delta_qty: opts.deltaQty,
        reason: opts.reason,
        reason_detail: opts.reasonDetail ?? null,
        actor: opts.actor,
      })
      .select("*")
      .single();
    return { data, error };
  }

  test(
    "undo creates a NEW movement row with delta_qty negated and undo_of = the original row's id — the original row is never mutated or deleted (append-only)",
    async () => {
      const part = await createTestPart(service);
      const { data: original, error: originalError } = await insertMovement({
        partId: part.id,
        deltaQty: -5,
        reason: "pick",
        actor: actorA.id,
      });
      expect(originalError).toBeNull();
      expect(original).not.toBeNull();

      const { data: undoRow, error: undoError } = await service
        .from("smark_movements")
        .insert({
          part_id: part.id,
          big_box_id: box.boxId,
          delta_qty: 5,
          reason: "undo",
          undo_of: (original as { id: string }).id,
          actor: actorA.id,
        })
        .select("*")
        .single();
      expect(undoError).toBeNull();
      expect((undoRow as { delta_qty: number }).delta_qty).toBe(5);
      expect((undoRow as { undo_of: string }).undo_of).toBe((original as { id: string }).id);

      // Original row is untouched — same delta_qty/reason it was written with.
      const { data: reread } = await service
        .from("smark_movements")
        .select("*")
        .eq("id", (original as { id: string }).id)
        .single();
      expect((reread as { delta_qty: number }).delta_qty).toBe(-5);
      expect((reread as { reason: string }).reason).toBe("pick");
      expect((reread as { undo_of: string | null }).undo_of).toBeNull();

      await part.cleanup();
    },
  );

  test(
    "undo stamps reason='undo' on the reversing row; the original row keeps its original reason (pick/receive/adjust/bulk_pick)",
    async () => {
      const part = await createTestPart(service);
      const { data: original } = await insertMovement({
        partId: part.id,
        deltaQty: 20,
        reason: "receive",
        actor: actorA.id,
      });

      const { data: undoRow, error } = await service
        .from("smark_movements")
        .insert({
          part_id: part.id,
          big_box_id: box.boxId,
          delta_qty: -20,
          reason: "undo",
          undo_of: (original as { id: string }).id,
          actor: actorA.id,
        })
        .select("*")
        .single();

      expect(error).toBeNull();
      expect((undoRow as { reason: string }).reason).toBe("undo");

      const { data: reread } = await service
        .from("smark_movements")
        .select("reason")
        .eq("id", (original as { id: string }).id)
        .single();
      expect((reread as { reason: string }).reason).toBe("receive");

      await part.cleanup();
    },
  );

  test(
    "a movement can be undone at most once — undoing an already-undone movement (undo_of already points at it) is rejected, not a silent no-op",
    async () => {
      const part = await createTestPart(service);
      const { data: original } = await insertMovement({
        partId: part.id,
        deltaQty: -3,
        reason: "pick",
        actor: actorA.id,
      });
      const originalId = (original as { id: string }).id;

      const first = await service
        .from("smark_movements")
        .insert({
          part_id: part.id,
          big_box_id: box.boxId,
          delta_qty: 3,
          reason: "undo",
          undo_of: originalId,
          actor: actorA.id,
        })
        .select("*")
        .single();
      expect(first.error).toBeNull();

      // Second undo attempt against the SAME original — smark_movements_undo_of_unique
      // (UNIQUE(undo_of)) must reject this, not silently succeed.
      const second = await service
        .from("smark_movements")
        .insert({
          part_id: part.id,
          big_box_id: box.boxId,
          delta_qty: 3,
          reason: "undo",
          undo_of: originalId,
          actor: actorB.id,
        })
        .select("*")
        .single();
      expect(second.error).not.toBeNull();
      expect(second.data).toBeNull();

      await part.cleanup();
    },
  );

  test("undo-of-undo is rejected — a movement whose reason='undo' cannot itself be undone (no undo chains)", () => {
    // NOT enforceable by the schema alone: `smark_movements_undo_pairing` only
    // checks `(reason = 'undo') = (undo_of is not null)` on the ROW ITSELF —
    // it has no cross-row lookup at the referenced undo_of target, so nothing
    // in the DB stops undo_of from pointing at a reason='undo' row. The scan
    // package's `lib/movements` (docs/OWNERSHIP.md) is the app-level guard:
    // `assertUndoable` rejects this BEFORE any query is sent — real
    // `undoMovement()` (lib/movements/service.ts) always calls this first.
    const undoMovementRow: UndoableMovement = {
      id: "undo-row-id",
      part_id: "part-id",
      big_box_id: "box-id",
      delta_qty: 5,
      reason: "undo",
      bom_id: null,
    };
    expect(() => assertUndoable(undoMovementRow, new Set())).toThrow(MovementValidationError);
    expect(() => assertUndoable(undoMovementRow, new Set())).toThrow(/no undo chains/);
  });

  test(
    "an undo pair nets to zero: total_qty after undo equals total_qty immediately before the original mutation",
    async () => {
      const part = await createTestPart(service);
      await service.from("smark_stock_locations").insert({
        part_id: part.id,
        big_box_id: box.boxId,
        qty: 10,
      });
      const beforeQty = await readTotalQty(service, part.id);
      expect(beforeQty).toBe(10);

      // Original mutation: pick 4 (movement row + the location-qty half of the
      // future write path, simulated directly per this file's header note).
      const { data: original } = await insertMovement({
        partId: part.id,
        deltaQty: -4,
        reason: "pick",
        actor: actorA.id,
      });
      await service
        .from("smark_stock_locations")
        .update({ qty: 6 })
        .eq("part_id", part.id)
        .eq("big_box_id", box.boxId);
      expect(await readTotalQty(service, part.id)).toBe(6);

      // Undo: reversing movement row + the matching location-qty restore.
      await service
        .from("smark_movements")
        .insert({
          part_id: part.id,
          big_box_id: box.boxId,
          delta_qty: 4,
          reason: "undo",
          undo_of: (original as { id: string }).id,
          actor: actorA.id,
        });
      await service
        .from("smark_stock_locations")
        .update({ qty: 10 })
        .eq("part_id", part.id)
        .eq("big_box_id", box.boxId);

      expect(await readTotalQty(service, part.id)).toBe(beforeQty);

      await part.cleanup();
    },
  );

  test(
    "guided box-audit variances (adjust movements tagged audit, FEATURES.md §5.4/§9) are undoable through the same pairing rule as any other movement",
    async () => {
      const part = await createTestPart(service);
      const { data: original, error: originalError } = await insertMovement({
        partId: part.id,
        deltaQty: -2,
        reason: "adjust",
        reasonDetail: "audit",
        actor: actorA.id,
      });
      expect(originalError).toBeNull();

      const { data: undoRow, error: undoError } = await service
        .from("smark_movements")
        .insert({
          part_id: part.id,
          big_box_id: box.boxId,
          delta_qty: 2,
          reason: "undo",
          undo_of: (original as { id: string }).id,
          actor: actorA.id,
        })
        .select("*")
        .single();

      expect(undoError).toBeNull();
      expect((undoRow as { reason: string; undo_of: string }).reason).toBe("undo");
      expect((undoRow as { undo_of: string }).undo_of).toBe((original as { id: string }).id);

      const { data: reread } = await service
        .from("smark_movements")
        .select("reason, reason_detail")
        .eq("id", (original as { id: string }).id)
        .single();
      expect((reread as { reason: string }).reason).toBe("adjust");
      expect((reread as { reason_detail: string }).reason_detail).toBe("audit");

      await part.cleanup();
    },
  );

  test(
    "the undo movement stamps the actor who performed the undo (may differ from the original movement's actor — e.g. owner undoing an employee's mistake)",
    async () => {
      const part = await createTestPart(service);
      const { data: original } = await insertMovement({
        partId: part.id,
        deltaQty: -1,
        reason: "bulk_pick",
        actor: actorB.id, // employee made the original mistake
      });

      const { data: undoRow, error } = await service
        .from("smark_movements")
        .insert({
          part_id: part.id,
          big_box_id: box.boxId,
          delta_qty: 1,
          reason: "undo",
          undo_of: (original as { id: string }).id,
          actor: actorA.id, // owner performs the undo
        })
        .select("*")
        .single();

      expect(error).toBeNull();
      expect((undoRow as { actor: string }).actor).toBe(actorA.id);

      const { data: reread } = await service
        .from("smark_movements")
        .select("actor")
        .eq("id", (original as { id: string }).id)
        .single();
      expect((reread as { actor: string }).actor).toBe(actorB.id);

      await part.cleanup();
    },
  );
});

// Kept out of the DB-gated block — this exercises `lib/movements/service.ts`
// (the scan package's real write path receive/bulk-takeout also import,
// docs/OWNERSHIP.md) against a fake PostgREST-shaped client, not a live DB,
// so it runs under plain `bun test` with no local Supabase stack required.
describe("invariant: undo pairing — app write-path coverage", () => {
  test("every stock-mutating action (scan take-out/add, bulk_pick finish, receive confirm, qty adjust) writes exactly one smark_movements row", async () => {
    for (const reason of ["pick", "receive", "adjust", "bulk_pick"] as const) {
      let movementInserts = 0;
      let locationUpdates = 0;
      const client = makeFakeMovementsClient({
        startingQty: 20,
        onMovementInsert: () => {
          movementInserts += 1;
        },
        onLocationUpdate: () => {
          locationUpdates += 1;
        },
      });

      const input: MovementInput = {
        locationId: "loc-1",
        partId: "part-1",
        bigBoxId: "box-1",
        deltaQty: reason === "receive" ? 5 : -5,
        reason,
        actor: "actor-1",
      };
      await recordMovement(client, input);

      expect(movementInserts).toBe(1);
      expect(locationUpdates).toBe(1);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * A minimal, hand-rolled fake of the slice of `SupabaseClient` that
 * `lib/movements/service.ts` calls — enough to exercise `recordMovement`'s
 * real code path (exactly-one-insert, exactly-one-update) without a live
 * Postgres instance. Local to this test file on purpose: docs/OWNERSHIP.md
 * reserves `tests/helpers/**` for the integrator, so a shared fake-client
 * factory doesn't belong there.
 * ──────────────────────────────────────────────────────────────────────────── */

interface FakeMovementsClientOptions {
  startingQty: number;
  onMovementInsert?: (row: unknown) => void;
  onLocationUpdate?: (nextQty: number) => void;
}

function fakeOk<T>(data: T): PostgrestSingleResponse<T> {
  return { data, error: null, count: null, status: 200, statusText: "OK" } as PostgrestSingleResponse<T>;
}

function makeFakeMovementsClient(options: FakeMovementsClientOptions): SupabaseClient<Database> {
  let currentQty = options.startingQty;

  const builder = (table: string) => {
    if (table === TABLES.stock_locations) {
      return {
        select: () => ({
          eq: () => ({
            single: async () => fakeOk({ id: "loc-1", part_id: "part-1", big_box_id: "box-1", qty: currentQty }),
          }),
        }),
        update: (patch: { qty: number }) => ({
          eq: () => ({
            eq: (_col: string, expectedQty: number) => ({
              select: () => ({
                maybeSingle: async () => {
                  if (expectedQty !== currentQty) return fakeOk(null);
                  currentQty = patch.qty;
                  options.onLocationUpdate?.(currentQty);
                  return fakeOk({ id: "loc-1", part_id: "part-1", big_box_id: "box-1", qty: currentQty });
                },
              }),
            }),
          }),
        }),
      };
    }
    if (table === TABLES.movements) {
      return {
        insert: (row: unknown) => ({
          select: () => ({
            single: async () => {
              options.onMovementInsert?.(row);
              return fakeOk({ id: "movement-1", ...(row as object) });
            },
          }),
        }),
      };
    }
    throw new Error(`fake client: unexpected table "${table}"`);
  };

  return { from: builder } as unknown as SupabaseClient<Database>;
}
