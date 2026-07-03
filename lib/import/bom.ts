/**
 * lib/import/bom.ts — BOM xlsx parsing primitives (FEATURES.md §14, plan/SCHEMA.md §3).
 *
 * Parses the two REAL project BOM workbooks the client supplied
 * (`TMCS_96x32_Matrix_V1.2.xlsx`, `GCU_V1.1_BOM.xlsx`) — a single sheet, a
 * single header row, clean rectangular schema:
 *
 *   # | Reference | Qty | Value | Footprint | DNP | Description | MPN |
 *   Manufacturer | PartLink | LCSC Part #
 *
 * Column PRESENCE varies between real files (GCU has no "LCSC Part #" column
 * at all) so columns are located by header TEXT, never a fixed index.
 *
 * Scope: this module only PARSES a workbook into raw `BomLineRaw` rows —
 * matching against the catalog (`match_state`, `matched_part_id`) is
 * bom-pipeline's reconcile step (`lib/bom/**`), which imports these
 * primitives (OWNERSHIP.md: "lib/import (import) ← bom-pipeline").
 */

// Namespace import (not `import XLSX from "xlsx"`): xlsx's ESM build
// (node_modules/xlsx/xlsx.mjs) exposes only named exports, no default, so the
// default form hard-fails Turbopack's `next build` ("Export default doesn't
// exist in target module") once this module is pulled into an app route's
// build graph (bom-pipeline imports it). All usage below is `XLSX.*`.
import * as XLSX from "xlsx";

/** One parsed `smark_bom_lines`-shaped row, before reconcile/matching. */
export interface BomLineRaw {
  /** The sheet's own `#` column when present, else 1-based row order. */
  line_no: number | null;
  /** Raw reference designators, e.g. `"C3,C69,C70"`. */
  references: string | null;
  qty: number | null;
  value: string | null;
  /** Raw footprint string, e.g. `"SMARKKicadLib:C0805"`. */
  footprint: string | null;
  dnp: boolean;
  description: string | null;
  mpn: string | null;
  manufacturer: string | null;
  part_link: string | null;
  lcsc_pn: string | null;
}

export interface ParsedBom {
  /** The workbook's sheet actually parsed (BOM files are single-sheet). */
  sheet_name: string;
  lines: BomLineRaw[];
}

/** Column roles this parser understands — everything else in the header row is ignored. */
type BomColumnRole =
  | "line_no"
  | "references"
  | "qty"
  | "value"
  | "footprint"
  | "dnp"
  | "description"
  | "mpn"
  | "manufacturer"
  | "part_link"
  | "lcsc_pn";

/**
 * Header label → role, normalized (trim + lowercase + collapse whitespace).
 * Includes the "LCSC" short form alongside "LCSC Part #" since a distributor
 * added via Settings (FEATURES §16) may label the column differently.
 */
const BOM_HEADER_ROLES: Record<string, BomColumnRole> = {
  "#": "line_no",
  reference: "references",
  references: "references",
  qty: "qty",
  value: "value",
  footprint: "footprint",
  dnp: "dnp",
  description: "description",
  mpn: "mpn",
  manufacturer: "manufacturer",
  partlink: "part_link",
  "part link": "part_link",
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
function mapColumns(headerRow: unknown[]): Partial<Record<BomColumnRole, number>> {
  const map: Partial<Record<BomColumnRole, number>> = {};
  headerRow.forEach((cell, col) => {
    const role = BOM_HEADER_ROLES[normalizeHeader(cell)];
    if (role && map[role] === undefined) map[role] = col;
  });
  return map;
}

/** Parses one already-loaded worksheet (as a 2D grid) into `BomLineRaw[]`. */
export function parseBomGrid(grid: unknown[][]): BomLineRaw[] {
  const headerRow = grid[0] ?? [];
  const columns = mapColumns(headerRow);
  const lines: BomLineRaw[] = [];

  for (let r = 1; r < grid.length; r += 1) {
    const row = grid[r];
    if (!row) continue;

    const cell = (role: BomColumnRole): unknown => {
      const col = columns[role];
      return col === undefined ? null : row[col];
    };

    // A row is real BOM content only when it carries at least a reference,
    // a value, or an MPN — fully blank trailing rows are common in these
    // sheets and must not become empty part lines.
    const references = cellToText(cell("references"));
    const value = cellToText(cell("value"));
    const mpn = cellToText(cell("mpn"));
    const description = cellToText(cell("description"));
    if (!references && !value && !mpn && !description) continue;

    lines.push({
      line_no: cellToNumber(cell("line_no")) ?? r,
      references,
      qty: cellToNumber(cell("qty")),
      value,
      footprint: cellToText(cell("footprint")),
      dnp: cellToBool(cell("dnp")),
      description,
      mpn,
      manufacturer: cellToText(cell("manufacturer")),
      part_link: cellToText(cell("part_link")),
      lcsc_pn: cellToText(cell("lcsc_pn")),
    });
  }

  return lines;
}

/**
 * Parses a BOM workbook from disk/bytes. Real BOM files are single-sheet;
 * pass `sheetName` to target a specific one in a multi-sheet workbook.
 */
export function parseBomWorkbook(input: string | Buffer | ArrayBuffer, sheetName?: string): ParsedBom {
  const workbook =
    typeof input === "string"
      ? XLSX.readFile(input)
      : XLSX.read(input instanceof ArrayBuffer ? Buffer.from(input) : input, { type: "buffer" });
  const name = sheetName ?? workbook.SheetNames[0];
  if (!name) throw new Error("BOM workbook has no sheets.");
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`BOM workbook has no sheet named "${name}".`);

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null }) as unknown[][];
  return { sheet_name: name, lines: parseBomGrid(grid) };
}
