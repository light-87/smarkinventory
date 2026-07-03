/**
 * lib/import/stocklist.ts — Stock List.xlsx importer (FEATURES.md §14, plan/SCHEMA.md §1).
 *
 * `Stock List.xlsx` is the messy, zero-location "canonical source of truth"
 * the client has run the business off for years: 15 sheets, each hand-built
 * in Excel over time with its own column layout, in-cell subheadings
 * ("A) FUSE"), side-by-side tables sharing one physical row range, and
 * merged header cells. There is no single fixed schema to hardcode per
 * sheet — instead this module runs ONE generic engine per sheet that:
 *
 *   1. Fills merged cells forward (`fillMergedCells`) so a vertically-merged
 *      category label (e.g. S2's "ADC" spanning rows 5–16) reads correctly
 *      on every row it covers, using the workbook's own merge metadata
 *      rather than guessing.
 *   2. Scans every row for header-keyword hits (MPN, VALUE, QTY, PACKAGE...)
 *      to find header rows WHEREVER they occur — sheets like S6/S8/S9/S10/S11
 *      repeat a header every N rows as a new hand-typed sub-table starts.
 *   3. Groups a header row's hits into column CLUSTERS (a sheet can hold
 *      several independent tables side by side on the same physical rows —
 *      S6's "A) FUSE" table at cols 1–8 next to "D) THERMISTORS" at cols
 *      11–19) and tracks each cluster's data range independently, so one
 *      cluster's later header repeat never truncates an unrelated cluster
 *      still running alongside it.
 *   4. Reads a per-row "category" cell one column left of each cluster
 *      (merge-filled, or a literal single-letter marker row like
 *      `["A","FUSE"]` immediately preceding a header) into `attributes`.
 *
 * Output rows carry `source_sheet` + `needs_review` (FEATURES §14) — this is
 * a best-effort read of real, inconsistent data entry, not a lossless parse;
 * anything ambiguous is flagged for the Receive onboarding queue rather than
 * silently guessed.
 */

import XLSX from "xlsx";
import { normalizeLcsc, normalizeMpn } from "@/lib/matcher";

/* ────────────────────────────────────────────────────────────────────────────
 * Public types
 * ──────────────────────────────────────────────────────────────────────────── */

export type PartAttributeValue = string | number | boolean | null;

/** One `smark_parts`-shaped row parsed from a Stock List sheet, pre-dedupe. */
export interface ParsedStockPart {
  category: string | null;
  value: string | null;
  /** [R2-24] split out of a combined `"0.1µF/50V"`-style value string. */
  voltage: string | null;
  package: string | null;
  mpn: string | null;
  lcsc_pn: string | null;
  mfr: string | null;
  qty: number | null;
  attributes: Record<string, PartAttributeValue>;
  source_sheet: string;
  needs_review: boolean;
}

export interface SheetParseSummary {
  sheet: string;
  rowCount: number;
  skipped: boolean;
}

export interface StockListParseResult {
  parts: ParsedStockPart[];
  sheetSummary: SheetParseSummary[];
}

export interface DedupeReportEntry {
  key: string;
  keyedBy: "mpn" | "lcsc";
  mergedCount: number;
}

export interface DedupeResult {
  parts: ParsedStockPart[];
  merges: DedupeReportEntry[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Per-sheet category map — the one hand-authored fact per sheet: what kind of
 * part lives there. `null` = not a parts table at all (skipped entirely).
 * ──────────────────────────────────────────────────────────────────────────── */

export const SHEET_CATEGORY: Record<string, string | null> = {
  Index: null, // table of contents, not data
  "S2 - SMD IC": "IC",
  "S3 - Res": "Resistor",
  "S4- Cap": "Capacitor",
  "S5-Ind+Diode": "Inductor", // refined to "Diode" per-row when the text says so
  "S6-MiscElec": "Other",
  "Material List": "Other",
  "S7-SMD Modules": "Module",
  "S8-TH IC": "IC",
  "S9-Misc Elec": "Other",
  "S10-Conectors1": "Connector",
  "S11-Conectors2": "Connector",
  "S12-Stencils": null, // project/version tracking, not a parts table
  SMPS: "SMPS",
  "VOLTAGE PROTECTOR": "Other",
};

/* ────────────────────────────────────────────────────────────────────────────
 * Cell helpers
 * ──────────────────────────────────────────────────────────────────────────── */

function normKey(cell: unknown): string {
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

/**
 * SMD package codes are sometimes transcribed as bare 3-digit numbers when
 * Excel eats the leading zero (`0402` stored/typed as `402`). Restores it;
 * leaves genuine 4+ digit codes (`1206`, `1812`) and text packages
 * (`"MSOP8"`, `"SOT-23-6"`) untouched.
 */
function normalizePackageCell(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return null;
    const digits = String(Math.trunc(Math.abs(cell)));
    return digits.length === 3 ? `0${digits}` : digits;
  }
  const s = String(cell).trim();
  return s === "" ? null : s;
}

/** A category/subcategory candidate: real text, not a bare serial number. */
function categoryCandidate(cell: unknown): string | null {
  const s = cellToText(cell);
  if (s === null) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return null;
  return s;
}

function isLetterMarkerToken(s: string): boolean {
  return /^[A-Z]\)?$/.test(s.trim());
}

/**
 * Heuristic: does this token look like a manufacturer part number (as opposed
 * to a component VALUE that happens to sit in the same combined column, e.g.
 * S6's "VALUE/MPN")? Value-shaped tokens (`"500mA"`, `"5A"`, `"1.25A"`) are
 * explicitly rejected; genuine MPNs mix letters+digits with no spaces.
 */
const VALUE_SHAPED = /^\d+(?:\.\d+)?\s*(?:[munpkM])?(?:A|V|W|Hz|F|H|R|Ω|ohm)$/i;
export function looksLikeMpn(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (VALUE_SHAPED.test(s)) return false;
  if (/^\d+(?:\.\d+)?$/.test(s)) return false;
  if (/\s/.test(s)) return false;
  return /[A-Za-z]/.test(s) && /\d/.test(s) && s.length >= 5;
}

/**
 * [R2-24] Splits a combined `"value/voltage"` string, e.g. `"0.1µF/50V"` →
 * `{ value: "0.1µF", voltage: "50V" }`. Only splits when the text AFTER the
 * last `/` is voltage-SHAPED (ends in `V`, optional SI prefix) — a string
 * like `"0.1uF/100nF"` (two capacitance notations for the same value) or
 * `"0.01R/10mΩ"` is left whole, since neither side is a voltage.
 */
const VOLTAGE_TOKEN = /^\d+(?:\.\d+)?\s*[munpkM]?V$/i;
export function splitValueVoltage(raw: string | null | undefined): {
  value: string | null;
  voltage: string | null;
} {
  const s = cellToText(raw ?? null);
  if (s === null) return { value: null, voltage: null };
  const slash = s.lastIndexOf("/");
  if (slash === -1) return { value: s, voltage: null };
  const left = s.slice(0, slash).trim();
  const right = s.slice(slash + 1).trim();
  if (left && VOLTAGE_TOKEN.test(right)) return { value: left, voltage: right };
  return { value: s, voltage: null };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Merge fill — real spreadsheet semantics for vertical/wide category labels
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Merges wider than this (in columns) are banner/section titles centered
 * across many columns for display, not a category label attached to a
 * specific field — filling them forward would bleed a text banner into
 * unrelated data columns (observed: a 5-column "OLED DISPLAY" section merge
 * on S9 overwriting an adjacent QTY column with text). Narrow merges (at
 * most 2 columns, like S2's "ADC" spanning its Sr.No./spacer columns) are
 * real per-row category fill-downs and are safe to propagate.
 */
const MAX_FILLABLE_MERGE_WIDTH = 1;

/**
 * Returns the sheet as a 2D grid (row-index-aligned with the workbook, i.e.
 * `grid[r][c]` === cell at 0-based row `r`, col `c`) with every NARROW merged
 * range filled forward from its top-left value — so a vertical category
 * merge (S2's "ADC" spanning several MPN rows) reads correctly on every row
 * it spans, using the workbook's own merge metadata rather than a heuristic.
 */
export function fillMergedCells(sheet: XLSX.WorkSheet): unknown[][] {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null }) as unknown[][];
  const merges = sheet["!merges"] ?? [];
  for (const range of merges) {
    if (range.e.c - range.s.c > MAX_FILLABLE_MERGE_WIDTH) continue;
    const topLeftRow = grid[range.s.r];
    const topLeftValue = topLeftRow ? topLeftRow[range.s.c] : null;
    if (topLeftValue === null || topLeftValue === undefined) continue;
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const row = grid[r];
      if (!row) continue;
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        if (row[c] === null || row[c] === undefined) row[c] = topLeftValue;
      }
    }
  }
  return grid;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Header keyword → role map (exact match on normalized header text)
 * ──────────────────────────────────────────────────────────────────────────── */

type CoreRole =
  | "mpn"
  | "mpnOrValue"
  | "value"
  | "voltage"
  | "package"
  | "qty"
  | "manufacturer"
  | "distributor"
  | "orderCode"
  | "digikeyPn"
  | "description";

const HEADER_KEYWORDS: Record<string, CoreRole> = {
  mpn: "mpn",
  mnp: "mpn", // real typo on S8-TH IC's header
  "manuf. part no. (mpn)": "mpn",
  "value/mpn": "mpnOrValue",
  value: "value",
  voltage: "voltage",
  package: "package",
  "package, size": "package",
  qty: "qty",
  "qty.": "qty",
  "available qty.": "qty",
  manufacturer: "manufacturer",
  manufaturer: "manufacturer", // real typo on S5's header
  distributor: "distributor",
  "order code": "orderCode",
  "distributor stock no.": "orderCode",
  "dis. stock no.": "orderCode",
  "stock number": "orderCode",
  "stock no": "orderCode",
  "digikey part no.": "digikeyPn",
  description: "description",
  "working description": "description",
  "description/package": "description",
  particular: "description",
  name: "description",
  "module name": "description",
};

const HEADER_HIT_THRESHOLD = 2;
/** Columns separating two header hits beyond this gap start a NEW cluster. */
const CLUSTER_GAP = 3;

interface HeaderHit {
  col: number;
  role: CoreRole;
}

function scanHeaderHits(row: unknown[]): HeaderHit[] {
  const hits: HeaderHit[] = [];
  row.forEach((cell, col) => {
    const role = HEADER_KEYWORDS[normKey(cell)];
    if (role) hits.push({ col, role });
  });
  return hits;
}

/** Groups a row's header hits into contiguous column clusters. */
function clusterHits(hits: HeaderHit[]): HeaderHit[][] {
  if (hits.length === 0) return [];
  const sorted = [...hits].sort((a, b) => a.col - b.col);
  const clusters: HeaderHit[][] = [[sorted[0]!]];
  for (let i = 1; i < sorted.length; i += 1) {
    const hit = sorted[i]!;
    const current = clusters[clusters.length - 1]!;
    const prev = current[current.length - 1]!;
    if (hit.col - prev.col - 1 > CLUSTER_GAP) {
      clusters.push([hit]);
    } else {
      current.push(hit);
    }
  }
  return clusters.filter((c) => c.length >= HEADER_HIT_THRESHOLD);
}

/* ────────────────────────────────────────────────────────────────────────────
 * The generic per-sheet cluster engine
 * ──────────────────────────────────────────────────────────────────────────── */

interface ActiveCluster {
  colStart: number;
  colEnd: number;
  roles: Map<number, CoreRole>;
  dataStartRow: number;
  sticky: string | null;
  rows: ParsedStockPart[];
}

function roleColumn(cluster: ActiveCluster, role: CoreRole): number | undefined {
  for (const [col, r] of cluster.roles) if (r === role) return col;
  return undefined;
}

function seedInitialSubcategory(grid: unknown[][], headerRow: number, colStart: number): string | null {
  if (colStart <= 0) return null;
  const seedRow = grid[headerRow - 1];
  if (!seedRow) return null;
  const marker = categoryCandidate(seedRow[colStart - 1]);
  if (marker && isLetterMarkerToken(marker)) {
    return categoryCandidate(seedRow[colStart]);
  }
  return null;
}

/** Builds one output row from a cluster's role map + a data row, or `null` if unusable. */
function buildPartFromRow(
  sheetName: string,
  baseCategory: string | null,
  cluster: ActiveCluster,
  row: unknown[],
  subcategory: string | null,
): ParsedStockPart | null {
  const cellAt = (role: CoreRole): unknown => {
    const col = roleColumn(cluster, role);
    return col === undefined ? null : row[col];
  };

  const mpnCell = cellToText(cellAt("mpn"));
  const identCell = cellToText(cellAt("mpnOrValue"));
  const valueCell = cellToText(cellAt("value"));
  const descriptionCell = cellToText(cellAt("description"));
  const voltageCell = cellToText(cellAt("voltage"));
  const distributorCell = cellToText(cellAt("distributor"));
  const orderCodeCell = cellToText(cellAt("orderCode"));
  const digikeyCell = cellToText(cellAt("digikeyPn"));
  const manufacturerCell = cellToText(cellAt("manufacturer"));

  let mpn = mpnCell;
  let identAsValue: string | null = null;
  if (!mpn && identCell) {
    if (looksLikeMpn(identCell)) mpn = identCell;
    else identAsValue = identCell;
  }

  // A bare-numeric "value" cell (e.g. S4-Cap's EIA marking code "104" for
  // 0.1uF) is technically correct but far less useful than a human
  // description sitting right next to it ("0.1uF/100nF") — prefer text over
  // a lone number when both are present.
  const isBareNumericText = (s: string) => /^\d+(?:\.\d+)?$/.test(s);
  const baseValueText =
    (valueCell && !isBareNumericText(valueCell) ? valueCell : null) ??
    identAsValue ??
    descriptionCell ??
    valueCell;
  if (!mpn && !baseValueText && !descriptionCell) return null; // nothing to key on at all

  const split = splitValueVoltage(baseValueText);
  const value = split.value;
  const voltage = voltageCell ?? split.voltage;
  const packageValue = normalizePackageCell(cellAt("package"));
  const qty = cellToNumber(cellAt("qty"));

  let lcsc: string | null = null;
  if (orderCodeCell) {
    const distributorIsLcsc = distributorCell !== null && /lcsc/i.test(distributorCell);
    if (distributorIsLcsc || /^C\d{4,}$/i.test(orderCodeCell)) {
      lcsc = normalizeLcsc(orderCodeCell);
    }
  }
  if (!lcsc && mpn && /^C\d{4,}$/i.test(mpn)) {
    lcsc = normalizeLcsc(mpn);
    mpn = null;
  }

  const attributes: Record<string, PartAttributeValue> = {};
  if (subcategory) attributes.subcategory = subcategory;
  if (descriptionCell) attributes.description = descriptionCell;
  if (distributorCell) attributes.distributor = distributorCell;
  if (orderCodeCell && !lcsc) attributes.order_code = orderCodeCell;
  if (digikeyCell) attributes.digikey_pn = digikeyCell;

  let category = baseCategory;
  if (sheetName === "S5-Ind+Diode" && descriptionCell && /diode/i.test(descriptionCell)) {
    category = "Diode";
  }

  return {
    category,
    value,
    voltage,
    package: packageValue,
    mpn,
    lcsc_pn: lcsc,
    mfr: manufacturerCell,
    qty,
    attributes,
    source_sheet: sheetName,
    needs_review: mpn === null || packageValue === null || qty === null,
  };
}

/** Parses one Stock List sheet with the generic multi-cluster engine. */
export function parseGenericSheet(sheetName: string, grid: unknown[][], baseCategory: string): ParsedStockPart[] {
  const active: ActiveCluster[] = [];
  const finished: ParsedStockPart[] = [];

  /** Closes clusters whose column range overlaps [colStart, colEnd], returning their last-known sticky category. */
  const closeOverlapping = (colStart: number, colEnd: number): Array<string | null> => {
    const closedStickies: Array<string | null> = [];
    for (let i = active.length - 1; i >= 0; i -= 1) {
      const c = active[i]!;
      if (c.colStart <= colEnd && c.colEnd >= colStart) {
        finished.push(...c.rows);
        closedStickies.push(c.sticky);
        active.splice(i, 1);
      }
    }
    return closedStickies;
  };

  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const clusters = clusterHits(scanHeaderHits(row));

    if (clusters.length > 0) {
      for (const hits of clusters) {
        const colStart = hits[0]!.col;
        const colEnd = hits[hits.length - 1]!.col;
        const closedStickies = closeOverlapping(colStart, colEnd);
        const roles = new Map(hits.map((h) => [h.col, h.role] as const));
        active.push({
          colStart,
          colEnd,
          roles,
          dataStartRow: r + 1,
          // A repeated header at the same columns (common in these
          // hand-built sheets) usually continues the SAME sub-table under a
          // slightly different layout — inherit the closing cluster's
          // category when this header row has no fresh marker of its own.
          sticky: seedInitialSubcategory(grid, r, colStart) ?? closedStickies.find((s) => s !== null) ?? null,
          rows: [],
        });
      }
      continue; // a header row is never itself data for any cluster
    }

    for (const cluster of active) {
      if (r < cluster.dataStartRow) continue;
      const catCol = cluster.colStart - 1;
      const catCell = catCol >= 0 ? categoryCandidate(row[catCol]) : null;

      let subcategory = cluster.sticky;
      if (catCell !== null) {
        if (isLetterMarkerToken(catCell)) {
          const otherRolesEmpty = [...cluster.roles.keys()].every(
            (col) => col === cluster.colStart || cellToText(row[col]) === null,
          );
          if (otherRolesEmpty) {
            // A row can be the SECOND physical row of a marker whose label
            // merge only covers the first (e.g. a 2-row-tall single-letter
            // merge next to a label that doesn't repeat) — only update the
            // sticky category when there's an actual label to read; never
            // fall back to the bare letter token itself as a "category".
            const label = categoryCandidate(row[cluster.colStart]);
            if (label) cluster.sticky = label;
            continue; // pure section-marker row — no part here
          }
          // Letter marker but real data alongside it — ignore the stray letter.
        } else {
          cluster.sticky = catCell;
          subcategory = catCell;
        }
      }

      const part = buildPartFromRow(sheetName, baseCategory, cluster, row, subcategory);
      if (part) cluster.rows.push(part);
    }
  }

  closeOverlapping(-Infinity, Infinity);
  return finished;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Special-cased tiny sheets that don't clear the generic engine's threshold
 * ──────────────────────────────────────────────────────────────────────────── */

/** `VOLTAGE PROTECTOR` — 3 plain columns (Sr.No / Phase-description / Qty), too small for ≥2 header hits. */
function parseVoltageProtectorSheet(grid: unknown[][]): ParsedStockPart[] {
  const out: ParsedStockPart[] = [];
  for (let r = 2; r < grid.length; r += 1) {
    const row = grid[r];
    if (!row) continue;
    const description = cellToText(row[1]);
    const qty = cellToNumber(row[2]);
    if (!description) continue;
    out.push({
      category: "Other",
      value: description,
      voltage: null,
      package: null,
      mpn: null,
      lcsc_pn: null,
      mfr: null,
      qty,
      attributes: { subcategory: "Voltage protector" },
      source_sheet: "VOLTAGE PROTECTOR",
      needs_review: true,
    });
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Top-level workbook parse
 * ──────────────────────────────────────────────────────────────────────────── */

function parseStockSheet(sheetName: string, sheet: XLSX.WorkSheet): ParsedStockPart[] {
  if (sheetName === "VOLTAGE PROTECTOR") {
    return parseVoltageProtectorSheet(fillMergedCells(sheet));
  }
  const category = SHEET_CATEGORY[sheetName];
  if (category === null || category === undefined) return [];
  return parseGenericSheet(sheetName, fillMergedCells(sheet), category);
}

/** Parses the full Stock List workbook — every sheet, generic engine + special cases. */
export function parseStockListWorkbook(input: string | Buffer | ArrayBuffer): StockListParseResult {
  const workbook =
    typeof input === "string"
      ? XLSX.readFile(input)
      : XLSX.read(input instanceof ArrayBuffer ? Buffer.from(input) : input, { type: "buffer" });

  const parts: ParsedStockPart[] = [];
  const sheetSummary: SheetParseSummary[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const skipped = SHEET_CATEGORY[sheetName] === null && sheetName !== "VOLTAGE PROTECTOR";
    const rows = parseStockSheet(sheetName, sheet);
    parts.push(...rows);
    sheetSummary.push({ sheet: sheetName, rowCount: rows.length, skipped });
  }

  return { parts, sheetSummary };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Dedupe by MPN → LCSC (FEATURES §14) — same normalizers as lib/matcher, so
 * import-time identity and reconcile-time identity never disagree.
 * ──────────────────────────────────────────────────────────────────────────── */

function mergeAttributes(
  base: Record<string, PartAttributeValue>,
  extra: Record<string, PartAttributeValue>,
): Record<string, PartAttributeValue> {
  const merged = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (merged[k] === undefined || merged[k] === null) merged[k] = v;
  }
  return merged;
}

/** First non-null wins; used to fill gaps when merging duplicate rows. */
function coalesce<T>(a: T | null, b: T | null): T | null {
  return a ?? b;
}

/**
 * Dedupes parsed rows by normalized MPN first, then normalized LCSC PN
 * (FEATURES §14: "dedupe by MPN/LCSC") — rows with neither key never merge
 * (each stays its own row; there is nothing safe to key them on). Later
 * duplicates fill gaps in the kept row (qty summed, blank fields patched)
 * rather than being discarded outright.
 */
export function dedupeStockParts(parts: ParsedStockPart[]): DedupeResult {
  const byMpn = new Map<string, ParsedStockPart>();
  const byLcsc = new Map<string, ParsedStockPart>();
  const mergeCounts = new Map<string, { keyedBy: "mpn" | "lcsc"; count: number }>();
  const kept: ParsedStockPart[] = [];

  for (const part of parts) {
    const mpnKey = part.mpn ? normalizeMpn(part.mpn) : "";
    const lcscKey = part.lcsc_pn ? normalizeLcsc(part.lcsc_pn) : "";
    const existing = (mpnKey && byMpn.get(mpnKey)) || (lcscKey && byLcsc.get(lcscKey)) || undefined;

    if (existing) {
      existing.qty = existing.qty === null && part.qty === null ? null : (existing.qty ?? 0) + (part.qty ?? 0);
      existing.value = coalesce(existing.value, part.value);
      existing.voltage = coalesce(existing.voltage, part.voltage);
      existing.package = coalesce(existing.package, part.package);
      existing.mfr = coalesce(existing.mfr, part.mfr);
      existing.lcsc_pn = coalesce(existing.lcsc_pn, part.lcsc_pn);
      existing.mpn = coalesce(existing.mpn, part.mpn);
      existing.needs_review = existing.needs_review || part.needs_review;
      existing.attributes = mergeAttributes(existing.attributes, part.attributes);

      const dedupeKey = mpnKey || lcscKey;
      const entry = mergeCounts.get(dedupeKey);
      if (entry) entry.count += 1;
      else mergeCounts.set(dedupeKey, { keyedBy: mpnKey ? "mpn" : "lcsc", count: 1 });
      continue;
    }

    // Clone before keeping — this function must never mutate the caller's
    // input rows (a merge below mutates `existing` in place, which would
    // otherwise silently corrupt `parts` too, since `kept` would hold the
    // very same object references).
    const clone: ParsedStockPart = { ...part, attributes: { ...part.attributes } };
    kept.push(clone);
    if (mpnKey) byMpn.set(mpnKey, clone);
    if (lcscKey) byLcsc.set(lcscKey, clone);
  }

  const merges: DedupeReportEntry[] = [...mergeCounts.entries()].map(([key, { keyedBy, count }]) => ({
    key,
    keyedBy,
    mergedCount: count,
  }));

  return { parts: kept, merges };
}
