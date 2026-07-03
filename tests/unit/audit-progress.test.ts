import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearAuditProgress,
  createAuditProgress,
  loadAuditProgress,
  markLocationDone,
  saveAuditProgress,
} from "@/lib/audit";

/**
 * lib/audit/progress — resumable audit progress (plan/tab-shelves.md
 * R2-25/Q-10: "partial audit resumable — persist progress in a table or
 * localStorage, your call"). Bun's test runner has no DOM/`window` by
 * default, so this suite covers both halves explicitly:
 *   - the pure, window-independent helpers (`createAuditProgress`,
 *     `markLocationDone`) — real logic, always exercised;
 *   - the storage-backed helpers against a minimal in-memory `Storage` shim
 *     installed as `globalThis.window`, proving the round-trip actually
 *     works rather than only proving the SSR no-op guard does.
 */

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe("createAuditProgress / markLocationDone (pure, no storage involved)", () => {
  test("createAuditProgress starts empty for the given box", () => {
    const progress = createAuditProgress("box-1");
    expect(progress.boxId).toBe("box-1");
    expect(progress.doneLocationIds).toEqual([]);
    expect(typeof progress.startedAt).toBe("string");
  });

  test("markLocationDone appends without mutating the input", () => {
    const original = createAuditProgress("box-1");
    const next = markLocationDone(original, "loc-1");
    expect(original.doneLocationIds).toEqual([]); // unchanged
    expect(next.doneLocationIds).toEqual(["loc-1"]);
  });

  test("marking the same location twice doesn't duplicate it", () => {
    const once = markLocationDone(createAuditProgress("box-1"), "loc-1");
    const twice = markLocationDone(once, "loc-1");
    expect(twice.doneLocationIds).toEqual(["loc-1"]);
    expect(twice).toBe(once); // no-op returns the same reference
  });

  test("marking a second, different location preserves order", () => {
    let progress = createAuditProgress("box-1");
    progress = markLocationDone(progress, "loc-1");
    progress = markLocationDone(progress, "loc-2");
    expect(progress.doneLocationIds).toEqual(["loc-1", "loc-2"]);
  });
});

describe("without a window (SSR / plain `bun test`) — every helper degrades safely", () => {
  test("loadAuditProgress returns null, save/clear are silent no-ops", () => {
    expect(typeof window).toBe("undefined");
    expect(loadAuditProgress("box-1")).toBeNull();
    expect(() => saveAuditProgress(createAuditProgress("box-1"))).not.toThrow();
    expect(() => clearAuditProgress("box-1")).not.toThrow();
  });
});

describe("with a window (localStorage round-trip)", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { localStorage: createMemoryStorage() };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  test("save then load returns an equivalent progress object", () => {
    const progress = markLocationDone(createAuditProgress("box-1"), "loc-1");
    saveAuditProgress(progress);
    expect(loadAuditProgress("box-1")).toEqual(progress);
  });

  test("progress for a different box doesn't collide", () => {
    saveAuditProgress(markLocationDone(createAuditProgress("box-1"), "loc-1"));
    saveAuditProgress(markLocationDone(createAuditProgress("box-2"), "loc-9"));

    expect(loadAuditProgress("box-1")?.doneLocationIds).toEqual(["loc-1"]);
    expect(loadAuditProgress("box-2")?.doneLocationIds).toEqual(["loc-9"]);
  });

  test("clearAuditProgress removes the saved session", () => {
    saveAuditProgress(markLocationDone(createAuditProgress("box-1"), "loc-1"));
    clearAuditProgress("box-1");
    expect(loadAuditProgress("box-1")).toBeNull();
  });

  test("loadAuditProgress rejects a malformed record instead of throwing", () => {
    (window.localStorage as Storage).setItem("smark.audit.box-1", "{not json");
    expect(loadAuditProgress("box-1")).toBeNull();
  });

  test("loadAuditProgress rejects a record whose boxId doesn't match the key (defensive)", () => {
    (window.localStorage as Storage).setItem(
      "smark.audit.box-1",
      JSON.stringify({ boxId: "box-2", startedAt: new Date().toISOString(), doneLocationIds: ["loc-1"] }),
    );
    expect(loadAuditProgress("box-1")).toBeNull();
  });
});
