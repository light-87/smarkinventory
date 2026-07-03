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

import type { SupabaseClient } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase/server";
import { TABLES, type AgentRunStatus, type Database } from "@/types/db";
import {
  buildProjectUsageBars,
  composeBoxLabel,
  computeInventoryValue,
  computeRunLaneProgress,
  deltaTone,
  extractRunTotalLines,
  formatDelta,
  formatRunCost,
  movementReasonLabel,
  stockStateFor,
  todayBoundsIso,
  uniq,
  type ProjectUsageBar,
  type RunCostDisplay,
  type RunLaneProgress,
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

/* ────────────────────────────────────────────────────────────────────────────
 * Agent activity — recent smark_agent_runs (plan/tab-dashboard.md's
 * agent-activity section, FEATURES §5.1). Typed against the plain
 * `SupabaseClient<Database>` (not the server-only `SupabaseServerClient`
 * alias above) so the SAME shaping function serves both the initial
 * server-rendered fetch (lib/supabase/server.ts) and the client-side "while
 * active" poll (lib/supabase/client.ts) — see hooks/use-agent-runs-feed.ts.
 * Both factories return RLS-bound clients; neither is service-role (HARD
 * RULES: "RLS clients in app routes"). See lib/dashboard/compute.ts's
 * "Agent activity card" section header for the done/total RLS caveat.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AgentRunFeedRow {
  id: string;
  bomId: string;
  bomName: string;
  projectId: string;
  projectName: string;
  status: AgentRunStatus;
  laneProgress: RunLaneProgress;
  cost: RunCostDisplay;
  startedByName: string | null;
  createdAt: string;
  /** Best-effort "finished at" for terminal runs — see formatFinishedAgo's doc. */
  updatedAt: string | null;
}

export async function getRecentAgentRuns(
  supabase: SupabaseClient<Database>,
  limit = 5,
): Promise<AgentRunFeedRow[]> {
  const { data, error } = await supabase
    .from(TABLES.agent_runs)
    .select("id, bom_id, status, actual_cost, est_cost, plan, started_by, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  assertNoError(error, "loading recent agent runs");

  const runs = data ?? [];
  if (runs.length === 0) return [];

  const bomIds = uniq(runs.map((r) => r.bom_id));
  const userIds = uniq(runs.map((r) => r.started_by));

  const [bomsRes, usersRes] = await Promise.all([
    bomIds.length
      ? supabase.from(TABLES.boms).select("id, name, project_id").in("id", bomIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase.from(TABLES.app_users).select("id, username, display_name").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  assertNoError(bomsRes.error, "loading BOMs for agent run feed");
  assertNoError(usersRes.error, "loading users for agent run feed");

  const boms = bomsRes.data ?? [];
  const projectIds = uniq(boms.map((b) => b.project_id));
  const projectsRes = projectIds.length
    ? await supabase.from(TABLES.projects).select("id, name").in("id", projectIds)
    : { data: [] as { id: string; name: string }[], error: null };
  assertNoError(projectsRes.error, "loading projects for agent run feed");

  const bomById = new Map(boms.map((b) => [b.id, b]));
  const projectNameById = new Map((projectsRes.data ?? []).map((p) => [p.id, p.name]));
  const userNameById = new Map(
    (usersRes.data ?? []).map((u) => [u.id, u.display_name ?? u.username]),
  );

  return runs.map((r) => {
    const bom = bomById.get(r.bom_id);
    const totalLines = extractRunTotalLines(r.plan);
    return {
      id: r.id,
      bomId: r.bom_id,
      bomName: bom?.name ?? "Deleted BOM",
      projectId: bom?.project_id ?? "",
      projectName: bom ? (projectNameById.get(bom.project_id) ?? "Unknown project") : "Unknown project",
      status: r.status,
      laneProgress: computeRunLaneProgress(r.status, totalLines),
      cost: formatRunCost(r.actual_cost, r.est_cost),
      startedByName: r.started_by ? (userNameById.get(r.started_by) ?? null) : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}
