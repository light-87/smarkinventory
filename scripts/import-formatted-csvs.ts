#!/usr/bin/env bun
/**
 * scripts/import-formatted-csvs.ts — imports the client's CLEANED stock list
 * (`Formatted Output`, 2026-08-10) into `smark_parts` + `smark_stock_locations`.
 *
 * Usage:
 *   bun run scripts/import-formatted-csvs.ts [folder] [--dry-run] [--verbose]
 *   bun --env-file=.env.cloud.local run scripts/import-formatted-csvs.ts   # PROD
 *
 * (no folder arg = `tests/fixtures/formatted-output`, where the client's drop
 * is checked in — same convention as `Stock List.xlsx` for the xlsx importer.)
 *
 * SERVICE-ROLE KEY, SCRIPT-ONLY — same posture as `scripts/import-stocklist.ts`:
 * a trusted operator tool run from a terminal during onboarding, never from an
 * app route. There is no signed-in session during a one-shot bulk migration for
 * RLS to key off, so `createServiceClient()` is the correct (and only) way to
 * do this write. Requires `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
 *
 * **`.env.local` points at the LOCAL stack on purpose.** A prod run must pass
 * `--env-file=.env.cloud.local` explicitly; that is deliberate friction, not an
 * oversight (see the header of `.env.local`).
 *
 * How this differs from `scripts/import-stocklist.ts`, which stays as it is:
 *
 *   1. **Input** — 31 clean per-category CSVs instead of the 15 messy xlsx
 *      sheets. `lib/import/formatted-csv.ts` maps them; there is no guessing.
 *   2. **Identity is provenance-first** (`source_sheet` + `attributes.source_row`,
 *      then MPN, then LCSC). The xlsx importer dedupes on MPN, which would
 *      silently merge the 38 part numbers that repeat across this drop. Those
 *      are reported for the client to rule on instead.
 *   3. **It creates stock locations.** FEATURES.md §14 says "NO locations
 *      created", and for the xlsx path that still holds. But `total_qty` is a
 *      trigger-maintained rollup of `smark_stock_locations.qty` — with no
 *      locations, all 1,999 parts read as "Out of stock", which makes the
 *      catalog impossible for the client to verify. So every part is parked in
 *      one staging box (shelf `U` / `U-IMPORT`) holding its real count, and
 *      keeps `needs_review = true` so Receive's onboarding queue still walks it
 *      to a real Shelf → Big Box → ESD. `assignOnboardingLocation` moves that
 *      row rather than creating a second one.
 *
 * `--dry-run` parses, matches and prints the full plan — per-file counts, data
 * flags, the duplicate-MPN report — without writing anything.
 */

import { resolve } from "node:path";
import { createServiceClient } from "@/lib/supabase/server";
import {
  collectDuplicateMpns,
  parseFormattedCsvFolder,
  provenanceKeyOf,
  summarizeDataFlags,
  type FormattedCsvPart,
  type PartAttributeValue,
} from "@/lib/import/formatted-csv";
import { fetchExistingPartIdentities } from "@/lib/import/existing-parts";
import {
  FALLBACK_SHELF_CODE,
  FALLBACK_SHELF_NAME,
  IMPORT_STAGING_BOX_NAME,
} from "@/lib/receive/storage-suggestion";
import { selectAllRows } from "@/lib/supabase/select-all";
import { normalizeLcsc, normalizeMpn } from "@/lib/matcher";
import { TABLES, type PartRow } from "@/types/db";

const DEFAULT_FOLDER = "tests/fixtures/formatted-output";
const INSERT_CHUNK_SIZE = 250;
const PID_PREFIX = "SMK-";
const PID_DIGITS = 6;

/**
 * The staging home for imported stock. Shelf `U`/"Unsorted" is the app's own
 * fallback shelf (`lib/receive/storage-suggestion.ts`), so this reuses the
 * existing convention rather than inventing a parallel one. It is honest about
 * the real world: the client's stock currently sits in one place, unlabelled
 * (docs/setup-decisions.md).
 *
 * The shelf code and box name come FROM `lib/receive/storage-suggestion.ts`
 * rather than being repeated here: the onboarding queue decides "still in
 * staging, so offer the assign form" by matching on exactly these two values,
 * and a local copy drifting would take that whole screen out.
 */
const STAGING_SHELF_CODE = FALLBACK_SHELF_CODE;
const STAGING_SHELF_NAME = FALLBACK_SHELF_NAME;
const STAGING_BOX_NAME = IMPORT_STAGING_BOX_NAME;
const STAGING_BOX_NOTE = "Imported stock awaiting put-away — assign a real shelf via Receive → onboarding queue.";

type PartInsert = Partial<PartRow>;

interface ExistingPart {
  id: string;
  internal_pid: string;
  mpn: string | null;
  lcsc_pn: string | null;
  source_sheet: string | null;
  attributes: Record<string, PartAttributeValue>;
}

function parseArgs(argv: string[]): { folder: string; dryRun: boolean; verbose: boolean } {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.find((a) => !a.startsWith("--"));
  return {
    folder: resolve(positional ?? DEFAULT_FOLDER),
    dryRun: flags.has("--dry-run"),
    verbose: flags.has("--verbose"),
  };
}

/** `SMK-000482`-style ids, continuing from the highest already in the catalog. */
function nextPidSequence(existingPids: string[], count: number): string[] {
  let max = 0;
  for (const pid of existingPids) {
    const match = /^SMK-(\d+)$/.exec(pid);
    if (match) max = Math.max(max, Number.parseInt(match[1]!, 10));
  }
  return Array.from({ length: count }, (_, i) => `${PID_PREFIX}${String(max + i + 1).padStart(PID_DIGITS, "0")}`);
}

/** Provenance key for a part already in the catalog, read back out of `attributes`. */
function existingProvenanceKey(row: ExistingPart): string | null {
  const file = row.attributes?.source_file;
  const sourceRow = row.attributes?.source_row;
  return provenanceKeyOf(
    typeof file === "string" ? file : null,
    row.source_sheet,
    typeof sourceRow === "number" ? sourceRow : null,
  );
}

/**
 * Identity lookup, provenance first. MPN/LCSC remain as fallbacks so a part
 * already created by hand (or by the older xlsx import) is patched rather than
 * duplicated — but two rows the client typed on separate sheet lines always
 * stay two parts, whatever their MPN says.
 */
function findExisting(
  maps: { byProvenance: Map<string, ExistingPart>; byMpn: Map<string, ExistingPart>; byLcsc: Map<string, ExistingPart> },
  part: FormattedCsvPart,
): ExistingPart | undefined {
  const provenance = provenanceKeyOf(part.source_file, part.source_sheet, part.source_row);
  if (provenance) {
    const hit = maps.byProvenance.get(provenance);
    if (hit) return hit;
  }
  if (part.mpn) {
    const hit = maps.byMpn.get(normalizeMpn(part.mpn));
    if (hit) return hit;
  }
  if (part.lcsc_pn) return maps.byLcsc.get(normalizeLcsc(part.lcsc_pn));
  return undefined;
}

/**
 * Everything the CSV says about a part. Deliberately excludes `internal_pid` —
 * a part's id is minted once and never rewritten by a re-import.
 */
function buildFields(part: FormattedCsvPart): PartInsert {
  return {
    mpn: part.mpn,
    manufacturer: part.manufacturer,
    lcsc_pn: part.lcsc_pn,
    description: part.description,
    category: part.category,
    value: part.value,
    package: part.package,
    voltage: part.voltage,
    default_distributor: part.distributor,
    attributes: part.attributes,
    source_sheet: part.source_sheet,
    // Freshly imported: nothing has a real location or a printed label yet.
    needs_review: true,
  };
}

function buildInsertRow(part: FormattedCsvPart, internalPid: string): PartInsert {
  return { internal_pid: internalPid, ...buildFields(part) };
}

/** Finds or creates shelf `U` → box `U-IMPORT`, and returns the box id. */
async function ensureStagingBox(supabase: ReturnType<typeof createServiceClient>): Promise<string> {
  const { data: shelf, error: shelfReadError } = await supabase
    .from(TABLES.shelves)
    .select("id")
    .eq("code", STAGING_SHELF_CODE)
    .maybeSingle();
  if (shelfReadError) throw new Error(`Reading shelf ${STAGING_SHELF_CODE}: ${shelfReadError.message}`);

  let shelfId = shelf?.id;
  if (!shelfId) {
    const { data, error } = await supabase
      .from(TABLES.shelves)
      .insert({ code: STAGING_SHELF_CODE, name: STAGING_SHELF_NAME, location_note: STAGING_BOX_NOTE })
      .select("id")
      .single();
    if (error) throw new Error(`Creating shelf ${STAGING_SHELF_CODE}: ${error.message}`);
    shelfId = data.id;
  }

  const { data: box, error: boxReadError } = await supabase
    .from(TABLES.big_boxes)
    .select("id")
    .eq("shelf_id", shelfId)
    .eq("name", STAGING_BOX_NAME)
    .maybeSingle();
  if (boxReadError) throw new Error(`Reading box ${STAGING_BOX_NAME}: ${boxReadError.message}`);
  if (box) return box.id;

  const { data, error } = await supabase
    .from(TABLES.big_boxes)
    .insert({ shelf_id: shelfId, name: STAGING_BOX_NAME, notes: STAGING_BOX_NOTE })
    .select("id")
    .single();
  if (error) throw new Error(`Creating box ${STAGING_BOX_NAME}: ${error.message}`);
  return data.id;
}

/**
 * Inserts in chunks. Takes the insert as a callback rather than a table name so
 * each call site keeps its own generated row typing — a `from(table: string)`
 * helper erases it and would let a wrong-shaped row through.
 */
async function insertChunked<T>(
  rows: readonly T[],
  label: string,
  insert: (chunk: T[]) => PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const { error } = await insert(rows.slice(i, i + INSERT_CHUNK_SIZE));
    if (error) throw new Error(`${label} insert failed at offset ${i}: ${error.message}`);
    console.log(`  ${label}: ${Math.min(i + INSERT_CHUNK_SIZE, rows.length)} / ${rows.length}`);
  }
}

async function main() {
  const { folder, dryRun, verbose } = parseArgs(process.argv.slice(2));

  console.log(`Reading ${folder} ...\n`);
  const { parts, fileSummary, skippedFiles } = parseFormattedCsvFolder(folder);

  console.log("File summary:");
  for (const f of fileSummary) {
    console.log(`  ${f.file.padEnd(34)} ${String(f.rowCount).padStart(4)} rows   → ${f.category}`);
  }
  for (const s of skippedFiles) console.log(`  ${s.file.padEnd(34)} (skipped — ${s.reason})`);

  const flags = summarizeDataFlags(parts);
  const withQty = parts.filter((p) => (p.qty ?? 0) > 0).length;
  console.log(`\nParsed ${parts.length} stock rows across ${fileSummary.length} files.`);
  console.log(`  ${withQty} carry a positive quantity.`);
  console.log(`  ${flags.no_identity} have no MPN and no LCSC number — BOM reconcile can never match these.`);
  console.log(`  ${flags.unidentifiable} of those have no value or description either.`);
  console.log(`  ${flags.qty_unparsed} quantities were text ("16 strip"); ${flags.qty_missing} were blank.`);

  const duplicates = collectDuplicateMpns(parts);
  console.log(`\n${duplicates.length} MPNs appear on more than one row (reported, never auto-merged):`);
  for (const d of verbose ? duplicates : duplicates.slice(0, 10)) {
    const where = d.occurrences.map((o) => `${o.source_sheet}#${o.source_row} (qty ${o.qty ?? "—"})`).join(", ");
    console.log(`  ${d.mpn.padEnd(28)} ${where}`);
  }
  if (!verbose && duplicates.length > 10) console.log(`  … ${duplicates.length - 10} more (--verbose to list all)`);

  const supabase = createServiceClient();
  const existing = (await fetchExistingPartIdentities(supabase, [
    "source_sheet",
    "attributes",
  ])) as unknown as ExistingPart[];

  const maps = {
    byProvenance: new Map<string, ExistingPart>(),
    byMpn: new Map<string, ExistingPart>(),
    byLcsc: new Map<string, ExistingPart>(),
  };
  for (const row of existing) {
    const key = existingProvenanceKey(row);
    if (key) maps.byProvenance.set(key, row);
    if (row.mpn) maps.byMpn.set(normalizeMpn(row.mpn), row);
    if (row.lcsc_pn) maps.byLcsc.set(normalizeLcsc(row.lcsc_pn), row);
  }

  const newParts: FormattedCsvPart[] = [];
  const updates: { id: string; part: FormattedCsvPart }[] = [];
  for (const part of parts) {
    const match = findExisting(maps, part);
    if (match) updates.push({ id: match.id, part });
    else newParts.push(part);
  }

  const pids = nextPidSequence(
    existing.map((e) => e.internal_pid),
    newParts.length,
  );
  const insertRows = newParts.map((part, i) => buildInsertRow(part, pids[i]!));

  console.log(
    `\nCatalog currently holds ${existing.length} parts.` +
      `\nPlan: insert ${insertRows.length} new, refresh ${updates.length} existing.`,
  );
  if (verbose) console.log("Sample new rows:", JSON.stringify(insertRows.slice(0, 3), null, 2));

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  await insertChunked(insertRows, "parts", (chunk) => supabase.from(TABLES.parts).insert(chunk));

  for (const u of updates) {
    // A re-import is a refresh from the client's own file, so it OVERWRITES —
    // unlike the xlsx importer's gap-fill patch. The CSVs are the corrected
    // source of truth; a stale value in the catalog should not win.
    const { error } = await supabase.from(TABLES.parts).update(buildFields(u.part)).eq("id", u.id);
    if (error) throw new Error(`Update failed for part ${u.id}: ${error.message}`);
  }
  if (updates.length > 0) console.log(`  parts: refreshed ${updates.length}`);

  /* ── Stock locations — the qty the client says is on hand ─────────────── */

  const boxId = await ensureStagingBox(supabase);
  console.log(`\nStaging box ${STAGING_SHELF_CODE}/${STAGING_BOX_NAME} ready.`);

  // Re-read so we have ids for both the rows we just inserted and the ones we
  // refreshed, keyed the same provenance-first way.
  const afterInsert = (await fetchExistingPartIdentities(supabase, [
    "source_sheet",
    "attributes",
  ])) as unknown as ExistingPart[];
  const idByProvenance = new Map<string, string>();
  for (const row of afterInsert) {
    const key = existingProvenanceKey(row);
    if (key) idByProvenance.set(key, row.id);
  }

  // Paged: on a re-run this table holds ~2000 rows, and a truncated read would
  // make already-located parts look unlocated — inserting a SECOND location for
  // each and doubling total_qty through the rollup trigger.
  const locatedRows = await selectAllRows((from, to) =>
    supabase.from(TABLES.stock_locations).select("part_id").order("id").range(from, to),
  );
  const alreadyLocated = new Set(locatedRows.map((r) => r.part_id));

  const locationRows: { part_id: string; big_box_id: string; qty: number; esd_note: string }[] = [];
  let unmatched = 0;
  for (const part of parts) {
    const key = provenanceKeyOf(part.source_file, part.source_sheet, part.source_row);
    const partId = key ? idByProvenance.get(key) : undefined;
    if (!partId) {
      unmatched += 1;
      continue;
    }
    // Never a second location for a part that already lives somewhere — that
    // would double its total_qty via the rollup trigger.
    if (alreadyLocated.has(partId)) continue;
    locationRows.push({ part_id: partId, big_box_id: boxId, qty: part.qty ?? 0, esd_note: STAGING_BOX_NOTE });
  }

  if (unmatched > 0) {
    console.log(`  note: ${unmatched} rows had no provenance key and got no location — check their Source_Row.`);
  }

  // Each insert fires a per-part advisory lock + total_qty re-SUM
  // (migration 0002), so this is the slow half of the run.
  await insertChunked(locationRows, "locations", (chunk) => supabase.from(TABLES.stock_locations).insert(chunk));

  console.log(
    `\nDone. ${insertRows.length} parts inserted, ${updates.length} refreshed, ` +
      `${locationRows.length} stock locations created.`,
  );
  console.log("Next: Receive → onboarding queue to assign Shelf → Big Box → ESD + print labels.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
