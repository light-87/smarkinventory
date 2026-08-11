/**
 * lib/inventory/filter.ts — pure search/filter/facet-count logic (tab-inventory.md
 * §2). Shared, unmodified, between the interactive client (hooks/use-inventory-
 * filters.ts) and the CSV export route (app/(app)/inventory/export/route.ts) so
 * the exported file always matches exactly what the table shows — no separate
 * "server-side filter reimplementation" to drift out of sync.
 *
 * Which filters exist, and which categories each belongs to, is declared in
 * `facet-registry.ts` (a transcription of the client's `Filter_Specification.md`).
 * This module is the engine: it matches parts, counts values and builds the
 * sidebar view model from those declarations.
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
 *   - Stock stays a fixed three-value enum, always shown in full.
 *   - A group offering nothing to choose between in scope is dropped: zero
 *     values, or a single value that everything in scope already has. That one
 *     rule is what implements every "Excluded — always blank in the source" line
 *     in the spec (`PPM`, capacitor `Tolerance_Percent`, `ic_th` `Package`, the
 *     single-manufacturer files) without maintaining a blocklist, and it is why
 *     Status disappears on a catalog where every part is Active.
 *   - A CATEGORY-SCOPED group stays hidden until you narrow to one of its
 *     categories. Resistance means nothing while you are looking at ICs.
 *
 * Counting is a single pass per group rather than a scan per value: Package alone
 * has 329 values against 1,999 parts, and the old shape re-scanned the catalog
 * for every one of them on every keystroke.
 */

import type { InventoryPart } from "./types";
import {
  FACET_BY_ID,
  FACET_DEFS,
  INTERNAL_ATTRIBUTE_KEYS,
  type FacetDef,
  type RangeUnit,
} from "./facet-registry";

export { canonicalPackage } from "./canonical-package";
export type { FacetDef, RangeUnit } from "./facet-registry";

/** Facet ids, in sidebar order. */
export const FACET_GROUP_ORDER: readonly string[] = FACET_DEFS.map((f) => f.id);

export type FacetGroupName = string;

/** Groups open by default. */
export const DEFAULT_OPEN_GROUPS: readonly string[] = ["Category", "Sub-category", "Package", "Stock"];

/**
 * A filter's selection, as stored and as encoded into the URL.
 *
 * Both kinds live in the same `string[]` slot so the URL codec, the export route
 * and the "clear this chip" path stay one code path. A range is a single string,
 * `"<min>..<max>@<unitId>"` with either bound optionally empty — the bounds are
 * kept exactly as typed (not pre-multiplied) so reopening a shared link shows the
 * user the numbers and unit they actually entered rather than 0.0000001.
 */
export type InventoryFilters = Partial<Record<string, string[]>>;

export interface RangeSelection {
  min: string;
  max: string;
  unitId: string;
}

const RANGE_SEPARATOR = "..";

export function encodeRange(range: RangeSelection): string {
  return `${range.min.trim()}${RANGE_SEPARATOR}${range.max.trim()}@${range.unitId}`;
}

export function decodeRange(raw: string | undefined, facet: FacetDef): RangeSelection | null {
  const fallbackUnit = facet.units?.[0]?.id ?? "";
  if (!raw) return null;
  const [bounds = "", unitId = fallbackUnit] = raw.split("@");
  const separatorAt = bounds.indexOf(RANGE_SEPARATOR);
  if (separatorAt < 0) return null;
  const min = bounds.slice(0, separatorAt);
  const max = bounds.slice(separatorAt + RANGE_SEPARATOR.length);
  if (min.trim() === "" && max.trim() === "") return null;
  return { min, max, unitId };
}

function unitFactor(facet: FacetDef, unitId: string): number {
  if (!facet.units) return 1;
  return facet.units.find((u) => u.id === unitId)?.factor ?? facet.units[0]?.factor ?? 1;
}

/** A typed bound in the column's base unit. Blank or non-numeric means "unbounded". */
function boundInBaseUnit(raw: string, factor: number): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n * factor : null;
}

/**
 * Bounds are compared with a relative tolerance because converting a typed
 * value into the base unit is a floating-point multiply that does not always
 * land on the stored number: `100 * 1e-9` is 1.0000000000000001e-7, which is
 * strictly greater than the 1e-7 the importer parsed from the sheet. Exact
 * comparison therefore made a 100 nF capacitor fail a 100–100 nF filter — the
 * search most likely to be typed, returning nothing for a part sitting right
 * there in the catalog.
 *
 * Relative rather than absolute: these columns span 1e-12 to 1e6, so any fixed
 * epsilon is either meaningless at one end or swallows real differences at the
 * other. A zero bound compares exactly, which is what "quantity ≤ 0" needs.
 */
const RANGE_EPSILON = 1e-9;

function atLeast(value: number, bound: number): boolean {
  return value >= bound || Math.abs(value - bound) <= Math.abs(bound) * RANGE_EPSILON;
}

function atMost(value: number, bound: number): boolean {
  return value <= bound || Math.abs(value - bound) <= Math.abs(bound) * RANGE_EPSILON;
}

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

/**
 * Search also covers attribute values, which is what makes the spec's many
 * "text search only (not range)" columns reachable at all — diode `Rating`
 * ("1A/40V"), resistor `Power_Watts` ("1/4W"), relay `Voltage` ("7A,250V AC"),
 * SMPS `Dimension`. Building a dedicated search box per column, per category,
 * would be a lot of chrome for fields most people will type into the one box
 * anyway. Provenance and QA keys are skipped: matching a part because you typed
 * a digit that happens to be its source row is noise, not a search result.
 */
function attributeSearchValues(part: InventoryPart): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(part.attributes)) {
    if (INTERNAL_ATTRIBUTE_KEYS.has(key)) continue;
    if (value === null || value === undefined || typeof value === "boolean") continue;
    out.push(String(value));
  }
  return out;
}

export function matchesSearch(part: InventoryPart, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  for (const field of SEARCH_FIELDS) {
    const value = part[field];
    if (value != null && String(value).toLowerCase().includes(q)) return true;
  }
  return attributeSearchValues(part).some((v) => v.toLowerCase().includes(q));
}

/** The set of facet values a single part contributes to `facet` (multi only). */
function facetValuesFor(part: InventoryPart, facet: FacetDef): string[] {
  return facet.valuesOf ? facet.valuesOf(part) : [];
}

function matchesRange(part: InventoryPart, facet: FacetDef, raw: string): boolean {
  const range = decodeRange(raw, facet);
  if (!range) return true;

  const value = facet.numberOf?.(part) ?? null;
  // A part with no value for this column cannot satisfy a bound on it. Showing
  // unpriced hardware inside "cost price 10–50" would misreport the catalog.
  if (value === null) return false;

  const factor = unitFactor(facet, range.unitId);
  const min = boundInBaseUnit(range.min, factor);
  const max = boundInBaseUnit(range.max, factor);
  if (min !== null && !atLeast(value, min)) return false;
  if (max !== null && !atMost(value, max)) return false;
  return true;
}

export function matchesFilters(part: InventoryPart, filters: InventoryFilters): boolean {
  for (const facet of FACET_DEFS) {
    const selected = filters[facet.id];
    if (!selected || selected.length === 0) continue;

    if (facet.kind === "range") {
      if (!matchesRange(part, facet, selected[0]!)) return false;
      continue;
    }

    const values = facetValuesFor(part, facet);
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

/** One pass over `parts`, tallying how many carry each value of `facet`. */
function countValues(parts: readonly InventoryPart[], facet: FacetDef): Map<string, number> {
  const counts = new Map<string, number>();
  for (const part of parts) {
    for (const value of facetValuesFor(part, facet)) {
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
  label: string;
  kind: FacetKindView;
  hint?: string;
  uncapped: boolean;
  /** Multi only. */
  values: FacetValueCount[];
  /** Range only — the units offered, and how many parts in scope even have a value. */
  units?: readonly RangeUnit[];
  range?: RangeSelection | null;
  rangeCount?: number;
}

export type FacetKindView = "multi" | "range";

/**
 * Is this facet's category in play? A facet scoped to categories appears once the
 * user has selected at least one category it covers — picking Resistor and
 * Capacitor together surfaces Mount type (both), Resistance (resistors) and
 * Capacitance (capacitors), which is how a distributor's catalog behaves when you
 * pick two part families.
 */
function facetIsInScope(facet: FacetDef, filters: InventoryFilters): boolean {
  if (facet.categories === null) return true;
  const chosen = filters.Category;
  if (!chosen || chosen.length === 0) return false;
  return chosen.some((c) => facet.categories!.includes(c));
}

/**
 * Sidebar order: Category, then the filters specific to the categories you just
 * picked, then the global ones.
 *
 * Registry order alone put Capacitance eleventh, below eight global groups — so
 * choosing Capacitor buried the one filter you chose it for under a scroll. The
 * category-specific filters are the entire reason a category was selected, so
 * they sit directly under the choice that summoned them.
 */
function sidebarRank(facet: FacetDef): number {
  if (facet.id === "Category") return 0;
  return facet.categories === null ? 2 : 1;
}

/** Builds every live facet group with counts (see module doc for the exact semantics). */
export function buildFacetGroups(
  parts: readonly InventoryPart[],
  search: string,
  filters: InventoryFilters,
): FacetGroupViewModel[] {
  const groups: FacetGroupViewModel[] = [];
  const ordered = FACET_DEFS.map((facet, index) => ({ facet, index })).sort(
    (a, b) => sidebarRank(a.facet) - sidebarRank(b.facet) || a.index - b.index,
  );

  for (const { facet } of ordered) {
    const isSelected = (filters[facet.id]?.length ?? 0) > 0;
    // A facet you have already applied never vanishes, even if narrowing the
    // categories would otherwise hide it — an invisible filter still in force is
    // the worst possible state for the sidebar to be in.
    if (!facetIsInScope(facet, filters) && !isSelected) continue;

    // Every other group's selection applies; this one's deliberately does not,
    // so its own options stay switchable and multi-selectable.
    const otherFilters: InventoryFilters = { ...filters };
    delete otherFilters[facet.id];
    const scope = filterInventoryParts(parts, search, otherFilters);

    if (facet.kind === "range") {
      const withValue = scope.reduce((n, part) => (facet.numberOf?.(part) != null ? n + 1 : n), 0);
      if (withValue === 0 && !isSelected) continue;
      groups.push({
        name: facet.id,
        label: facet.label,
        kind: "range",
        hint: facet.hint,
        uncapped: false,
        values: [],
        units: facet.units,
        range: decodeRange(filters[facet.id]?.[0], facet),
        rangeCount: withValue,
      });
      continue;
    }

    const counts = countValues(scope, facet);
    const selected = new Set(filters[facet.id] ?? []);

    // Fixed enums render in full, in their declared order. Everything else is
    // exactly what exists in scope, so a zero-count option cannot appear —
    // ranked by count, because alphabetical order on 329 packages buries "0805"
    // (194 parts) among one-off strings like "10.3x10.4x4mm".
    const candidates =
      facet.fixedValues ??
      Array.from(counts.keys()).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));

    // Nothing to choose between: no options, or one option that every part in
    // scope already carries. Either way the row is decoration, not a filter.
    const offersAChoice =
      facet.fixedValues !== undefined ||
      candidates.length > 1 ||
      (candidates.length === 1 && (counts.get(candidates[0]!) ?? 0) < scope.length);
    if (!offersAChoice && !isSelected) continue;

    groups.push({
      name: facet.id,
      label: facet.label,
      kind: "multi",
      hint: facet.hint,
      uncapped: facet.uncapped === true,
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

/** Human text for one applied range, e.g. "1 – 10 kΩ", "≥ 5", "≤ 100 nF". */
function rangeChipLabel(facet: FacetDef, raw: string): string | null {
  const range = decodeRange(raw, facet);
  if (!range) return null;
  const unit = facet.units?.find((u) => u.id === range.unitId)?.label ?? "";
  const suffix = unit ? ` ${unit}` : "";
  const min = range.min.trim();
  const max = range.max.trim();
  if (min && max) return `${min} – ${max}${suffix}`;
  if (min) return `≥ ${min}${suffix}`;
  return `≤ ${max}${suffix}`;
}

export function buildActiveChips(filters: InventoryFilters): ActiveChip[] {
  const chips: ActiveChip[] = [];
  for (const facet of FACET_DEFS) {
    const selected = filters[facet.id] ?? [];
    if (facet.kind === "range") {
      const text = selected[0] ? rangeChipLabel(facet, selected[0]) : null;
      if (text) chips.push({ group: facet.id, value: selected[0]!, label: `${facet.label}: ${text}` });
      continue;
    }
    for (const value of selected) {
      chips.push({ group: facet.id, value, label: `${facet.label}: ${displayLabelForFacetValue(facet.id, value)}` });
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
  for (const facet of FACET_DEFS) {
    for (const value of filters[facet.id] ?? []) params.append(`${FILTER_PARAM_PREFIX}${facet.id}`, value);
  }
  return params;
}

export function decodeFiltersFromSearchParams(params: URLSearchParams): {
  search: string;
  filters: InventoryFilters;
} {
  const search = params.get(SEARCH_PARAM) ?? "";
  const filters: InventoryFilters = {};
  for (const facet of FACET_DEFS) {
    const values = params.getAll(`${FILTER_PARAM_PREFIX}${facet.id}`);
    if (values.length > 0) filters[facet.id] = values;
  }
  return { search, filters };
}

export { FACET_BY_ID };
