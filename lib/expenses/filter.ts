/**
 * lib/expenses/filter.ts — pure entry-list filtering (month/type/category/
 * account/project), shared unmodified between the interactive client
 * (hooks/use-expense-filters.ts) and the CSV/xlsx export route
 * (app/(app)/expenses/export/route.ts) — same shape as lib/inventory/filter.ts,
 * so a click on Export always downloads exactly the on-screen filtered rows.
 *
 * Soft-deleted rows are excluded at the QUERY layer primarily
 * (lib/expenses/queries.ts's `getEntries` never selects `deleted_at is not
 * null`) — `isVisibleEntry`/`filterEntries` below are a second, pure line of
 * defense: even if a caller ever hands this module a row with `deleted_at`
 * set (a stale cache, a future query bug), it never renders. That's the
 * behavior tests/unit/expenses-filter.test.ts's "soft delete" cases pin.
 */

import { monthPeriodOf } from "./period";
import { EMPTY_ENTRY_FILTERS, FILTER_ALL, type EntryFilters } from "./types";
import type { EntryListItem } from "./types";

/** A soft-deleted entry is never visible, regardless of filters (defense in depth — see module doc). */
export function isVisibleEntry(entry: EntryListItem): boolean {
  return entry.deleted_at == null;
}

export function matchesEntryFilters(entry: EntryListItem, filters: EntryFilters): boolean {
  if (!isVisibleEntry(entry)) return false;
  if (filters.month !== FILTER_ALL && monthPeriodOf(entry.entry_date) !== filters.month) return false;
  if (filters.type !== FILTER_ALL && entry.entry_type !== filters.type) return false;
  if (filters.category !== FILTER_ALL && entry.category !== filters.category) return false;
  if (filters.accountId !== FILTER_ALL && entry.account_id !== filters.accountId) return false;
  if (filters.projectId !== FILTER_ALL && entry.project_id !== filters.projectId) return false;
  return true;
}

export function filterEntries(entries: readonly EntryListItem[], filters: EntryFilters): EntryListItem[] {
  return entries.filter((entry) => matchesEntryFilters(entry, filters));
}

/* ────────────────────────────────────────────────────────────────────────────
 * URL <-> filter state — the Export link and the export route agree on this
 * encoding (mirrors lib/inventory/filter.ts's encode/decodeFiltersFromSearchParams).
 * ──────────────────────────────────────────────────────────────────────────── */

const PARAM = {
  month: "month",
  type: "type",
  category: "category",
  accountId: "account",
  projectId: "project",
} as const;

export function encodeEntryFiltersToSearchParams(filters: EntryFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, param] of Object.entries(PARAM) as [keyof EntryFilters, string][]) {
    const value = filters[key];
    if (value !== FILTER_ALL) params.set(param, value);
  }
  return params;
}

export function decodeEntryFiltersFromSearchParams(params: URLSearchParams): EntryFilters {
  return {
    month: params.get(PARAM.month) ?? EMPTY_ENTRY_FILTERS.month,
    type: (params.get(PARAM.type) as EntryFilters["type"]) ?? EMPTY_ENTRY_FILTERS.type,
    category: (params.get(PARAM.category) as EntryFilters["category"]) ?? EMPTY_ENTRY_FILTERS.category,
    accountId: params.get(PARAM.accountId) ?? EMPTY_ENTRY_FILTERS.accountId,
    projectId: params.get(PARAM.projectId) ?? EMPTY_ENTRY_FILTERS.projectId,
  };
}
