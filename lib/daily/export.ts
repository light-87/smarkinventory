/**
 * lib/daily/export.ts — day/range export (R2-33: "Export a day (or range) as
 * CSV/xlsx — movements + attendance + hours (+ expenses for owner/
 * accountant)"). Only this module touches the `xlsx` package — the row
 * shaping itself lives in `lib/daily/compute.ts` (pure, unit-testable without
 * pulling `xlsx` in).
 *
 * `lib/inventory/csv.ts` already hand-rolls RFC 4180 CSV encoding, but it's
 * inventory-owned and not in this package's cross-import allowlist
 * (docs/OWNERSHIP.md) — the same tiny encoder is re-implemented here rather
 * than reached into (matches the "each surface re-implements this tiny
 * logic locally" precedent already set by lib/dashboard/compute.ts).
 *
 * `sanitizeForSpreadsheet`/`sanitizeRow` (finding #6) guard against CSV/
 * formula injection (CWE-1236): free-text fields this package doesn't
 * control (vendor, note, category, box/movement labels, PO-derived text)
 * could otherwise hand Excel/Sheets a leading `=`/`+`/`-`/`@` (or tab/CR) to
 * interpret as a formula on open. Applied at the ROW-ARRAY level (after
 * `./compute`'s row builders, before either format is written) so both the
 * CSV block writer AND `aoa_to_sheet` (which never goes through
 * `toCsvValue`) get the same protection from one place.
 *
 * Named imports (`{ utils, write }`), not `import XLSX from "xlsx"`: the
 * package's ESM build (`xlsx.mjs`, `"module"` in its package.json) has no
 * default export — only `next build`'s Turbopack bundler resolves this
 * module to that ESM file (dev/`tsc` resolve the CJS `xlsx.js`, which
 * default-exports fine), so a default import passes typecheck/dev but fails
 * `bun run build` with "Export default doesn't exist in target module".
 * `lib/import/bom.ts` / `lib/bom/*` predate this file and still use the
 * default-import form — see this package's report re: notes-for-integrator.
 */
import { utils, write } from "xlsx";
import {
  ATTENDANCE_EXPORT_HEADERS,
  attendanceExportRow,
  EXPENSE_EXPORT_HEADERS,
  expenseExportRow,
  HOURS_EXPORT_HEADERS,
  hoursExportRow,
  MOVEMENT_EXPORT_HEADERS,
  movementExportRow,
  type AttendanceExportInput,
  type ExpenseExportInput,
  type HoursExportInput,
} from "./compute";
import type { MovementDailyRow } from "./compute";

export interface DailyExportData {
  movements: { row: MovementDailyRow; actorName: string }[];
  attendance: AttendanceExportInput[];
  hours: HoursExportInput[];
  /** `null` when the caller (employee) has no access to Expenses at all. */
  expenses: ExpenseExportInput[] | null;
}

const FORMULA_INJECTION_LEAD_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Prefixes a value with a leading apostrophe if it could be read as a spreadsheet formula. */
function sanitizeForSpreadsheet(value: string): string {
  return value.length > 0 && FORMULA_INJECTION_LEAD_CHARS.has(value[0]!) ? `'${value}` : value;
}

/** Neutralizes every string cell in a row — numbers pass through untouched. */
function sanitizeRow(row: readonly (string | number)[]): (string | number)[] {
  return row.map((cell) => (typeof cell === "string" ? sanitizeForSpreadsheet(cell) : cell));
}

function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toCsvBlock(title: string, headers: readonly string[], rows: (string | number)[][]): string {
  const lines = [title, headers.join(","), ...rows.map((row) => sanitizeRow(row).map(toCsvValue).join(","))];
  return lines.join("\r\n");
}

/** One combined CSV — a titled block per section (movements/attendance/hours[/expenses]). */
export function buildDailyExportCsv(data: DailyExportData): string {
  const blocks = [
    toCsvBlock(
      "Movements",
      MOVEMENT_EXPORT_HEADERS,
      data.movements.map(({ row, actorName }) => movementExportRow(row, actorName)),
    ),
    toCsvBlock("Attendance", ATTENDANCE_EXPORT_HEADERS, data.attendance.map(attendanceExportRow)),
    toCsvBlock("Hours", HOURS_EXPORT_HEADERS, data.hours.map(hoursExportRow)),
  ];
  if (data.expenses) {
    blocks.push(toCsvBlock("Expenses", EXPENSE_EXPORT_HEADERS, data.expenses.map(expenseExportRow)));
  }
  return blocks.join("\r\n\r\n");
}

/** One workbook, one sheet per section (movements/attendance/hours[/expenses]). */
export function buildDailyExportXlsx(data: DailyExportData): Buffer {
  const wb = utils.book_new();

  const movementsSheet = utils.aoa_to_sheet([
    [...MOVEMENT_EXPORT_HEADERS],
    ...data.movements.map(({ row, actorName }) => sanitizeRow(movementExportRow(row, actorName))),
  ]);
  utils.book_append_sheet(wb, movementsSheet, "Movements");

  const attendanceSheet = utils.aoa_to_sheet([
    [...ATTENDANCE_EXPORT_HEADERS],
    ...data.attendance.map((row) => sanitizeRow(attendanceExportRow(row))),
  ]);
  utils.book_append_sheet(wb, attendanceSheet, "Attendance");

  const hoursSheet = utils.aoa_to_sheet([[...HOURS_EXPORT_HEADERS], ...data.hours.map((row) => sanitizeRow(hoursExportRow(row)))]);
  utils.book_append_sheet(wb, hoursSheet, "Hours");

  if (data.expenses) {
    const expensesSheet = utils.aoa_to_sheet([
      [...EXPENSE_EXPORT_HEADERS],
      ...data.expenses.map((row) => sanitizeRow(expenseExportRow(row))),
    ]);
    utils.book_append_sheet(wb, expensesSheet, "Expenses");
  }

  return write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
