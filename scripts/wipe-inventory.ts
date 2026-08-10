#!/usr/bin/env bun
/**
 * scripts/wipe-inventory.ts — clears the part catalog so a fresh stock list can
 * be imported. The executable companion to `docs/inventory-wipe-2026-08-10.sql`.
 *
 * Usage:
 *   bun --env-file=.env.cloud.local run scripts/wipe-inventory.ts            # census only (read-only)
 *   bun --env-file=.env.cloud.local run scripts/wipe-inventory.ts --backup   # census + write a JSON backup
 *   bun --env-file=.env.cloud.local run scripts/wipe-inventory.ts --confirm  # actually delete
 *
 * **Why a script and not just the SQL.** The SQL file is the better tool when
 * you have a psql/SQL-editor session: it runs inside one transaction, so a
 * failure halfway rolls the whole thing back. `.env.cloud.local` carries only
 * the REST URL and the service-role key — no database connection string — so
 * against cloud this goes through PostgREST, which has **no transaction**. Each
 * statement below commits on its own. If one fails, earlier ones stay applied;
 * the census + `--backup` exist so that is recoverable rather than fatal.
 * Prefer the SQL file whenever you can paste into the Supabase SQL editor.
 *
 * SERVICE-ROLE KEY, SCRIPT-ONLY. `smark_part_events` is append-only — it has no
 * DELETE policy for ANY role by design (migration 0002) — so this genuinely
 * cannot be done as a signed-in user; it needs the RLS bypass.
 *
 * SCOPE — inventory only. Projects, BOMs, orders, attendance, users, agent runs
 * and ordering rules are left alone. Order lines keep their rows and their money
 * (financial history "must never be lost" — migration 0004); only their pointer
 * at a deleted part is nulled.
 */

import { writeFileSync } from "node:fs";
import { createServiceClient } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/select-all";
import { TABLES } from "@/types/db";

type DB = ReturnType<typeof createServiceClient>;

/** PostgREST requires a filter on every delete; this one matches every row. */
const ALL_ROWS = { column: "id", filter: "is", value: null } as const;

async function countOf(supabase: DB, table: string, describe?: (q: never) => never): Promise<number> {
  void describe;
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(`Counting ${table}: ${error.message}`);
  return count ?? 0;
}

async function census(supabase: DB): Promise<void> {
  const rows: [string, number][] = [];

  for (const [label, table] of [
    ["parts", TABLES.parts],
    ["stock_locations", TABLES.stock_locations],
    ["big_boxes", TABLES.big_boxes],
    ["shelves", TABLES.shelves],
    ["part_events", TABLES.part_events],
    ["movements", TABLES.movements],
    ["qr_labels", TABLES.qr_labels],
  ] as const) {
    rows.push([label, await countOf(supabase, table)]);
  }

  // The four references that BLOCK a part delete until they are cleared.
  for (const [label, table, column] of [
    ["cart_items → part", TABLES.cart_items, "part_id"],
    ["order_lines → part", TABLES.order_lines, "part_id"],
    ["bom_lines matched", TABLES.bom_lines, "matched_part_id"],
    ["agent_results → part", TABLES.agent_results, "part_id"],
  ] as const) {
    const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).not(column, "is", null);
    if (error) throw new Error(`Counting ${label}: ${error.message}`);
    rows.push([label, count ?? 0]);
  }

  console.log("\nCensus — what is in the catalog right now:");
  for (const [label, count] of rows) console.log(`  ${label.padEnd(22)} ${String(count).padStart(6)}`);

  // Untouched by this script — printed so the blast radius is visibly bounded.
  console.log("\nKept (must not change):");
  for (const [label, table] of [
    ["projects", TABLES.projects],
    ["boms", TABLES.boms],
    ["orders", TABLES.orders],
    ["app_users", TABLES.app_users],
  ] as const) {
    console.log(`  ${label.padEnd(22)} ${String(await countOf(supabase, table)).padStart(6)}`);
  }

  const sample = await selectAllRows((from, to) =>
    supabase
      .from(TABLES.parts)
      .select("internal_pid, mpn, category, value, package, total_qty, source_sheet, created_at")
      .order("internal_pid")
      .range(from, to),
  );
  console.log(`\nCatalog sample (first 15 of ${sample.length}):`);
  for (const p of sample.slice(0, 15)) {
    console.log(
      `  ${p.internal_pid}  ${(p.mpn ?? "—").padEnd(20).slice(0, 20)} ${(p.category ?? "—").padEnd(12)} ` +
        `${(p.value ?? "—").padEnd(16).slice(0, 16)} qty ${String(p.total_qty).padStart(6)}  ${p.source_sheet ?? ""}`,
    );
  }
}

async function backup(supabase: DB): Promise<void> {
  const parts = await selectAllRows((from, to) =>
    supabase.from(TABLES.parts).select("*").order("internal_pid").range(from, to),
  );
  const locations = await selectAllRows((from, to) =>
    supabase.from(TABLES.stock_locations).select("*").order("id").range(from, to),
  );
  const path = `docs/backup-inventory-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(path, JSON.stringify({ parts, locations }, null, 2), "utf8");
  console.log(`\nBackup written: ${path} (${parts.length} parts, ${locations.length} locations)`);
}

async function wipe(supabase: DB): Promise<void> {
  console.log("\nDeleting — children first (FK order matters; four of these are NO ACTION):");

  // Polymorphic target_id with NO foreign key by design, so these would survive
  // as orphans pointing at dead uuids and later collide with fresh labels.
  const { error: labelsError } = await supabase
    .from(TABLES.qr_labels)
    .delete()
    .in("target_type", ["part", "big_box"]);
  if (labelsError) throw new Error(`qr_labels: ${labelsError.message}`);
  console.log("  qr_labels          ✓");

  for (const [label, table] of [
    ["part_events", TABLES.part_events],
    ["movements", TABLES.movements],
    // Each row fires a per-part advisory lock + total_qty re-SUM. The slow one.
    ["stock_locations", TABLES.stock_locations],
  ] as const) {
    const { error } = await supabase.from(table).delete().not(ALL_ROWS.column, ALL_ROWS.filter, ALL_ROWS.value);
    if (error) throw new Error(`${label}: ${error.message}`);
    console.log(`  ${label.padEnd(18)} ✓`);
  }

  // Deleted, not unlinked: smark_cart_items has
  // `check (part_id is not null or descriptor is not null)`, so nulling part_id
  // would violate it — and an open cart line for a deleted part means nothing.
  const { error: cartError } = await supabase.from(TABLES.cart_items).delete().not("part_id", "is", null);
  if (cartError) throw new Error(`cart_items: ${cartError.message}`);
  console.log("  cart_items         ✓");

  // Order lines are KEPT — financial history. Only the dead pointer goes.
  const { error: linesError } = await supabase
    .from(TABLES.order_lines)
    .update({ part_id: null })
    .not("part_id", "is", null);
  if (linesError) throw new Error(`order_lines: ${linesError.message}`);
  console.log("  order_lines        ✓ (part_id nulled, rows kept)");

  for (const [label, table] of [
    ["parts", TABLES.parts],
    ["big_boxes", TABLES.big_boxes],
    ["shelves", TABLES.shelves],
  ] as const) {
    const { error } = await supabase.from(table).delete().not(ALL_ROWS.column, ALL_ROWS.filter, ALL_ROWS.value);
    if (error) throw new Error(`${label}: ${error.message}`);
    console.log(`  ${label.padEnd(18)} ✓`);
  }

  // matched_part_id nulled itself (ON DELETE SET NULL), but match_state would be
  // left claiming 'in_stock' while pointing at nothing. Reset so every BOM
  // re-reconciles honestly against the new catalog.
  const { error: bomError } = await supabase
    .from(TABLES.bom_lines)
    .update({ match_state: "unresolved", match_confidence: null })
    .is("matched_part_id", null)
    .neq("match_state", "unresolved");
  if (bomError) throw new Error(`bom_lines: ${bomError.message}`);
  console.log("  bom_lines          ✓ (stale match_state reset)");
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  const supabase = createServiceClient();

  console.log(`Target: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  await census(supabase);

  if (flags.has("--backup") || flags.has("--confirm")) await backup(supabase);

  if (!flags.has("--confirm")) {
    console.log("\nRead-only. Re-run with --confirm to delete.");
    return;
  }

  await wipe(supabase);

  console.log("\nVerify — every count must be 0:");
  for (const [label, table] of [
    ["parts", TABLES.parts],
    ["stock_locations", TABLES.stock_locations],
    ["big_boxes", TABLES.big_boxes],
    ["shelves", TABLES.shelves],
    ["part_events", TABLES.part_events],
    ["movements", TABLES.movements],
    ["qr_labels", TABLES.qr_labels],
  ] as const) {
    console.log(`  ${label.padEnd(18)} ${String(await countOf(supabase, table)).padStart(6)}`);
  }

  console.log("\nUntouched:");
  for (const [label, table] of [
    ["projects", TABLES.projects],
    ["boms", TABLES.boms],
    ["orders", TABLES.orders],
    ["order_lines", TABLES.order_lines],
    ["app_users", TABLES.app_users],
  ] as const) {
    console.log(`  ${label.padEnd(18)} ${String(await countOf(supabase, table)).padStart(6)}`);
  }

  console.log("\nNext: bun --env-file=.env.cloud.local run scripts/import-formatted-csvs.ts");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
