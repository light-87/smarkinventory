/**
 * lib/runs/stock.ts — the single shared "is this option low on stock?" rule, so
 * the review highlight (components/review/review-line-card.tsx) and the desktop
 * low-stock alternative re-run (lib/runs/enqueue.ts createDesktopRun) always
 * agree. Null stock = unknown = NOT low (mirrors worker/src/matcher-lite.ts's
 * `stockQty === null || stockQty >= needed` convention).
 */
export function isLowStock(stockQty: number | null, neededQty: number): boolean {
  return stockQty != null && stockQty < neededQty;
}

/** Confidence below this (0–100) is flagged "verify manually" in the review. */
export const LOW_CONFIDENCE_MAX = 50;
