/**
 * worker/tests/cost-ceiling.test.ts — the per-run ₹ ceiling abort
 * (FEATURES.md §15/§18). Pure unit tests — no DB/network involved.
 */

import { expect, test } from "bun:test";
import { estimateCallCostRupees, estimateNextCallRupees, RunCostTracker } from "../src/caps";

test("RunCostTracker starts with zero spend and full headroom", () => {
  const tracker = new RunCostTracker(100);
  expect(tracker.spent).toBe(0);
  expect(tracker.remaining).toBe(100);
  expect(tracker.hasExceededCeiling).toBe(false);
});

test("wouldExceed answers BEFORE spending, without mutating state", () => {
  const tracker = new RunCostTracker(10);
  expect(tracker.wouldExceed(11)).toBe(true);
  expect(tracker.wouldExceed(5)).toBe(false);
  expect(tracker.spent).toBe(0); // wouldExceed must not record anything
});

test("recording spend up to the ceiling flips hasExceededCeiling", () => {
  const tracker = new RunCostTracker(10);
  tracker.record(6);
  expect(tracker.hasExceededCeiling).toBe(false);
  tracker.record(4);
  expect(tracker.spent).toBe(10);
  expect(tracker.hasExceededCeiling).toBe(true);
});

test("recording spend past the ceiling also flips hasExceededCeiling (never silently overspends unnoticed)", () => {
  const tracker = new RunCostTracker(10);
  tracker.record(15);
  expect(tracker.hasExceededCeiling).toBe(true);
  expect(tracker.remaining).toBe(0); // never negative
});

test("estimateCallCostRupees scales with tokens and is positive for a known model", () => {
  const small = estimateCallCostRupees("claude-sonnet-5", 1000, 500);
  const large = estimateCallCostRupees("claude-sonnet-5", 10_000, 5000);
  expect(small).toBeGreaterThan(0);
  expect(large).toBeGreaterThan(small);
});

test("Opus-tier calls cost more than Sonnet-tier calls for identical token counts", () => {
  const sonnetCost = estimateCallCostRupees("claude-sonnet-5", 5000, 2000);
  const opusCost = estimateCallCostRupees("claude-opus-4-8", 5000, 2000);
  expect(opusCost).toBeGreaterThan(sonnetCost);
});

test("an unknown model falls back to the safer (higher) Opus-tier rate rather than under-estimating", () => {
  const unknownCost = estimateCallCostRupees("some-future-model", 5000, 2000);
  const opusCost = estimateCallCostRupees("claude-opus-4-8", 5000, 2000);
  expect(unknownCost).toBe(opusCost);
});

test("a custom INR/USD rate is respected", () => {
  const at80 = estimateCallCostRupees("claude-sonnet-5", 1_000_000, 0, 80);
  const at100 = estimateCallCostRupees("claude-sonnet-5", 1_000_000, 0, 100);
  expect(at100).toBeGreaterThan(at80);
});

test("RunCostTracker can be seeded with already-persisted spend (worker-restart regression, R2-37) — a run that already spent past the ceiling stays flagged even in a brand-new tracker", () => {
  const freshAfterRestart = new RunCostTracker(10, 12); // ceiling 10, persisted actual_cost 12
  expect(freshAfterRestart.spent).toBe(12);
  expect(freshAfterRestart.hasExceededCeiling).toBe(true);
  expect(freshAfterRestart.remaining).toBe(0);
});

test("a seeded tracker's remaining headroom accounts for the persisted spend, not just what happens after seeding", () => {
  const tracker = new RunCostTracker(100, 40);
  expect(tracker.remaining).toBe(60);
  tracker.record(30);
  expect(tracker.spent).toBe(70);
  expect(tracker.remaining).toBe(30);
});

test("omitting the seed still defaults to zero spend (existing behavior unchanged)", () => {
  const tracker = new RunCostTracker(10);
  expect(tracker.spent).toBe(0);
});

/**
 * Report finding #6 — `wouldExceed` (the pre-spend gate) used to be dead
 * code: `processQueuedJobs` only checked `hasExceededCeiling` (AFTER
 * spend), so a whole claimed batch could all read the same under-ceiling
 * tracker and overshoot before the next tick caught it.
 * `estimateNextCallRupees` is the conservative per-call reservation
 * `worker/index.ts` now calls `wouldExceed` with BEFORE dispatching.
 */
test("estimateNextCallRupees is a positive, non-zero reservation usable as a pre-spend gate", () => {
  const estimate = estimateNextCallRupees();
  expect(estimate).toBeGreaterThan(0);
});

test("wouldExceed(estimateNextCallRupees()) stops dispatch BEFORE a run's remaining headroom goes negative", () => {
  const perCallEstimate = estimateNextCallRupees();
  // A tracker with headroom for exactly one more call...
  const tracker = new RunCostTracker(perCallEstimate * 1.5);
  expect(tracker.hasExceededCeiling).toBe(false);
  expect(tracker.wouldExceed(perCallEstimate)).toBe(false); // one more call still fits
  tracker.record(perCallEstimate);
  // ...but a SECOND call reserved against the same estimate would now overshoot,
  // and the pre-spend gate catches that BEFORE the call is made (not after).
  expect(tracker.wouldExceed(perCallEstimate)).toBe(true);
});
