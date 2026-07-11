/**
 * lib/settings/types.ts — shared shapes for the Settings surface
 * (plan/tab-settings.md, FEATURES.md §5.16 / §7 / §13).
 *
 * Kept separate from `types/db.ts` (integrator-owned) — these are
 * package-local VIEW shapes (joined/shaped for the UI), not DB row
 * contracts. Mirrors lib/expenses/types.ts's `ActionResult` convention.
 */

import type { ConcurrencyPreset, DistributorApiType, DistributorRow, OrderingRuleKey, OrderingRuleRow, PartFieldTemplateRow } from "@/types/db";

/** Result envelope shared by every mutating Server Action (mirrors lib/expenses/types.ts). */
export type ActionResult<T extends Record<string, unknown> = { id: string }> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/* ────────────────────────────────────────────────────────────────────────────
 * Standard search ladder (FEATURES.md §7)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Display copy for the 7 standard rungs — `custom` rows carry their own free-text label in `params`. */
export const STANDARD_RULE_LABELS: Record<Exclude<OrderingRuleKey, "custom">, string> = {
  mpn: "MPN — exact match, then known equivalents",
  lcsc: "LCSC PN — if present, search LCSC only",
  value: "Value — R: value/tolerance/wattage · C: value/voltage/dielectric",
  package: "Package — mandatory, never substitutable",
  status: "Part status — Active > NRND > EOL",
  qty: "Quantity — ≥ the multiplied need",
  cost: "Cost — lowest, all else equal",
};

/** A rule row shaped for display: the free-text label already resolved (standard copy or custom `params.label`). */
export interface OrderingRuleItem {
  row: OrderingRuleRow;
  label: string;
}

/** The one row the DB (migration 0004 trigger + CHECK) and the UI both refuse to remove. */
export function isRulePinned(row: Pick<OrderingRuleRow, "key" | "mandatory">): boolean {
  return row.key === "package" || row.mandatory;
}

export function labelForRule(row: OrderingRuleRow): string {
  if (row.key === "custom") {
    const params = row.params as { label?: unknown } | null;
    return typeof params?.label === "string" && params.label.trim().length > 0 ? params.label : "Custom rule";
  }
  return STANDARD_RULE_LABELS[row.key];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Distributors (FEATURES.md §15, R2-28 "addable")
 * ──────────────────────────────────────────────────────────────────────────── */

/** `smark_distributors.api_type` as a Settings-facing method choice — `none` isn't offered by "+ Add distributor". */
export type DistributorMethod = "rest" | "browse";

export const ADDABLE_DISTRIBUTOR_METHODS: readonly { value: DistributorMethod; label: string }[] = [
  { value: "rest", label: "REST-with-key" },
  { value: "browse", label: "Browser-agent" },
];

/** Display label for any `api_type`, including the legacy/unused `none` a row could carry. */
export const DISTRIBUTOR_METHOD_LABELS: Record<DistributorApiType, string> = {
  rest: "REST-with-key",
  browse: "Browser-agent",
  none: "No integration",
};

export interface DistributorItem {
  row: DistributorRow;
}

/* ────────────────────────────────────────────────────────────────────────────
 * App-wide config (label size / low-stock default / concurrency default)
 * — no backing table exists yet (see lib/settings/app-config.ts header).
 * ──────────────────────────────────────────────────────────────────────────── */

export const LABEL_SIZE_OPTIONS = [{ value: "avery_l7651", label: "Avery L7651 · 38×21mm (65/sheet)" }] as const;
export type LabelSize = (typeof LABEL_SIZE_OPTIONS)[number]["value"];

export interface AppConfig {
  labelSize: LabelSize;
  lowStockDefaultThreshold: number | null;
  concurrencyDefault: ConcurrencyPreset;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  labelSize: "avery_l7651",
  lowStockDefaultThreshold: null,
  concurrencyDefault: "balanced",
};

/* ────────────────────────────────────────────────────────────────────────────
 * Retire remembered custom part fields (R2-23, real `smark_part_field_templates`)
 * ──────────────────────────────────────────────────────────────────────────── */

export type PartFieldTemplateItem = PartFieldTemplateRow;
