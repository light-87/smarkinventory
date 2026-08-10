#!/usr/bin/env bun
/**
 * scripts/build-correction-sheet.ts — the "please check these" workbook for the
 * client, generated from the imported catalog.
 *
 * Usage:
 *   bun --env-file=.env.cloud.local run scripts/build-correction-sheet.ts
 *   bun run scripts/build-correction-sheet.ts --no-db     # skip the PID lookup
 *
 * The 2026-08-10 stock drop is clean but not perfect, and the imperfections are
 * things only the client can resolve: which repeated part numbers are the same
 * physical part, what "16 strip" means as a count, which cells hold a
 * description in the part-number column. This turns those into four tabs of
 * closed questions with our best guess pre-filled, so the job is confirming
 * rather than composing.
 *
 * **Generated from OUR data, not from a copy of his spreadsheet**, and every row
 * carries `Where` (`file | sheet # row`). That string is the same provenance key
 * `lib/import/formatted-csv.ts` matches on, so a filled-in sheet can be read
 * back and applied in place, with no risk of duplicating a part. If he edited
 * his own `Stock List.xlsx` instead we would be guessing which row changed.
 *
 * Reads `smark_parts` to put the app's PID on each row, so he can find an item
 * on screen while answering. `--no-db` skips that and leaves the column blank.
 */

import { writeFileSync } from "node:fs";
import { utils, write } from "xlsx";
import {
  collectDuplicateMpns,
  parseFormattedCsvFolder,
  provenanceKeyOf,
  type FormattedCsvPart,
} from "@/lib/import/formatted-csv";
import { createServiceClient } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/select-all";
import { TABLES } from "@/types/db";

const DEFAULT_FOLDER = "tests/fixtures/formatted-output";

/** The 284 rows with no identity and no value are too many to ask about; the
 *  biggest 50 by quantity hold 90% of the pieces. Ask about those. */
const MISSING_DETAIL_ROWS = 50;

/** `resistors.csv | S3-Res # 5` — human-readable, and the key we re-import on. */
function whereOf(part: FormattedCsvPart): string {
  return `${part.source_file} | ${part.source_sheet} # ${part.source_row}`;
}

/**
 * A part-number cell that is really something else. Two signals, either enough:
 *
 *  - it contains a space and isn't part-number shaped ("2P Male (RTA)",
 *    "1.5A USB 2.0 1 Side insert 4P Female", "27th Jan25" — a restock date);
 *  - it contains no digit at all ("CHINESE", "REEL"). Essentially every real
 *    manufacturer part number carries a digit somewhere, and the words that
 *    turn up in this column instead are origins and packaging units.
 *
 * Heuristic, not a rule, which is exactly why the sheet asks him to confirm
 * rather than us just clearing the field.
 */
function looksLikeFreeText(mpn: string | null): boolean {
  if (!mpn) return false;
  const trimmed = mpn.trim();
  if (!/\d/.test(trimmed)) return true;
  return /\s/.test(trimmed) && !/^[A-Z0-9][A-Z0-9\-_/.+]*$/i.test(trimmed);
}

async function loadPidsByProvenance(): Promise<Map<string, string>> {
  const supabase = createServiceClient();
  const rows = await selectAllRows((from, to) =>
    supabase.from(TABLES.parts).select("internal_pid, source_sheet, attributes").order("internal_pid").range(from, to),
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    const attributes = (row.attributes ?? {}) as Record<string, unknown>;
    const key = provenanceKeyOf(
      typeof attributes.source_file === "string" ? attributes.source_file : null,
      row.source_sheet,
      typeof attributes.source_row === "number" ? attributes.source_row : null,
    );
    if (key) map.set(key, row.internal_pid);
  }
  return map;
}

function main(parts: FormattedCsvPart[], pidOf: (p: FormattedCsvPart) => string) {
  const workbook = utils.book_new();
  const addSheet = (name: string, rows: (string | number)[][]) =>
    utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), name);

  /* ── Read me ───────────────────────────────────────────────────────────── */

  addSheet("Read me", [
    ["Stock list — items that need your input"],
    [],
    ["Everything from your Formatted Output folder is now in the app: 1,999 items with quantities."],
    ["These four tabs are the only things we could not decide for you."],
    [],
    ["Tab", "What it is", "What we need"],
    ["1 Duplicates", "The same part number on more than one row", "Merge, or keep them separate"],
    ["2 Quantities", "Quantity cells that held text instead of a number", "The real count, and what a strip/roll is"],
    ["3 Wrong column", "A description or date sitting in the part-number column", "Confirm we can move it out"],
    ["4 Missing details", "Items with no part number and no value", "What the item is, if you know"],
    [],
    ["Please type in the YOUR ANSWER columns only. Leave anything you are unsure about blank."],
    ["Do not delete or edit the 'Where' column — that is how we put your answers back into the app."],
    ["'PID' is the code shown in the app, so you can look an item up on screen while you answer."],
    [],
    ["Tab 4 is the shortest list we could make it: there are 284 such items, but these 50 hold 90% of the stock."],
  ]);

  /* ── 1. Duplicates ─────────────────────────────────────────────────────── */

  // Only groups whose part number is a real part number. The rest are prose in
  // the wrong column, and tab 3 already asks about every one of those — asking
  // twice about the same cell makes the sheet look confused.
  const duplicates = collectDuplicateMpns(parts).filter((d) => !looksLikeFreeText(d.mpn));
  const duplicateRows: (string | number)[][] = [
    ["Group", "PID", "Part number", "Category", "Value", "Package", "Qty", "Where", "Our suggestion", "YOUR ANSWER"],
  ];

  duplicates.forEach((entry, i) => {
    const rows = entry.occurrences.map(
      (o) => parts.find((p) => provenanceKeyOf(p.source_file, p.source_sheet, p.source_row) === `${o.source_file}|${o.source_sheet}#${o.source_row}`)!,
    );
    const categories = new Set(rows.map((r) => r.category));

    // Pre-filled so he is confirming, not composing. Cross-category is the
    // strong signal: one physical part typed into two different sheets.
    const suggestion =
      categories.size > 1
        ? "MERGE — same part in two sheets, quantities should add up"
        : "Keep separate — these look like different variants";

    rows.forEach((row, j) => {
      duplicateRows.push([
        i + 1,
        pidOf(row),
        row.mpn ?? "",
        row.category,
        row.value ?? "",
        row.package ?? "",
        row.qty ?? "",
        whereOf(row),
        j === 0 ? suggestion : "",
        "",
      ]);
    });
    duplicateRows.push([]); // blank line between groups so they read as blocks
  });
  addSheet("1 Duplicates", duplicateRows);

  /* ── 2. Quantities ─────────────────────────────────────────────────────── */

  const unparsed = parts.filter((p) => p.dataFlags.includes("qty_unparsed"));
  addSheet("2 Quantities", [
    ["PID", "Item", "Category", "Package", "Your sheet said", "We used", "Where", "YOUR ANSWER (real quantity)", "What does the unit mean?"],
    ...unparsed.map((p) => [
      pidOf(p),
      p.mpn ?? p.value ?? p.description ?? "",
      p.category,
      p.package ?? "",
      String(p.attributes.qty_raw ?? ""),
      p.qty ?? "",
      whereOf(p),
      "",
      "",
    ]),
  ]);

  /* ── 3. Wrong column ───────────────────────────────────────────────────── */

  const freeText = parts.filter((p) => looksLikeFreeText(p.mpn));
  addSheet("3 Wrong column", [
    ["PID", "Text found in the part-number column", "Category", "Qty", "Where", "Our suggestion", "YOUR ANSWER"],
    ...freeText.map((p) => [
      pidOf(p),
      p.mpn ?? "",
      p.category,
      p.qty ?? "",
      whereOf(p),
      "Move to description, leave part number blank",
      "",
    ]),
  ]);

  /* ── 4. Missing details ────────────────────────────────────────────────── */

  const missing = parts
    .filter((p) => !p.mpn && !p.lcsc_pn && !p.value)
    .sort((a, b) => (b.qty ?? 0) - (a.qty ?? 0))
    .slice(0, MISSING_DETAIL_ROWS);
  addSheet("4 Missing details", [
    ["PID", "Category", "Package", "Qty", "Where", "YOUR ANSWER — what is it? (value)", "YOUR ANSWER — part number if any"],
    ...missing.map((p) => [pidOf(p), p.category, p.package ?? "", p.qty ?? "", whereOf(p), "", ""]),
  ]);

  const path = `docs/correction-needed-${new Date().toISOString().slice(0, 10)}.xlsx`;
  writeFileSync(path, write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer);

  console.log(`Written: ${path}`);
  console.log(`  1 Duplicates      ${duplicates.length} groups`);
  console.log(`  2 Quantities      ${unparsed.length} rows`);
  console.log(`  3 Wrong column    ${freeText.length} rows`);
  console.log(`  4 Missing details ${missing.length} of ${parts.filter((p) => !p.mpn && !p.lcsc_pn && !p.value).length} rows`);
}

const flags = new Set(process.argv.slice(2));
const folder = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? DEFAULT_FOLDER;
const { parts } = parseFormattedCsvFolder(folder);

const pids = flags.has("--no-db") ? new Map<string, string>() : await loadPidsByProvenance();
if (!flags.has("--no-db")) console.log(`Read ${pids.size} PIDs from ${process.env.NEXT_PUBLIC_SUPABASE_URL}\n`);

main(parts, (p) => pids.get(provenanceKeyOf(p.source_file, p.source_sheet, p.source_row) ?? "") ?? "");
