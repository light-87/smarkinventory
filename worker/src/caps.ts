/**
 * worker/src/caps.ts — FEATURES.md §15/§18: "fixed small per-site
 * concurrency cap that ALWAYS overrides the user knob" + the per-run ₹
 * ceiling (abort past it, write `actual_cost` either way).
 *
 * Two independent concerns live here:
 *   1. Concurrency clamp — a distributor-keyed ceiling nothing (not the
 *      Economy/Balanced/Thorough tier, not a Settings default, not a future
 *      per-BOM override) can raise. `clampToSiteCap` is the single function
 *      every call site MUST route through before touching a distributor.
 *   2. Cost ceiling — turns Claude token usage into a ₹ estimate (rough,
 *      documented conversion) and gives the run loop a hard abort signal.
 */

import type { ConcurrencyPreset, ConcurrencyTierConfig, PerSiteCapMap } from "../../types/worker";
import { CONCURRENCY_TIER_PRESETS } from "../../types/worker";

/**
 * The fixed per-site cap (FEATURES §15). Deliberately a plain constant, not
 * env/Settings-configurable from here — Settings (app-side) may show a
 * per-distributor "budget" for humans, but THIS number is the worker's own
 * hard safety ceiling and does not read that config. Unknown/added
 * distributors (Settings "+ Add site") fall back to `DEFAULT_SITE_CAP`.
 */
export const PER_SITE_CAPS: PerSiteCapMap = {
  Digikey: 3,
  Mouser: 3,
  element14: 2,
  LCSC: 1, // BrowserDriver path — human-paced, anti-bot posture (FEATURES §0/§15)
  Unikey: 1,
};

export const DEFAULT_SITE_CAP = 1;

/** Absolute ceiling on parallel item-agents regardless of tier — a second, coarser safety net. */
export const MAX_FANOUT_WIDTH = 8;

function siteCapFor(distributorName: string): number {
  return PER_SITE_CAPS[distributorName] ?? DEFAULT_SITE_CAP;
}

/**
 * The one function every dispatch path calls before deciding how many
 * concurrent requests to send a given distributor. `requested` is whatever
 * the tier/user knob asked for — this NEVER returns more than the fixed cap.
 */
export function clampToSiteCap(distributorName: string, requested: number): number {
  const cap = siteCapFor(distributorName);
  return Math.max(1, Math.min(requested, cap));
}

/** Resolves a tier to its fanout/depth config, then clamps fanout to the absolute ceiling. */
export function resolveTier(preset: ConcurrencyPreset): ConcurrencyTierConfig {
  const base = CONCURRENCY_TIER_PRESETS[preset];
  return { ...base, fanoutWidth: Math.min(base.fanoutWidth, MAX_FANOUT_WIDTH) };
}

/**
 * A tiny per-key counting semaphore — used to keep in-flight requests to one
 * distributor at or below its clamped cap even when many item-agents run
 * concurrently across different BOM lines.
 */
export class KeyedSemaphore {
  private readonly limits = new Map<string, number>();
  private readonly inFlight = new Map<string, number>();
  private readonly waiters = new Map<string, Array<() => void>>();

  constructor(private readonly limitFor: (key: string) => number) {}

  private limit(key: string): number {
    let limit = this.limits.get(key);
    if (limit === undefined) {
      limit = this.limitFor(key);
      this.limits.set(key, limit);
    }
    return limit;
  }

  async acquire(key: string): Promise<() => void> {
    const current = this.inFlight.get(key) ?? 0;
    if (current < this.limit(key)) {
      this.inFlight.set(key, current + 1);
      return () => this.release(key);
    }
    await new Promise<void>((resolve) => {
      const queue = this.waiters.get(key) ?? [];
      queue.push(resolve);
      this.waiters.set(key, queue);
    });
    // Woken by `release()`, which hands its permit DIRECTLY to us (see
    // below) without ever decrementing `inFlight` in between — so we must
    // NOT re-increment here. The old code decremented on release, woke the
    // waiter, and only re-incremented once the waiter resumed; that left a
    // window (between the decrement and this line running, i.e. a whole
    // scheduler tick since resolving a promise only schedules a microtask)
    // where `inFlight` read transiently low, and a completely unrelated
    // `acquire()` call landing in that window would read `current < limit`
    // and wrongly grab a second, concurrent permit — defeating the fixed
    // per-site cap (FEATURES §15) for exactly the anti-bot-posture sites
    // (LCSC/Unikey, cap 1) that most need it held to.
    return () => this.release(key);
  }

  private release(key: string): void {
    const queue = this.waiters.get(key);
    const next = queue?.shift();
    if (next) {
      // Hand the permit straight to the next waiter — `inFlight` is left
      // unchanged (still "held", just by a different caller now), so no
      // acquire() racing in this same window can observe a transiently
      // freed slot and sneak in an extra concurrent permit.
      next();
      return;
    }
    const current = this.inFlight.get(key) ?? 0;
    this.inFlight.set(key, Math.max(0, current - 1));
  }
}

/** A KeyedSemaphore pre-wired to the fixed per-site caps above. */
export function createSiteSemaphore(): KeyedSemaphore {
  return new KeyedSemaphore(siteCapFor);
}

/* ────────────────────────────────────────────────────────────────────────────
 * ₹ ceiling
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * $/1M-token rates (cached from the Claude API skill, 2026-06-24). Kept as a
 * small table rather than hardcoding two numbers so adding a model tier
 * later is a one-line change, not a refactor.
 */
const USD_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
};
const DEFAULT_RATE = { input: 5, output: 25 }; // unknown model → assume Opus-tier (safer over-estimate)

/** Rough, documented USD→INR conversion. Override via env if the integrator wants a live rate. */
export const DEFAULT_INR_PER_USD = 83;

export function estimateCallCostRupees(
  model: string,
  tokensIn: number,
  tokensOut: number,
  inrPerUsd: number = DEFAULT_INR_PER_USD,
): number {
  const rate = USD_PER_MILLION_TOKENS[model] ?? DEFAULT_RATE;
  const usd = (tokensIn / 1_000_000) * rate.input + (tokensOut / 1_000_000) * rate.output;
  return usd * inrPerUsd;
}

/**
 * Conservative worst-case token shape for ONE item-agent Claude call
 * (worker/src/item-agent.ts hard-caps `maxTokens: 800`; input scales with the
 * candidate-listing count but rarely runs past a few thousand tokens for this
 * catalog's line sizes). Passing an unrecognized model name into
 * `estimateCallCostRupees` falls back to `DEFAULT_RATE` (Opus-tier pricing),
 * keeping this an over-, not under-, estimate regardless of which item model
 * is actually configured.
 */
const ESTIMATED_NEXT_CALL_TOKENS = { input: 3000, output: 800 };

/**
 * The pre-spend reservation `RunCostTracker.wouldExceed` should be called
 * with BEFORE dispatching a new item-agent job — see this package's report
 * finding #6: without it, the ceiling was only checked AFTER each job's own
 * spend landed, so a whole claimed batch (up to `FANOUT_BATCH_LIMIT`) could
 * all read the same under-ceiling tracker and overshoot by up to a batch's
 * worth of calls before the NEXT tick caught it.
 */
export function estimateNextCallRupees(inrPerUsd: number = DEFAULT_INR_PER_USD): number {
  return estimateCallCostRupees("__unknown-conservative-estimate__", ESTIMATED_NEXT_CALL_TOKENS.input, ESTIMATED_NEXT_CALL_TOKENS.output, inrPerUsd);
}

/** Accumulates spend across a run and answers "would the NEXT call push us over the ceiling?". */
export class RunCostTracker {
  private spentRupees: number;

  /**
   * `initialSpentRupees` seeds the tally from whatever `smark_agent_runs.actual_cost`
   * already holds (FEATURES §15/§18). Without this, a worker restart mid-run
   * (this service's documented operational model — "restart on crash",
   * worker/index.ts's own header) resets in-memory spend to 0 while the
   * persisted `actual_cost` survives, so `hasExceededCeiling` would report
   * false and let a run that already reached its ₹ ceiling spend up to a
   * FULL ceiling again after every restart.
   */
  constructor(private readonly ceilingRupees: number, initialSpentRupees = 0) {
    this.spentRupees = initialSpentRupees;
  }

  get spent(): number {
    return this.spentRupees;
  }

  get remaining(): number {
    return Math.max(0, this.ceilingRupees - this.spentRupees);
  }

  /** True once cumulative spend has reached the ceiling — the run loop should stop dispatching. */
  get hasExceededCeiling(): boolean {
    return this.spentRupees >= this.ceilingRupees;
  }

  /** True if `nextCallRupees` would push cumulative spend past the ceiling — call BEFORE spending. */
  wouldExceed(nextCallRupees: number): boolean {
    return this.spentRupees + nextCallRupees > this.ceilingRupees;
  }

  record(rupees: number): void {
    this.spentRupees += rupees;
  }
}
