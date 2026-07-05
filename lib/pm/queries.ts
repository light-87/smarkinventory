/**
 * lib/pm/queries.ts — server-only data fetching for the Project-Management
 * module. Every function takes an already-created request Supabase client
 * (`lib/supabase/server.ts` `createClient()`) so it runs under the caller's
 * session + RLS — never the service-role client. Mirrors
 * lib/attendance/queries.ts.
 *
 * Actor-scoping ("employee sees only their own time logs", "only tasks
 * they're assigned to") is enforced HERE (query params), same one-
 * enforcement-point convention as lib/attendance/queries.ts's header — pair
 * with `dataScope(role, "projects")` from lib/auth/roles.ts at the call site.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BugStatus,
  ChangeRequestStatus,
  Database,
  ReportedSource,
  TaskSource,
  TaskStatus,
} from "@/types/db";
import { TABLES } from "@/types/db";
import { aggregateEmployeeKpi, effectiveness, efficiency, projectProgress, type TaskKpiScore } from "./kpi";

type DB = SupabaseClient<Database>;

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`[pm] ${context}: ${error.message}`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Projects
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PmProjectView {
  id: string;
  name: string;
  client: string | null;
  showTimeToClient: boolean;
  importedAt: string | null;
  archivedAt: string | null;
}

/** Every project (owner/employee/accountant all see the list per FEATURES §2 "projects" area) — includes Clockify-imported legacy projects. */
export async function listProjects(supabase: DB): Promise<PmProjectView[]> {
  const { data, error } = await supabase
    .from(TABLES.projects)
    .select("id, name, client, show_time_to_client, imported_at, archived_at")
    .order("created_at", { ascending: false });
  assertNoError(error, "smark_projects");

  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    client: p.client,
    showTimeToClient: p.show_time_to_client,
    importedAt: p.imported_at,
    archivedAt: p.archived_at,
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tasks + assignees
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TaskAssigneeView {
  userId: string;
  displayName: string | null;
  username: string;
  estimatedHours: number;
}

export interface TaskView {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  source: TaskSource;
  originChangeRequestId: string | null;
  submittedAt: string | null;
  doneAt: string | null;
  createdAt: string;
  assignees: TaskAssigneeView[];
}

async function attachAssignees(supabase: DB, taskIds: string[]): Promise<Map<string, TaskAssigneeView[]>> {
  const byTask = new Map<string, TaskAssigneeView[]>();
  if (taskIds.length === 0) return byTask;

  const { data, error } = await supabase
    .from(TABLES.task_assignees)
    .select("task_id, user_id, estimated_hours, smark_app_users(username, display_name)")
    .in("task_id", taskIds);
  assertNoError(error, "smark_task_assignees");

  for (const row of (data ?? []) as unknown as Array<{
    task_id: string;
    user_id: string;
    estimated_hours: number;
    smark_app_users: { username: string; display_name: string | null } | null;
  }>) {
    const list = byTask.get(row.task_id) ?? [];
    list.push({
      userId: row.user_id,
      displayName: row.smark_app_users?.display_name ?? null,
      username: row.smark_app_users?.username ?? "",
      estimatedHours: Number(row.estimated_hours),
    });
    byTask.set(row.task_id, list);
  }
  return byTask;
}

function toTaskView(row: {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  source: string;
  origin_change_request_id: string | null;
  submitted_at: string | null;
  done_at: string | null;
  created_at: string;
}, assigneesByTask: Map<string, TaskAssigneeView[]>): TaskView {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    source: row.source as TaskSource,
    originChangeRequestId: row.origin_change_request_id,
    submittedAt: row.submitted_at,
    doneAt: row.done_at,
    createdAt: row.created_at,
    assignees: assigneesByTask.get(row.id) ?? [],
  };
}

/** Every task of a project, newest first, with assignees embedded. */
export async function getProjectTasks(supabase: DB, projectId: string): Promise<TaskView[]> {
  const { data, error } = await supabase
    .from(TABLES.tasks)
    .select("id, project_id, title, description, status, source, origin_change_request_id, submitted_at, done_at, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  assertNoError(error, "smark_tasks (project)");

  const rows = data ?? [];
  const assigneesByTask = await attachAssignees(supabase, rows.map((r) => r.id));
  return rows.map((r) => toTaskView(r, assigneesByTask));
}

/** Project completion % (lib/pm/kpi.ts projectProgress — % of tasks with status='done'). */
export async function getProjectProgress(supabase: DB, projectId: string): Promise<number> {
  const { data, error } = await supabase.from(TABLES.tasks).select("status").eq("project_id", projectId);
  assertNoError(error, "smark_tasks (progress)");
  const rows = data ?? [];
  const done = rows.filter((r) => r.status === "done").length;
  return projectProgress(rows.length, done);
}

/** Tasks a given engineer is assigned to, across every project — "my tasks". */
export async function getMyTasks(supabase: DB, userId: string): Promise<TaskView[]> {
  const { data: assignRows, error: assignError } = await supabase
    .from(TABLES.task_assignees)
    .select("task_id")
    .eq("user_id", userId);
  assertNoError(assignError, "smark_task_assignees (my tasks)");
  const taskIds = Array.from(new Set((assignRows ?? []).map((r) => r.task_id)));
  if (taskIds.length === 0) return [];

  const { data, error } = await supabase
    .from(TABLES.tasks)
    .select("id, project_id, title, description, status, source, origin_change_request_id, submitted_at, done_at, created_at")
    .in("id", taskIds)
    .order("created_at", { ascending: false });
  assertNoError(error, "smark_tasks (my tasks)");

  const rows = data ?? [];
  const assigneesByTask = await attachAssignees(supabase, rows.map((r) => r.id));
  return rows.map((r) => toTaskView(r, assigneesByTask));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Time logs
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TimeLogView {
  id: string;
  taskId: string;
  userId: string;
  workDate: string;
  hours: number;
  description: string;
  createdAt: string;
}

export async function getTimeLogsForTask(supabase: DB, taskId: string): Promise<TimeLogView[]> {
  const { data, error } = await supabase
    .from(TABLES.time_logs)
    .select("id, task_id, user_id, work_date, hours, description, created_at")
    .eq("task_id", taskId)
    .order("work_date", { ascending: false });
  assertNoError(error, "smark_time_logs (task)");
  return (data ?? []).map((r) => ({
    id: r.id,
    taskId: r.task_id,
    userId: r.user_id,
    workDate: r.work_date,
    hours: Number(r.hours),
    description: r.description,
    createdAt: r.created_at,
  }));
}

export async function getTimeLogsForUser(supabase: DB, userId: string): Promise<TimeLogView[]> {
  const { data, error } = await supabase
    .from(TABLES.time_logs)
    .select("id, task_id, user_id, work_date, hours, description, created_at")
    .eq("user_id", userId)
    .order("work_date", { ascending: false });
  assertNoError(error, "smark_time_logs (user)");
  return (data ?? []).map((r) => ({
    id: r.id,
    taskId: r.task_id,
    userId: r.user_id,
    workDate: r.work_date,
    hours: Number(r.hours),
    description: r.description,
    createdAt: r.created_at,
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Bugs / change requests / holds
 * ──────────────────────────────────────────────────────────────────────────── */

export interface BugView {
  id: string;
  taskId: string;
  description: string;
  classification: "bug" | "change_request";
  status: BugStatus;
  reportedSource: ReportedSource;
  reportedBy: string | null;
  decidedBy: string | null;
  createdAt: string;
}

export async function getBugsForTask(supabase: DB, taskId: string): Promise<BugView[]> {
  const { data, error } = await supabase
    .from(TABLES.bugs)
    .select("id, task_id, description, classification, status, reported_source, reported_by, decided_by, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });
  assertNoError(error, "smark_bugs (task)");
  return (data ?? []).map((r) => ({
    id: r.id,
    taskId: r.task_id,
    description: r.description,
    classification: r.classification as "bug" | "change_request",
    status: r.status as BugStatus,
    reportedSource: r.reported_source as ReportedSource,
    reportedBy: r.reported_by,
    decidedBy: r.decided_by,
    createdAt: r.created_at,
  }));
}

/** Bugs across every task of a project (owner triage inbox). */
export async function getBugsForProject(supabase: DB, projectId: string): Promise<BugView[]> {
  const { data: taskRows, error: taskError } = await supabase.from(TABLES.tasks).select("id").eq("project_id", projectId);
  assertNoError(taskError, "smark_tasks (bugs by project)");
  const taskIds = (taskRows ?? []).map((r) => r.id);
  if (taskIds.length === 0) return [];

  const { data, error } = await supabase
    .from(TABLES.bugs)
    .select("id, task_id, description, classification, status, reported_source, reported_by, decided_by, created_at")
    .in("task_id", taskIds)
    .order("created_at", { ascending: false });
  assertNoError(error, "smark_bugs (project)");
  return (data ?? []).map((r) => ({
    id: r.id,
    taskId: r.task_id,
    description: r.description,
    classification: r.classification as "bug" | "change_request",
    status: r.status as BugStatus,
    reportedSource: r.reported_source as ReportedSource,
    reportedBy: r.reported_by,
    decidedBy: r.decided_by,
    createdAt: r.created_at,
  }));
}

export interface ChangeRequestView {
  id: string;
  projectId: string;
  description: string;
  status: ChangeRequestStatus;
  requestedSource: "client" | "owner";
  resultingTaskId: string | null;
  decidedBy: string | null;
  createdAt: string;
}

export async function getChangeRequests(
  supabase: DB,
  projectId: string,
  options: { status?: ChangeRequestStatus } = {},
): Promise<ChangeRequestView[]> {
  let query = supabase
    .from(TABLES.change_requests)
    .select("id, project_id, description, status, requested_source, resulting_task_id, decided_by, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (options.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  assertNoError(error, "smark_change_requests");
  return (data ?? []).map((r) => ({
    id: r.id,
    projectId: r.project_id,
    description: r.description,
    status: r.status as ChangeRequestStatus,
    requestedSource: r.requested_source as "client" | "owner",
    resultingTaskId: r.resulting_task_id,
    decidedBy: r.decided_by,
    createdAt: r.created_at,
  }));
}

export interface TaskHoldView {
  id: string;
  taskId: string;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  endedSource: "client" | "owner" | null;
}

export async function getHoldsForTask(supabase: DB, taskId: string): Promise<TaskHoldView[]> {
  const { data, error } = await supabase
    .from(TABLES.task_holds)
    .select("id, task_id, reason, started_at, ended_at, ended_source")
    .eq("task_id", taskId)
    .order("started_at", { ascending: false });
  assertNoError(error, "smark_task_holds");
  return (data ?? []).map((r) => ({
    id: r.id,
    taskId: r.task_id,
    reason: r.reason,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    endedSource: r.ended_source as "client" | "owner" | null,
  }));
}

export async function getOpenHold(supabase: DB, taskId: string): Promise<TaskHoldView | null> {
  const holds = await getHoldsForTask(supabase, taskId);
  return holds.find((h) => h.endedAt === null) ?? null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * KPI rollups
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * True when `workDate` falls inside `[hold.startedAt, hold.endedAt ?? now]`
 * (compared at calendar-date granularity — `smark_time_logs.work_date` is a
 * plain date, `smark_task_holds` timestamps are timestamptz). An
 * approximation documented here rather than hidden: a log dated the same day
 * a hold opened or closed counts as "inside" the hold.
 */
function dateFallsInHold(workDate: string, hold: TaskHoldView): boolean {
  const startDate = hold.startedAt.slice(0, 10);
  const endDate = hold.endedAt ? hold.endedAt.slice(0, 10) : null;
  if (workDate < startDate) return false;
  if (endDate !== null && workDate > endDate) return false;
  return true;
}

/** Logged hours for one (task, user) pair, EXCLUDING any log whose work_date falls inside one of the task's hold windows. */
export async function getLoggedHoursExcludingHolds(supabase: DB, taskId: string, userId: string): Promise<number> {
  const [logs, holds] = await Promise.all([getTimeLogsForTask(supabase, taskId), getHoldsForTask(supabase, taskId)]);
  return logs
    .filter((l) => l.userId === userId)
    .filter((l) => !holds.some((h) => dateFallsInHold(l.workDate, h)))
    .reduce((sum, l) => sum + l.hours, 0);
}

/** Confirmed-bug count (classification='bug', status='confirmed') for one task — feeds effectiveness(). */
export async function getConfirmedBugCount(supabase: DB, taskId: string): Promise<number> {
  const { count, error } = await supabase
    .from(TABLES.bugs)
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId)
    .eq("classification", "bug")
    .eq("status", "confirmed");
  assertNoError(error, "smark_bugs (confirmed count)");
  return count ?? 0;
}

/**
 * One engineer's aggregated KPI (lib/pm/kpi.ts aggregateEmployeeKpi) across
 * every DONE task they're assigned to. Per lib/pm/kpi.ts's contract:
 * efficiency uses the engineer's OWN estimated_hours vs their OWN logged
 * hours (excluding hold windows); effectiveness uses the confirmed-bug count
 * on the (shared) task.
 */
export async function getEmployeeKpiRollup(supabase: DB, userId: string) {
  const { data: assignRows, error } = await supabase
    .from(TABLES.task_assignees)
    .select("task_id, estimated_hours, smark_tasks(id, status)")
    .eq("user_id", userId);
  assertNoError(error, "smark_task_assignees (kpi rollup)");

  const doneAssignments = (assignRows ?? []).filter(
    (r) => (r as unknown as { smark_tasks: { status: string } | null }).smark_tasks?.status === "done",
  ) as unknown as Array<{ task_id: string; estimated_hours: number }>;

  const scores: TaskKpiScore[] = await Promise.all(
    doneAssignments.map(async (a) => {
      const [actualHours, confirmedBugs] = await Promise.all([
        getLoggedHoursExcludingHolds(supabase, a.task_id, userId),
        getConfirmedBugCount(supabase, a.task_id),
      ]);
      return {
        efficiency: efficiency(Number(a.estimated_hours), actualHours),
        effectiveness: effectiveness(confirmedBugs),
      };
    }),
  );

  return aggregateEmployeeKpi(scores);
}
