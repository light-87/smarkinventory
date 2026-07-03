import { describe, expect, test } from "bun:test";
import {
  clearOfflineMovements,
  createMemoryStorage,
  enqueueOfflineMovement,
  isNetworkError,
  listOfflineMovements,
  removeOfflineMovement,
} from "@/lib/scan/offline-queue";
import type { MovementInput } from "@/lib/movements";

/**
 * lib/scan/offline-queue — the localStorage-backed movement queue
 * (plan/tab-scan.md OFFLINE note: "queue movement in localStorage + banner
 * 'N queued — will sync'; sync on reconnect"). `createMemoryStorage()`
 * stands in for `window.localStorage` so this runs under plain `bun test`.
 */

function sampleInput(overrides: Partial<MovementInput> = {}): MovementInput {
  return {
    locationId: "loc-1",
    partId: "part-1",
    bigBoxId: "box-1",
    deltaQty: -4,
    reason: "adjust",
    actor: "actor-1",
    ...overrides,
  };
}

describe("offline queue: enqueue / list / remove / clear", () => {
  test("starts empty", () => {
    const storage = createMemoryStorage();
    expect(listOfflineMovements(storage)).toEqual([]);
  });

  test("enqueue adds an entry with a generated id, timestamp, and the given summary", () => {
    const storage = createMemoryStorage();
    const queued = enqueueOfflineMovement(sampleInput(), "Took out 4 × SMK-000101 from Box A-03", storage);
    expect(queued.id).toBeTruthy();
    expect(queued.summary).toBe("Took out 4 × SMK-000101 from Box A-03");
    expect(queued.input).toEqual(sampleInput());
    expect(new Date(queued.queuedAt).toString()).not.toBe("Invalid Date");

    const all = listOfflineMovements(storage);
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(queued);
  });

  test("multiple enqueues preserve insertion order (FIFO — sync must not reorder scans)", () => {
    const storage = createMemoryStorage();
    enqueueOfflineMovement(sampleInput({ deltaQty: -1 }), "first", storage);
    enqueueOfflineMovement(sampleInput({ deltaQty: -2 }), "second", storage);
    enqueueOfflineMovement(sampleInput({ deltaQty: -3 }), "third", storage);

    const all = listOfflineMovements(storage);
    expect(all.map((item) => item.summary)).toEqual(["first", "second", "third"]);
  });

  test("removeOfflineMovement drops only the matching entry", () => {
    const storage = createMemoryStorage();
    const a = enqueueOfflineMovement(sampleInput(), "a", storage);
    const b = enqueueOfflineMovement(sampleInput(), "b", storage);

    removeOfflineMovement(a.id, storage);

    const remaining = listOfflineMovements(storage);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(b.id);
  });

  test("clearOfflineMovements empties the queue entirely", () => {
    const storage = createMemoryStorage();
    enqueueOfflineMovement(sampleInput(), "a", storage);
    enqueueOfflineMovement(sampleInput(), "b", storage);
    clearOfflineMovements(storage);
    expect(listOfflineMovements(storage)).toEqual([]);
  });

  test("survives corrupted/garbage storage content instead of throwing", () => {
    const storage = createMemoryStorage();
    storage.setItem("smarkstock.scan.offlineMovements.v1", "{not json");
    expect(listOfflineMovements(storage)).toEqual([]);
    // enqueue still works afterwards — a bad read doesn't wedge future writes.
    const queued = enqueueOfflineMovement(sampleInput(), "recovered", storage);
    expect(listOfflineMovements(storage)).toEqual([queued]);
  });

  test("two independent storages don't leak into each other", () => {
    const storageA = createMemoryStorage();
    const storageB = createMemoryStorage();
    enqueueOfflineMovement(sampleInput(), "only in A", storageA);
    expect(listOfflineMovements(storageB)).toEqual([]);
  });
});

describe("isNetworkError", () => {
  test("classifies a TypeError (fetch's generic failure shape) as a network error", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
  });

  test("classifies an error message mentioning network/fetch failure as a network error", () => {
    expect(isNetworkError(new Error("network request failed"))).toBe(true);
    expect(isNetworkError(new Error("fetch failed"))).toBe(true);
  });

  test("does NOT classify a plain validation error as a network error", () => {
    expect(isNetworkError(new Error("insufficient stock: 3 available, delta -5 would go negative"))).toBe(false);
  });

  test("does NOT classify an arbitrary string reason as a network error", () => {
    expect(isNetworkError("some unrelated failure")).toBe(false);
  });
});
