"use client";

import { useMemo, useState } from "react";
import {
  buildActiveChips,
  buildFacetGroups,
  DEFAULT_OPEN_GROUPS,
  encodeFiltersToSearchParams,
  filterInventoryParts,
  type FacetGroupName,
  type InventoryFilters,
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
  const [filters, setFilters] = useState<InventoryFilters>({});
  const [openGroups, setOpenGroups] = useState<Partial<Record<FacetGroupName, boolean>>>({});

  const filteredParts = useMemo(() => filterInventoryParts(parts, search, filters), [parts, search, filters]);
  const facetGroups = useMemo(() => buildFacetGroups(parts, search, filters), [parts, search, filters]);
  const activeChips = useMemo(() => buildActiveChips(filters), [filters]);
  const exportHref = useMemo(
    () => `/inventory/export?${encodeFiltersToSearchParams(search, filters).toString()}`,
    [search, filters],
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
    exportHref,
    toggleValue,
    clearAll,
    isGroupOpen,
    toggleGroupOpen,
  };
}
