/**
 * lib/expenses/csv.ts — CSV row shaping for the Expenses export (R2-33).
 * Same hand-rolled RFC 4180 encoder as lib/inventory/csv.ts (no library —
 * quote iff comma/quote/newline, CRLF rows); the xlsx variant
 * (app/(app)/expenses/export/route.ts, `?format=xlsx`) reuses `EXPENSE_EXPORT_HEADERS`
 * + `entryToExportRow` so both formats always agree on columns/order.
 *
 * `sanitizeForSpreadsheet` (finding #6) guards against CSV/formula injection
 * (CWE-1236): free-text fields an operator or external source controls
 * (vendor, note, category, PO-derived text) are neutralized here — the ONE
 * shaping function both the CSV and xlsx export paths go through — so
 * neither format ever hands Excel/Sheets a leading `=`/`+`/`-`/`@` (or
 * tab/CR) to interpret as a formula on open.
 */

import type { EntryListItem } from "./types";

const FORMULA_INJECTION_LEAD_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Prefixes a value with a leading apostrophe if it could be read as a spreadsheet formula. */
export function sanitizeForSpreadsheet(value: string): string {
  return value.length > 0 && FORMULA_INJECTION_LEAD_CHARS.has(value[0]!) ? `'${value}` : value;
}

export function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = sanitizeForSpreadsheet(String(value));
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(toCsvValue).join(",")).join("\r\n");
}

export const EXPENSE_EXPORT_HEADERS = [
  "Date",
  "Type",
  "Amount (INR)",
  "Category",
  "Account",
  "Vendor/Party",
  "Project",
  "GSTIN",
  "Tax amount (INR)",
  "Note",
  "Draft",
  "Attachment URL",
] as const;

/**
 * One export row per entry — same columns/order as `EXPENSE_EXPORT_HEADERS`.
 * Free-text fields are run through `sanitizeForSpreadsheet` HERE (not just in
 * `toCsvValue`) so the xlsx path — which writes these values straight into
 * `aoa_to_sheet` and never calls `toCsvValue` — gets the same protection.
 */
export function entryToExportRow(entry: EntryListItem): (string | number)[] {
  return [
    entry.entry_date,
    entry.entry_type,
    entry.amount,
    sanitizeForSpreadsheet(entry.category),
    sanitizeForSpreadsheet(entry.accountName ?? ""),
    sanitizeForSpreadsheet(entry.vendor ?? ""),
    sanitizeForSpreadsheet(entry.projectName ?? ""),
    sanitizeForSpreadsheet(entry.gstin ?? ""),
    entry.tax_amount ?? "",
    sanitizeForSpreadsheet(entry.note ?? ""),
    entry.is_draft ? "yes" : "",
    sanitizeForSpreadsheet(entry.attachment_url ?? ""),
  ];
}
