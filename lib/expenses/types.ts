/**
 * lib/expenses/types.ts — shared shapes for the Expenses surface
 * (plan/tab-expenses.md R2-20/21/15/33/37, FEATURES.md §5.14).
 *
 * Kept separate from `types/db.ts` (integrator-owned) — these are
 * package-local VIEW shapes (joined/shaped for the UI), not DB row
 * contracts.
 */

import type { ExpenseAccountRow, ExpenseCategory, ExpenseEntryType, ExpenseRow, RollupBucket } from "@/types/db";

/** An entry row joined with display-only account/project names. */
export interface EntryListItem extends ExpenseRow {
  accountName: string | null;
  projectName: string | null;
}

/** "all" sentinel keeps filter state representable in a single string per dimension. */
export const FILTER_ALL = "all" as const;
export type FilterAllOr<T extends string> = T | typeof FILTER_ALL;

export interface EntryFilters {
  /** `YYYY-MM`, or "all". */
  month: FilterAllOr<string>;
  type: FilterAllOr<ExpenseEntryType>;
  category: FilterAllOr<ExpenseCategory>;
  accountId: FilterAllOr<string>;
  projectId: FilterAllOr<string>;
}

export const EMPTY_ENTRY_FILTERS: EntryFilters = {
  month: FILTER_ALL,
  type: FILTER_ALL,
  category: FILTER_ALL,
  accountId: FILTER_ALL,
  projectId: FILTER_ALL,
};

export type ChartBucket = RollupBucket;

export interface ProjectOption {
  id: string;
  name: string;
}

export type AccountOption = ExpenseAccountRow;

/** Result envelope shared by every mutating Server Action (mirrors lib/receive/core.ts). */
export type ActionResult<T extends Record<string, unknown> = { id: string }> =
  | ({ ok: true } & T)
  | { ok: false; error: string };
