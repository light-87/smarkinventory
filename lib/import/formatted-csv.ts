/**
 * lib/import/formatted-csv.ts — the CLEANED stock list importer (FEATURES.md §14).
 *
 * `lib/import/stocklist.ts` reads the raw `Stock List.xlsx`: 15 hand-built
 * sheets, side-by-side tables, merged headers, in-cell subheadings. It is a
 * best-effort archaeology engine and it stays exactly as it is.
 *
 * This module reads a DIFFERENT, better input. On 2026-08-10 the client sent
 * `Formatted Output.zip` — that same workbook reshaped by hand into 31 clean
 * per-category CSVs (+ `category_index.csv` as a manifest and `stencils.csv`,
 * which is project/version tracking rather than stock). Every file has one
 * fixed header row, one row per part, and the same trailing columns
 * (`MPN, Description, Distributor, LCSC_Part, Qty_In_Stock, Source_Sheet,
 * Source_Row`). The value/voltage splitting, the unit parsing and the
 * distributor normalisation the xlsx engine has to guess at are already done,
 * and `Source_Sheet`/`Source_Row` point back at the original cell.
 *
 * So the job here is mapping, not archaeology — but three things still need
 * care, all of them consequences of what the source data actually is:
 *
 *   1. **No type coercion, ever.** The CSVs are read by a hand-rolled RFC 4180
 *      reader rather than SheetJS. A spreadsheet parser turns the package
 *      `0603` into the number 603 and `2.2e-06` into a float whose printed
 *      form is no longer the client's — leading-zero package codes are exactly
 *      the class of damage `lib/import/stocklist.ts` already has to repair.
 *      Everything arrives as a raw string; only the columns we explicitly
 *      declare numeric get parsed.
 *   2. **A blank MPN is normal, not an error.** 880 of the 1,999 stock rows
 *      have none (420/450 resistors, 264/275 capacitors) — generic passives
 *      never had a manufacturer part number in the source. 484 rows have
 *      neither MPN nor LCSC number, which means `lib/bom/reconcile.ts`
 *      (exact-identity only, by design) can never match them to a BOM line.
 *      That is a fact about the client's data, so those rows are FLAGGED
 *      (`attributes.data_flag`), never dropped and never given invented
 *      identifiers.
 *   3. **Identity is provenance-first.** Deduping on MPN would silently merge
 *      the 22 part numbers that repeat across the sheets — the Import_Guide
 *      calls those out as needing a human decision, and some are genuine
 *      variants. `Source_Sheet` + `Source_Row` is the stable natural key that
 *      makes a re-import idempotent without ever merging two rows the client
 *      typed separately. `collectDuplicateMpns` reports the collisions instead.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeMpn } from "@/lib/matcher";

/* ────────────────────────────────────────────────────────────────────────────
 * Public types
 * ──────────────────────────────────────────────────────────────────────────── */

export type PartAttributeValue = string | number | boolean | null;

/**
 * Why a row wants a human look during the client's verification pass. Separate
 * from `needs_review` (which every imported row gets, to drive the Receive
 * onboarding queue) — this says *what* is off about the data itself.
 */
export type DataFlag =
  /** No MPN and no LCSC number — invisible to BOM reconcile (484 rows). */
  | "no_identity"
  /** `Qty_In_Stock` held text the source never resolved, e.g. `"16 strip"` (17 rows). */
  | "qty_unparsed"
  /** `Qty_In_Stock` was blank. Blank means "unknown", not zero (50 rows). */
  | "qty_missing"
  /** No MPN, LCSC, value OR description — nothing but a package and a count. */
  | "unidentifiable";

/** One `smark_parts`-shaped row mapped from a cleaned CSV. */
export interface FormattedCsvPart {
  category: string;
  value: string | null;
  voltage: string | null;
  package: string | null;
  mpn: string | null;
  lcsc_pn: string | null;
  manufacturer: string | null;
  description: string | null;
  /** → `smark_parts.default_distributor`. Dirty by nature; see the guide's caveat. */
  distributor: string | null;
  /** Parsed count, or null when the cell was blank or unparseable. */
  qty: number | null;
  /** The original cell text, kept only when it wasn't a plain number. */
  qtyRaw: string | null;
  attributes: Record<string, PartAttributeValue>;
  source_sheet: string;
  source_row: number | null;
  /** The CSV this row came from, e.g. `resistors.csv`. */
  source_file: string;
  dataFlags: DataFlag[];
}

export interface FileParseSummary {
  file: string;
  category: string;
  rowCount: number;
}

export interface DuplicateMpnEntry {
  /** The normalized key rows collided on. */
  key: string;
  /** The MPN as first written in the source. */
  mpn: string;
  occurrences: { source_file: string; source_sheet: string; source_row: number | null; qty: number | null }[];
}

export interface FormattedCsvParseResult {
  parts: FormattedCsvPart[];
  fileSummary: FileParseSummary[];
  /** Files present in the folder that were deliberately not imported. */
  skippedFiles: { file: string; reason: string }[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * File → category map
 *
 * Values reuse the existing `PART_CATEGORIES` spellings (types/db.ts) wherever
 * one fits, so the Inventory Category facet and the Receive form's chips stay
 * one vocabulary. Where two files collapse into one category (IC, Switch,
 * Display) the finer distinction survives in `attributes.sub_category` — see
 * FILE_SUB_CATEGORY below.
 * ──────────────────────────────────────────────────────────────────────────── */

export const FILE_CATEGORY: Record<string, string> = {
  "resistors.csv": "Resistor",
  // Added in the client's v2 drop (2026-08-11): resistor arrays and ferrite
  // beads were pulled out of resistors.csv and inductors.csv into files of
  // their own, which is why those two shrank by 25 and 7 rows.
  "resistor_networks.csv": "Resistor Network",
  "capacitors.csv": "Capacitor",
  "inductors.csv": "Inductor",
  "ferrites.csv": "Ferrite Bead",
  "diodes.csv": "Diode",
  "ic_smd.csv": "IC",
  "ic_th.csv": "IC",
  "discrete_semiconductors_th.csv": "Transistor",
  "modules.csv": "Module",
  "connectors.csv": "Connector",
  "spring_terminal_blocks.csv": "Terminal Block",
  "ffc_fpc_connectors.csv": "FFC/FPC Connector",
  "cable_assemblies.csv": "Cable Assembly",
  "misc_fuse.csv": "Fuse",
  "misc_crystal.csv": "Crystal",
  "misc_led.csv": "LED",
  "misc_thermistor_varistor.csv": "Thermistor/Varistor",
  "misc_ir.csv": "IR",
  "misc_photosensor.csv": "Photosensor",
  "dev_kits.csv": "Dev Kit",
  "misc_switch.csv": "Switch",
  "misc_rocker_switch.csv": "Switch",
  "misc_current_transformer.csv": "Current Transformer",
  "misc_dcdc_converter.csv": "DC-DC Converter",
  "misc_lcd_display.csv": "Display",
  "misc_oled_display.csv": "Display",
  "misc_battery.csv": "Battery",
  "misc_relay.csv": "Relay",
  "misc_transformer.csv": "Transformer",
  "material_list.csv": "Hardware",
  "smps.csv": "SMPS",
  "voltage_protector.csv": "Voltage Protector",
};

/** Files in the folder that are intentionally not parts. */
export const SKIPPED_FILES: Record<string, string> = {
  "category_index.csv": "manifest, not stock",
  "stencils.csv": "PCB project/version reference — no MPN, distributor or quantity (Import_Guide §3)",
  "Import_Guide.md": "documentation",
  "Filter_Specification.md": "documentation (v2) — the per-category filter spec",
};

/**
 * Sub-category for files whose own name carries a distinction the `category`
 * column collapses. Files with a real `Sub_Category`/`Type` COLUMN (ic_smd,
 * connectors, voltage_protector) take it from the data instead — see
 * SUB_CATEGORY_HEADERS.
 */
const FILE_SUB_CATEGORY: Record<string, string> = {
  "ic_th.csv": "Through-hole",
  "discrete_semiconductors_th.csv": "Through-hole",
  "misc_rocker_switch.csv": "Rocker",
  "misc_lcd_display.csv": "LCD",
  "misc_oled_display.csv": "OLED",
};

/**
 * Mount type where the FILE states it (SMD/TH is in the file's own name or the
 * manifest's description). Files with a real `Mount_Type` column — resistors,
 * capacitors, diodes — take it from the data and are absent here. Nothing else
 * is inferred: guessing a mount type onto a connector would be inventing data.
 */
const FILE_MOUNT_TYPE: Record<string, string> = {
  "ic_smd.csv": "SMD",
  "ic_th.csv": "TH",
  "discrete_semiconductors_th.csv": "TH",
  "modules.csv": "SMD",
};

/* ────────────────────────────────────────────────────────────────────────────
 * Column → field map
 * ──────────────────────────────────────────────────────────────────────────── */

type TypedField = "mpn" | "lcsc_pn" | "manufacturer" | "description" | "distributor" | "package" | "voltage" | "value";

/** CSV headers that map onto a real `smark_parts` column rather than `attributes`. */
const TYPED_HEADERS: Record<string, TypedField> = {
  MPN: "mpn",
  LCSC_Part: "lcsc_pn",
  Manufacturer: "manufacturer",
  Description: "description",
  Distributor: "distributor",
  Package: "package",
  Package_Size: "package",
  Voltage_Rating: "voltage",
  Value_Display: "value",
};

/**
 * Per-file `value` source for the files that have no `Value_Display` but do
 * have one column that reads as the part's human name in the Inventory grid.
 */
const FILE_VALUE_HEADER: Record<string, string> = {
  "modules.csv": "Module_Name",
  "smps.csv": "Output_Spec",
  "material_list.csv": "Value",
  "cable_assemblies.csv": "Assembly_Type",
};

/** Headers whose value is the row's sub-category, whatever the column is called. */
const SUB_CATEGORY_HEADERS = new Set(["Sub_Category", "Type"]);

/** Headers parsed as numbers in `attributes` (the rest stay verbatim strings). */
const NUMERIC_ATTRIBUTE_HEADERS = new Set([
  "Resistance_Ohms",
  "Capacitance_Farads",
  "Inductance_Henries",
  "Tolerance_Percent",
  "Power_Watts",
  "Pins",
  "Moq",
  "CP",
  "SP_MOQ100",
  "SP_MOQ25",
]);

/** Always blank in the source — the guide says so explicitly. Not worth a jsonb key. */
const IGNORED_HEADERS = new Set(["PPM", "Source_Sheet", "Source_Row", "Qty_In_Stock"]);

/* ────────────────────────────────────────────────────────────────────────────
 * CSV reading — RFC 4180, no coercion
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Splits CSV text into raw string cells. Handles the UTF-8 BOM the client's
 * files carry (they use it to keep `Ω`/`µ`/`℃` intact), quoted fields with
 * embedded commas, newlines and doubled quotes, and both CRLF and LF endings.
 * Deliberately returns strings only — see this module's header on coercion.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i += 1) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch !== '"') {
        field += ch;
      } else if (text[i + 1] === '"') {
        field += '"';
        i += 1; // consume the escaped pair
      } else {
        inQuotes = false;
      }
      continue;
    }

    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** `parseCsv` + the header row applied, so callers work in `{ Header: value }` records. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];

  return body
    .filter((cells) => cells.some((c) => c.trim() !== "")) // drop trailing blank lines
    .map((cells) => {
      const record: Record<string, string> = {};
      header.forEach((key, i) => {
        record[key.trim()] = (cells[i] ?? "").trim();
      });
      return record;
    });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Value helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/** Empty/whitespace cells become null — blank means "no data in the source", never 0 or "N/A". */
function orNull(raw: string | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function toNumberOrString(raw: string): number | string {
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

/** `Group` → `group`, `SP_MOQ100` → `sp_moq100`, `Contact_Type` → `contact_type`. */
export function attributeKeyFor(header: string): string {
  return header
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export interface ParsedQty {
  qty: number | null;
  /** Present only when the cell held something a plain number couldn't represent. */
  raw: string | null;
  flag: "qty_unparsed" | "qty_missing" | null;
}

/**
 * Reads `Qty_In_Stock`. Most cells are plain integers; 17 are text the original
 * spreadsheet never resolved (`"16 strip"`, `"180/10"`, `"3 + 5 SAMPLE"`,
 * `"50Mtr"`). For those we take the leading number as a usable count AND keep
 * the original text on the part, so the client can see exactly what the sheet
 * said when verifying. A cell with no leading digit yields no count at all
 * rather than a guessed 0.
 */
export function parseQty(raw: string | undefined): ParsedQty {
  const text = (raw ?? "").trim();
  if (text === "") return { qty: null, raw: null, flag: "qty_missing" };

  if (/^\d+$/.test(text)) return { qty: Number.parseInt(text, 10), raw: null, flag: null };

  const leading = /^(\d+)/.exec(text);
  return {
    qty: leading ? Number.parseInt(leading[1]!, 10) : null,
    raw: text,
    flag: "qty_unparsed",
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Row → part
 * ──────────────────────────────────────────────────────────────────────────── */

function mapRecord(file: string, record: Record<string, string>): FormattedCsvPart {
  const category = FILE_CATEGORY[file]!;
  const attributes: Record<string, PartAttributeValue> = {};
  const typed: Partial<Record<TypedField, string | null>> = {};

  const valueHeader = FILE_VALUE_HEADER[file];

  for (const [header, cell] of Object.entries(record)) {
    if (IGNORED_HEADERS.has(header)) continue;

    const value = orNull(cell);
    if (value === null) continue;

    if (header === valueHeader) {
      typed.value = value;
      continue;
    }

    const typedField = TYPED_HEADERS[header];
    if (typedField) {
      typed[typedField] = value;
      continue;
    }

    const key = SUB_CATEGORY_HEADERS.has(header) ? "sub_category" : attributeKeyFor(header);
    attributes[key] = NUMERIC_ATTRIBUTE_HEADERS.has(header) ? toNumberOrString(value) : value;
  }

  // File-level facts the columns don't carry. Data always wins over the
  // filename — only fill in what the row itself didn't say.
  const fileSubCategory = FILE_SUB_CATEGORY[file];
  if (fileSubCategory && attributes.sub_category === undefined) attributes.sub_category = fileSubCategory;

  const fileMountType = FILE_MOUNT_TYPE[file];
  if (fileMountType && attributes.mount_type === undefined) attributes.mount_type = fileMountType;

  const { qty, raw: qtyRaw, flag: qtyFlag } = parseQty(record.Qty_In_Stock);
  if (qtyRaw) attributes.qty_raw = qtyRaw;

  const mpn = typed.mpn ?? null;
  const lcscPn = typed.lcsc_pn ?? null;
  const value = typed.value ?? null;
  const description = typed.description ?? null;

  const dataFlags: DataFlag[] = [];
  if (mpn === null && lcscPn === null) dataFlags.push("no_identity");
  if (mpn === null && lcscPn === null && value === null && description === null) dataFlags.push("unidentifiable");
  if (qtyFlag) dataFlags.push(qtyFlag);
  if (dataFlags.length > 0) attributes.data_flag = dataFlags.join(",");

  const sourceRow = orNull(record.Source_Row);
  const parsedSourceRow = sourceRow === null ? null : Number.parseInt(sourceRow, 10);
  if (parsedSourceRow !== null && Number.isFinite(parsedSourceRow)) attributes.source_row = parsedSourceRow;
  // Stored because `source_sheet` + `source_row` alone is NOT unique — the
  // original workbook put independent tables side by side on the same physical
  // rows, so `S11-Connectors2#14` exists in both connectors.csv and
  // ffc_fpc_connectors.csv. The filename is what separates them. See
  // provenanceKeyOf().
  attributes.source_file = file;

  return {
    category,
    value,
    voltage: typed.voltage ?? null,
    package: typed.package ?? null,
    mpn,
    lcsc_pn: lcscPn,
    manufacturer: typed.manufacturer ?? null,
    description,
    distributor: typed.distributor ?? null,
    qty,
    qtyRaw,
    attributes,
    source_sheet: orNull(record.Source_Sheet) ?? file.replace(/\.csv$/, ""),
    source_row: parsedSourceRow !== null && Number.isFinite(parsedSourceRow) ? parsedSourceRow : null,
    source_file: file,
    dataFlags,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Entry points
 * ──────────────────────────────────────────────────────────────────────────── */

/** Maps one cleaned CSV's text. Pure — the unit tests drive this directly. */
export function parseFormattedCsvFile(file: string, text: string): FormattedCsvPart[] {
  if (!FILE_CATEGORY[file]) {
    throw new Error(`Unknown stock CSV "${file}" — add it to FILE_CATEGORY or SKIPPED_FILES.`);
  }
  return parseCsvRecords(text).map((record) => mapRecord(file, record));
}

/**
 * Reads every stock CSV in the client's `Formatted Output` folder. Unknown
 * filenames throw rather than being skipped quietly: if the client sends a
 * revised drop with a new category, that must be a deliberate mapping decision,
 * not a file that silently never imports.
 */
export function parseFormattedCsvFolder(dir: string): FormattedCsvParseResult {
  const parts: FormattedCsvPart[] = [];
  const fileSummary: FileParseSummary[] = [];
  const skippedFiles: { file: string; reason: string }[] = [];

  for (const file of readdirSync(dir).sort()) {
    const skipReason = SKIPPED_FILES[file];
    if (skipReason) {
      skippedFiles.push({ file, reason: skipReason });
      continue;
    }
    if (!file.endsWith(".csv")) continue;

    const rows = parseFormattedCsvFile(file, readFileSync(join(dir, file), "utf8"));
    parts.push(...rows);
    fileSummary.push({ file, category: FILE_CATEGORY[file]!, rowCount: rows.length });
  }

  return { parts, fileSummary, skippedFiles };
}

/**
 * The stable natural key for one row of the client's drop: which file, which
 * sheet of the original workbook, which row of it.
 *
 * All three parts are needed, and this was verified against the real drop
 * rather than assumed:
 *   - `sheet#row` alone collides 64 times — the workbook has independent tables
 *     side by side sharing physical row numbers, so `S6-MiscElec#38` is both a
 *     crystal and an IR receiver.
 *   - `file|row` alone collides 43 times — connectors.csv merges two sheets, so
 *     row 6 appears twice in it.
 *   - `file|sheet#row` is unique across all 1,999 rows, with none missing.
 *
 * Returns null when either component is absent, so a row without provenance
 * falls through to MPN/LCSC matching instead of colliding on a partial key.
 */
export function provenanceKeyOf(
  sourceFile: string | null | undefined,
  sourceSheet: string | null | undefined,
  sourceRow: number | null | undefined,
): string | null {
  if (!sourceFile || !sourceSheet || sourceRow === null || sourceRow === undefined) return null;
  return `${sourceFile}|${sourceSheet}#${sourceRow}`;
}

/**
 * Every MPN that appears on more than one row, with each occurrence's origin.
 * Reported, never auto-merged: the Import_Guide flags these as a human call
 * (some are genuine variants — `XY-128` is both the 2-pin and the 3-pin green
 * connector — and some are the same part typed into two sheets).
 */
export function collectDuplicateMpns(parts: readonly FormattedCsvPart[]): DuplicateMpnEntry[] {
  const byKey = new Map<string, { mpn: string; rows: FormattedCsvPart[] }>();

  for (const part of parts) {
    if (!part.mpn) continue;
    const key = normalizeMpn(part.mpn);
    if (key === "") continue;
    const entry = byKey.get(key);
    if (entry) entry.rows.push(part);
    else byKey.set(key, { mpn: part.mpn, rows: [part] });
  }

  return [...byKey.entries()]
    .filter(([, { rows }]) => rows.length > 1)
    .map(([key, { mpn, rows }]) => ({
      key,
      mpn,
      occurrences: rows.map((r) => ({
        source_file: r.source_file,
        source_sheet: r.source_sheet,
        source_row: r.source_row,
        qty: r.qty,
      })),
    }))
    .sort((a, b) => b.occurrences.length - a.occurrences.length || a.key.localeCompare(b.key));
}

/** Counts per `DataFlag`, for the import summary and the client's verification list. */
export function summarizeDataFlags(parts: readonly FormattedCsvPart[]): Record<DataFlag, number> {
  const counts: Record<DataFlag, number> = {
    no_identity: 0,
    qty_unparsed: 0,
    qty_missing: 0,
    unidentifiable: 0,
  };
  for (const part of parts) {
    for (const flag of part.dataFlags) counts[flag] += 1;
  }
  return counts;
}
