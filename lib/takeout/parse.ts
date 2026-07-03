/**
 * lib/takeout/parse.ts — ad-hoc BOM parsing for Bulk takeout's upload/paste
 * zone (plan/tab-bulk-pick.md: "Empty state: upload/paste zone").
 *
 * Deliberately does NOT import `lib/import/bom.ts`: docs/OWNERSHIP.md's
 * cross-package import allow-list only grants that module to `bom-pipeline`
 * ("lib/import (import) ← bom-pipeline") — takeout isn't listed. This is a
 * small, independent re-implementation of the same idea (locate columns by
 * header TEXT, not position — real sheets vary which columns are present)
 * so this package never reaches across that ownership boundary. Flagged in
 * this package's report as a candidate for a future shared parsing
 * primitive if the integrator wants one (the two implementations are
 * intentionally near-identical).
 *
 * No Node-only APIs here (`xlsx`'s `type: "array"` read works in the
 * browser) — both parsers run client-side, so the upload/paste panel can
 * show resolved lines without a server round trip for the file itself; only
 * the resulting plain-data rows are sent to `resolveAdHocLinesAction`.
 */

import * as XLSX from "xlsx";
import type { TakeoutRawLine } from "./types";

type TakeoutColumnRole =
  | "line_no"
  | "references"
  | "qty"
  | "value"
  | "footprint"
  | "dnp"
  | "description"
  | "mpn"
  | "manufacturer"
  | "lcsc_pn";

/** Header label → role, normalized (trim + lowercase + collapse whitespace). */
const HEADER_ROLES: Record<string, TakeoutColumnRole> = {
  "#": "line_no",
  reference: "references",
  references: "references",
  qty: "qty",
  quantity: "qty",
  value: "value",
  footprint: "footprint",
  package: "footprint",
  dnp: "dnp",
  description: "description",
  mpn: "mpn",
  manufacturer: "manufacturer",
  mfr: "manufacturer",
  "part link": "footprint",
  "lcsc part #": "lcsc_pn",
  "lcsc part number": "lcsc_pn",
  lcsc: "lcsc_pn",
};

function normalizeHeader(cell: unknown): string {
  return String(cell ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function cellToText(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null;
  const s = String(cell).trim();
  return s === "" ? null : s;
}

function cellToNumber(cell: unknown): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  const s = String(cell).trim().replace(/,/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cellToBool(cell: unknown): boolean {
  return cellToText(cell) !== null;
}

/** Locates each recognized column's index in the header row. First match wins per role. */
function mapColumns(headerRow: readonly unknown[]): Partial<Record<TakeoutColumnRole, number>> {
  const map: Partial<Record<TakeoutColumnRole, number>> = {};
  headerRow.forEach((cell, col) => {
    const role = HEADER_ROLES[normalizeHeader(cell)];
    if (role && map[role] === undefined) map[role] = col;
  });
  return map;
}

/** Parses an already-loaded 2D grid (header row + data rows) into raw takeout lines. */
export function parseTakeoutGrid(grid: readonly (readonly unknown[])[]): TakeoutRawLine[] {
  const headerRow = grid[0] ?? [];
  const columns = mapColumns(headerRow);
  const lines: TakeoutRawLine[] = [];

  for (let r = 1; r < grid.length; r += 1) {
    const row = grid[r];
    if (!row) continue;

    const cell = (role: TakeoutColumnRole): unknown => {
      const col = columns[role];
      return col === undefined ? null : row[col];
    };

    // A row is real content only when it carries at least a reference, a
    // value, or an MPN — fully blank trailing rows are common and must not
    // become empty pick lines.
    const references = cellToText(cell("references"));
    const value = cellToText(cell("value"));
    const mpn = cellToText(cell("mpn"));
    const description = cellToText(cell("description"));
    if (!references && !value && !mpn && !description) continue;

    lines.push({
      lineNo: cellToNumber(cell("line_no")) ?? r,
      references,
      qty: cellToNumber(cell("qty")),
      value,
      footprint: cellToText(cell("footprint")),
      dnp: cellToBool(cell("dnp")),
      description,
      mpn,
      manufacturer: cellToText(cell("manufacturer")),
      lcscPn: cellToText(cell("lcsc_pn")),
    });
  }

  return lines;
}

/** Parses an uploaded workbook's bytes (first sheet, or `sheetName` if given). */
export function parseUploadedTakeoutFile(bytes: ArrayBuffer | Uint8Array, sheetName?: string): TakeoutRawLine[] {
  const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  const workbook = XLSX.read(data, { type: "array" });
  const name = sheetName ?? workbook.SheetNames[0];
  if (!name) throw new Error("That workbook has no sheets.");
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`That workbook has no sheet named "${name}".`);

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null }) as unknown[][];
  return parseTakeoutGrid(grid);
}

/**
 * Parses pasted spreadsheet text — Excel/Sheets copy-paste is tab-separated;
 * falls back to comma-separated for a plain CSV paste (detected off the
 * header row only, so a comma inside a later cell's free text never flips it).
 */
export function parsePastedTakeoutText(text: string): TakeoutRawLine[] {
  const rows = text
    .split(/\r\n|\r|\n/)
    .map((row) => row.trimEnd())
    .filter((row) => row.trim().length > 0);
  if (rows.length === 0) return [];

  const delimiter = rows[0]!.includes("\t") ? "\t" : ",";
  const grid = rows.map((row) => row.split(delimiter).map((cell) => cell.trim()));
  return parseTakeoutGrid(grid);
}
