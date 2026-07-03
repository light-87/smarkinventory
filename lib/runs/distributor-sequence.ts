/**
 * lib/runs/distributor-sequence.ts — pure resolver for the Ordering
 * Workspace's "Distributor sequence" card (plan/tab-ordering-workspace.md
 * §2.1) and the enqueue contract's `WorkerRunConfig.distributorSequence`
 * (types/worker.ts).
 *
 * `smark_boms.distributor_sequence` starts `null` (SCHEMA.md §3) — this
 * function computes what to SHOW/RUN in that case from the global
 * `smark_distributor_preferences` defaults, forcing Unikey off per
 * plan/tab-ordering-workspace.md §2.1 ("defaults from global preferences.
 * Unikey defaults OFF") even though `supabase/seed.sql` seeds every
 * distributor `enabled: true` in preferences — the per-BOM default is a
 * DELIBERATE narrowing of the global default, not a preferences bug. Once a
 * BOM has its own saved sequence, that sequence wins outright (including a
 * user re-enabling Unikey) and any distributor missing from it (soft-deleted
 * / never seen before) is appended at the end, enabled by the same rule.
 *
 * Pure — no I/O — so both the workspace's read path and `lib/runs/enqueue.ts`
 * call this and always agree on "what does this BOM's sequence actually
 * mean right now", and it's directly unit-testable
 * (tests/unit/runs-distributor-sequence.test.ts).
 */

import type { DistributorApiType, DistributorSequenceItem } from "@/types/db";

export interface DistributorRefRow {
  id: string;
  name: string;
  api_type: DistributorApiType;
  active: boolean;
}

export interface DistributorPreferenceRefRow {
  distributor_id: string;
  rank: number;
  enabled: boolean;
}

export interface EffectiveDistributorRow {
  id: string;
  name: string;
  apiType: DistributorApiType;
  enabled: boolean;
  /** 1-based position — the drag-reorder order, and the order agents try sites in. */
  rank: number;
}

function isUnikey(name: string): boolean {
  return name.trim().toLowerCase() === "unikey";
}

/**
 * Resolves the effective, ordered distributor sequence for a BOM.
 *
 * - `savedSequence` non-empty → that order/toggles win; distributors it
 *   references that no longer exist/aren't active are dropped; any active
 *   distributor NOT yet in it (e.g. added via Settings after this BOM's
 *   sequence was saved) is appended at the end (Unikey still forced off).
 * - `savedSequence` null/empty → build from `smark_distributor_preferences`
 *   rank order (unranked distributors sort last, stable by name), Unikey off.
 */
export function resolveDistributorSequence(
  savedSequence: readonly DistributorSequenceItem[] | null,
  distributors: readonly DistributorRefRow[],
  preferences: readonly DistributorPreferenceRefRow[],
): EffectiveDistributorRow[] {
  const activeById = new Map(distributors.filter((d) => d.active).map((d) => [d.id, d] as const));

  if (savedSequence && savedSequence.length > 0) {
    const rows: EffectiveDistributorRow[] = [];
    const seen = new Set<string>();
    for (const item of savedSequence) {
      const d = activeById.get(item.distributor_id);
      if (!d || seen.has(d.id)) continue;
      seen.add(d.id);
      rows.push({ id: d.id, name: d.name, apiType: d.api_type, enabled: item.enabled, rank: rows.length + 1 });
    }
    for (const d of distributors) {
      if (!d.active || seen.has(d.id)) continue;
      seen.add(d.id);
      rows.push({ id: d.id, name: d.name, apiType: d.api_type, enabled: !isUnikey(d.name), rank: rows.length + 1 });
    }
    return rows;
  }

  const prefByDistributor = new Map(preferences.map((p) => [p.distributor_id, p] as const));
  const ranked = [...distributors.filter((d) => d.active)].sort((a, b) => {
    const rankA = prefByDistributor.get(a.id)?.rank ?? Number.MAX_SAFE_INTEGER;
    const rankB = prefByDistributor.get(b.id)?.rank ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.name.localeCompare(b.name);
  });

  return ranked.map((d, index) => ({
    id: d.id,
    name: d.name,
    apiType: d.api_type,
    enabled: isUnikey(d.name) ? false : (prefByDistributor.get(d.id)?.enabled ?? true),
    rank: index + 1,
  }));
}

/** `EffectiveDistributorRow[]` → the jsonb shape persisted onto `smark_boms.distributor_sequence`. */
export function toStoredSequence(rows: readonly EffectiveDistributorRow[]): DistributorSequenceItem[] {
  return rows.map((r) => ({ distributor_id: r.id, enabled: r.enabled }));
}
