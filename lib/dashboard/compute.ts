/**
 * lib/dashboard/compute.ts — pure helpers behind the Dashboard stat tiles,
 * recent-movements feed, and usage-by-project bars.
 *
 * Kept dependency-free (no Supabase, no React) so `tests/unit/dashboard-*`
 * can exercise the business rules without a database. `lib/dashboard/queries.ts`
 * is the only caller — it fetches rows, these functions shape them.
 */

import type { MovementReason, MovementReasonDetail } from "@/types/db";
import { formatNumber } from "@/lib/format";

/* ────────────────────────────────────────────────────────────────────────────
 * Stock state — MUST agree with Inventory's Stock facet and Shelves' low dots
 * (plan/tab-dashboard.md §4: "same stockState rule: 0 = out, ≤ reorder_point
 * = low"). Each surface re-implements this tiny predicate locally (no shared
 * lib location owns it); keep this comment in sync if the rule ever changes.
 * ──────────────────────────────────────────────────────────────────────────── */

export type StockState = "ok" | "low" | "out";

export function stockStateFor(totalQty: number, reorderPoint: number | null): StockState {
  if (totalQty <= 0) return "out";
  const threshold = reorderPoint ?? 0;
  if (totalQty <= threshold) return "low";
  return "ok";
}

/* ────────────────────────────────────────────────────────────────────────────
 * Inventory value ₹ [R2-11] — Σ(total_qty × last_unit_price), unpriced parts
 * excluded from the sum. `unpricedCount` only counts parts that actually hold
 * stock (a priceless part with zero qty contributes no hidden value, so
 * counting it would make the "N unpriced" honesty label misleading).
 * ──────────────────────────────────────────────────────────────────────────── */

export interface InventoryValueInput {
  total_qty: number;
  last_unit_price: number | null;
}

export interface InventoryValueResult {
  value: number;
  unpricedCount: number;
}

export function computeInventoryValue(parts: InventoryValueInput[]): InventoryValueResult {
  let value = 0;
  let unpricedCount = 0;
  for (const p of parts) {
    if (p.last_unit_price == null) {
      if (p.total_qty > 0) unpricedCount++;
      continue;
    }
    value += p.total_qty * p.last_unit_price;
  }
  return { value, unpricedCount };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Recent movements feed
 * ──────────────────────────────────────────────────────────────────────────── */

/** "+50" / "−145" (real minus sign, en-IN grouping) — mirrors the prototype's delta chip. */
export function formatDelta(delta: number): string {
  const abs = formatNumber(Math.abs(delta));
  return delta < 0 ? `−${abs}` : `+${abs}`;
}

/** Chip tone for a delta — negative (stock leaving) reads in the orange voice. */
export function deltaTone(delta: number): "accent" | "neutral" {
  return delta < 0 ? "accent" : "neutral";
}

const REASON_LABELS: Record<MovementReason, string> = {
  pick: "pick",
  bulk_pick: "bulk pick",
  receive: "receive",
  adjust: "adjust",
  undo: "undo",
};

export interface MovementReasonLabelOptions {
  /** Joined BOM name when `movements.bom_id` is set (pick / bulk_pick context). */
  bomName?: string | null;
  reasonDetail?: MovementReasonDetail | null;
}

/**
 * "pick · TMCS_96x32" / "adjust · audit" / "receive". `smark_movements` has no
 * distributor column (that detail lives on `smark_part_events`, out of scope
 * for this read-only screen) — see dashboard report notes-for-integrator.
 */
export function movementReasonLabel(
  reason: MovementReason,
  options: MovementReasonLabelOptions = {},
): string {
  const label = REASON_LABELS[reason];
  if (options.bomName) return `${label} · ${options.bomName}`;
  if (options.reasonDetail) return `${label} · ${options.reasonDetail}`;
  return label;
}

/** Box chip text — big boxes have no short "B-12"-style code in the schema
 * (see dashboard report); shelf code + box name is the closest honest label. */
export interface BoxLabelInput {
  name: string;
  shelfCode: string | null;
}

export function composeBoxLabel(box: BoxLabelInput): string {
  return box.shelfCode ? `${box.shelfCode} · ${box.name}` : box.name;
}

/* ────────────────────────────────────────────────────────────────────────────
 * "Today" bounds — server-local calendar day (see dashboard report re: no
 * project-wide IST convention yet). Exposed with an injectable reference date
 * so tests are deterministic.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface DateRangeIso {
  start: string;
  end: string;
}

export function todayBoundsIso(reference: Date = new Date()): DateRangeIso {
  const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Usage by project bars
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ProjectUsageInput {
  projectId: string;
  name: string;
  count: number;
}

export interface ProjectUsageBar extends ProjectUsageInput {
  /** 0–100, relative to the largest count in the (already-limited) set. */
  pct: number;
}

/** Sorts desc by count, keeps the top `limit`, and scales bar widths to the max. */
export function buildProjectUsageBars(rows: ProjectUsageInput[], limit = 6): ProjectUsageBar[] {
  const sorted = [...rows].sort((a, b) => b.count - a.count).slice(0, limit);
  const max = sorted.reduce((m, r) => Math.max(m, r.count), 0);
  return sorted.map((r) => ({
    ...r,
    pct: max > 0 ? Math.round((r.count / max) * 100) : 0,
  }));
}

/** De-dupes and drops null/undefined — small helper shared by the query layer. */
export function uniq<T>(values: Array<T | null | undefined>): T[] {
  return [...new Set(values.filter((v): v is T => v != null))];
}
