"use client";

import { Button } from "@/components/ui/button";
import { ExpenseCategorySchema } from "@/types/db";
import type { AccountOption, EntryFilters, ProjectOption } from "@/lib/expenses/types";
import { FILTER_ALL } from "@/lib/expenses/types";
import { NativeSelect } from "./native-select";

const EXPENSE_CATEGORIES = ExpenseCategorySchema.options;

export interface EntryFiltersBarProps {
  filters: EntryFilters;
  onChange: <K extends keyof EntryFilters>(key: K, value: EntryFilters[K]) => void;
  onClear: () => void;
  hasFilters: boolean;
  accounts: AccountOption[];
  projects: ProjectOption[];
}

/**
 * "filter by month/type/category/account/project" (plan/tab-expenses.md
 * R2-20). One row above the entry table, filters everything below it —
 * matching the dataviz skill's filter-composition rule even though this row
 * scopes a table rather than a chart set.
 */
export function EntryFiltersBar({ filters, onChange, onClear, hasFilters, accounts, projects }: EntryFiltersBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <input
        type="month"
        value={filters.month === FILTER_ALL ? "" : filters.month}
        onChange={(e) => onChange("month", e.target.value || FILTER_ALL)}
        className="h-10 rounded-lg border border-charcoal bg-surface-well px-3 text-sm text-snow outline-none focus:border-smark-orange"
        aria-label="Filter by month"
      />
      <NativeSelect
        aria-label="Filter by type"
        className="w-[132px]"
        value={filters.type}
        onChange={(e) => onChange("type", e.target.value as EntryFilters["type"])}
        options={[
          { value: FILTER_ALL, label: "All types" },
          { value: "expense", label: "Expense" },
          { value: "income", label: "Income" },
        ]}
      />
      <NativeSelect
        aria-label="Filter by category"
        className="w-[160px]"
        value={filters.category}
        onChange={(e) => onChange("category", e.target.value as EntryFilters["category"])}
        options={[
          { value: FILTER_ALL, label: "All categories" },
          ...EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c })),
        ]}
      />
      <NativeSelect
        aria-label="Filter by account"
        className="w-[160px]"
        value={filters.accountId}
        onChange={(e) => onChange("accountId", e.target.value)}
        options={[{ value: FILTER_ALL, label: "All accounts" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
      />
      <NativeSelect
        aria-label="Filter by project"
        className="w-[160px]"
        value={filters.projectId}
        onChange={(e) => onChange("projectId", e.target.value)}
        options={[{ value: FILTER_ALL, label: "All projects" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
      />
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      )}
    </div>
  );
}
