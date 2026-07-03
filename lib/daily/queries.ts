/**
 * lib/daily/queries.ts — server-only data fetching for Daily Reports
 * (plan/tab-daily-reports.md R2-07). Every function takes an already-created
 * request Supabase client (`lib/supabase/server.ts` `createClient()`) so it
 * runs under the caller's session + RLS — never the service-role client.
 *
 * Joins are resolved with small follow-up `.in()` queries instead of
 * PostgREST embedded selects (same reasoning as lib/dashboard/queries.ts and
 * app/(app)/shelves/queries.ts: `types/db.ts`'s `Database` generic declares
 * every table's `Relationships` as `[]`, so hand-joining in JS keeps this
 * fully typed).
 *
 * "Employee sees self only" (FEATURES.md §2/§5.13) is enforced HERE, at the
 * query layer, not by RLS: the underlying operational tables (movements,
 * part events, boms, runs, cart, orders) grant employee a BROAD read (full
 * parity with owner) per the "Dashboard·Inventory·...·Projects·Cart" rows of
 * the role matrix — only Daily Reports itself restricts employee to "self".
 * Every function below that can be actor-scoped takes an `actorFilter:
 * string | null` — `null` = no filter (owner/accountant "all"), a user id =
 * restrict to that actor. Callers (app/(app)/daily/page.tsx) MUST pass the
 * caller's own id when `dataScope(role, "daily_reports") === "self"` — this
 * is the one enforcement point, so get it right there.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, AppRole, MovementReason, MovementReasonDetail } from "@/types/db";
import { TABLES } from "@/types/db";
import type { IsoBounds } from "./compute";
import { filterActivityForActor } from "./compute";
import type { OrderingActivityItem, MovementDailyRow } from "./compute";
import { formatINR } from "@/lib/format";

type DB = SupabaseClient<Database>;

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`[daily] ${context}: ${error.message}`);
}

function uniq<T>(values: readonly (T | null | undefined)[]): T[] {
  return [...new Set(values.filter((v): v is T => v != null))];
}

/* ────────────────────────────────────────────────────────────────────────────
 * People + project pickers
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AppUserOption {
  id: string;
  username: string;
  displayName: string | null;
  role: AppRole;
}

/** Every active user, name-sorted — day-header person filter + team table roster. */
export async function getActiveUsers(supabase: DB): Promise<AppUserOption[]> {
  const { data, error } = await supabase
    .from(TABLES.app_users)
    .select("id, username, display_name, role")
    .eq("active", true);
  assertNoError(error, "smark_app_users");

  const rows = (data ?? []) as { id: string; username: string; display_name: string | null; role: AppRole }[];
  return rows
    .map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, role: r.role }))
    .sort((a, b) => (a.displayName ?? a.username).localeCompare(b.displayName ?? b.username));
}

export interface ProjectOption {
  id: string;
  name: string;
}

/** Every non-archived project — owner "working on" picker + owner-correction picker. */
export async function getAllActiveProjects(supabase: DB): Promise<ProjectOption[]> {
  const { data, error } = await supabase
    .from(TABLES.projects)
    .select("id, name, archived_at")
    .is("archived_at", null)
    .order("name", { ascending: true });
  assertNoError(error, "smark_projects");
  return (data ?? []).map((p) => ({ id: p.id, name: p.name }));
}

/**
 * A user's own active project assignments (smark_project_members) — the
 * "working on" picker's default list. Falls back to every non-archived
 * project when the user has no memberships (dev/fresh-install seed carries
 * zero `smark_project_members` rows today, and an owner is rarely assigned
 * as a "member" of their own company's projects) so the picker is never
 * emptier than it has to be.
 */
export async function getMyProjectOptions(supabase: DB, userId: string): Promise<ProjectOption[]> {
  const { data: memberships, error: membershipError } = await supabase
    .from(TABLES.project_members)
    .select("project_id")
    .eq("user_id", userId)
    .eq("active", true);
  assertNoError(membershipError, "smark_project_members");

  const projectIds = uniq((memberships ?? []).map((m) => m.project_id));
  if (projectIds.length === 0) return getAllActiveProjects(supabase);

  const { data: projects, error: projectsError } = await supabase
    .from(TABLES.projects)
    .select("id, name, archived_at")
    .in("id", projectIds)
    .is("archived_at", null)
    .order("name", { ascending: true });
  assertNoError(projectsError, "smark_projects");
  return (projects ?? []).map((p) => ({ id: p.id, name: p.name }));
}

/** display_name ?? username for every id, "Unknown" for a miss (defensive — should never happen for FK'd actor columns). */
export async function getUserNames(supabase: DB, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = uniq(ids);
  if (wanted.length === 0) return new Map();
  const { data, error } = await supabase
    .from(TABLES.app_users)
    .select("id, username, display_name")
    .in("id", wanted);
  assertNoError(error, "smark_app_users (names)");
  return new Map((data ?? []).map((u) => [u.id, u.display_name ?? u.username]));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Section 1 — Attendance & work
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AttendanceView {
  id: string;
  userId: string;
  workDate: string;
  checkIn: string | null;
  checkOut: string | null;
  currentProjectId: string | null;
  currentProjectName: string | null;
  note: string | null;
}

async function attachProjectNames<T extends { currentProjectId: string | null }>(
  supabase: DB,
  rows: T[],
): Promise<(T & { currentProjectName: string | null })[]> {
  const ids = uniq(rows.map((r) => r.currentProjectId));
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const { data, error } = await supabase.from(TABLES.projects).select("id, name").in("id", ids);
    assertNoError(error, "smark_projects (attendance project names)");
    for (const p of data ?? []) nameById.set(p.id, p.name);
  }
  return rows.map((r) => ({ ...r, currentProjectName: r.currentProjectId ? (nameById.get(r.currentProjectId) ?? null) : null }));
}

/** One user's attendance row for a day, or `null` if they haven't clocked in yet. */
export async function getAttendanceForUserDay(supabase: DB, userId: string, workDate: string): Promise<AttendanceView | null> {
  const { data, error } = await supabase
    .from(TABLES.attendance)
    .select("id, user_id, work_date, check_in, check_out, current_project_id, note")
    .eq("user_id", userId)
    .eq("work_date", workDate)
    .maybeSingle();
  assertNoError(error, "smark_attendance (self)");
  if (!data) return null;

  const [withProject] = await attachProjectNames(supabase, [
    {
      id: data.id,
      userId: data.user_id,
      workDate: data.work_date,
      checkIn: data.check_in,
      checkOut: data.check_out,
      currentProjectId: data.current_project_id,
      note: data.note,
    },
  ]);
  return withProject!;
}

/** Every active user's attendance rows over a date range (inclusive) — export uses `from !== to`; the day view/team table calls this with `from === to`. */
export async function getAttendanceForRange(supabase: DB, from: string, to: string): Promise<AttendanceView[]> {
  const { data, error } = await supabase
    .from(TABLES.attendance)
    .select("id, user_id, work_date, check_in, check_out, current_project_id, note")
    .gte("work_date", from)
    .lte("work_date", to);
  assertNoError(error, "smark_attendance (range)");

  const rows = (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    workDate: r.work_date,
    checkIn: r.check_in,
    checkOut: r.check_out,
    currentProjectId: r.current_project_id,
    note: r.note,
  }));
  return attachProjectNames(supabase, rows);
}

/** Every active user's attendance row for ONE day (team table) — `null` row for anyone who hasn't clocked in. */
export async function getAttendanceForDay(supabase: DB, workDate: string): Promise<AttendanceView[]> {
  return getAttendanceForRange(supabase, workDate, workDate);
}

export interface TimeEntryView {
  id: string;
  userId: string;
  projectId: string;
  projectName: string;
  workDate: string;
  hours: number;
  note: string | null;
  enteredBy: string;
}

/** Manual hours logged over a date range (inclusive, all users) — team table hours column + export. */
export async function getHoursForRange(supabase: DB, from: string, to: string): Promise<TimeEntryView[]> {
  const { data, error } = await supabase
    .from(TABLES.time_entries)
    .select("id, user_id, project_id, work_date, hours, note, entered_by")
    .gte("work_date", from)
    .lte("work_date", to);
  assertNoError(error, "smark_time_entries (range)");

  const rows = data ?? [];
  const projectIds = uniq(rows.map((r) => r.project_id));
  const nameById = new Map<string, string>();
  if (projectIds.length > 0) {
    const { data: projects, error: projectsError } = await supabase.from(TABLES.projects).select("id, name").in("id", projectIds);
    assertNoError(projectsError, "smark_projects (hours)");
    for (const p of projects ?? []) nameById.set(p.id, p.name);
  }

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    projectId: r.project_id,
    projectName: nameById.get(r.project_id) ?? "—",
    workDate: r.work_date,
    hours: r.hours,
    note: r.note,
    enteredBy: r.entered_by,
  }));
}

/** Manual hours logged for ONE day (all users) — team table hours column. */
export async function getHoursForDay(supabase: DB, workDate: string): Promise<TimeEntryView[]> {
  return getHoursForRange(supabase, workDate, workDate);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Section 2 — Movements today
 * ──────────────────────────────────────────────────────────────────────────── */

/** Full-detail movement rows for a timestamptz range, joined to part/box/shelf/bom for display (dashboard's recent-movements pattern, extended with actor + bom name). */
export async function getMovementsForRange(supabase: DB, bounds: IsoBounds, actorId: string | null): Promise<MovementDailyRow[]> {
  let query = supabase
    .from(TABLES.movements)
    .select("id, created_at, part_id, big_box_id, delta_qty, reason, reason_detail, bom_id, actor")
    .gte("created_at", bounds.startIso)
    .lt("created_at", bounds.endIso)
    .order("created_at", { ascending: false });
  if (actorId) query = query.eq("actor", actorId);

  const { data, error } = await query;
  assertNoError(error, "smark_movements (range)");
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const partIds = uniq(rows.map((r) => r.part_id));
  const boxIds = uniq(rows.map((r) => r.big_box_id));
  const bomIds = uniq(rows.map((r) => r.bom_id));

  const [partsRes, boxesRes, bomsRes] = await Promise.all([
    partIds.length ? supabase.from(TABLES.parts).select("id, internal_pid").in("id", partIds) : Promise.resolve({ data: [], error: null }),
    boxIds.length ? supabase.from(TABLES.big_boxes).select("id, name, shelf_id").in("id", boxIds) : Promise.resolve({ data: [], error: null }),
    bomIds.length ? supabase.from(TABLES.boms).select("id, name").in("id", bomIds) : Promise.resolve({ data: [], error: null }),
  ]);
  assertNoError(partsRes.error, "smark_parts (movement PIDs)");
  assertNoError(boxesRes.error, "smark_big_boxes (movement boxes)");
  assertNoError(bomsRes.error, "smark_boms (movement boms)");

  const boxes = (boxesRes.data ?? []) as { id: string; name: string; shelf_id: string }[];
  const shelfIds = uniq(boxes.map((b) => b.shelf_id));
  const shelvesRes = shelfIds.length
    ? await supabase.from(TABLES.shelves).select("id, code").in("id", shelfIds)
    : { data: [] as { id: string; code: string }[], error: null };
  assertNoError(shelvesRes.error, "smark_shelves (movement boxes)");

  const pidById = new Map((partsRes.data ?? []).map((p: { id: string; internal_pid: string }) => [p.id, p.internal_pid]));
  const shelfCodeById = new Map((shelvesRes.data ?? []).map((s) => [s.id, s.code]));
  const boxLabelById = new Map(
    boxes.map((b) => [b.id, `${shelfCodeById.get(b.shelf_id) ?? "?"} · ${b.name}`]),
  );
  const bomNameById = new Map((bomsRes.data ?? []).map((b: { id: string; name: string }) => [b.id, b.name]));

  return rows.map((r) => ({
    id: r.id,
    occurredAt: r.created_at,
    actorId: r.actor,
    deltaQty: r.delta_qty,
    reason: r.reason as MovementReason,
    reasonDetail: r.reason_detail as MovementReasonDetail | null,
    pid: pidById.get(r.part_id) ?? "—",
    boxLabel: r.big_box_id ? (boxLabelById.get(r.big_box_id) ?? null) : null,
    bomName: r.bom_id ? (bomNameById.get(r.bom_id) ?? null) : null,
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Section 3 — Ordering activity today
 *
 * NOTE (notes-for-integrator): `v_daily_activity` [0005] has no "BOM
 * uploaded" branch in its `kind` union — FEATURES.md §5.13 / plan/tab-
 * daily-reports.md both expect BOM uploads in this section, so they're
 * supplemented here with a direct `smark_boms` query rather than via the
 * view. Distributor names / PO numbers / part labels also aren't carried by
 * the view's columns (only pre-baked into its `summary` text), so this
 * queries `smark_agent_runs` / `smark_cart_items` / `smark_orders` /
 * `smark_order_lines` directly instead of reading the view — same hand-join
 * approach as `getMovementsForRange` above, kept consistent rather than
 * mixing "read the view" and "read the tables" for the same section.
 * ──────────────────────────────────────────────────────────────────────────── */

async function partLabels(supabase: DB, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = uniq(ids);
  if (wanted.length === 0) return new Map();
  const { data, error } = await supabase.from(TABLES.parts).select("id, internal_pid").in("id", wanted);
  assertNoError(error, "smark_parts (ordering activity)");
  return new Map((data ?? []).map((p) => [p.id, p.internal_pid]));
}

export async function getOrderingActivityForRange(
  supabase: DB,
  bounds: IsoBounds,
  actorId: string | null,
): Promise<OrderingActivityItem[]> {
  const items: OrderingActivityItem[] = [];

  // ---- BOM uploads (missing from v_daily_activity — see header note) ------
  {
    let q = supabase
      .from(TABLES.boms)
      .select("id, name, uploaded_by, created_at, project_id")
      .gte("created_at", bounds.startIso)
      .lt("created_at", bounds.endIso);
    if (actorId) q = q.eq("uploaded_by", actorId);
    const { data, error } = await q;
    assertNoError(error, "smark_boms (uploads)");

    const projectIds = uniq((data ?? []).map((b) => b.project_id));
    const projectNameById = new Map<string, string>();
    if (projectIds.length > 0) {
      const { data: projects, error: pErr } = await supabase.from(TABLES.projects).select("id, name").in("id", projectIds);
      assertNoError(pErr, "smark_projects (bom upload names)");
      for (const p of projects ?? []) projectNameById.set(p.id, p.name);
    }

    for (const b of data ?? []) {
      const projectName = projectNameById.get(b.project_id);
      items.push({
        id: b.id,
        occurredAt: b.created_at,
        actorId: b.uploaded_by,
        kind: "bom_uploaded",
        label: `uploaded BOM "${b.name}"${projectName ? ` · ${projectName}` : ""}`,
      });
    }
  }

  // ---- Agent runs: started + finished ----------------------------------
  {
    let startedQ = supabase
      .from(TABLES.agent_runs)
      .select("id, bom_id, concurrency_preset, started_by, created_at")
      .gte("created_at", bounds.startIso)
      .lt("created_at", bounds.endIso);
    if (actorId) startedQ = startedQ.eq("started_by", actorId);

    let finishedQ = supabase
      .from(TABLES.agent_runs)
      .select("id, bom_id, status, actual_cost, started_by, updated_at, created_at")
      .in("status", ["done", "failed"])
      .gte("updated_at", bounds.startIso)
      .lt("updated_at", bounds.endIso);
    if (actorId) finishedQ = finishedQ.eq("started_by", actorId);

    const [startedRes, finishedRes] = await Promise.all([startedQ, finishedQ]);
    assertNoError(startedRes.error, "smark_agent_runs (started)");
    assertNoError(finishedRes.error, "smark_agent_runs (finished)");

    const bomIds = uniq([...(startedRes.data ?? []).map((r) => r.bom_id), ...(finishedRes.data ?? []).map((r) => r.bom_id)]);
    const bomNameById = new Map<string, string>();
    if (bomIds.length > 0) {
      const { data: boms, error: bomErr } = await supabase.from(TABLES.boms).select("id, name").in("id", bomIds);
      assertNoError(bomErr, "smark_boms (run names)");
      for (const b of boms ?? []) bomNameById.set(b.id, b.name);
    }

    for (const r of startedRes.data ?? []) {
      items.push({
        id: `${r.id}-started`,
        occurredAt: r.created_at,
        actorId: r.started_by,
        kind: "run_started",
        label: `started a run · ${r.concurrency_preset}${bomNameById.has(r.bom_id) ? ` · ${bomNameById.get(r.bom_id)}` : ""}`,
      });
    }
    for (const r of finishedRes.data ?? []) {
      const cost = r.actual_cost != null ? ` · ${formatINR(r.actual_cost)}` : "";
      items.push({
        id: `${r.id}-finished`,
        occurredAt: r.updated_at ?? r.created_at,
        actorId: r.started_by,
        kind: "run_finished",
        label: `run ${r.status}${cost}${bomNameById.has(r.bom_id) ? ` · ${bomNameById.get(r.bom_id)}` : ""}`,
      });
    }
  }

  // ---- Cart adds -----------------------------------------------------------
  {
    let q = supabase
      .from(TABLES.cart_items)
      .select("id, part_id, descriptor, qty_to_order, source, created_by, created_at")
      .gte("created_at", bounds.startIso)
      .lt("created_at", bounds.endIso);
    if (actorId) q = q.eq("created_by", actorId);
    const { data, error } = await q;
    assertNoError(error, "smark_cart_items (adds)");

    const pids = await partLabels(supabase, (data ?? []).map((c) => c.part_id).filter((id): id is string => id != null));

    for (const c of data ?? []) {
      const descriptor = c.descriptor as { mpn?: string | null; value?: string | null } | null;
      const label = c.part_id ? (pids.get(c.part_id) ?? "—") : (descriptor?.mpn ?? descriptor?.value ?? "item");
      items.push({
        id: c.id,
        occurredAt: c.created_at,
        actorId: c.created_by,
        kind: "cart_add",
        label: `added ${c.qty_to_order} × ${label} to cart (${c.source})`,
      });
    }
  }

  // ---- Orders placed ---------------------------------------------------
  {
    let q = supabase
      .from(TABLES.orders)
      .select("id, po_number, distributor_id, placed_by, placed_at")
      .gte("placed_at", bounds.startIso)
      .lt("placed_at", bounds.endIso);
    if (actorId) q = q.eq("placed_by", actorId);
    const { data, error } = await q;
    assertNoError(error, "smark_orders (placed)");

    const distributorIds = uniq((data ?? []).map((o) => o.distributor_id));
    const distNameById = new Map<string, string>();
    if (distributorIds.length > 0) {
      const { data: dists, error: distErr } = await supabase.from(TABLES.distributors).select("id, name").in("id", distributorIds);
      assertNoError(distErr, "smark_distributors (orders)");
      for (const d of dists ?? []) distNameById.set(d.id, d.name);
    }

    for (const o of data ?? []) {
      items.push({
        id: o.id,
        occurredAt: o.placed_at,
        actorId: o.placed_by,
        kind: "order_placed",
        label: `placed PO ${o.po_number}${distNameById.has(o.distributor_id) ? ` · ${distNameById.get(o.distributor_id)}` : ""}`,
      });
    }
  }

  // ---- Arrivals (order_lines carries no actor — dropped under self-scope
  // per lib/daily/compute.ts `filterActivityForActor`) ------------------
  {
    const { data, error } = await supabase
      .from(TABLES.order_lines)
      .select("id, part_id, order_id, arrived_qty, arrived_at")
      .not("arrived_at", "is", null)
      .gte("arrived_at", bounds.startIso)
      .lt("arrived_at", bounds.endIso);
    assertNoError(error, "smark_order_lines (arrivals)");

    const pids = await partLabels(supabase, (data ?? []).map((l) => l.part_id).filter((id): id is string => id != null));
    const orderIds = uniq((data ?? []).map((l) => l.order_id));
    const poById = new Map<string, string>();
    if (orderIds.length > 0) {
      const { data: orders, error: oErr } = await supabase.from(TABLES.orders).select("id, po_number").in("id", orderIds);
      assertNoError(oErr, "smark_orders (arrival PO)");
      for (const o of orders ?? []) poById.set(o.id, o.po_number);
    }

    for (const l of data ?? []) {
      const label = l.part_id ? (pids.get(l.part_id) ?? "—") : "—";
      items.push({
        id: l.id,
        occurredAt: l.arrived_at!,
        actorId: null,
        kind: "arrival",
        label: `arrived ${l.arrived_qty} × ${label}${poById.has(l.order_id) ? ` · PO ${poById.get(l.order_id)}` : ""}`,
      });
    }
  }

  // Arrivals carry no actor column (see the arrivals block above) — a
  // self-scoped viewer can never claim one as "theirs", so they're dropped
  // here rather than shown unattributed under someone else's day.
  return filterActivityForActor(items, actorId);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Section 4 — Expenses today (owner + accountant only — RLS already returns
 * zero rows for employee, but callers gate the section's very existence too)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ExpenseDailyRow {
  id: string;
  entryType: "expense" | "income";
  amount: number;
  category: string;
  vendor: string | null;
  note: string | null;
  entryDate: string;
  isDraft: boolean;
}

export async function getExpensesForRange(supabase: DB, from: string, to: string): Promise<ExpenseDailyRow[]> {
  const { data, error } = await supabase
    .from(TABLES.expenses)
    .select("id, entry_type, amount, category, vendor, note, entry_date, is_draft, deleted_at")
    .is("deleted_at", null)
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("entry_date", { ascending: false });
  assertNoError(error, "smark_expenses (range)");

  return (data ?? []).map((e) => ({
    id: e.id,
    entryType: e.entry_type as "expense" | "income",
    amount: e.amount,
    category: e.category,
    vendor: e.vendor,
    note: e.note,
    entryDate: e.entry_date,
    isDraft: e.is_draft,
  }));
}
