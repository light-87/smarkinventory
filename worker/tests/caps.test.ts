/**
 * worker/tests/caps.test.ts — per-site cap clamping (FEATURES.md §15: "fixed
 * small per-site concurrency cap that ALWAYS overrides the user knob").
 * Pure unit tests — no DB/network involved.
 */

import { expect, test } from "bun:test";
import { clampToSiteCap, createSiteSemaphore, DEFAULT_SITE_CAP, KeyedSemaphore, MAX_FANOUT_WIDTH, PER_SITE_CAPS, resolveTier } from "../src/caps";

test("a user knob of 10 is clamped to Digikey's fixed cap of 3", () => {
  expect(PER_SITE_CAPS.Digikey).toBe(3);
  expect(clampToSiteCap("Digikey", 10)).toBe(3);
});

test("a knob BELOW the cap is left alone (never inflated up to the cap)", () => {
  expect(clampToSiteCap("Digikey", 1)).toBe(1);
});

test("an unknown/Settings-added distributor falls back to DEFAULT_SITE_CAP", () => {
  expect(clampToSiteCap("SomeNewDistributor", 10)).toBe(DEFAULT_SITE_CAP);
});

test("the clamp never returns less than 1, even for a knob of 0", () => {
  expect(clampToSiteCap("Digikey", 0)).toBe(1);
});

test("LCSC/Unikey (browser-only, anti-bot posture) are capped at 1 regardless of tier", () => {
  expect(clampToSiteCap("LCSC", 5)).toBe(1);
  expect(clampToSiteCap("Unikey", 5)).toBe(1);
});

test("resolveTier clamps 'thorough' fanout to the absolute MAX_FANOUT_WIDTH ceiling", () => {
  const thorough = resolveTier("thorough");
  expect(thorough.fanoutWidth).toBeLessThanOrEqual(MAX_FANOUT_WIDTH);
});

test("resolveTier still returns distinct configs per preset", () => {
  const economy = resolveTier("economy");
  const balanced = resolveTier("balanced");
  const thorough = resolveTier("thorough");
  expect(economy.fanoutWidth).toBeLessThan(balanced.fanoutWidth);
  expect(balanced.fanoutWidth).toBeLessThan(thorough.fanoutWidth);
});

test("KeyedSemaphore never lets more than the cap run concurrently for one key", async () => {
  const semaphore = createSiteSemaphore(); // Digikey capped at 3
  let concurrent = 0;
  let maxObserved = 0;

  async function task(): Promise<void> {
    const release = await semaphore.acquire("Digikey");
    concurrent += 1;
    maxObserved = Math.max(maxObserved, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 5));
    concurrent -= 1;
    release();
  }

  await Promise.all(Array.from({ length: 10 }, () => task()));
  expect(maxObserved).toBeLessThanOrEqual(PER_SITE_CAPS.Digikey ?? 0);
});

test("release() hands its permit directly to a queued waiter — a fresh acquire() issued right after release() cannot double up on the cap (cap 1 regression)", async () => {
  // Deterministic repro for the "decrement-then-reincrement" race: the old
  // release() decremented `inFlight` and woke the waiter BEFORE the waiter's
  // own continuation had a chance to re-increment it (resolving a promise
  // only schedules a microtask, it doesn't run synchronously) — so a THIRD,
  // unrelated acquire() issued in that window read the transiently-lowered
  // count and wrongly took the fast path, granting a second concurrent
  // permit under a cap of 1.
  const semaphore = new KeyedSemaphore(() => 1);

  const release1 = await semaphore.acquire("k"); // grants the sole permit (fast path)

  let holder2Settled = false;
  const holder2Promise = semaphore.acquire("k").then((release2) => {
    holder2Settled = true;
    return release2;
  }); // synchronously takes the SLOW (queued) path — current(1) >= limit(1)

  release1(); // hand off to the queued waiter (holder2)

  // A brand-new acquire(), issued synchronously right after release() — with
  // the bug this wrongly succeeds via the fast path (inFlight already reads
  // 0 at this point); fixed, inFlight is still "1" (now held by holder2) so
  // this must queue too.
  let holder3Settled = false;
  const holder3Promise = semaphore.acquire("k").then((release3) => {
    holder3Settled = true;
    return release3;
  });

  // Drain the event loop so every continuation that CAN run, has run.
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(holder2Settled).toBe(true); // the queued waiter gets the handed-off permit
  expect(holder3Settled).toBe(false); // the fresh acquire must queue behind it, never double up

  const release2 = await holder2Promise;
  release2();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(holder3Settled).toBe(true); // now it's holder3's turn, only after holder2 releases

  const release3 = await holder3Promise;
  release3();
});
