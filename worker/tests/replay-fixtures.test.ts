/**
 * worker/tests/replay-fixtures.test.ts — the record/replay layer every REST
 * distributor client wraps its live call in (worker/src/distributors/
 * record-replay.ts). Pure filesystem tests — no network, no DB.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fixtureSlug, withRecordReplay } from "../src/distributors/record-replay";

const SCRATCH_DIR = path.join(import.meta.dir, "fixtures", "tmp-replay-test");

beforeEach(async () => {
  await rm(SCRATCH_DIR, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(SCRATCH_DIR, { recursive: true, force: true });
});

test("fixtureSlug is deterministic for the same key", () => {
  const a = fixtureSlug("mpn:GRM319R6YA106KA12D|lcsc:C92797|value:10uF/35V|pkg:C1206");
  const b = fixtureSlug("mpn:GRM319R6YA106KA12D|lcsc:C92797|value:10uF/35V|pkg:C1206");
  expect(a).toBe(b);
});

test("fixtureSlug differs for different keys", () => {
  const a = fixtureSlug("mpn:AAA");
  const b = fixtureSlug("mpn:BBB");
  expect(a).not.toBe(b);
});

test("replay mode with no fixture throws a clear error and never calls the live function", async () => {
  let liveCalled = false;
  await expect(
    withRecordReplay("no-such-key", { distributorName: "TestDist", fixturesDir: SCRATCH_DIR, mode: "replay" }, async () => {
      liveCalled = true;
      return { ok: true };
    }),
  ).rejects.toThrow(/no fixture/);
  expect(liveCalled).toBe(false);
});

test("record mode writes a fixture that a later replay call reads back verbatim", async () => {
  const key = "mpn:TEST123";
  const recorded = await withRecordReplay(key, { distributorName: "TestDist", fixturesDir: SCRATCH_DIR, mode: "record" }, async () => ({
    listings: [{ price: 1.23, stockQty: 500 }],
  }));
  expect(recorded.listings[0]?.price).toBe(1.23);

  let liveCalledOnReplay = false;
  const replayed = await withRecordReplay<{ listings: Array<{ price: number; stockQty: number }> }>(
    key,
    { distributorName: "TestDist", fixturesDir: SCRATCH_DIR, mode: "replay" },
    async () => {
      liveCalledOnReplay = true;
      throw new Error("should never be called in replay mode");
    },
  );
  expect(liveCalledOnReplay).toBe(false);
  expect(replayed.listings[0]?.price).toBe(1.23);
  expect(replayed.listings[0]?.stockQty).toBe(500);
});

test("two different keys record to two different fixture files", async () => {
  await withRecordReplay("key-one", { distributorName: "TestDist", fixturesDir: SCRATCH_DIR, mode: "record" }, async () => ({ n: 1 }));
  await withRecordReplay("key-two", { distributorName: "TestDist", fixturesDir: SCRATCH_DIR, mode: "record" }, async () => ({ n: 2 }));

  const one = await withRecordReplay<{ n: number }>("key-one", { distributorName: "TestDist", fixturesDir: SCRATCH_DIR, mode: "replay" }, async () => {
    throw new Error("unreachable");
  });
  const two = await withRecordReplay<{ n: number }>("key-two", { distributorName: "TestDist", fixturesDir: SCRATCH_DIR, mode: "replay" }, async () => {
    throw new Error("unreachable");
  });
  expect(one.n).toBe(1);
  expect(two.n).toBe(2);
});
