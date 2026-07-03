/**
 * lib/inventory/filter.ts — pure search/filter/facet-count logic (tab-inventory.md
 * §2). Shared, unmodified, between the interactive client (hooks/use-inventory-
 * filters.ts) and the CSV export route (app/(app)/inventory/export/route.ts) so
 * the exported file always matches exactly what the table shows — no separate
 * "server-side filter reimplementation" to drift out of sync.
 *
 * Facet semantics mirror the approved prototype (SmarkStock-prototype/
 * SmarkStock.dc.html `facetCounts`/`filteredParts`) exactly:
 *   - a facet group's VALUE LIST is derived from the full unfiltered catalog
 *     (so a value never disappears just because it's currently filtered out),
 *     except Stock/Status which are fixed enums always shown.
 *   - each value's COUNT is computed against the full currently-filtered set
 *     (search + every active facet, including that value's own group) — not
 *     "counts excluding this group", which is a different (also valid) UX the
 *     client didn't ask for.
 */

import type { InventoryPart } from "./types";
import { STOCK_STATE_LABEL } from "./stock-state";

export const FACET_GROUP_ORDER = [
  "Category",
  "Package",
  "Voltage",
  "Stock",
  "Status",
  "Dielectric",
  "Distributor",
  "Project",
  "Shelf",
] as const;

export type FacetGroupName = (typeof FACET_GROUP_ORDER)[number];

/** Groups open by default (matches the prototype's `invOpen` default set). */
export const DEFAULT_OPEN_GROUPS: readonly FacetGroupName[] = ["Category", "Package", "Stock", "Status"];

export type InventoryFilters = Partial<Record<FacetGroupName, string[]>>;

const SEARCH_FIELDS = ["internal_pid", "mpn", "value", "package", "category", "manufacturer", "lcsc_pn"] as const;

const STATUS_DISPLAY: Record<string, string> = { active: "Active", nrnd: "NRND", eol: "EOL" };

const FIXED_GROUP_VALUES: Partial<Record<FacetGroupName, string[]>> = {
  Stock: ["In stock", "Low", "Out"],
  Status: ["active", "nrnd", "eol"],
};

export function matchesSearch(part: InventoryPart, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return SEARCH_FIELDS.some((field) => {
    const value = part[field];
    return value != null && String(value).toLowerCase().includes(q);
  });
}

/** The set of facet values a single part contributes to `group`. */
function facetValuesForGroup(part: InventoryPart, group: FacetGroupName): string[] {
  switch (group) {
    case "Category":
      return part.category ? [part.category] : [];
    case "Package":
      return part.package ? [part.package] : [];
    case "Voltage":
      return part.voltage ? [part.voltage] : [];
    case "Dielectric": {
      const dielectric = part.attributes.dielectric;
      return typeof dielectric === "string" && dielectric ? [dielectric] : [];
    }
    case "Distributor":
      return part.distributorNames;
    case "Project":
      return part.projectNames;
    case "Shelf":
      return part.locations.map((l) => l.shelfCode).filter((code) => code !== "—");
    case "Status":
      return [part.part_status];
    case "Stock":
      return [STOCK_STATE_LABEL[part.stockState]];
    default:
      return [];
  }
}

export function matchesFilters(part: InventoryPart, filters: InventoryFilters): boolean {
  for (const group of FACET_GROUP_ORDER) {
    const selected = filters[group];
    if (!selected || selected.length === 0) continue;
    const values = facetValuesForGroup(part, group);
    if (!selected.some((v) => values.includes(v))) return false;
  }
  return true;
}

export function filterInventoryParts(
  parts: readonly InventoryPart[],
  search: string,
  filters: InventoryFilters,
): InventoryPart[] {
  return parts.filter((part) => matchesSearch(part, search) && matchesFilters(part, filters));
}

export function displayLabelForFacetValue(group: FacetGroupName, value: string): string {
  return group === "Status" ? (STATUS_DISPLAY[value] ?? value) : value;
}

function candidateValuesForGroup(parts: readonly InventoryPart[], group: FacetGroupName): string[] {
  const fixed = FIXED_GROUP_VALUES[group];
  if (fixed) return fixed;
  const values = new Set<string>();
  for (const part of parts) {
    for (const value of facetValuesForGroup(part, group)) values.add(value);
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

export interface FacetValueCount {
  value: string;
  count: number;
  selected: boolean;
}

export interface FacetGroupViewModel {
  name: FacetGroupName;
  values: FacetValueCount[];
}

/** Builds every non-empty facet group with live counts (see module doc for the exact semantics). */
export function buildFacetGroups(
  parts: readonly InventoryPart[],
  search: string,
  filters: InventoryFilters,
): FacetGroupViewModel[] {
  const filtered = filterInventoryParts(parts, search, filters);
  const groups: FacetGroupViewModel[] = [];

  for (const group of FACET_GROUP_ORDER) {
    const candidates = candidateValuesForGroup(parts, group);
    if (candidates.length === 0) continue;
    const selected = new Set(filters[group] ?? []);
    const values = candidates.map((value) => ({
      value,
      count: filtered.filter((part) => facetValuesForGroup(part, group).includes(value)).length,
      selected: selected.has(value),
    }));
    groups.push({ name: group, values });
  }

  return groups;
}

export interface ActiveChip {
  group: FacetGroupName;
  value: string;
  label: string;
}

export function buildActiveChips(filters: InventoryFilters): ActiveChip[] {
  const chips: ActiveChip[] = [];
  for (const group of FACET_GROUP_ORDER) {
    for (const value of filters[group] ?? []) {
      chips.push({ group, value, label: `${group}: ${displayLabelForFacetValue(group, value)}` });
    }
  }
  return chips;
}

/* ────────────────────────────────────────────────────────────────────────────
 * URL <-> filter state — shared by the client's Export link and the export
 * route handler, so a click always downloads exactly the on-screen rows.
 * ──────────────────────────────────────────────────────────────────────────── */

const FILTER_PARAM_PREFIX = "f_";
const SEARCH_PARAM = "q";

export function encodeFiltersToSearchParams(search: string, filters: InventoryFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (search.trim()) params.set(SEARCH_PARAM, search);
  for (const group of FACET_GROUP_ORDER) {
    for (const value of filters[group] ?? []) params.append(`${FILTER_PARAM_PREFIX}${group}`, value);
  }
  return params;
}

export function decodeFiltersFromSearchParams(params: URLSearchParams): {
  search: string;
  filters: InventoryFilters;
} {
  const search = params.get(SEARCH_PARAM) ?? "";
  const filters: InventoryFilters = {};
  for (const group of FACET_GROUP_ORDER) {
    const values = params.getAll(`${FILTER_PARAM_PREFIX}${group}`);
    if (values.length > 0) filters[group] = values;
  }
  return { search, filters };
}
