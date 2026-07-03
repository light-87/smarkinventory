#!/usr/bin/env bun
/**
 * scripts/import-stocklist.ts — one-shot import of `Stock List.xlsx` → `smark_parts`.
 *
 * Usage:
 *   bun run scripts/import-stocklist.ts ["path/to/Stock List.xlsx"] [--dry-run] [--verbose]
 *
 * (no args = looks for "Stock List.xlsx" at the repo root, matching the
 * client-supplied file checked in there; also aliased as
 * `scripts/import-stock.ts` per docs/OWNERSHIP.md's file name — see this
 * package's report to the integrator.)
 *
 * SERVICE-ROLE KEY, SCRIPT-ONLY (CLAUDE.md "never hardcode API keys — use env
 * variables"; FEATURES.md §3 env registry): this is a trusted operator tool
 * run from a terminal by the owner during onboarding, never invoked from an
 * app route or Server Action — there is no signed-in user/session during a
 * one-shot bulk migration for RLS to key off, so `createServiceClient()`
 * (lib/supabase/server.ts, already documented for exactly this kind of
 * trusted server-only path) is the correct — and only — way to do this bulk
 * write. Requires `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in
 * the environment (`.env.local`, or `bunx supabase status -o env` locally).
 *
 * What it does (FEATURES.md §14):
 *   1. Parse the workbook (lib/import/stocklist.ts — the 15-sheet generic
 *      column-map engine) and dedupe by MPN/LCSC.
 *   2. Match every parsed row against the EXISTING catalog by normalized
 *      MPN, then LCSC PN (same normalizers `lib/matcher` uses, so import
 *      identity and reconcile identity never disagree) — reruns are
 *      idempotent: a part already in `smark_parts` never gets a second row,
 *      it only has its blank fields patched.
 *   3. Inserts genuinely new parts with a freshly minted `internal_pid`
 *      (`SMK-NNNNNN`, continuing from whatever the highest existing one is).
 *   4. Creates NO `smark_stock_locations` rows (FEATURES §14: "NO locations
 *      created") — every imported part keeps/gets `needs_review = true` so
 *      it surfaces in Receive's onboarding queue for Shelf → Big Box → ESD
 *      assignment + label print. The sheet's raw quantity is preserved as
 *      `attributes.import_qty` (a count the business SAID it had, not a
 *      located stock figure) — `total_qty` stays trigger-derived from
 *      locations and is never written here.
 *
 * `--dry-run` parses + matches and prints the summary a real run would
 * produce, without writing anything. `--verbose` also prints the first few
 * new/updated rows.
 */

import { resolve } from "node:path";
import { createServiceClient } from "@/lib/supabase/server";
import {
  dedupeStockParts,
  parseStockListWorkbook,
  type ParsedStockPart,
  type PartAttributeValue,
} from "@/lib/import/stocklist";
import { buildIdentityMaps, fetchExistingPartIdentities, findByIdentity } from "@/lib/import/existing-parts";
import { TABLES, type PartRow } from "@/types/db";

type PartInsert = Partial<PartRow>;
type PartPatch = Partial<PartRow>;

const INSERT_CHUNK_SIZE = 250;
const PID_PREFIX = "SMK-";
const PID_DIGITS = 6;

interface ExistingPart {
  id: string;
  internal_pid: string;
  mpn: string | null;
  lcsc_pn: string | null;
  category: string | null;
  value: string | null;
  voltage: string | null;
  package: string | null;
  default_distributor: string | null;
  attributes: Record<string, PartAttributeValue>;
  needs_review: boolean;
}

function parseArgs(argv: string[]): { filePath: string; dryRun: boolean; verbose: boolean } {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.find((a) => !a.startsWith("--"));
  return {
    filePath: resolve(positional ?? "Stock List.xlsx"),
    dryRun: flags.has("--dry-run"),
    verbose: flags.has("--verbose"),
  };
}

function nextPidSequence(existingPids: string[], count: number): string[] {
  let max = 0;
  for (const pid of existingPids) {
    const match = /^SMK-(\d+)$/.exec(pid);
    if (match) max = Math.max(max, Number.parseInt(match[1]!, 10));
  }
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    out.push(`${PID_PREFIX}${String(max + i).padStart(PID_DIGITS, "0")}`);
  }
  return out;
}

interface PlannedUpdate {
  id: string;
  patch: PartPatch;
}

/** Merges an imported row's data into an existing part — only fills gaps, never overwrites a real value. */
function planUpdate(existing: ExistingPart, incoming: ParsedStockPart): PlannedUpdate | null {
  const patch: PartPatch = {};
  if (!existing.category && incoming.category) patch.category = incoming.category;
  if (!existing.value && incoming.value) patch.value = incoming.value;
  if (!existing.voltage && incoming.voltage) patch.voltage = incoming.voltage;
  if (!existing.package && incoming.package) patch.package = incoming.package;
  if (!existing.default_distributor && typeof incoming.attributes.distributor === "string") {
    patch.default_distributor = incoming.attributes.distributor;
  }
  const mergedAttributes = { ...incoming.attributes, ...existing.attributes };
  if (Object.keys(mergedAttributes).length > Object.keys(existing.attributes).length) {
    patch.attributes = mergedAttributes;
  }
  if (!existing.needs_review && incoming.needs_review) patch.needs_review = true;
  return Object.keys(patch).length > 0 ? { id: existing.id, patch } : null;
}

function buildInsertRow(part: ParsedStockPart, internalPid: string): PartInsert {
  const attributes: Record<string, string | number | boolean | null> = { ...part.attributes };
  if (part.qty !== null) attributes.import_qty = part.qty;

  return {
    internal_pid: internalPid,
    mpn: part.mpn,
    manufacturer: part.mfr,
    lcsc_pn: part.lcsc_pn,
    category: part.category,
    value: part.value,
    package: part.package,
    voltage: part.voltage,
    default_distributor: typeof part.attributes.distributor === "string" ? part.attributes.distributor : null,
    attributes,
    source_sheet: part.source_sheet,
    needs_review: true, // freshly imported — always queued for onboarding review
  };
}

async function main() {
  const { filePath, dryRun, verbose } = parseArgs(process.argv.slice(2));

  console.log(`Parsing ${filePath} ...`);
  const parsed = parseStockListWorkbook(filePath);
  const { parts, merges } = dedupeStockParts(parsed.parts);

  console.log("\nSheet summary:");
  for (const s of parsed.sheetSummary) {
    console.log(`  ${s.sheet.padEnd(22)} ${s.skipped ? "(skipped)" : `${s.rowCount} rows`}`);
  }
  console.log(`\nParsed ${parsed.parts.length} rows, deduped to ${parts.length} (${merges.length} MPN/LCSC merges).`);
  console.log(`needs_review: ${parts.filter((p) => p.needs_review).length} / ${parts.length}`);

  const supabase = createServiceClient();
  const existing = (await fetchExistingPartIdentities(supabase, [
    "category",
    "value",
    "voltage",
    "package",
    "default_distributor",
    "attributes",
    "needs_review",
  ])) as unknown as ExistingPart[];
  const identityMaps = buildIdentityMaps(existing);

  const newParts: ParsedStockPart[] = [];
  const updates: PlannedUpdate[] = [];

  for (const part of parts) {
    const match = findByIdentity(identityMaps, part.mpn, part.lcsc_pn);

    if (match) {
      const planned = planUpdate(match, part);
      if (planned) updates.push(planned);
      continue;
    }
    newParts.push(part);
  }

  const pids = nextPidSequence(
    existing.map((e) => e.internal_pid),
    newParts.length,
  );
  const insertRows = newParts.map((part, i) => buildInsertRow(part, pids[i]!));

  console.log(`\nPlan: ${insertRows.length} new parts to insert, ${updates.length} existing parts to patch.`);
  if (verbose) {
    console.log("Sample new rows:", JSON.stringify(insertRows.slice(0, 3), null, 2));
    console.log("Sample updates:", JSON.stringify(updates.slice(0, 3), null, 2));
  }

  if (dryRun) {
    console.log("\n--dry-run: no writes performed.");
    return;
  }

  for (let i = 0; i < insertRows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = insertRows.slice(i, i + INSERT_CHUNK_SIZE);
    const { error } = await supabase.from(TABLES.parts).insert(chunk);
    if (error) throw new Error(`Insert failed at offset ${i}: ${error.message}`);
    console.log(`  inserted ${Math.min(i + INSERT_CHUNK_SIZE, insertRows.length)} / ${insertRows.length}`);
  }

  for (const u of updates) {
    const { error } = await supabase.from(TABLES.parts).update(u.patch).eq("id", u.id);
    if (error) throw new Error(`Update failed for part ${u.id}: ${error.message}`);
  }

  console.log(`\nDone. Inserted ${insertRows.length}, patched ${updates.length}.`);
  console.log("Next step: Receive → onboarding queue to assign Shelf → Big Box → ESD + print labels.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
