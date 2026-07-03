import { describe, expect, test } from "bun:test";
import type { PostgrestSingleResponse, SupabaseClient } from "@supabase/supabase-js";
import { recordMovement, undoMovement } from "@/lib/movements/service";
import { MovementValidationError, type MovementInput } from "@/lib/movements/types";
import { TABLES, type Database } from "@/types/db";

/**
 * lib/movements/service — the DB-backed half of the movement/undo write path
 * (FEATURES.md §9, docs/OWNERSHIP.md `lib/movements/**` — owned by `scan`,
 * imported by `receive`/`takeout`). Exercised here against a small in-memory
 * fake of the PostgREST calls it makes (`tests/helpers/**` is
 * integrator-locked, so this fake is local to the file) — real Supabase
 * coverage of the same contract lives in
 * tests/invariants/{undo-pairing,qty-rollup}.test.ts's DB-backed suites.
 */

const PART_ID = "part-1";
const BOX_ID = "box-1";
const ACTOR_A = "actor-a";
const ACTOR_B = "actor-b";

describe("recordMovement", () => {
  test("applies the delta to the location and writes exactly one movement row", async () => {
    const db = makeDb({ "loc-1": { id: "loc-1", part_id: PART_ID, big_box_id: BOX_ID, qty: 20 } });
    const client = makeClient(db);

    const input: MovementInput = {
      locationId: "loc-1",
      partId: PART_ID,
      bigBoxId: BOX_ID,
      deltaQty: -6,
      reason: "pick",
      actor: ACTOR_A,
    };
    const { movement, location } = await recordMovement(client, input);

    expect(location.qty).toBe(14);
    expect(db.stockLocations.get("loc-1")?.qty).toBe(14);
    expect(movement.delta_qty).toBe(-6);
    expect(movement.reason).toBe("pick");
    expect(movement.actor).toBe(ACTOR_A);
    expect(movement.undo_of).toBeNull();
    expect(db.movements.size).toBe(1);
  });

  test("rejects a delta that would take a location negative, without writing anything", async () => {
    const db = makeDb({ "loc-1": { id: "loc-1", part_id: PART_ID, big_box_id: BOX_ID, qty: 3 } });
    const client = makeClient(db);

    const input: MovementInput = {
      locationId: "loc-1",
      partId: PART_ID,
      bigBoxId: BOX_ID,
      deltaQty: -5,
      reason: "pick",
      actor: ACTOR_A,
    };
    await expect(recordMovement(client, input)).rejects.toThrow(MovementValidationError);

    expect(db.stockLocations.get("loc-1")?.qty).toBe(3); // untouched
    expect(db.movements.size).toBe(0); // no orphaned movement row either
  });

  test("retries the location update on an optimistic-concurrency conflict and still succeeds", async () => {
    const db = makeDb({ "loc-1": { id: "loc-1", part_id: PART_ID, big_box_id: BOX_ID, qty: 50 } });
    // First update attempt reports "0 rows matched" (simulated lost race), second succeeds.
    const client = makeClient(db, { raceAttemptsBeforeSuccess: 1 });

    const input: MovementInput = {
      locationId: "loc-1",
      partId: PART_ID,
      bigBoxId: BOX_ID,
      deltaQty: -10,
      reason: "adjust",
      actor: ACTOR_A,
    };
    const { location } = await recordMovement(client, input);
    expect(location.qty).toBe(40);
  });

  test("gives up with a clear error after too many concurrent conflicts", async () => {
    const db = makeDb({ "loc-1": { id: "loc-1", part_id: PART_ID, big_box_id: BOX_ID, qty: 50 } });
    const client = makeClient(db, { raceAttemptsBeforeSuccess: 99 }); // never succeeds

    const input: MovementInput = {
      locationId: "loc-1",
      partId: PART_ID,
      bigBoxId: BOX_ID,
      deltaQty: -10,
      reason: "adjust",
      actor: ACTOR_A,
    };
    await expect(recordMovement(client, input)).rejects.toThrow(MovementValidationError);
  });
});

describe("undoMovement", () => {
  test("reverses the qty change and writes a reason='undo' row pointing at the original", async () => {
    const db = makeDb({ "loc-1": { id: "loc-1", part_id: PART_ID, big_box_id: BOX_ID, qty: 20 } });
    const client = makeClient(db);

    const { movement: original } = await recordMovement(client, {
      locationId: "loc-1",
      partId: PART_ID,
      bigBoxId: BOX_ID,
      deltaQty: -8,
      reason: "pick",
      actor: ACTOR_A,
    });
    expect(db.stockLocations.get("loc-1")?.qty).toBe(12);

    const { movement: undo, location } = await undoMovement(client, original.id, ACTOR_B);
    expect(undo.reason).toBe("undo");
    expect(undo.undo_of).toBe(original.id);
    expect(undo.delta_qty).toBe(8);
    expect(undo.actor).toBe(ACTOR_B); // may differ from the original actor
    expect(location?.qty).toBe(20); // restored to the pre-mutation value
  });

  test("rejects undoing a movement whose own reason is 'undo' (no undo chains)", async () => {
    const db = makeDb({ "loc-1": { id: "loc-1", part_id: PART_ID, big_box_id: BOX_ID, qty: 20 } });
    const client = makeClient(db);
    db.movements.set("m-undo", {
      id: "m-undo",
      part_id: PART_ID,
      big_box_id: BOX_ID,
      delta_qty: 5,
      reason: "undo",
      reason_detail: null,
      bom_id: null,
      undo_of: "m-original",
      actor: ACTOR_A,
      created_at: "",
      updated_at: null,
    });

    await expect(undoMovement(client, "m-undo", ACTOR_B)).rejects.toThrow(/no undo chains/);
  });

  test("rejects undoing an already-undone movement", async () => {
    const db = makeDb({ "loc-1": { id: "loc-1", part_id: PART_ID, big_box_id: BOX_ID, qty: 20 } });
    const client = makeClient(db);
    db.movements.set("m-original", {
      id: "m-original",
      part_id: PART_ID,
      big_box_id: BOX_ID,
      delta_qty: -5,
      reason: "pick",
      reason_detail: null,
      bom_id: null,
      undo_of: null,
      actor: ACTOR_A,
      created_at: "",
      updated_at: null,
    });
    db.movements.set("m-already-undo", {
      id: "m-already-undo",
      part_id: PART_ID,
      big_box_id: BOX_ID,
      delta_qty: 5,
      reason: "undo",
      reason_detail: null,
      bom_id: null,
      undo_of: "m-original",
      actor: ACTOR_A,
      created_at: "",
      updated_at: null,
    });

    await expect(undoMovement(client, "m-original", ACTOR_B)).rejects.toThrow(/already been undone/);
  });

  test("a movement with no big_box_id (context-less adjust) writes the undo row but has no location to reverse", async () => {
    const db = makeDb({});
    const client = makeClient(db);
    db.movements.set("m-no-box", {
      id: "m-no-box",
      part_id: PART_ID,
      big_box_id: null,
      delta_qty: -3,
      reason: "adjust",
      reason_detail: null,
      bom_id: null,
      undo_of: null,
      actor: ACTOR_A,
      created_at: "",
      updated_at: null,
    });

    const { movement: undo, location } = await undoMovement(client, "m-no-box", ACTOR_B);
    expect(undo.reason).toBe("undo");
    expect(undo.big_box_id).toBeNull();
    expect(location).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Minimal in-memory fake of the PostgREST calls `lib/movements/service.ts`
 * makes. Local to this test file — docs/OWNERSHIP.md reserves
 * `tests/helpers/**` for the integrator.
 * ──────────────────────────────────────────────────────────────────────────── */

interface FakeLocationRow {
  id: string;
  part_id: string;
  big_box_id: string;
  qty: number;
}

interface DbState {
  stockLocations: Map<string, FakeLocationRow>;
  movements: Map<string, Record<string, unknown>>;
}

function makeDb(initialLocations: Record<string, FakeLocationRow>): DbState {
  return {
    stockLocations: new Map(Object.entries(initialLocations)),
    movements: new Map(),
  };
}

function ok<T>(data: T): PostgrestSingleResponse<T> {
  return { data, error: null, count: null, status: 200, statusText: "OK" } as PostgrestSingleResponse<T>;
}

function fail<T>(message: string): PostgrestSingleResponse<T> {
  return {
    data: null,
    error: { message, details: "", hint: "", code: "TEST", name: "PostgrestError" },
    count: null,
    status: 404,
    statusText: "Not Found",
  } as unknown as PostgrestSingleResponse<T>;
}

interface FakeClientOptions {
  /** How many update attempts report "0 rows matched" (simulated race) before one succeeds. */
  raceAttemptsBeforeSuccess?: number;
}

function makeClient(db: DbState, options: FakeClientOptions = {}): SupabaseClient<Database> {
  let movementCounter = 0;
  let updateAttempts = 0;
  const raceAttemptsBeforeSuccess = options.raceAttemptsBeforeSuccess ?? 0;

  const from = (table: string) => {
    if (table === TABLES.stock_locations) {
      return {
        select: () => ({
          eq: (col1: string, val1: unknown) => ({
            single: async () => {
              const row = [...db.stockLocations.values()].find(
                (r) => (r as unknown as Record<string, unknown>)[col1] === val1,
              );
              return row ? ok(row) : fail("not found");
            },
            eq: (col2: string, val2: unknown) => ({
              maybeSingle: async () => {
                const row = [...db.stockLocations.values()].find(
                  (r) =>
                    (r as unknown as Record<string, unknown>)[col1] === val1 &&
                    (r as unknown as Record<string, unknown>)[col2] === val2,
                );
                return ok(row ?? null);
              },
            }),
          }),
        }),
        update: (patch: { qty: number }) => ({
          eq: (col1: string, val1: unknown) => ({
            eq: (col2: string, val2: unknown) => ({
              select: () => ({
                maybeSingle: async () => {
                  updateAttempts += 1;
                  if (updateAttempts <= raceAttemptsBeforeSuccess) {
                    return ok(null); // simulated lost race
                  }
                  const row = [...db.stockLocations.values()].find(
                    (r) => (r as unknown as Record<string, unknown>)[col1] === val1,
                  );
                  if (!row || (row as unknown as Record<string, unknown>)[col2] !== val2) return ok(null);
                  const updated = { ...row, qty: patch.qty };
                  db.stockLocations.set(row.id, updated);
                  return ok(updated);
                },
              }),
            }),
          }),
        }),
      };
    }
    if (table === TABLES.movements) {
      return {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              movementCounter += 1;
              const id = `m-new-${movementCounter}`;
              const full = { id, created_at: "", updated_at: null, ...row };
              db.movements.set(id, full);
              return ok(full);
            },
          }),
        }),
        select: () => ({
          eq: (col1: string, val1: unknown) => ({
            single: async () => {
              const row = [...db.movements.values()].find((r) => r[col1] === val1);
              return row ? ok(row) : fail("not found");
            },
            maybeSingle: async () => {
              const row = [...db.movements.values()].find((r) => r[col1] === val1);
              return ok(row ?? null);
            },
          }),
        }),
      };
    }
    throw new Error(`fake client: unexpected table "${table}"`);
  };

  return { from } as unknown as SupabaseClient<Database>;
}
