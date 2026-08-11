/**
 * lib/inventory/columns.ts — which columns the Inventory grid shows, per category.
 *
 * Client report, 2026-08-11, with `ic_smd.csv` open in Excel beside the app:
 * "A generic header is used and applied to all the components. The headers are
 * different according to the files I shared. Like… 'V' and 'Value' is not part
 * of the source file (here for category - IC). Instead other important values
 * should be displayed here. So this header needs to change as per the category
 * selection."
 *
 * He is right, and the fix is the same shape as the facet registry: declare
 * every column once, say which categories each belongs to, and let the data
 * decide the rest. A resistor sheet has resistance, tolerance and wattage; an
 * IC sheet has sub-category, manufacturer, package and project. One fixed
 * header can only ever suit one of them.
 *
 * Two rules pick the set:
 *
 *   1. **Category-scoped columns appear when you narrow to their category**,
 *      exactly like the category-scoped filters. With nothing selected the grid
 *      shows a general-purpose set, because a mixed view has no better answer.
 *   2. **A column with no data in the current rows is dropped.** This is what
 *      actually kills "Value" and "V" on ICs, and it generalises: it also
 *      removes Tolerance from a resistor view where the source never filled it
 *      in, without anyone maintaining a list of exceptions. The same rule the
 *      facet sidebar uses for dead options.
 *
 * PID, MPN, Description, Qty and Location are never dropped — they are how a
 * row is identified and acted on, and a blank one is information too.
 */

import { CATEGORY } from "./facet-registry";
import type { InventoryPart } from "./types";

export type ColumnRender = "pid" | "text" | "description" | "qty" | "location";

export interface InventoryColumn {
  id: string;
  label: string;
  /** Read the cell's text. `null` = nothing to show for this part. */
  value: (part: InventoryPart) => string | null;
  render?: ColumnRender;
  align?: "right";
  mono?: boolean;
  /**
   * `"always"` — never dropped, shown in every view.
   * `"default"` — the general-purpose set, used when no category is selected.
   * a category list — shown once the view narrows to one of them.
   */
  scope: "always" | "default" | readonly string[];
  /** Rough width share, used to size the table's minimum width. */
  width: number;
}

function attr(part: InventoryPart, key: string): string | null {
  const raw = part.attributes[key];
  if (raw === null || raw === undefined || typeof raw === "boolean") return null;
  const text = String(raw).trim();
  return text === "" ? null : text;
}

const RESISTIVE = [CATEGORY.resistor, CATEGORY.resistorNetwork] as const;
const WOUND = [CATEGORY.inductor, CATEGORY.ferrite] as const;

export const INVENTORY_COLUMNS: readonly InventoryColumn[] = [
  { id: "pid", label: "PID", scope: "always", render: "pid", mono: true, width: 90, value: (p) => p.internal_pid },
  { id: "mpn", label: "MPN", scope: "always", mono: true, width: 130, value: (p) => p.mpn },
  { id: "description", label: "Description", scope: "always", render: "description", width: 170, value: (p) => p.description },

  /* General-purpose set — a mixed catalog has no better answer than these. */
  { id: "value", label: "Value", scope: "default", width: 90, value: (p) => p.value },
  { id: "voltage", label: "V", scope: "default", mono: true, width: 60, value: (p) => p.voltage },
  { id: "package", label: "Package", scope: "default", mono: true, width: 120, value: (p) => p.package },
  { id: "category", label: "Category", scope: "default", width: 110, value: (p) => p.category },
  { id: "sub_category", label: "Sub-category", scope: "default", width: 120, value: (p) => attr(p, "sub_category") },

  /* Resistors — resistors.csv / resistor_networks.csv */
  { id: "res_value", label: "Resistance", scope: RESISTIVE, width: 100, value: (p) => p.value },
  { id: "res_tolerance", label: "Tolerance", scope: RESISTIVE, width: 90, value: (p) => {
      const t = attr(p, "tolerance_percent");
      return t === null ? null : `±${t}%`;
    } },
  { id: "res_power", label: "Power", scope: RESISTIVE, width: 80, value: (p) => attr(p, "power_watts") },

  /* Capacitors — capacitors.csv */
  { id: "cap_value", label: "Capacitance", scope: [CATEGORY.capacitor], width: 100, value: (p) => p.value },
  { id: "cap_voltage", label: "Voltage", scope: [CATEGORY.capacitor], mono: true, width: 80, value: (p) => p.voltage },
  { id: "cap_case", label: "Case size", scope: [CATEGORY.capacitor], width: 110, value: (p) => attr(p, "color") },

  /* Inductors and ferrite beads */
  { id: "ind_value", label: "Inductance", scope: [CATEGORY.inductor], width: 100, value: (p) => p.value },
  { id: "ind_current", label: "Current", scope: WOUND, width: 100, value: (p) => attr(p, "current_rating") },

  /* Diodes — diodes.csv */
  { id: "diode_type", label: "Diode type", scope: [CATEGORY.diode], width: 130, value: (p) => attr(p, "diode_type") },
  { id: "diode_rating", label: "Rating", scope: [CATEGORY.diode], width: 100, value: (p) => attr(p, "rating") },

  /* ICs — ic_smd.csv / ic_th.csv. The columns he had open in Excel. */
  { id: "ic_sub", label: "Sub-category", scope: [CATEGORY.ic], width: 130, value: (p) => attr(p, "sub_category") },
  { id: "ic_project", label: "Project", scope: [CATEGORY.ic], width: 100, value: (p) => attr(p, "project") },

  /* Fuses, thermistors, batteries */
  { id: "fuse_current", label: "Current", scope: [CATEGORY.fuse], width: 100, value: (p) => attr(p, "current_rating") },
  { id: "rating", label: "Rating", scope: [CATEGORY.thermistor, CATEGORY.battery], width: 120, value: (p) => attr(p, "rating") },

  /* Relays and transformers — misc_relay.csv / misc_transformer.csv */
  { id: "coil_voltage", label: "Voltage", scope: [CATEGORY.relay, CATEGORY.transformer], width: 100, value: (p) => attr(p, "voltage") },
  { id: "coil_current", label: "Current", scope: [CATEGORY.relay, CATEGORY.transformer], width: 100, value: (p) => attr(p, "current") },

  /* Material list — material_list.csv */
  { id: "hw_group", label: "Group", scope: [CATEGORY.hardware], width: 150, value: (p) => attr(p, "group") },
  { id: "hw_cp", label: "CP ₹", scope: [CATEGORY.hardware], align: "right", mono: true, width: 80, value: (p) => attr(p, "cp") },
  { id: "hw_sp100", label: "SP@100 ₹", scope: [CATEGORY.hardware], align: "right", mono: true, width: 90, value: (p) => attr(p, "sp_moq100") },
  { id: "hw_sp25", label: "SP@25 ₹", scope: [CATEGORY.hardware], align: "right", mono: true, width: 90, value: (p) => attr(p, "sp_moq25") },

  /* SMPS — smps.csv */
  { id: "smps_dim", label: "Dimension", scope: [CATEGORY.smps], width: 110, value: (p) => attr(p, "dimension") },
  { id: "smps_height", label: "Height", scope: [CATEGORY.smps], width: 80, value: (p) => attr(p, "height") },
  { id: "smps_status", label: "Build status", scope: [CATEGORY.smps], width: 120, value: (p) => attr(p, "status") },

  /* Connector-shaped categories, for whenever the reworked files land. */
  { id: "pin_count", label: "Pins", scope: [CATEGORY.terminalBlock, CATEGORY.ffcFpc, CATEGORY.connector], width: 80, value: (p) => attr(p, "pin_count") },
  { id: "pitch", label: "Pitch", scope: [CATEGORY.terminalBlock, CATEGORY.ffcFpc, CATEGORY.connector], width: 90, value: (p) => attr(p, "pitch") },
  { id: "contact_type", label: "Contact", scope: [CATEGORY.ffcFpc], width: 100, value: (p) => attr(p, "contact_type") },

  /* Shared tail columns for the category views. */
  { id: "cat_package", label: "Package", scope: [
      ...RESISTIVE, CATEGORY.capacitor, ...WOUND, CATEGORY.diode, CATEGORY.ic, CATEGORY.fuse,
      CATEGORY.crystal, CATEGORY.led, CATEGORY.thermistor, CATEGORY.terminalBlock, CATEGORY.ffcFpc,
      CATEGORY.connector,
    ], mono: true, width: 120, value: (p) => p.package },
  { id: "cat_mount", label: "Mount", scope: [...RESISTIVE, CATEGORY.capacitor, CATEGORY.diode, CATEGORY.ic], width: 80, value: (p) => attr(p, "mount_type") },
  { id: "cat_manufacturer", label: "Manufacturer", scope: [
      CATEGORY.capacitor, ...WOUND, CATEGORY.diode, CATEGORY.ic,
    ], width: 140, value: (p) => p.manufacturer },

  { id: "qty", label: "Qty", scope: "always", render: "qty", align: "right", width: 80, value: (p) => String(p.total_qty) },
  // Rendered as a chip from the part's locations, so the text accessor is
  // unused — it exists only to satisfy the shared column shape.
  { id: "location", label: "Location", scope: "always", render: "location", width: 160, value: () => null },
];

/**
 * The columns to render for the current view.
 *
 * `selectedCategories` comes straight from the Category facet. With none (or
 * with several that share no scoped columns) this falls back to the general set,
 * which is what the grid always showed.
 */
export function visibleColumns(
  parts: readonly InventoryPart[],
  selectedCategories: readonly string[],
): InventoryColumn[] {
  const narrowed = selectedCategories.length > 0;

  const candidates = INVENTORY_COLUMNS.filter((column) => {
    if (column.scope === "always") return true;
    if (column.scope === "default") return !narrowed;
    return narrowed && column.scope.some((c) => selectedCategories.includes(c));
  });

  return candidates.filter((column) => {
    if (column.scope === "always") return true;
    // Dead column: nothing in view has a value for it. This is what removes
    // "Value" and "V" from an IC view — ic_smd.csv has no such columns, so
    // every cell would read "—".
    return parts.some((part) => column.value(part) !== null);
  });
}

/** Minimum table width so the chosen columns don't crush each other. */
export function minWidthFor(columns: readonly InventoryColumn[]): number {
  return columns.reduce((total, column) => total + column.width, 0);
}
