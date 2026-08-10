/**
 * lib/inventory/filter.ts — pure search/filter/facet-count logic (tab-inventory.md
 * §2). Shared, unmodified, between the interactive client (hooks/use-inventory-
 * filters.ts) and the CSV export route (app/(app)/inventory/export/route.ts) so
 * the exported file always matches exactly what the table shows — no separate
 * "server-side filter reimplementation" to drift out of sync.
 *
 * Facet semantics originally mirrored the approved prototype exactly: a group's
 * value list came from the FULL unfiltered catalog, and every count was computed
 * against the fully-filtered set including that group's own selection. Both of
 * those were rewritten on 2026-08-10, when the real 1,999-part catalog landed and
 * made their consequences visible for the first time. The prototype had 15 parts;
 * nothing about this was wrong until it met real data.
 *
 * What went wrong: ticking Category = Resistor left 317 of the 329 Package
 * checkboxes on screen reading "0", plus 26 dead Voltage rows (resistors have no
 * voltage) and 19 dead Distributors. The sidebar became mostly noise.
 *
 * What it does now, per group:
 *   - SCOPE = the catalog filtered by the search and by every OTHER group's
 *     selection, deliberately ignoring this group's own. That is what makes
 *     hiding zero-count values safe: counting Category against a Category filter
 *     would collapse the group to the one option already ticked, and you could
 *     never switch to Capacitor or add a second category. Standard behaviour on
 *     any faceted catalog, and it only became necessary once values were hidden.
 *   - VALUES are the distinct values actually present in that scope, so a dead
 *     option cannot render. A value you have selected always survives, because
 *     the scope ignores your own group's filter.
 *   - Stock/Status stay fixed three-value enums, always shown in full. They are
 *     short by construction and never the source of the noise.
 *   - A group with nothing in scope is dropped entirely (Voltage vanishes while
 *     you are looking at resistors, instead of showing 26 zeroes).
 *
 * Counting is a single pass per group rather than a scan per value: Package alone
 * has 329 values against 1,999 parts, and the old shape re-scanned the catalog
 * for every one of them on every keystroke.
 */

import type { InventoryPart } from "./types";
import { STOCK_STATE_LABEL } from "./stock-state";
import { packageKey } from "@/lib/matcher";

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

// `description` earns its place here because most of the imported catalog has
// no MPN at all (880 of 1999 rows — generic passives never had one), so the
// description is often the only human-readable handle on a part: "RS485 Fuse
// 0.14A", "IC ADC 16BIT SAR 8MSOP", "Microcontroller".
const SEARCH_FIELDS = [
  "internal_pid",
  "mpn",
  "value",
  "package",
  "category",
  "manufacturer",
  "lcsc_pn",
  "description",
] as const;

const STATUS_DISPLAY: Record<string, string> = { active: "Active", nrnd: "NRND", eol: "EOL" };

const FIXED_GROUP_VALUES: Partial<Record<FacetGroupName, string[]>> = {
  Stock: ["In stock", "Low", "Out"],
  Status: ["active", "nrnd", "eol"],
};

/**
 * Collapses the spellings the stock sheet uses for one physical package into a
 * single facet option, which is also the value stored in the filter and the URL.
 *
 * The client's sheet writes the same package several ways, and untreated each
 * spelling became its own checkbox — so ticking "0603 (1608 Metric)" (157 parts)
 * silently missed the 13 filed under "603", and SMA was split four ways across
 * "SMA", "SMA (DO-214AC)", "SMA(DO-214AC)" and "SMA(DO241AC)". 31 sizes were
 * split like this. A filter that quietly hides matching stock is worse than no
 * filter.
 *
 * Deliberately a pure function of one string, not of the catalog: the value ends
 * up in the URL, so it must not shift when the data changes. A recognised
 * imperial chip size becomes its bare code ("0603"); everything else keeps its
 * own text with any parenthetical restatement removed. Case-only variants
 * ("8x16mm" vs "8X16mm") are left alone — folding case would turn LCSC-style
 * names into mush for the sake of one pair.
 */
export function canonicalPackage(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;

  const key = packageKey(raw);
  if (/^\d{4}$/.test(key)) return key;

  const stripped = raw.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
  return stripped === "" ? raw.trim() : stripped;
}

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
    case "Package": {
      // Canonical, not raw — so counting and matching agree and a spelling
      // variant can never hide stock behind a filter that should include it.
      const canonical = canonicalPackage(part.package);
      return canonical ? [canonical] : [];
    }
    case "Voltage":
      return part.voltage ? [part.voltage] : [];
    case "Dielectric": {
      const dielectric = part.attributes.dielectric;
      return typeof dielectric === "string" && dielectric ? [dielectric] : [];
    }
    case "Distributor": {
      // Order history (`distributorNames`, from smark_part_events) plus the
      // part's own default. History alone was empty for the entire imported
      // catalog — nothing has been ordered through the app yet — which left the
      // facet blank even though every CSV row names a distributor.
      const names = new Set(part.distributorNames);
      if (part.default_distributor) names.add(part.default_distributor);
      return [...names];
    }
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

/** One pass over `parts`, tallying how many carry each value of `group`. */
function countValues(parts: readonly InventoryPart[], group: FacetGroupName): Map<string, number> {
  const counts = new Map<string, number>();
  for (const part of parts) {
    for (const value of facetValuesForGroup(part, group)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
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
  const groups: FacetGroupViewModel[] = [];

  for (const group of FACET_GROUP_ORDER) {
    // Every other group's selection applies; this one's deliberately does not,
    // so its own options stay switchable and multi-selectable.
    const otherFilters: InventoryFilters = { ...filters };
    delete otherFilters[group];
    const scope = filterInventoryParts(parts, search, otherFilters);
    const counts = countValues(scope, group);
    const selected = new Set(filters[group] ?? []);

    // Fixed enums render in full, in their declared order. Everything else is
    // exactly what exists in scope, so a zero-count option cannot appear —
    // ranked by count, because alphabetical order on 329 packages buries "0805"
    // (194 parts) among one-off strings like "10.3x10.4x4mm".
    const fixed = FIXED_GROUP_VALUES[group];
    const candidates =
      fixed ??
      Array.from(counts.keys()).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
    if (candidates.length === 0) continue;

    groups.push({
      name: group,
      values: candidates.map((value) => ({
        value,
        count: counts.get(value) ?? 0,
        selected: selected.has(value),
      })),
    });
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
