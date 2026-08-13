/**
 * lib/part-events/specs.ts — builds the part-detail "Specifications" grid
 * (tab-part-detail.md §2: "value, package, dielectric/tolerance/voltage etc.
 * from attributes"; R2-11: "+ Last price, Stock value"). Pure.
 */

import { formatINR } from "@/lib/format";
import type { PartRow } from "@/types/db";
import type { SpecEntry } from "./types";

const KNOWN_ATTRIBUTE_LABELS: Record<string, string> = {
  dielectric: "Dielectric",
  tolerance: "Tolerance",
  wattage: "Wattage",
  current: "Current",
  pin_count: "Pin count",
  esr: "ESR",
  inductance: "Inductance",
  // The title-case fallback renders these "Sub Category", "Mount Type",
  // "Tolerance Percent" — each reading as a different field from the column or
  // facet of the same name elsewhere in the app. The importer writes all of
  // them, so they show on most parts.
  sub_category: "Sub-category",
  mount_type: "Mount type",
  tolerance_percent: "Tolerance (%)",
  power_watts: "Power rating",
  current_rating: "Current rating",
  diode_type: "Diode type",
  contact_type: "Contact type",
  package_size: "Package size",
  cp: "Cost price (₹)",
  sp_moq100: "Sell price @ MOQ 100 (₹)",
  sp_moq25: "Sell price @ MOQ 25 (₹)",
};

function attributeLabel(key: string): string {
  return KNOWN_ATTRIBUTE_LABELS[key] ?? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Attributes the Specifications grid must not render (client report, 2026-08-11:
 * "these should be removed", pointing at Source Row and Source File).
 *
 * Two kinds, both noise to the person checking a part:
 *
 *   - **Provenance and QA.** `Filter_Specification.md` §1 is explicit that
 *     `Source_Sheet`/`Source_Row` are "internal build/QA traceability only —
 *     do not expose them as filters or as visible fields". They were already
 *     excluded from filtering and search; the specs grid rendered every
 *     attribute it found, so they leaked in here. `data_flag`/`qty_raw` are our
 *     own import bookkeeping and belong with them.
 *   - **Raw base-unit numbers.** `Import_Guide.md` §2: "Do not filter directly
 *     against these raw numbers in the UI — 0.0000001 is unreadable… for
 *     display use `Value_Display`." A row reading "Capacitance Farads 1e-7"
 *     directly under "Value 100 nF" is the same number twice, once unreadably.
 *     They stay on the part and still drive the range filters.
 */
const HIDDEN_SPEC_KEYS: ReadonlySet<string> = new Set([
  "source_file",
  "source_row",
  "source_sheet",
  "data_flag",
  "qty_raw",
  "resistance_ohms",
  "capacitance_farads",
  "inductance_henries",
  // Duplicates of real columns. The client created a custom "description" field
  // before the Receive form had one, so parts saved then carry the text in
  // `attributes` as well; rendering both puts two rows labelled Description on
  // the same part, disagreeing with each other. The column is the source of
  // truth and `buildPartSpecs` already shows it.
  "description",
  "distributor",
]);

/** qty × last_unit_price — null when the part has never been priced (R2-11 honesty rule). */
export function computeStockValue(part: PartRow): number | null {
  if (part.last_unit_price == null) return null;
  return Math.round(part.total_qty * part.last_unit_price * 100) / 100;
}

/**
 * Fields the grid always renders, blank or not.
 *
 * Client report, 2026-08-11: "Empty fields are just not shown at all on part
 * page… this way I am unable to add details that are not already in it." A grid
 * that hides what is missing is exactly backwards during a verification pass:
 * the gaps are the thing he is looking for. These render "—" when unset, which
 * both shows the gap and tells him the field is available to fill in.
 *
 * Only this core set is forced. The long tail of per-category attributes still
 * appears only when populated, or a resistor would carry a dozen blank rows for
 * columns its source file has never heard of.
 */
const ALWAYS_SHOWN = ["MPN", "Description", "Value", "Voltage", "Package", "Category", "Sub-category", "Manufacturer", "Distributor", "LCSC PN", "Mount type"] as const;

export function buildPartSpecs(part: PartRow): SpecEntry[] {
  const specs: SpecEntry[] = [];
  const push = (label: string, value: unknown) => {
    if (value === null || value === undefined) return;
    const str = String(value).trim();
    if (!str) return;
    specs.push({ label, value: str });
  };

  // For much of the real catalog (ICs, fuses, displays) the description is the
  // only human-readable handle on the part, so it leads the grid rather than
  // being left off it as it was while the demo catalog set the shape here.
  push("MPN", part.mpn);
  push("Description", part.description);
  push("Value", part.value);
  push("Voltage", part.voltage);
  // Where the part was sourced from — "it gives us idea from where we sourced
  // that item". Read off the part itself rather than order history, which is
  // empty for the whole imported catalog.
  push("Distributor", part.default_distributor);
  push("Package", part.package);
  push("Category", part.category);
  push("Manufacturer", part.manufacturer);
  push("LCSC PN", part.lcsc_pn);

  for (const [key, value] of Object.entries(part.attributes)) {
    if (HIDDEN_SPEC_KEYS.has(key)) continue;
    push(attributeLabel(key), value);
  }

  // Anything in the core set that had no value follows as a blank row, in the
  // declared order, so the gaps are visible and obviously fillable.
  const present = new Set(specs.map((s) => s.label));
  const blanks: SpecEntry[] = ALWAYS_SHOWN.filter((label) => !present.has(label)).map((label) => ({
    label,
    value: "—",
  }));

  const stockValue = computeStockValue(part);
  const money: SpecEntry[] = [
    { label: "Last price", value: part.last_unit_price != null ? formatINR(part.last_unit_price) : "Not yet priced" },
    { label: "Stock value", value: stockValue != null ? formatINR(stockValue) : "— (unpriced)" },
  ];

  return [...specs, ...blanks, ...money];
}
