/**
 * lib/bom/parse-upload.ts — uploaded BOM workbook parsing (R2-19).
 *
 * Delegates the 10 standard fields `lib/import/bom.ts` already understands
 * (line_no/references/qty/value/footprint/dnp/description/mpn/manufacturer/
 * part_link/lcsc_pn) to that module (owned by the `import` package,
 * docs/OWNERSHIP.md cross-import allowance: "lib/import (import) ←
 * bom-pipeline"). This module ADDS the two things `lib/import/bom.ts`
 * doesn't parse — the per-line "Priority/Notes" column and any company
 * custom columns (R2-19) — without editing that module.
 *
 * Row alignment: mirrors `lib/import/bom.ts`'s OWN "keep this row" rule (a
 * row survives only when it carries a reference, value, mpn, or
 * description — see `parseBomGrid`'s source) via an independently-located
 * reference/value/mpn/description column set, so this module's extras line
 * up 1:1 with `parseBomWorkbook`'s surviving rows without needing anything
 * unexported from that module.
 */

// Namespace import (not `import XLSX from "xlsx"`) — the default-export form
// fails Next.js's Turbopack production RSC bundling against this package's
// ESM build ("Export default doesn't exist in target module"), even though
// it resolves fine under Bun/tsc. lib/import/bom.ts uses the default form and
// hits the same failure — flagged for that package's owner in this
// package's report (bom-pipeline can't edit lib/import/**, docs/OWNERSHIP.md).
import * as XLSX from "xlsx";
import { BOM_HEADER_ROLES, parseBomWorkbook, type BomLineRaw } from "@/lib/import/bom";
import type { BomLineExtra, BomTemplateColumn, FieldType } from "@/types/db";

export interface UploadedBomLine extends BomLineRaw {
  priorityNote: string | null;
  extra: BomLineExtra | null;
}

export interface ParsedUploadedBom {
  sheetName: string;
  lines: UploadedBomLine[];
}

function normalizeHeader(cell: unknown): string {
  return String(cell ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function cellIsBlank(cell: unknown): boolean {
  if (cell === null || cell === undefined) return true;
  return String(cell).trim() === "";
}

type KeepRole = "references" | "value" | "mpn" | "description";

/** Mirrors the subset of lib/import/bom.ts's BOM_HEADER_ROLES the "keep this row" rule reads. */
const KEEP_ROW_ROLES: Record<string, KeepRole> = {
  reference: "references",
  references: "references",
  value: "value",
  mpn: "mpn",
  description: "description",
};

const PRIORITY_HEADER_CANDIDATES = new Set(["priority/notes", "priority / notes", "priority notes", "priority", "notes"]);

interface LocatedColumns {
  keep: Partial<Record<KeepRole, number>>;
  priorityCol: number | null;
  customCols: Map<string, number>;
  /** Every column that is NOT a standard field, the priority note, or a registered custom column — keyed by its raw header. Captured verbatim into `extra` so no column is ever silently dropped (the sourcing agent reads whatever's there). */
  autoCols: Map<string, number>;
}

function locateColumns(headerRow: readonly unknown[], customColumns: readonly BomTemplateColumn[]): LocatedColumns {
  const keep: LocatedColumns["keep"] = {};
  let priorityCol: number | null = null;
  const customCols = new Map<string, number>();
  const customLabels = new Set(customColumns.flatMap((c) => [normalizeHeader(c.label), normalizeHeader(c.key)]));
  const autoCols = new Map<string, number>();

  headerRow.forEach((cell, col) => {
    const normalized = normalizeHeader(cell);
    if (normalized === "") return;

    const role = KEEP_ROW_ROLES[normalized];
    if (role && keep[role] === undefined) keep[role] = col;

    if (priorityCol === null && PRIORITY_HEADER_CANDIDATES.has(normalized)) priorityCol = col;

    for (const column of customColumns) {
      if (customCols.has(column.key)) continue;
      if (normalized === normalizeHeader(column.label) || normalized === normalizeHeader(column.key)) {
        customCols.set(column.key, col);
      }
    }

    // Anything left over — not a standard field, not the priority note, not a
    // registered custom column — is captured verbatim so it reaches the agent.
    const rawKey = String(cell ?? "").trim();
    const isStandard = BOM_HEADER_ROLES[normalized] !== undefined;
    const isPriority = PRIORITY_HEADER_CANDIDATES.has(normalized);
    if (!isStandard && !isPriority && !customLabels.has(normalized) && !autoCols.has(rawKey)) {
      autoCols.set(rawKey, col);
    }
  });

  return { keep, priorityCol, customCols, autoCols };
}

function cellToExtraValue(cell: unknown, type: FieldType): string | number | null {
  if (cellIsBlank(cell)) return null;
  if (type === "number") {
    const n = Number(String(cell).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return String(cell).trim();
}

/**
 * Parses an uploaded BOM workbook — real BOM files are single-sheet
 * (lib/import/bom.ts's own assumption); pass a specific `sheetName` only if
 * targeting a multi-sheet workbook.
 */
export function parseUploadedBomBuffer(
  input: Buffer | ArrayBuffer,
  customColumns: readonly BomTemplateColumn[] = [],
  sheetName?: string,
): ParsedUploadedBom {
  const buffer = input instanceof ArrayBuffer ? Buffer.from(input) : input;
  const standard = parseBomWorkbook(buffer, sheetName);

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[standard.sheet_name];
  const grid = sheet ? (XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null }) as unknown[][]) : [];
  const headerRow = grid[0] ?? [];
  const { keep, priorityCol, customCols, autoCols } = locateColumns(headerRow, customColumns);

  const extras: { priorityNote: string | null; extra: BomLineExtra | null }[] = [];
  for (let r = 1; r < grid.length; r += 1) {
    const row = grid[r];
    if (!row) continue;
    const cellAt = (col: number | undefined): unknown => (col === undefined ? null : row[col]);

    const kept =
      !cellIsBlank(cellAt(keep.references)) ||
      !cellIsBlank(cellAt(keep.value)) ||
      !cellIsBlank(cellAt(keep.mpn)) ||
      !cellIsBlank(cellAt(keep.description));
    if (!kept) continue;

    const priorityRaw = cellAt(priorityCol ?? undefined);
    const priorityNote = cellIsBlank(priorityRaw) ? null : String(priorityRaw).trim();

    let extra: BomLineExtra | null = null;
    const values: BomLineExtra = {};
    // Registered custom columns keep their configured slug + type.
    for (const column of customColumns) {
      const col = customCols.get(column.key);
      if (col === undefined) continue;
      const value = cellToExtraValue(cellAt(col), column.type);
      if (value !== null) values[column.key] = value;
    }
    // Every other unrecognized column is captured verbatim (text) under its raw
    // header, so no column is ever silently dropped — the sourcing agent reads
    // whatever the sheet carried (LCSC_Part, supplier codes, RoHS flags, …).
    for (const [rawKey, col] of autoCols) {
      if (rawKey in values) continue;
      const value = cellToExtraValue(cellAt(col), "text");
      if (value !== null) values[rawKey] = value;
    }
    if (Object.keys(values).length > 0) extra = values;

    extras.push({ priorityNote, extra });
  }

  const lines: UploadedBomLine[] = standard.lines.map((line, index) => ({
    ...line,
    priorityNote: extras[index]?.priorityNote ?? null,
    extra: extras[index]?.extra ?? null,
  }));

  return { sheetName: standard.sheet_name, lines };
}
