/**
 * lib/inventory/csv.ts — hand-rolled CSV encoding (R2-33: "Export CSV/xlsx of
 * the filtered view... all columns incl. price, location, voltage").
 *
 * No csv library per the mission note ("hand-rolled CSV") — this is the
 * entire spec: RFC 4180 quoting (quote a field iff it contains a comma,
 * quote, or line break; double up embedded quotes), CRLF row endings.
 *
 * `sanitizeForSpreadsheet` (matches lib/expenses/csv.ts / lib/daily/export.ts
 * "finding #6") guards against CSV/formula injection (CWE-1236): free-text
 * fields an operator controls (MPN, manufacturer, value, package, datasheet
 * URL from the Receive "New part" form or the Stock List import, plus box
 * names in the Location column) are neutralized here so Excel/Sheets never
 * interprets a leading `=`/`+`/`-`/`@` (or tab/CR) as a formula on open.
 */

import type { InventoryPart } from "./types";

const FORMULA_INJECTION_LEAD_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Prefixes a value with a leading apostrophe if it could be read as a spreadsheet formula. */
export function sanitizeForSpreadsheet(value: string): string {
  return value.length > 0 && FORMULA_INJECTION_LEAD_CHARS.has(value[0]!) ? `'${value}` : value;
}

export function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = sanitizeForSpreadsheet(String(value));
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(toCsvValue).join(",")).join("\r\n");
}

export const INVENTORY_EXPORT_HEADERS = [
  "PID",
  "MPN",
  "Manufacturer",
  "LCSC PN",
  "Category",
  "Value",
  "Voltage",
  "Package",
  "Qty",
  "Reorder point",
  "Status",
  "Location",
  "Last unit price (INR)",
  "Stock value (INR)",
  "Datasheet URL",
] as const;

function formatLocations(part: InventoryPart): string {
  if (part.locations.length === 0) return "—";
  return part.locations
    .map((l) => `Shelf ${sanitizeForSpreadsheet(l.shelfCode)} · ${sanitizeForSpreadsheet(l.boxName)} (${l.qty})`)
    .join(" / ");
}

/**
 * One CSV row per part — same columns/order as `INVENTORY_EXPORT_HEADERS`.
 * Free-text fields are run through `sanitizeForSpreadsheet` HERE (not just in
 * `toCsvValue`) so a future xlsx path — which would write these values
 * straight into `aoa_to_sheet` and never call `toCsvValue` — gets the same
 * protection, exactly as lib/expenses/csv.ts's `entryToExportRow` does.
 */
export function inventoryPartToCsvRow(part: InventoryPart): (string | number)[] {
  const stockValue = part.last_unit_price != null ? Math.round(part.total_qty * part.last_unit_price * 100) / 100 : "";
  return [
    part.internal_pid,
    sanitizeForSpreadsheet(part.mpn ?? ""),
    sanitizeForSpreadsheet(part.manufacturer ?? ""),
    part.lcsc_pn ?? "",
    sanitizeForSpreadsheet(part.category ?? ""),
    sanitizeForSpreadsheet(part.value ?? ""),
    part.voltage ?? "",
    sanitizeForSpreadsheet(part.package ?? ""),
    part.total_qty,
    part.reorder_point ?? "",
    part.part_status,
    formatLocations(part),
    part.last_unit_price ?? "",
    stockValue,
    sanitizeForSpreadsheet(part.datasheet_url ?? ""),
  ];
}
