/**
 * lib/audit/variance.ts — pure math for the guided box-audit (no I/O).
 * Kept separate from `actions.ts` (the DB-writing server action) so the
 * decision logic is unit-testable without a Supabase connection.
 */

import type { AuditContentItem } from "./types";

/** Signed delta a counted quantity implies against the last recorded qty. */
export function computeDelta(recordedQty: number, countedQty: number): number {
  return countedQty - recordedQty;
}

/** Whether confirming `countedQty` against `recordedQty` is a variance (→ an `adjust` movement). */
export function isVariance(recordedQty: number, countedQty: number): boolean {
  return computeDelta(recordedQty, countedQty) !== 0;
}

interface LastCountedAt {
  last_counted_at: string | null;
}

/**
 * Box-header "last audited {date}" (plan/tab-shelves.md §2). There is no
 * per-box column — `last_counted_at` lives on each ESD location
 * (SCHEMA.md §2) — so the box's assurance is only as fresh as its STALEST
 * location: the earliest `last_counted_at` across its current contents, or
 * `null` ("not yet audited") if any location has never been counted or the
 * box is empty. This also makes a PARTIAL audit visible: counting half the
 * box doesn't move the header until every location has a stamp.
 */
export function deriveBoxLastAuditedAt(locations: readonly LastCountedAt[]): string | null {
  if (locations.length === 0) return null;

  let earliestRaw: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;
  for (const location of locations) {
    if (location.last_counted_at === null) return null;
    const ms = new Date(location.last_counted_at).getTime();
    if (Number.isNaN(ms)) continue;
    if (ms < earliestMs) {
      earliestMs = ms;
      earliestRaw = location.last_counted_at;
    }
  }
  return earliestRaw;
}

/** First ESD in walk order not yet confirmed this session, or `null` when the walk is complete. */
export function nextPendingLocationId(
  items: readonly Pick<AuditContentItem, "locationId">[],
  doneIds: ReadonlySet<string>,
): string | null {
  const next = items.find((item) => !doneIds.has(item.locationId));
  return next ? next.locationId : null;
}

export interface AuditCompletion {
  done: number;
  total: number;
}

/** "{done} of {total} counted" — also what decides whether the audit is finished. */
export function auditCompletionCount(
  items: readonly Pick<AuditContentItem, "locationId">[],
  doneIds: ReadonlySet<string>,
): AuditCompletion {
  const total = items.length;
  const done = items.reduce((count, item) => (doneIds.has(item.locationId) ? count + 1 : count), 0);
  return { done, total };
}

/** An audit walk with zero ESDs (empty box) has nothing to do — never "in progress". */
export function isAuditComplete(completion: AuditCompletion): boolean {
  return completion.total > 0 && completion.done >= completion.total;
}
