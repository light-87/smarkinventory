/**
 * lib/bom/queries.ts — read-side data fetchers for the BOM-pipeline surface.
 * Hand-joins across tables with follow-up `.in()` queries rather than
 * PostgREST embedded selects — `types/db.ts`'s `Database` generic carries no
 * `Relationships` metadata for supabase-js to type embeds against (same
 * convention as `app/(app)/shelves/queries.ts`, `lib/receive/queries.ts`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BomLineRow, BomRow, BomSourcingStatus, Database } from "@/types/db";
import { TABLES, VIEWS } from "@/types/db";
import { fetchExistingPartIdentities } from "@/lib/import/existing-parts";
import type { ReconcileCatalogPart } from "./reconcile";

type DB = SupabaseClient<Database>;

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`[bom] ${context}: ${error.message}`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Project header (read-only — projects-hub owns writes/the hub page)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ProjectHeader {
  id: string;
  name: string;
  client: string | null;
  archivedAt: string | null;
}

export async function getProjectHeader(supabase: DB, projectId: string): Promise<ProjectHeader | null> {
  const { data, error } = await supabase
    .from(TABLES.projects)
    .select("id, name, client, archived_at")
    .eq("id", projectId)
    .maybeSingle();
  assertNoError(error, "smark_projects");
  if (!data) return null;
  return { id: data.id, name: data.name, client: data.client, archivedAt: data.archived_at };
}

/* ────────────────────────────────────────────────────────────────────────────
 * BOM list (per project)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface BomListRow {
  id: string;
  name: string;
  lineCount: number;
  inStock: number;
  toOrder: number;
  buildQty: number;
  sourcingStatus: BomSourcingStatus;
  createdInApp: boolean;
  uploadedByName: string | null;
  createdAt: string;
  /** Newest run for this BOM (`smark_boms.saved_run_id`) — `null` until a run has ever been started. */
  savedRunId: string | null;
  /** [0015] Soft-archive timestamp — non-null means hidden from the active list; reversible. */
  archivedAt: string | null;
}

async function countMatchStatesByBom(supabase: DB, bomIds: readonly string[]): Promise<Map<string, { inStock: number; toOrder: number }>> {
  const result = new Map<string, { inStock: number; toOrder: number }>();
  if (bomIds.length === 0) return result;

  const { data, error } = await supabase.from(TABLES.bom_lines).select("bom_id, match_state").in("bom_id", bomIds);
  assertNoError(error, "smark_bom_lines (state counts)");

  for (const row of data ?? []) {
    const bucket = result.get(row.bom_id) ?? { inStock: 0, toOrder: 0 };
    if (row.match_state === "in_stock") bucket.inStock += 1;
    else bucket.toOrder += 1;
    result.set(row.bom_id, bucket);
  }
  return result;
}

/** Every BOM for a project, newest first, with its in-stock/to-order split (FEATURES §5.8). */
export async function listBomsForProject(supabase: DB, projectId: string): Promise<BomListRow[]> {
  const { data: boms, error } = await supabase
    .from(TABLES.boms)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  assertNoError(error, "smark_boms");
  if (!boms || boms.length === 0) return [];

  const bomIds = boms.map((b) => b.id);
  const counts = await countMatchStatesByBom(supabase, bomIds);

  const uploaderIds = Array.from(new Set(boms.map((b) => b.uploaded_by).filter((v): v is string => Boolean(v))));
  const uploaderNames = new Map<string, string>();
  if (uploaderIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from(TABLES.app_users)
      .select("id, username, display_name")
      .in("id", uploaderIds);
    assertNoError(usersError, "smark_app_users");
    for (const u of users ?? []) uploaderNames.set(u.id, u.display_name ?? u.username);
  }

  return boms.map((bom) => {
    const state = counts.get(bom.id) ?? { inStock: 0, toOrder: 0 };
    return {
      id: bom.id,
      name: bom.name,
      lineCount: bom.line_count,
      inStock: state.inStock,
      toOrder: state.toOrder,
      buildQty: bom.build_qty,
      sourcingStatus: bom.sourcing_status,
      createdInApp: bom.created_in_app,
      uploadedByName: bom.uploaded_by ? (uploaderNames.get(bom.uploaded_by) ?? null) : null,
      createdAt: bom.created_at,
      savedRunId: bom.saved_run_id,
      archivedAt: bom.archived_at,
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Reconcile catalog + demand (shared by service.ts's write path)
 * ──────────────────────────────────────────────────────────────────────────── */

// `fetchExistingPartIdentities` always includes id/internal_pid/mpn/lcsc_pn — only the extra
// reconcile-specific columns need listing here.
const RECONCILE_CATALOG_COLUMNS = ["value", "package", "voltage", "part_status", "total_qty"];

/** The full `smark_parts` catalog, shaped for `lib/bom/reconcile.ts`. */
export async function getReconcileCatalog(supabase: DB): Promise<ReconcileCatalogPart[]> {
  const rows = await fetchExistingPartIdentities(supabase, RECONCILE_CATALOG_COLUMNS);
  return rows as unknown as ReconcileCatalogPart[];
}

/** Shortfall (cross-project demand − stock) per part id, for the contested-stock chip [R2-10]. */
export async function getShortfallByPartId(supabase: DB, partIds: readonly string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (partIds.length === 0) return map;

  const { data, error } = await supabase.from(VIEWS.part_demand).select("part_id, shortfall").in("part_id", partIds);
  assertNoError(error, "v_part_demand");
  for (const row of data ?? []) {
    if (row.shortfall > 0) map.set(row.part_id, row.shortfall);
  }
  return map;
}

export interface PrimaryLocation {
  shelfCode: string;
  boxName: string;
  qty: number;
}

/** The biggest-qty stock location per part — what the "In stock · Shelf B · Box B-12" tag points at. */
export async function getPrimaryLocationsByPartId(
  supabase: DB,
  partIds: readonly string[],
): Promise<Map<string, PrimaryLocation>> {
  const map = new Map<string, PrimaryLocation>();
  if (partIds.length === 0) return map;

  const { data: locations, error } = await supabase
    .from(TABLES.stock_locations)
    .select("part_id, big_box_id, qty")
    .in("part_id", partIds);
  assertNoError(error, "smark_stock_locations");
  if (!locations || locations.length === 0) return map;

  const boxIds = Array.from(new Set(locations.map((l) => l.big_box_id)));
  const { data: boxes, error: boxesError } = await supabase.from(TABLES.big_boxes).select("id, name, shelf_id").in("id", boxIds);
  assertNoError(boxesError, "smark_big_boxes");

  const shelfIds = Array.from(new Set((boxes ?? []).map((b) => b.shelf_id)));
  const { data: shelves, error: shelvesError } = await supabase.from(TABLES.shelves).select("id, code").in("id", shelfIds);
  assertNoError(shelvesError, "smark_shelves");

  const boxById = new Map((boxes ?? []).map((b) => [b.id, b]));
  const shelfById = new Map((shelves ?? []).map((s) => [s.id, s]));

  const bestByPart = new Map<string, { qty: number; big_box_id: string }>();
  for (const loc of locations) {
    const current = bestByPart.get(loc.part_id);
    if (!current || loc.qty > current.qty) bestByPart.set(loc.part_id, { qty: loc.qty, big_box_id: loc.big_box_id });
  }

  for (const [partId, best] of bestByPart) {
    const box = boxById.get(best.big_box_id);
    if (!box) continue;
    const shelf = shelfById.get(box.shelf_id);
    map.set(partId, { shelfCode: shelf?.code ?? "?", boxName: box.name, qty: best.qty });
  }
  return map;
}

/* ────────────────────────────────────────────────────────────────────────────
 * BOM detail (sheet-mirror view)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface BomDetailData {
  bom: BomRow;
  project: ProjectHeader;
  lines: BomLineRow[];
}

/**
 * Everything the BOM-detail route needs, or `null` if the BOM doesn't exist.
 * Raw lines only — the detail page mirrors the uploaded sheet as-is (manual-
 * test decision: stock-checking is the AI pipeline's job, so no per-line
 * match/location/shortfall lookups here anymore).
 */
export async function getBomDetail(supabase: DB, bomId: string): Promise<BomDetailData | null> {
  const { data: bom, error } = await supabase.from(TABLES.boms).select("*").eq("id", bomId).maybeSingle();
  assertNoError(error, "smark_boms");
  if (!bom) return null;

  const project = await getProjectHeader(supabase, bom.project_id);
  if (!project) return null;

  const { data: lines, error: linesError } = await supabase
    .from(TABLES.bom_lines)
    .select("*")
    .eq("bom_id", bomId)
    .order("line_no", { ascending: true, nullsFirst: false });
  assertNoError(linesError, "smark_bom_lines");

  return { bom, project, lines: (lines ?? []) as BomLineRow[] };
}
