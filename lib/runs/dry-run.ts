/**
 * lib/runs/dry-run.ts — pure, DB-free helpers for the Ordering Workspace's
 * dry-run ₹ estimate (plan/tab-ordering-workspace.md §2.5: "Agents per item …
 * dry-run cost estimate lives here") and the "saved run went stale" flag
 * (plan/tab-ordering-workspace.md R2-27 / SCHEMA.md §3: "Changing build_qty
 * after a run marks the saved run stale — app-level flag", i.e. NOT a DB
 * column; see supabase/migrations/0003_projects_boms.sql's own comment).
 *
 * Cost model (documented assumption — no live ANTHROPIC_API_KEY exists to
 * calibrate against, per FEATURES.md §0/build brief "NO LIVE KEYS EXIST"):
 * one Opus planning call per run + one Sonnet item-agent call per (to-order
 * line × ladder-depth attempt) the concurrency tier allows, at a flat
 * per-call token estimate, converted to ₹ at a blended rate. This mirrors
 * `worker/src/caps.ts`'s real per-model $/1M-token table and its
 * `DEFAULT_INR_PER_USD` conversion (kept independent, not imported — see
 * docs/OWNERSHIP.md: bom-pipeline does not import worker/src/**) so both
 * sides land in the same ballpark without a hard cross-package dependency.
 * Recalibrate both constants together once a real key exists and actual
 * costs can be compared against this estimate.
 */

import { CONCURRENCY_TIER_PRESETS, type ConcurrencyPreset } from "@/types/worker";

/** Average input+output tokens for one Sonnet item-agent search+compare call. */
export const TOKENS_PER_ITEM_CALL = 2500;
/** One Opus planning call per run, regardless of line count (single call, bigger context). */
export const TOKENS_PER_MASTER_CALL = 4000;
/** Blended ₹ per 1,000 tokens across the master (Opus) + item (Sonnet) calls — see module doc. */
export const RUPEES_PER_1K_TOKENS = 1.5;

export interface DryRunEstimateInput {
  /** Count of BOM lines that need sourcing (match_state != 'in_stock') — in-stock lines never reach the worker. */
  toOrderLineCount: number;
  tier: ConcurrencyPreset;
}

export interface DryRunEstimate {
  /** Sonnet item-agent calls the tier's ladder depth implies, one master (Opus) call. */
  estimatedCalls: number;
  estimatedTokens: number;
  estimatedRupees: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pure fn: lines × tier depth × per-call token estimate (+ one flat master
 * call), converted to ₹. Zero to-order lines still costs the one master call
 * (Opus still reads the BOM/rules even if it plans zero searches) — callers
 * that want to hide the estimate entirely for an empty BOM should check
 * `toOrderLineCount === 0` themselves before rendering it.
 */
export function computeDryRunEstimate(input: DryRunEstimateInput): DryRunEstimate {
  const { depthPerItem } = CONCURRENCY_TIER_PRESETS[input.tier];
  const itemCalls = Math.max(0, input.toOrderLineCount) * depthPerItem;
  const estimatedCalls = itemCalls + 1; // + 1 master planning call
  const estimatedTokens = itemCalls * TOKENS_PER_ITEM_CALL + TOKENS_PER_MASTER_CALL;
  const estimatedRupees = round2((estimatedTokens / 1000) * RUPEES_PER_1K_TOKENS);
  return { estimatedCalls, estimatedTokens, estimatedRupees };
}

/**
 * A per-run ₹ ceiling the worker must never exceed (FEATURES §15/§18,
 * `types/worker.ts` `WorkerRunConfig.rupeeCeiling`). No Settings knob exists
 * yet for an owner-set override, so this is generous-but-bounded headroom
 * over the dry-run estimate: 4× the estimate, floored at ₹100 so a tiny BOM
 * still has room for a slower-than-estimated run. Judgment call — flagged in
 * this package's report for a future Settings field.
 */
export function computeRupeeCeiling(estimate: DryRunEstimate): number {
  return Math.max(100, round2(estimate.estimatedRupees * 4));
}

export interface StaleCheckInput {
  /** `smark_boms.build_qty` right now. */
  currentBuildQty: number;
  /** `build_qty` captured on the saved run at enqueue time (app-level metadata — see lib/runs/config.ts). */
  runBuildQtyAtEnqueue: number | null;
}

/**
 * "Changing build_qty after a run marks the saved run stale" — app-level
 * flag (no DB column; SCHEMA.md §3). `runBuildQtyAtEnqueue == null` (e.g. a
 * malformed/legacy run) is treated as NOT stale rather than throwing — the
 * banner is a helpful nudge, not a correctness gate.
 */
export function isRunStale(input: StaleCheckInput): boolean {
  if (input.runBuildQtyAtEnqueue == null) return false;
  return input.currentBuildQty !== input.runBuildQtyAtEnqueue;
}
