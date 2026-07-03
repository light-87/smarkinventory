/**
 * lib/dashboard/compute.ts — pure helpers behind the Dashboard stat tiles,
 * recent-movements feed, and usage-by-project bars.
 *
 * Kept dependency-free (no Supabase, no React) so `tests/unit/dashboard-*`
 * can exercise the business rules without a database. `lib/dashboard/queries.ts`
 * is the only caller — it fetches rows, these functions shape them.
 */

import { formatDistanceStrict, isValid, parseISO } from "date-fns";
import type { AgentRunStatus, MovementReason, MovementReasonDetail } from "@/types/db";
import type { WorkerRunPlanColumn } from "@/types/worker";
import { formatINR, formatNumber } from "@/lib/format";
import { istDayBoundsIso } from "@/lib/timezone";

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
 * "Today" bounds — the Asia/Kolkata (IST) calendar day (finding #4: this used
 * to be server-local, which mis-bucketed every 00:00–05:30 IST event into the
 * previous day on a UTC runtime — see lib/timezone.ts). Exposed with an
 * injectable reference date so tests are deterministic.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface DateRangeIso {
  start: string;
  end: string;
}

export function todayBoundsIso(reference: Date = new Date()): DateRangeIso {
  return istDayBoundsIso(reference);
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

/* ────────────────────────────────────────────────────────────────────────────
 * Agent activity card (dashboard's WF-3 slice, plan/tab-dashboard.md).
 *
 * IMPORTANT read-access note: `smark_agent_results` and `smark_order_jobs`
 * are RLS-locked to `service_role` ONLY (supabase/migrations/0004_ordering_
 * finance.sql — "no UI surface reads this table directly", by design), and
 * this dashboard's Server/Client Components use the RLS-bound request client
 * (HARD RULES: "RLS clients in app routes"). That means the per-line
 * "done/total" progress the worker tracks while a run is `running` is NOT
 * observable from here — only `smark_agent_runs` (readable by all three
 * roles) is. `total` is recovered from the enqueue envelope
 * (`smark_agent_runs.plan.config.lines`, written before the worker ever
 * claims a job); `done` is only knowable at the run's terminal edges
 * (`review`/`done` ⇒ every line finished, by construction of the worker's
 * forward-only status walk — see worker/src/runs.ts markRunReviewIfComplete).
 * While `running`, `done` reads `null` (indeterminate) rather than a
 * fabricated number — see notes-for-integrator for the proper fix (a
 * SECURITY DEFINER view/function exposing just the counts, mirroring the
 * portal's read-function pattern).
 * ──────────────────────────────────────────────────────────────────────────── */

function toDateSafe(input: string | null | undefined): Date | null {
  if (!input) return null;
  const date = parseISO(input);
  return isValid(date) ? date : null;
}

/** Total to-order lines dispatched for a run, from the enqueue envelope
 * (`smark_agent_runs.plan`, types/worker.ts `WorkerRunPlanColumn`). `null`
 * when the column is empty/malformed (e.g. a worker-test fixture that never
 * wrote `plan`) rather than throwing — this card degrades, never crashes. */
export function extractRunTotalLines(plan: unknown): number | null {
  if (!plan || typeof plan !== "object") return null;
  const envelope = plan as Partial<WorkerRunPlanColumn>;
  const lines = envelope.config?.lines;
  return Array.isArray(lines) ? lines.length : null;
}

export interface RunLaneProgress {
  total: number | null;
  /** null = indeterminate (see file-header note above). */
  done: number | null;
}

/** Forward-only run statuses (types/db.ts `AgentRunStatusSchema`) mapped to
 * what "done" can honestly claim under RLS. */
export function computeRunLaneProgress(
  status: AgentRunStatus,
  totalLines: number | null,
): RunLaneProgress {
  if (totalLines == null) return { total: null, done: null };
  if (status === "planning") return { total: totalLines, done: 0 };
  if (status === "review" || status === "done") return { total: totalLines, done: totalLines };
  return { total: totalLines, done: null }; // running / failed — genuinely unknown here
}

/** "8 of 8 lines" / "6 lines" (indeterminate) / "no to-order lines" / "—". */
export function formatLaneProgress(progress: RunLaneProgress): string {
  const { total, done } = progress;
  if (total == null) return "—";
  if (total === 0) return "no to-order lines";
  const unit = total === 1 ? "line" : "lines";
  if (done == null) return `${formatNumber(total)} ${unit}`;
  return `${formatNumber(done)} of ${formatNumber(total)} ${unit}`;
}

const RUN_STATUS_LABELS: Record<AgentRunStatus, string> = {
  planning: "Planning",
  running: "Running",
  review: "Needs review",
  done: "Done",
  failed: "Failed",
};

export function runStatusLabel(status: AgentRunStatus): string {
  return RUN_STATUS_LABELS[status];
}

/** Subset of `ChipTone` (components/ui/chip.tsx) — kept as a local string
 * union rather than importing that .tsx's type so this file stays
 * dependency-free (no React/JSX in its module graph). Every value here is a
 * valid `ChipTone` string. The design system has exactly one alert color
 * (orange/"accent" — see chip.tsx's own doc comment "low stock, running,
 * alerts"), so `running` and `failed` intentionally share it; the label text
 * is what tells them apart, same as Inventory's "Out of stock" tile. */
export type RunStatusToneKey = "default" | "accent" | "soft";

const RUN_STATUS_TONES: Record<AgentRunStatus, RunStatusToneKey> = {
  planning: "default",
  running: "accent",
  review: "soft",
  done: "default",
  failed: "accent",
};

export function runStatusTone(status: AgentRunStatus): RunStatusToneKey {
  return RUN_STATUS_TONES[status];
}

export function isRunActive(status: AgentRunStatus): boolean {
  return status === "planning" || status === "running";
}

/** "3 minutes elapsed" for an in-flight run — `reference` is injectable for
 * deterministic tests (same convention as `todayBoundsIso`). */
export function formatElapsed(startIso: string, reference: Date = new Date()): string {
  const start = toDateSafe(startIso);
  if (!start) return "—";
  return `${formatDistanceStrict(start, reference)} elapsed`;
}

/** "5 minutes ago" for a finished run. `smark_agent_runs` has no dedicated
 * `finished_at` column — callers pass `updated_at` (stamped by
 * `trg_smark_agent_runs_updated_at` on every status flip, and nothing else
 * mutates a terminal run's row) as the best available proxy. */
export function formatFinishedAgo(finishedIso: string | null, reference: Date = new Date()): string {
  const finished = toDateSafe(finishedIso);
  if (!finished) return "—";
  return formatDistanceStrict(finished, reference, { addSuffix: true });
}

export interface RunCostDisplay {
  text: string;
  /** True when showing `est_cost` because `actual_cost` isn't posted yet. */
  isEstimate: boolean;
}

/** `actual_cost` once the worker has spent something; falls back to
 * `est_cost` (dry-run estimate) beforehand; "—" when neither exists yet. */
export function formatRunCost(actualCost: number | null, estCost: number | null): RunCostDisplay {
  if (actualCost != null) return { text: formatINR(actualCost), isEstimate: false };
  if (estCost != null) return { text: formatINR(estCost), isEstimate: true };
  return { text: "—", isEstimate: false };
}
