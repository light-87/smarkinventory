/**
 * lib/inventory/facet-registry.ts — the per-category filter spec, as data.
 *
 * Source of truth: the client's `Filter_Specification.md` (2026-08-11), which
 * gives a column-by-column filter design per source file, plus `Import_Guide.md`
 * §2 for the range-filter unit maths. Both ship in `tests/fixtures/formatted-
 * output/`. This file is that spec transcribed — one entry per filter, with the
 * spec's own reasoning kept as comments where it explains a non-obvious call.
 *
 * Why a registry rather than a switch: the spec covers ~30 filters across 30
 * categories, and most of the work is "which categories does this apply to, and
 * how do I read the value off a part". Declaring that once means matching,
 * counting, the sidebar and the URL codec all read from the same description and
 * cannot drift from each other.
 *
 * Two rules keep the sidebar honest, both inherited from the existing facet
 * behaviour rather than invented here:
 *   - A facet scoped to categories only appears once the user has narrowed to at
 *     least one of them. Resistance means nothing while you are looking at ICs.
 *   - A facet with nothing (or only one thing) to offer in the current scope is
 *     dropped. That is what silently handles the spec's many "Excluded — always
 *     blank in the source" columns without hardcoding a blocklist: `PPM`,
 *     capacitor `Tolerance_Percent`, `ic_th` `Package` and the rest simply never
 *     have values to show.
 */

import type { InventoryPart } from "./types";
import { canonicalPackage } from "./canonical-package";
import { STOCK_STATE_LABEL } from "./stock-state";

/** Categories as the importer writes them (`lib/import/formatted-csv.ts`). */
export const CATEGORY = {
  resistor: "Resistor",
  resistorNetwork: "Resistor Network",
  capacitor: "Capacitor",
  inductor: "Inductor",
  ferrite: "Ferrite Bead",
  diode: "Diode",
  ic: "IC",
  transistor: "Transistor",
  module: "Module",
  connector: "Connector",
  terminalBlock: "Terminal Block",
  ffcFpc: "FFC/FPC Connector",
  cableAssembly: "Cable Assembly",
  fuse: "Fuse",
  crystal: "Crystal",
  led: "LED",
  thermistor: "Thermistor/Varistor",
  battery: "Battery",
  relay: "Relay",
  transformer: "Transformer",
  hardware: "Hardware",
  smps: "SMPS",
  display: "Display",
} as const;

/**
 * Attribute keys the importer writes. `attributeKeyFor()` snake-cases the CSV
 * header, so these track the column names in the client's files exactly; a
 * typo here shows up as a permanently empty filter, which is why they are
 * named constants rather than inline strings.
 */
const ATTR = {
  subCategory: "sub_category",
  mountType: "mount_type",
  tolerancePercent: "tolerance_percent",
  powerWatts: "power_watts",
  resistanceOhms: "resistance_ohms",
  capacitanceFarads: "capacitance_farads",
  inductanceHenries: "inductance_henries",
  currentRating: "current_rating",
  diodeType: "diode_type",
  rating: "rating",
  group: "group",
  color: "color",
  pinCount: "pin_count",
  pitch: "pitch",
  contactType: "contact_type",
  status: "status",
  cp: "cp",
  spMoq100: "sp_moq100",
  spMoq25: "sp_moq25",
} as const;

/**
 * Internal provenance/QA keys. `Filter_Specification.md` §1 is explicit that
 * `Source_Sheet`/`Source_Row` must never surface as filters or visible fields;
 * they are kept on the part only because the importer's idempotency key is
 * `file | sheet # row`. The flags are ours, not the client's.
 */
export const INTERNAL_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  "source_file",
  "source_row",
  "source_sheet",
  "data_flag",
  "qty_raw",
]);

export interface RangeUnit {
  /** URL-safe id — ASCII so a shared link stays readable. */
  id: string;
  label: string;
  /** Multiply a typed value by this to reach the column's base unit. */
  factor: number;
}

/** `Import_Guide.md` §2: p=1e-12, n=1e-9, µ=1e-6, m=1e-3, k=1e3, M=1e6. */
const OHM_UNITS: RangeUnit[] = [
  { id: "ohm", label: "Ω", factor: 1 },
  { id: "kohm", label: "kΩ", factor: 1e3 },
  { id: "Mohm", label: "MΩ", factor: 1e6 },
];

const FARAD_UNITS: RangeUnit[] = [
  { id: "pF", label: "pF", factor: 1e-12 },
  { id: "nF", label: "nF", factor: 1e-9 },
  { id: "uF", label: "µF", factor: 1e-6 },
];

const HENRY_UNITS: RangeUnit[] = [
  { id: "nH", label: "nH", factor: 1e-9 },
  { id: "uH", label: "µH", factor: 1e-6 },
  { id: "mH", label: "mH", factor: 1e-3 },
];

export type FacetKind = "multi" | "range";

export interface FacetDef {
  /** Stable id — used as the URL key, so it must not change with the data. */
  id: string;
  label: string;
  kind: FacetKind;
  /** `null` = applies to the whole catalog. Otherwise only shown once the user has narrowed to one of these categories. */
  categories: readonly string[] | null;
  /** Multi only: the values this part contributes. */
  valuesOf?: (part: InventoryPart) => string[];
  /** Range only: this part's value in the column's base unit. */
  numberOf?: (part: InventoryPart) => number | null;
  /** Range only: omit for a plain number range (quantity, price). */
  units?: readonly RangeUnit[];
  /** Multi only: render every option, never collapse behind "show more". */
  uncapped?: boolean;
  /** Multi only: fixed option list, always rendered in full. */
  fixedValues?: readonly string[];
  /** Shown under the facet label in the sidebar when the data needs a caveat. */
  hint?: string;
}

/** Reads a string-ish attribute, skipping blanks. Numbers stringify (`pin_count`). */
function attrValues(part: InventoryPart, key: string): string[] {
  const raw = part.attributes[key];
  if (raw === null || raw === undefined || typeof raw === "boolean") return [];
  const text = String(raw).trim();
  return text ? [text] : [];
}

/** Reads a numeric attribute. The importer stores unparseable cells as strings, which must not become NaN. */
function attrNumber(part: InventoryPart, key: string): number | null {
  const raw = part.attributes[key];
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export const FACET_DEFS: readonly FacetDef[] = [
  /* ── Global (Filter_Specification §1 + the pre-existing facets) ─────────── */
  {
    id: "Category",
    label: "Category",
    kind: "multi",
    categories: null,
    // How people enter the catalog: pick the kind of part, then narrow. Hiding
    // two thirds of it behind "Show more" puts a click in front of the one
    // decision the sidebar exists to serve.
    uncapped: true,
    valuesOf: (p) => (p.category ? [p.category] : []),
  },
  {
    id: "Stock",
    label: "Stock",
    kind: "multi",
    categories: null,
    // Spec §1 asks for a one-click "In stock only"; this enum already is it.
    fixedValues: ["In stock", "Low", "Out"],
    valuesOf: (p) => [STOCK_STATE_LABEL[p.stockState]],
  },
  {
    id: "Sub-category",
    label: "Sub-category",
    kind: "multi",
    categories: null,
    // Spec calls this "the headline filter for ICs, the way chip type is on
    // Digikey" (37 clean values, every row). It is global rather than IC-only
    // because the same column carries connector Type, LCD/OLED and TH/Rocker.
    valuesOf: (p) => attrValues(p, ATTR.subCategory),
  },
  {
    id: "Package",
    label: "Package",
    kind: "multi",
    categories: null,
    valuesOf: (p) => {
      const canonical = canonicalPackage(p.package);
      return canonical ? [canonical] : [];
    },
  },
  {
    id: "Mount",
    label: "Mount type",
    kind: "multi",
    categories: null,
    valuesOf: (p) => attrValues(p, ATTR.mountType),
  },
  {
    id: "Distributor",
    label: "Distributor",
    kind: "multi",
    categories: null,
    valuesOf: (p) => {
      // Order history plus the part's own default. History alone was empty for
      // the whole imported catalog — nothing has been ordered through the app.
      const names = new Set(p.distributorNames);
      if (p.default_distributor) names.add(p.default_distributor);
      return [...names];
    },
  },
  {
    id: "Manufacturer",
    label: "Manufacturer",
    kind: "multi",
    categories: null,
    // Spec flags real noise in this column on ic_smd ("1 -desoldered" and spec
    // text that landed here in the source). Kept as-is: it filters correctly,
    // and cleaning the client's data behind their back would be worse.
    hint: "Some values are notes mis-typed into this column in the source sheet.",
    valuesOf: (p) => (p.manufacturer ? [p.manufacturer] : []),
  },
  {
    id: "Voltage",
    label: "Voltage",
    kind: "multi",
    categories: null,
    valuesOf: (p) => (p.voltage ? [p.voltage] : []),
  },
  {
    id: "Qty",
    label: "Quantity",
    kind: "range",
    categories: null,
    numberOf: (p) => p.total_qty,
  },
  {
    id: "Shelf",
    label: "Shelf",
    kind: "multi",
    categories: null,
    valuesOf: (p) => p.locations.map((l) => l.shelfCode).filter((code) => code !== "—"),
  },
  {
    id: "Project",
    label: "Project",
    kind: "multi",
    categories: null,
    valuesOf: (p) => p.projectNames,
  },
  {
    id: "Status",
    label: "Status",
    kind: "multi",
    categories: null,
    valuesOf: (p) => [p.part_status],
  },
  {
    id: "Dielectric",
    label: "Dielectric",
    kind: "multi",
    categories: null,
    valuesOf: (p) => attrValues(p, "dielectric"),
  },

  /* ── Resistors (spec §2) ────────────────────────────────────────────────── */
  {
    id: "Resistance",
    label: "Resistance",
    kind: "range",
    categories: [CATEGORY.resistor, CATEGORY.resistorNetwork],
    units: OHM_UNITS,
    numberOf: (p) => attrNumber(p, ATTR.resistanceOhms),
  },
  {
    id: "Tolerance",
    label: "Tolerance",
    kind: "multi",
    categories: [CATEGORY.resistor, CATEGORY.resistorNetwork],
    // Five fixed classes in the data, not a continuum — the spec is explicit
    // that this is a dropdown, not a slider. Populated on ~15% of rows, and
    // always blank on capacitors, which is why it is not a global facet.
    valuesOf: (p) => {
      const values = attrValues(p, ATTR.tolerancePercent);
      return values.map((v) => `±${v}%`);
    },
  },
  {
    id: "Power",
    label: "Power rating",
    kind: "multi",
    categories: [CATEGORY.resistor, CATEGORY.resistorNetwork],
    // Spec: "text search only (not range)" — stored as original text with
    // inconsistent formatting ("0.25W", "1/4W", "0.125w"). A value list is the
    // honest read of that: it shows exactly the spellings the sheet contains.
    valuesOf: (p) => attrValues(p, ATTR.powerWatts),
  },

  /* ── Capacitors ─────────────────────────────────────────────────────────── */
  {
    id: "Capacitance",
    label: "Capacitance",
    kind: "range",
    categories: [CATEGORY.capacitor],
    units: FARAD_UNITS,
    numberOf: (p) => attrNumber(p, ATTR.capacitanceFarads),
  },
  {
    id: "CaseSize",
    label: "Case size",
    kind: "multi",
    categories: [CATEGORY.capacitor],
    // The source column is headed "COLOUR" but holds case dimensions
    // ("6.3 x 5.8 mm"). Spec §2: label it Case size, never a colour picker.
    hint: "From the sheet's COLOUR column, which actually holds case dimensions.",
    valuesOf: (p) => attrValues(p, ATTR.color),
  },

  /* ── Inductors / ferrites ───────────────────────────────────────────────── */
  {
    id: "Inductance",
    label: "Inductance",
    kind: "range",
    categories: [CATEGORY.inductor],
    units: HENRY_UNITS,
    numberOf: (p) => attrNumber(p, ATTR.inductanceHenries),
  },
  {
    id: "Current",
    label: "Current rating",
    kind: "multi",
    categories: [CATEGORY.inductor, CATEGORY.ferrite, CATEGORY.fuse],
    // Original text, sometimes compound ("1.1A 280mΩ" mixes current and DCR).
    hint: "Original sheet text; some cells combine more than one spec.",
    valuesOf: (p) => attrValues(p, ATTR.currentRating),
  },

  /* ── Diodes ─────────────────────────────────────────────────────────────── */
  {
    id: "DiodeType",
    label: "Diode type",
    kind: "multi",
    categories: [CATEGORY.diode],
    // Spec: this is where the descriptive text lives for diodes, since
    // Description is always blank in that file. ~72% populated.
    valuesOf: (p) => attrValues(p, ATTR.diodeType),
  },
  {
    id: "Rating",
    label: "Rating",
    kind: "multi",
    categories: [CATEGORY.diode, CATEGORY.thermistor, CATEGORY.battery],
    hint: "Compound text from the sheet, e.g. 1A/40V.",
    valuesOf: (p) => attrValues(p, ATTR.rating),
  },

  /* ── Connectors (v1 data; absent from the v2 regeneration) ──────────────── */
  {
    id: "PinCount",
    label: "Pin count",
    kind: "multi",
    categories: [CATEGORY.terminalBlock, CATEGORY.ffcFpc, CATEGORY.connector],
    valuesOf: (p) => attrValues(p, ATTR.pinCount),
  },
  {
    id: "Pitch",
    label: "Pitch",
    kind: "multi",
    categories: [CATEGORY.terminalBlock, CATEGORY.ffcFpc, CATEGORY.connector],
    valuesOf: (p) => attrValues(p, ATTR.pitch),
  },
  {
    id: "ContactType",
    label: "Contact type",
    kind: "multi",
    categories: [CATEGORY.ffcFpc],
    valuesOf: (p) => attrValues(p, ATTR.contactType),
  },

  /* ── Material list / SMPS ───────────────────────────────────────────────── */
  {
    id: "Group",
    label: "Group",
    kind: "multi",
    categories: [CATEGORY.hardware],
    // Spec: "good primary filter for this file" (6 clean values).
    valuesOf: (p) => attrValues(p, ATTR.group),
  },
  {
    id: "CostPrice",
    label: "Cost price (₹)",
    kind: "range",
    categories: [CATEGORY.hardware],
    hint: "Sheet's own CP/SP columns; confirm the tiers with whoever owns pricing.",
    numberOf: (p) => attrNumber(p, ATTR.cp),
  },
  {
    id: "SellMoq100",
    label: "Sell price @ MOQ 100 (₹)",
    kind: "range",
    categories: [CATEGORY.hardware],
    numberOf: (p) => attrNumber(p, ATTR.spMoq100),
  },
  {
    id: "SellMoq25",
    label: "Sell price @ MOQ 25 (₹)",
    kind: "range",
    categories: [CATEGORY.hardware],
    numberOf: (p) => attrNumber(p, ATTR.spMoq25),
  },
  {
    id: "BuildStatus",
    label: "Build status",
    kind: "multi",
    categories: [CATEGORY.smps],
    valuesOf: (p) => attrValues(p, ATTR.status),
  },
];

export const FACET_BY_ID: ReadonlyMap<string, FacetDef> = new Map(FACET_DEFS.map((f) => [f.id, f]));
