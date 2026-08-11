"use client";

import { useDeferredValue, useMemo, useState } from "react";
import {
  buildActiveChips,
  buildFacetGroups,
  DEFAULT_OPEN_GROUPS,
  encodeFiltersToSearchParams,
  encodeRange,
  filterInventoryParts,
  type FacetGroupName,
  type InventoryFilters,
  type RangeSelection,
} from "@/lib/inventory/filter";
import type { InventoryPart } from "@/lib/inventory/types";

/**
 * hooks/use-inventory-filters.ts — client-side filter/facet state for the
 * Inventory table. All the actual matching/counting logic lives in
 * lib/inventory/filter.ts (pure, shared with the CSV export route) — this
 * hook only owns the React state and memoizes the derived views.
 */
export function useInventoryFilters(parts: readonly InventoryPart[]) {
  const [search, setSearch] = useState("");
  /**
   * Filtering runs against a DEFERRED copy of the search term.
   *
   * The grid renders every matching part as a real row — 1,745 of them
   * unfiltered — so each keystroke re-filters and re-reconciles the whole table
   * and takes ~600ms to settle. Typing "AD7684" meant six of those back to
   * back, which reads as a frozen input. React keeps the box itself on the
   * urgent update (so characters appear immediately) and re-renders the table
   * from the latest term once it has time, dropping the intermediate ones.
   *
   * Deliberately not a fixed debounce: this adapts to the machine, so a fast
   * laptop still filters on every keystroke and a slow one skips frames instead
   * of feeling laggy.
   */
  const appliedSearch = useDeferredValue(search);
  const [filters, setFilters] = useState<InventoryFilters>({});
  const [openGroups, setOpenGroups] = useState<Partial<Record<FacetGroupName, boolean>>>({});

  const filteredParts = useMemo(
    () => filterInventoryParts(parts, appliedSearch, filters),
    [parts, appliedSearch, filters],
  );
  const facetGroups = useMemo(
    () => buildFacetGroups(parts, appliedSearch, filters),
    [parts, appliedSearch, filters],
  );
  const activeChips = useMemo(() => buildActiveChips(filters), [filters]);
  const exportHref = useMemo(
    () => `/inventory/export?${encodeFiltersToSearchParams(appliedSearch, filters).toString()}`,
    [appliedSearch, filters],
  );

  function toggleValue(group: FacetGroupName, value: string) {
    setFilters((prev) => {
      const current = new Set(prev[group] ?? []);
      if (current.has(value)) current.delete(value);
      else current.add(value);
      const next = { ...prev };
      if (current.size > 0) next[group] = Array.from(current);
      else delete next[group];
      return next;
    });
  }

  /** A range facet holds at most one encoded value; `null` clears it. */
  function setRange(group: FacetGroupName, range: RangeSelection | null) {
    setFilters((prev) => {
      const next = { ...prev };
      if (range) next[group] = [encodeRange(range)];
      else delete next[group];
      return next;
    });
  }

  function clearAll() {
    setFilters({});
    setSearch("");
  }

  function isGroupOpen(group: FacetGroupName): boolean {
    return openGroups[group] ?? (DEFAULT_OPEN_GROUPS as readonly string[]).includes(group);
  }

  function toggleGroupOpen(group: FacetGroupName) {
    setOpenGroups((prev) => ({ ...prev, [group]: !isGroupOpen(group) }));
  }

  return {
    search,
    setSearch,
    filters,
    filteredParts,
    facetGroups,
    activeChips,
    hasFilters: activeChips.length > 0 || search.trim().length > 0,
    /** True while the table is still catching up with what has been typed. */
    searchPending: search !== appliedSearch,
    exportHref,
    toggleValue,
    setRange,
    clearAll,
    isGroupOpen,
    toggleGroupOpen,
  };
}
