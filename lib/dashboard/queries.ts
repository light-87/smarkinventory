/**
 * lib/dashboard/queries.ts — server-only data fetching for the Dashboard
 * (plan/tab-dashboard.md). Every function takes an already-created request
 * Supabase client (`lib/supabase/server.ts` `createClient()`) so it runs
 * under the caller's session + RLS — never the service-role client.
 *
 * Joins are resolved with small follow-up `.in()` queries instead of
 * PostgREST embedded selects: `types/db.ts`'s `Database` generic declares
 * every table's `Relationships` as `[]` (no FK metadata for supabase-js to
 * type embeds against), so hand-joining in JS keeps this fully typed.
 */

import type { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/types/db";
import {
  buildProjectUsageBars,
  composeBoxLabel,
  computeInventoryValue,
  deltaTone,
  formatDelta,
  movementReasonLabel,
  stockStateFor,
  todayBoundsIso,
  uniq,
  type ProjectUsageBar,
} from "@/lib/dashboard/compute";
import { formatTime } from "@/lib/format";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`[dashboard] ${context}: ${error.message}`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Stat tiles
 * ──────────────────────────────────────────────────────────────────────────── */

export interface DashboardStats {
  unitsInStock: number;
  distinctSkus: number;
  lowStock: number;
  outOfStock: number;
  onOrder: number;
  movementsToday: number;
  inventoryValue: number;
  unpricedCount: number;
}

export async function getDashboardStats(supabase: SupabaseServerClient): Promise<DashboardStats> {
  const { start, end } = todayBoundsIso();

  const [partsRes, movementsTodayRes, onOrderRes] = await Promise.all([
    supabase.from(TABLES.parts).select("total_qty, reorder_point, last_unit_price"),
    supabase
      .from(TABLES.movements)
      .select("id", { count: "exact", head: true })
      .gte("created_at", start)
      .lt("created_at", end),
    supabase
      .from(TABLES.order_lines)
      .select("id", { count: "exact", head: true })
      .eq("line_status", "ordered"),
  ]);

  assertNoError(partsRes.error, "loading parts for stats");
  assertNoError(movementsTodayRes.error, "counting today's movements");
  assertNoError(onOrderRes.error, "counting on-order lines");

  const parts = partsRes.data ?? [];
  let unitsInStock = 0;
  let lowStock = 0;
  let outOfStock = 0;
  for (const p of parts) {
    unitsInStock += p.total_qty;
    const state = stockStateFor(p.total_qty, p.reorder_point);
    if (state === "low") lowStock++;
    else if (state === "out") outOfStock++;
  }
  const { value: inventoryValue, unpricedCount } = computeInventoryValue(parts);

  return {
    unitsInStock,
    distinctSkus: parts.length,
    lowStock,
    outOfStock,
    onOrder: onOrderRes.count ?? 0,
    movementsToday: movementsTodayRes.count ?? 0,
    inventoryValue,
    unpricedCount,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Recent movements feed
 * ──────────────────────────────────────────────────────────────────────────── */

export interface MovementFeedRow {
  id: string;
  time: string;
  pid: string;
  delta: string;
  deltaTone: "accent" | "neutral";
  reason: string;
  box: string;
}

export async function getRecentMovements(
  supabase: SupabaseServerClient,
  limit = 8,
): Promise<MovementFeedRow[]> {
  const { data, error } = await supabase
    .from(TABLES.movements)
    .select("id, created_at, part_id, big_box_id, delta_qty, reason, reason_detail, bom_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  assertNoError(error, "loading recent movements");

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const partIds = uniq(rows.map((r) => r.part_id));
  const boxIds = uniq(rows.map((r) => r.big_box_id));
  const bomIds = uniq(rows.map((r) => r.bom_id));

  const [partsRes, boxesRes, bomsRes] = await Promise.all([
    partIds.length
      ? supabase.from(TABLES.parts).select("id, internal_pid").in("id", partIds)
      : Promise.resolve({ data: [], error: null }),
    boxIds.length
      ? supabase.from(TABLES.big_boxes).select("id, name, shelf_id").in("id", boxIds)
      : Promise.resolve({ data: [], error: null }),
    bomIds.length
      ? supabase.from(TABLES.boms).select("id, name").in("id", bomIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  assertNoError(partsRes.error, "loading parts for movement PIDs");
  assertNoError(boxesRes.error, "loading big boxes for movement feed");
  assertNoError(bomsRes.error, "loading BOMs for movement feed");

  const boxes = boxesRes.data ?? [];
  const shelfIds = uniq(boxes.map((b) => b.shelf_id));
  const shelvesRes = shelfIds.length
    ? await supabase.from(TABLES.shelves).select("id, code").in("id", shelfIds)
    : { data: [] as { id: string; code: string }[], error: null };
  assertNoError(shelvesRes.error, "loading shelves for movement feed");

  const partPidById = new Map((partsRes.data ?? []).map((p) => [p.id, p.internal_pid]));
  const shelfCodeById = new Map((shelvesRes.data ?? []).map((s) => [s.id, s.code]));
  const boxById = new Map(
    boxes.map((b) => [b.id, { name: b.name, shelfCode: shelfCodeById.get(b.shelf_id) ?? null }]),
  );
  const bomNameById = new Map((bomsRes.data ?? []).map((b) => [b.id, b.name]));

  return rows.map((r) => {
    const box = r.big_box_id ? boxById.get(r.big_box_id) : undefined;
    return {
      id: r.id,
      time: formatTime(r.created_at),
      pid: partPidById.get(r.part_id) ?? "—",
      delta: formatDelta(r.delta_qty),
      deltaTone: deltaTone(r.delta_qty),
      reason: movementReasonLabel(r.reason, {
        bomName: r.bom_id ? (bomNameById.get(r.bom_id) ?? null) : null,
        reasonDetail: r.reason_detail,
      }),
      box: box ? composeBoxLabel(box) : "—",
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Usage by project — distinct parts touched per project, sourced from
 * `smark_part_events.project_id` (the "part … events" project attribution
 * per plan/tab-dashboard.md; empty/thin until Scan/Bulk-pick/Receive start
 * writing events — placeholder-tolerant by design).
 * ──────────────────────────────────────────────────────────────────────────── */

export type { ProjectUsageBar };

export async function getUsageByProject(
  supabase: SupabaseServerClient,
  limit = 6,
): Promise<ProjectUsageBar[]> {
  const { data, error } = await supabase
    .from(TABLES.part_events)
    .select("project_id, part_id")
    .not("project_id", "is", null);
  assertNoError(error, "loading part events for project usage");

  const byProject = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    if (!row.project_id) continue;
    const set = byProject.get(row.project_id) ?? new Set<string>();
    set.add(row.part_id);
    byProject.set(row.project_id, set);
  }

  const projectIds = [...byProject.keys()];
  if (projectIds.length === 0) return [];

  const { data: projects, error: projectsError } = await supabase
    .from(TABLES.projects)
    .select("id, name")
    .in("id", projectIds);
  assertNoError(projectsError, "loading project names for usage bars");

  const nameById = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const inputs = projectIds.map((id) => ({
    projectId: id,
    name: nameById.get(id) ?? "Unknown project",
    count: byProject.get(id)?.size ?? 0,
  }));

  return buildProjectUsageBars(inputs, limit);
}
