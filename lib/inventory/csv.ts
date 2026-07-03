/**
 * lib/inventory/csv.ts — hand-rolled CSV encoding (R2-33: "Export CSV/xlsx of
 * the filtered view... all columns incl. price, location, voltage").
 *
 * No csv library per the mission note ("hand-rolled CSV") — this is the
 * entire spec: RFC 4180 quoting (quote a field iff it contains a comma,
 * quote, or line break; double up embedded quotes), CRLF row endings.
 */

import type { InventoryPart } from "./types";

export function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
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
  return part.locations.map((l) => `Shelf ${l.shelfCode} · ${l.boxName} (${l.qty})`).join(" / ");
}

/** One CSV row per part — same columns/order as `INVENTORY_EXPORT_HEADERS`. */
export function inventoryPartToCsvRow(part: InventoryPart): (string | number)[] {
  const stockValue = part.last_unit_price != null ? Math.round(part.total_qty * part.last_unit_price * 100) / 100 : "";
  return [
    part.internal_pid,
    part.mpn ?? "",
    part.manufacturer ?? "",
    part.lcsc_pn ?? "",
    part.category ?? "",
    part.value ?? "",
    part.voltage ?? "",
    part.package ?? "",
    part.total_qty,
    part.reorder_point ?? "",
    part.part_status,
    formatLocations(part),
    part.last_unit_price ?? "",
    stockValue,
    part.datasheet_url ?? "",
  ];
}
