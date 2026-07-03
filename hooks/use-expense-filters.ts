"use client";

import { useMemo, useState } from "react";
import {
  encodeEntryFiltersToSearchParams,
  filterEntries,
} from "@/lib/expenses/filter";
import { EMPTY_ENTRY_FILTERS, FILTER_ALL, type EntryFilters, type EntryListItem } from "@/lib/expenses/types";

/**
 * hooks/use-expense-filters.ts — client-side filter state for the entry
 * list. All matching logic lives in lib/expenses/filter.ts (pure, shared
 * with the CSV/xlsx export route) — this hook only owns the React state and
 * memoizes the derived view, same split as hooks/use-inventory-filters.ts.
 */
export function useExpenseFilters(entries: readonly EntryListItem[]) {
  const [filters, setFilters] = useState<EntryFilters>(EMPTY_ENTRY_FILTERS);

  const filteredEntries = useMemo(() => filterEntries(entries, filters), [entries, filters]);
  const exportParams = useMemo(() => encodeEntryFiltersToSearchParams(filters), [filters]);
  const exportHref = useMemo(() => `/expenses/export?${exportParams.toString()}`, [exportParams]);
  const exportHrefXlsx = useMemo(() => {
    const params = new URLSearchParams(exportParams);
    params.set("format", "xlsx");
    return `/expenses/export?${params.toString()}`;
  }, [exportParams]);
  const hasFilters = useMemo(() => Object.values(filters).some((v) => v !== FILTER_ALL), [filters]);

  function setFilter<K extends keyof EntryFilters>(key: K, value: EntryFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearAll() {
    setFilters(EMPTY_ENTRY_FILTERS);
  }

  return { filters, setFilter, filteredEntries, exportHref, exportHrefXlsx, hasFilters, clearAll };
}
