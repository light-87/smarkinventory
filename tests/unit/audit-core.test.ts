import { describe, expect, test } from "bun:test";
import type { PostgrestSingleResponse, SupabaseClient } from "@supabase/supabase-js";
import { confirmAuditCountCore, isUniqueViolation, undoAuditCountCore } from "@/lib/audit/core";
import { TABLES, type Database } from "@/types/db";

/**
 * lib/audit/core.ts — guided box-audit DB writes, split out of
 * lib/audit/actions.ts ("use server") so the actual write-path logic is
 * unit-testable with a fake `SupabaseClient` (no `next/headers`), mirroring
 * lib/receive/core.ts + lib/receive/actions.ts.
 *
 * Finding #3 — confirmAuditCount used to do an ABSOLUTE, unguarded qty set
 * (`.update({ qty: countedQty })`) computed against a qty read BEFORE the
 * write, with no re-check. A concurrent scan-pick/receive on the SAME ESD
 * between that read and the write was silently clobbered: the concurrent
 * movement's delta stayed in smark_movements but its qty change was
 * overwritten, breaking Σ(movement deltas) === net qty change.
 *
 * Finding #5 — undoAuditCount used to reverse the location qty BEFORE
 * inserting the undo row that `smark_movements_undo_of_unique`
 * (UNIQUE(undo_of)) arbitrates. Two concurrent undos of the same movement
 * could both pass the earlier `existingUndo` check and both reverse qty,
 * with only the loser's insert failing — silently double-reversing qty.
 */

function fakeOk<T>(data: T): PostgrestSingleResponse<T> {
  return { data, error: null, count: null, status: 200, statusText: "OK" } as PostgrestSingleResponse<T>;
}

function fakeErr<T>(error: { code: string; message: string }): PostgrestSingleResponse<T> {
  return { data: null, error, count: null, status: 409, statusText: "Conflict" } as unknown as PostgrestSingleResponse<T>;
}

// The insert schemas validate part_id/big_box_id/actor/undo_of as (strict, RFC
// 4122-shaped) UUIDs — version nibble 1-8, variant nibble 8/9/a/b — so plain
// mnemonic strings like "part-1" fail Zod's `.uuid()` check before the fake
// client is ever touched. Use real UUID-shaped fixtures throughout.
const PART_ID = "11111111-1111-4111-8111-111111111111";
const BOX_ID = "22222222-2222-4222-8222-222222222222";
const LOC_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const MOVEMENT_ID = "55555555-5555-4555-8555-555555555555";

/* ────────────────────────────────────────────────────────────────────────────
 * confirmAuditCountCore — finding #3
 * ──────────────────────────────────────────────────────────────────────────── */

interface FakeConfirmClientOptions {
  initialLocationQty: number;
  /** Successive values returned by `applyAuditRecount`'s fresh "select qty" read (last value repeats). */
  freshReadQueue: number[];
  /** The CAS write only succeeds when `.eq("qty", X)` is called with this X. */
  casSucceedsAtQty: number;
  calls: string[];
}

function makeFakeConfirmClient(opts: FakeConfirmClientOptions): SupabaseClient<Database> {
  let readIndex = 0;

  const builder = (table: string) => {
    if (table === TABLES.stock_locations) {
      return {
        select: (cols: string) => {
          if (cols.includes("part_id")) {
            // The box-membership check: select("id, part_id, big_box_id, qty")
            return {
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => {
                    opts.calls.push("initial-select");
                    return fakeOk({ id: LOC_ID, part_id: PART_ID, big_box_id: BOX_ID, qty: opts.initialLocationQty });
                  },
                }),
              }),
            };
          }
          // applyAuditRecount's fresh read: select("qty")
          return {
            eq: () => ({
              single: async () => {
                const qty = opts.freshReadQueue[Math.min(readIndex, opts.freshReadQueue.length - 1)];
                readIndex += 1;
                opts.calls.push(`fresh-read:${qty}`);
                return fakeOk({ qty });
              },
            }),
          };
        },
        update: (patch: { qty: number; last_counted_at: string | null }) => ({
          eq: () => ({
            eq: (_col: string, expectedQty: number) => ({
              select: () => ({
                maybeSingle: async () => {
                  opts.calls.push(`cas:${expectedQty}`);
                  if (expectedQty !== opts.casSucceedsAtQty) return fakeOk(null);
                  return fakeOk({ qty: patch.qty, last_counted_at: patch.last_counted_at });
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
              opts.calls.push("movement-insert");
              return fakeOk({ id: MOVEMENT_ID, ...(row as object) });
            },
          }),
        }),
      };
    }
    if (table === TABLES.part_events) {
      return {
        insert: async (_row: unknown) => {
          opts.calls.push("event-insert");
          return fakeOk(null);
        },
      };
    }
    throw new Error(`fake client: unexpected table "${table}"`);
  };

  return { from: builder } as unknown as SupabaseClient<Database>;
}

describe("confirmAuditCountCore — finding #3 CAS guard", () => {
  test("uses the FRESH qty read right before writing, not the earlier stale membership-check read, so a concurrent pick lands as a real delta", async () => {
    const calls: string[] = [];
    const client = makeFakeConfirmClient({
      // The initial box-membership select reads qty=100 ...
      initialLocationQty: 100,
      // ... but by the time the CAS write is about to happen, a concurrent
      // pick has already dropped it to 92 — applyAuditRecount's own fresh
      // read must see 92, not the stale 100.
      freshReadQueue: [92],
      casSucceedsAtQty: 92,
      calls,
    });

    const result = await confirmAuditCountCore(client, USER_ID, {
      boxId: BOX_ID,
      locationId: LOC_ID,
      countedQty: 100,
    });

    // Bug (pre-fix) would compute delta = countedQty(100) - staleQty(100) = 0,
    // silently discarding the concurrent -8 pick from the ledger entirely.
    // Fixed behavior: delta reconciles against the FRESH qty (92).
    expect(result.delta).toBe(8);
    expect(result.isVariance).toBe(true);
    expect(result.movementId).not.toBeNull();
    expect(calls).toContain("cas:92");
    expect(calls).not.toContain("cas:100"); // never attempts the stale value
  });

  test("retries the CAS write when a concurrent write races it, and reconciles against the value that actually won", async () => {
    const calls: string[] = [];
    const client = makeFakeConfirmClient({
      initialLocationQty: 50,
      // First fresh read sees 50; the CAS write for 50 loses a race (someone
      // else's write landed first), so the retry re-reads and sees 45.
      freshReadQueue: [50, 45],
      casSucceedsAtQty: 45,
      calls,
    });

    const result = await confirmAuditCountCore(client, USER_ID, {
      boxId: BOX_ID,
      locationId: LOC_ID,
      countedQty: 45,
    });

    expect(result.delta).toBe(0); // 45 counted - 45 fresh = confirmed exact, no variance
    expect(result.isVariance).toBe(false);
    expect(calls.filter((c) => c.startsWith("cas:"))).toEqual(["cas:50", "cas:45"]);
  });

  test("an exact re-count (no variance) still updates qty/last_counted_at but writes no movement", async () => {
    const calls: string[] = [];
    const client = makeFakeConfirmClient({
      initialLocationQty: 20,
      freshReadQueue: [20],
      casSucceedsAtQty: 20,
      calls,
    });

    const result = await confirmAuditCountCore(client, USER_ID, { boxId: BOX_ID, locationId: LOC_ID, countedQty: 20 });

    expect(result.isVariance).toBe(false);
    expect(result.movementId).toBeNull();
    expect(calls).not.toContain("movement-insert");
    expect(calls).not.toContain("event-insert");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * undoAuditCountCore — finding #5
 * ──────────────────────────────────────────────────────────────────────────── */

interface FakeUndoClientOptions {
  originalDeltaQty: number;
  existingUndo: { id: string } | null;
  insertError: { code: string; message: string } | null;
  startingQty: number;
  calls: string[];
}

function makeFakeAuditUndoClient(opts: FakeUndoClientOptions): { client: SupabaseClient<Database>; getQty: () => number } {
  let currentQty = opts.startingQty;

  const builder = (table: string) => {
    if (table === TABLES.movements) {
      return {
        select: (cols: string) => {
          if (cols === "id") {
            return {
              eq: () => ({
                maybeSingle: async () => {
                  opts.calls.push("existing-undo-check");
                  return fakeOk(opts.existingUndo);
                },
              }),
            };
          }
          return {
            eq: () => ({
              maybeSingle: async () =>
                fakeOk({ id: MOVEMENT_ID, part_id: PART_ID, big_box_id: BOX_ID, delta_qty: opts.originalDeltaQty, reason: "adjust" }),
            }),
          };
        },
        insert: async (_row: unknown) => {
          opts.calls.push("undo-insert");
          if (opts.insertError) return fakeErr(opts.insertError);
          return fakeOk(null);
        },
      };
    }
    if (table === TABLES.stock_locations) {
      return {
        select: (cols: string) => {
          if (cols === "id") {
            return {
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => {
                    opts.calls.push("location-lookup");
                    return fakeOk({ id: LOC_ID });
                  },
                }),
              }),
            };
          }
          return {
            eq: () => ({
              single: async () => {
                opts.calls.push("location-fetch");
                return fakeOk({ id: LOC_ID, qty: currentQty, last_counted_at: null });
              },
            }),
          };
        },
        update: (patch: { qty: number }) => ({
          eq: () => ({
            eq: (_col: string, expectedQty: number) => ({
              select: () => ({
                maybeSingle: async () => {
                  opts.calls.push("location-update");
                  if (expectedQty !== currentQty) return fakeOk(null);
                  currentQty = patch.qty;
                  return fakeOk({ qty: currentQty, last_counted_at: null });
                },
              }),
            }),
          }),
        }),
      };
    }
    if (table === TABLES.part_events) {
      return { insert: async (_row: unknown) => fakeOk(null) };
    }
    throw new Error(`fake client: unexpected table "${table}"`);
  };

  return { client: { from: builder } as unknown as SupabaseClient<Database>, getQty: () => currentQty };
}

describe("undoAuditCountCore — finding #5 concurrent-undo ordering", () => {
  test("inserts the undo movement BEFORE reversing the location qty", async () => {
    const calls: string[] = [];
    const { client } = makeFakeAuditUndoClient({
      originalDeltaQty: -5,
      existingUndo: null,
      insertError: null,
      startingQty: 10,
      calls,
    });

    const result = await undoAuditCountCore(client, USER_ID, MOVEMENT_ID);

    expect(result).toEqual({ ok: true, newQty: 15 }); // 10 + reversed delta (+5)
    expect(calls.indexOf("undo-insert")).toBeLessThan(calls.indexOf("location-fetch"));
    expect(calls.indexOf("undo-insert")).toBeLessThan(calls.indexOf("location-update"));
  });

  test("a unique-violation (23505) on the undo insert aborts WITHOUT ever touching qty", async () => {
    const calls: string[] = [];
    const { client, getQty } = makeFakeAuditUndoClient({
      originalDeltaQty: -5,
      existingUndo: null, // the earlier read didn't see the concurrent winner yet
      insertError: { code: "23505", message: 'duplicate key value violates unique constraint "smark_movements_undo_of_unique"' },
      startingQty: 10,
      calls,
    });

    const result = await undoAuditCountCore(client, USER_ID, MOVEMENT_ID);

    expect(result).toEqual({ ok: false, error: "This count has already been undone." });
    // The location-id lookup runs before the insert (needed either way), but
    // qty itself (applyLocationDelta's own read + write) must never be touched.
    expect(calls).not.toContain("location-fetch");
    expect(calls).not.toContain("location-update");
    expect(getQty()).toBe(10); // untouched
  });
});

describe("isUniqueViolation", () => {
  test("true for a Postgres 23505 error shape", () => {
    expect(isUniqueViolation({ code: "23505", message: "duplicate key" })).toBe(true);
  });

  test("false for other errors / non-error values", () => {
    expect(isUniqueViolation({ code: "23503", message: "fk violation" })).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
