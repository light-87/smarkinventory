import { describe, expect, test } from "bun:test";
import { computeDryRunEstimate, computeRupeeCeiling, isRunStale, RUPEES_PER_1K_TOKENS, TOKENS_PER_ITEM_CALL, TOKENS_PER_MASTER_CALL } from "@/lib/runs/dry-run";

/**
 * Pure dry-run ₹ estimate + "saved run went stale" flag
 * (plan/tab-ordering-workspace.md §2.5 / R2-27; lib/runs/dry-run.ts module
 * doc). Both are DB-free — this covers the same ground the ordering
 * workspace's tier picker and enqueue/re-run paths depend on agreeing on.
 */

describe("computeDryRunEstimate", () => {
  test("zero to-order lines still costs exactly one master planning call", () => {
    const estimate = computeDryRunEstimate({ toOrderLineCount: 0, tier: "balanced" });
    expect(estimate.estimatedCalls).toBe(1);
    expect(estimate.estimatedTokens).toBe(TOKENS_PER_MASTER_CALL);
    expect(estimate.estimatedRupees).toBeCloseTo((TOKENS_PER_MASTER_CALL / 1000) * RUPEES_PER_1K_TOKENS, 5);
  });

  test("scales linearly with to-order line count at a fixed tier", () => {
    const one = computeDryRunEstimate({ toOrderLineCount: 1, tier: "economy" });
    const ten = computeDryRunEstimate({ toOrderLineCount: 10, tier: "economy" });
    // economy depthPerItem = 2 (types/worker.ts CONCURRENCY_TIER_PRESETS) → 1 line = 2 item calls + 1 master.
    expect(one.estimatedCalls).toBe(2 + 1);
    expect(ten.estimatedCalls).toBe(20 + 1);
    expect(ten.estimatedTokens).toBe(20 * TOKENS_PER_ITEM_CALL + TOKENS_PER_MASTER_CALL);
  });

  test("a deeper tier costs more for the same line count (economy < balanced < thorough)", () => {
    const economy = computeDryRunEstimate({ toOrderLineCount: 5, tier: "economy" });
    const balanced = computeDryRunEstimate({ toOrderLineCount: 5, tier: "balanced" });
    const thorough = computeDryRunEstimate({ toOrderLineCount: 5, tier: "thorough" });
    expect(economy.estimatedRupees).toBeLessThan(balanced.estimatedRupees);
    expect(balanced.estimatedRupees).toBeLessThan(thorough.estimatedRupees);
  });

  test("rupee estimate is rounded to 2 decimal places", () => {
    const estimate = computeDryRunEstimate({ toOrderLineCount: 3, tier: "balanced" });
    const decimals = (estimate.estimatedRupees.toString().split(".")[1] ?? "").length;
    expect(decimals).toBeLessThanOrEqual(2);
  });

  test("a negative line count never produces a negative call count (floored at zero item calls)", () => {
    const estimate = computeDryRunEstimate({ toOrderLineCount: -5, tier: "balanced" });
    expect(estimate.estimatedCalls).toBe(1); // just the master call
  });
});

describe("computeRupeeCeiling", () => {
  test("is 4× the dry-run estimate", () => {
    const estimate = computeDryRunEstimate({ toOrderLineCount: 10, tier: "balanced" });
    expect(computeRupeeCeiling(estimate)).toBeCloseTo(estimate.estimatedRupees * 4, 5);
  });

  test("floors at ₹100 for a tiny/empty BOM", () => {
    const estimate = computeDryRunEstimate({ toOrderLineCount: 0, tier: "economy" });
    expect(computeRupeeCeiling(estimate)).toBe(100);
  });
});

describe("isRunStale — R2-27 build_qty change flag", () => {
  test("false when build_qty is unchanged since the run was enqueued", () => {
    expect(isRunStale({ currentBuildQty: 10, runBuildQtyAtEnqueue: 10 })).toBe(false);
  });

  test("true when build_qty changed (up or down) since the run was enqueued", () => {
    expect(isRunStale({ currentBuildQty: 20, runBuildQtyAtEnqueue: 10 })).toBe(true);
    expect(isRunStale({ currentBuildQty: 1, runBuildQtyAtEnqueue: 10 })).toBe(true);
  });

  test("treats a missing/legacy runBuildQtyAtEnqueue as not stale (a helpful nudge, not a correctness gate)", () => {
    expect(isRunStale({ currentBuildQty: 20, runBuildQtyAtEnqueue: null })).toBe(false);
  });
});
