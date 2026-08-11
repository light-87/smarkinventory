/**
 * lib/takeout/queries.ts — read-side data fetchers for Bulk takeout
 * (plan/tab-bulk-pick.md).
 *
 * All take a `SupabaseClient<Database>` the caller already created (Server
 * Component / Server Action) so this module stays framework-agnostic and
 * testable against the local stack without pulling in `next/headers`. No
 * embedded-resource joins anywhere — `Database`'s `TableOf` carries no
 * `Relationships` metadata (types/db.ts) — joins are done here in plain TS
 * over a handful of flat queries, same pattern as lib/receive/queries.ts and
 * lib/inventory/query.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";
import { selectAllRows, selectByIds } from "@/lib/supabase/select-all";
import type { TakeoutCatalogPart, TakeoutLocationRow } from "./resolve";
import type { TakeoutRawLine } from "./types";

type DB = SupabaseClient<Database>;

/* ────────────────────────────────────────────────────────────────────────────
 * "Pick a project BOM" picker — non-archived projects that have ≥1 BOM
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PickableBom {
  id: string;
  name: string;
  buildQty: number;
  lineCount: number;
}

export interface PickableProject {
  id: string;
  name: string;
  boms: PickableBom[];
}

export async function getPickableProjects(supabase: DB): Promise<PickableProject[]> {
  const [{ data: projects, error: projectsErr }, { data: boms, error: bomsErr }] = await Promise.all([
    supabase.from(TABLES.projects).select("id, name, archived_at").is("archived_at", null).order("name", { ascending: true }),
    supabase
      .from(TABLES.boms)
      .select("id, name, project_id, build_qty, line_count")
      .is("archived_at", null)
      .order("name", { ascending: true }),
  ]);
  if (projectsErr) throw projectsErr;
  if (bomsErr) throw bomsErr;

  const bomsByProject = new Map<string, PickableBom[]>();
  for (const bom of boms ?? []) {
    const list = bomsByProject.get(bom.project_id) ?? [];
    list.push({ id: bom.id, name: bom.name, buildQty: bom.build_qty, lineCount: bom.line_count });
    bomsByProject.set(bom.project_id, list);
  }

  return (projects ?? [])
    .map((project) => ({ id: project.id, name: project.name, boms: bomsByProject.get(project.id) ?? [] }))
    .filter((project) => project.boms.length > 0);
}

/* ────────────────────────────────────────────────────────────────────────────
 * A project BOM's lines, ready to resolve
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TakeoutBom {
  id: string;
  name: string;
  projectId: string;
  buildQty: number;
}

export interface LoadedBomLines {
  bom: TakeoutBom;
  projectName: string;
  rawLines: TakeoutRawLine[];
}

export async function getBomForTakeout(supabase: DB, bomId: string): Promise<LoadedBomLines | null> {
  const { data: bom, error: bomError } = await supabase.from(TABLES.boms).select("*").eq("id", bomId).maybeSingle();
  if (bomError) throw bomError;
  if (!bom) return null;

  const [{ data: lines, error: linesError }, { data: project, error: projectError }] = await Promise.all([
    supabase.from(TABLES.bom_lines).select("*").eq("bom_id", bomId).order("line_no", { ascending: true }),
    supabase.from(TABLES.projects).select("id, name").eq("id", bom.project_id).maybeSingle(),
  ]);
  if (linesError) throw linesError;
  if (projectError) throw projectError;

  const rawLines: TakeoutRawLine[] = (lines ?? []).map((line) => ({
    lineNo: line.line_no,
    references: line.references,
    qty: line.qty,
    value: line.value,
    footprint: line.footprint,
    dnp: line.dnp,
    description: line.description,
    mpn: line.mpn,
    manufacturer: line.manufacturer,
    lcscPn: line.lcsc_pn,
  }));

  return {
    bom: { id: bom.id, name: bom.name, projectId: bom.project_id, buildQty: bom.build_qty },
    projectName: project?.name ?? "—",
    rawLines,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Catalog + locations for matcher resolution
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Slim catalog for `lib/matcher.matchPart` — whole table, ~2000 rows at
 * SmarkStock's scale (same read shape as lib/receive/queries.ts's
 * getMatchCatalog), paged past PostgREST's 1000-row cap. Truncating this makes
 * pick lines for real, in-stock parts resolve to "not found".
 */
export async function getTakeoutCatalog(supabase: DB): Promise<TakeoutCatalogPart[]> {
  return selectAllRows((from, to) =>
    supabase
      .from(TABLES.parts)
      .select("id, internal_pid, mpn, lcsc_pn, value, package, voltage, part_status, total_qty")
      .order("internal_pid")
      .range(from, to),
  );
}

/** Locations for just the given part ids, joined out to shelf code + box name — keyed by part id (a part may have >1 home). */
export async function getTakeoutLocations(
  supabase: DB,
  partIds: readonly string[],
): Promise<Map<string, TakeoutLocationRow[]>> {
  const map = new Map<string, TakeoutLocationRow[]>();
  if (partIds.length === 0) return map;

  // Chunked: a long id list becomes a long URL, and PostgREST rejects it with
  // a bare 400 (see lib/supabase/select-all.ts).
  const locations = await selectByIds(partIds, (idChunk) =>
    supabase.from(TABLES.stock_locations).select("id, part_id, big_box_id, qty").in("part_id", idChunk),
  );
  if (locations.length === 0) return map;

  const boxIds = Array.from(new Set(locations.map((l) => l.big_box_id)));
  const boxes = await selectByIds(boxIds, (idChunk) =>
    supabase.from(TABLES.big_boxes).select("id, name, shelf_id").in("id", idChunk),
  );

  const shelfIds = Array.from(new Set(boxes.map((b) => b.shelf_id)));
  const shelves = await selectByIds(shelfIds, (idChunk) =>
    supabase.from(TABLES.shelves).select("id, code").in("id", idChunk),
  );

  const boxById = new Map(boxes.map((b) => [b.id, b]));
  const shelfById = new Map(shelves.map((s) => [s.id, s]));

  for (const loc of locations) {
    const box = boxById.get(loc.big_box_id);
    const shelf = box ? shelfById.get(box.shelf_id) : undefined;
    const row: TakeoutLocationRow = {
      id: loc.id,
      partId: loc.part_id,
      bigBoxId: loc.big_box_id,
      qty: loc.qty,
      boxName: box?.name ?? "—",
      shelfCode: shelf?.code ?? "—",
    };
    const list = map.get(loc.part_id) ?? [];
    list.push(row);
    map.set(loc.part_id, list);
  }
  return map;
}
