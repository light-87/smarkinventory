/**
 * lib/pm/dashboard.ts — owner-only read-only aggregates for the Project
 * Dashboard (`/project-dashboard`, area "project_dashboard" in
 * lib/auth/roles.ts). Additive module: nothing in lib/pm/queries.ts or
 * lib/pm/kpi.ts is modified, only imported and reused.
 *
 * Shape: one Supabase-hitting loader (`loadDashboardDataset`) fetches every
 * row the widgets need, filtered structurally by project/client/employee
 * (never by date range — those are structural facts: "which project/engineer
 * am I looking at"). Everything else is a pure `deriveX(dataset, ...)`
 * function operating on that in-memory dataset, mirroring lib/pm/kpi.ts's
 * "pure math, no Supabase" convention — date-range scoping (hours logged,
 * tasks completed in range, entries feed) happens in these pure functions,
 * never in the loader, so one dataset fetch serves every widget regardless of
 * which date range is currently selected.
 *
 * Per the task brief: date range scopes TIME-BASED metrics (hours logged,
 * tasks completed in range, time-log entries); structural facts (project
 * list, current assignees, current status, current progress %, current bug
 * counts, est-vs-actual overrun) stay current-state regardless of the date
 * range — documented per-function below.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BugStatus, Database, TaskStatus } from "@/types/db";
import { TABLES } from "@/types/db";
import { aggregateEmployeeKpi, effectiveness, efficiency, projectProgress, type TaskKpiScore } from "./kpi";
import { listEngineers, listProjects, type EngineerOption } from "./queries";

type DB = SupabaseClient<Database>;

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`[pm/dashboard] ${context}: ${error.message}`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Filters — combinable, read from the page's searchParams.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface DashboardFilters {
  /** `YYYY-MM-DD` inclusive, or `null` for no lower bound. */
  from: string | null;
  /** `YYYY-MM-DD` inclusive, or `null` for no upper bound. */
  to: string | null;
  client: string | null;
  projectId: string | null;
  employeeId: string | null;
}

export interface DashboardFilterOptions {
  projects: Array<{ id: string; name: string; client: string | null }>;
  clients: string[];
  engineers: EngineerOption[];
}

/** Dropdown option lists for the filter bar — projects/clients/engineers, unfiltered. */
export async function getDashboardFilterOptions(supabase: DB): Promise<DashboardFilterOptions> {
  const [projects, engineers] = await Promise.all([listProjects(supabase), listEngineers(supabase)]);
  const clients = Array.from(new Set(projects.map((p) => p.client).filter((c): c is string => !!c))).sort((a, b) =>
    a.localeCompare(b),
  );
  return {
    projects: projects.map((p) => ({ id: p.id, name: p.name, client: p.client })),
    clients,
    engineers,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Dataset — one fetch pass, structurally filtered.
 * ──────────────────────────────────────────────────────────────────────────── */

interface DatasetProject {
  id: string;
  name: string;
  client: string | null;
  archivedAt: string | null;
}

interface DatasetTask {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  doneAt: string | null;
}

interface DatasetAssignee {
  taskId: string;
  userId: string;
  estimatedHours: number;
}

interface DatasetBug {
  taskId: string;
  classification: "bug" | "change_request";
  status: BugStatus;
}

interface DatasetHold {
  taskId: string;
  startedAt: string;
  endedAt: string | null;
}

interface DatasetTimeLog {
  id: string;
  taskId: string;
  userId: string;
  workDate: string;
  hours: number;
  description: string;
}

export interface DashboardDataset {
  filters: DashboardFilters;
  projects: DatasetProject[];
  tasks: DatasetTask[];
  assignees: DatasetAssignee[];
  bugs: DatasetBug[];
  holds: DatasetHold[];
  timeLogs: DatasetTimeLog[];
  /** userId -> display name (falls back to username), for every active + inactive user referenced anywhere in the dataset. */
  userNames: Map<string, string>;
}

/**
 * True when `workDate` falls inside `[hold.startedAt, hold.endedAt ?? now]` at
 * calendar-date granularity — same convention documented in lib/pm/queries.ts
 * `dateFallsInHold` (same-day boundary counts as "inside").
 */
function dateFallsInHold(workDate: string, hold: DatasetHold): boolean {
  const startDate = hold.startedAt.slice(0, 10);
  const endDate = hold.endedAt ? hold.endedAt.slice(0, 10) : null;
  if (workDate < startDate) return false;
  if (endDate !== null && workDate > endDate) return false;
  return true;
}

/**
 * One fetch pass for every widget: projects narrowed by client/projectId,
 * their tasks (narrowed to an engineer's assignments when `employeeId` is
 * set — "drill into this engineer's work"), and every assignee/bug/hold/
 * time-log row for those tasks. Date range is NOT applied here — it's a
 * per-widget concern (see the `derive*` functions below).
 */
export async function loadDashboardDataset(supabase: DB, filters: DashboardFilters): Promise<DashboardDataset> {
  const { data: projectRows, error: projectError } = await supabase
    .from(TABLES.projects)
    .select("id, name, client, archived_at");
  assertNoError(projectError, "smark_projects");

  let projects: DatasetProject[] = (projectRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    client: p.client,
    archivedAt: p.archived_at,
  }));
  if (filters.projectId) projects = projects.filter((p) => p.id === filters.projectId);
  if (filters.client) projects = projects.filter((p) => p.client === filters.client);

  const projectIds = projects.map((p) => p.id);
  if (projectIds.length === 0) {
    return { filters, projects: [], tasks: [], assignees: [], bugs: [], holds: [], timeLogs: [], userNames: new Map() };
  }

  const { data: taskRows, error: taskError } = await supabase
    .from(TABLES.tasks)
    .select("id, project_id, title, status, created_at, done_at")
    .in("project_id", projectIds);
  assertNoError(taskError, "smark_tasks");

  let tasks: DatasetTask[] = (taskRows ?? []).map((t) => ({
    id: t.id,
    projectId: t.project_id,
    title: t.title,
    status: t.status as TaskStatus,
    createdAt: t.created_at,
    doneAt: t.done_at,
  }));

  const taskIds = tasks.map((t) => t.id);
  if (taskIds.length === 0) {
    return { filters, projects, tasks: [], assignees: [], bugs: [], holds: [], timeLogs: [], userNames: new Map() };
  }

  const [assigneeRes, bugRes, holdRes, timeLogRes, userRes] = await Promise.all([
    supabase.from(TABLES.task_assignees).select("task_id, user_id, estimated_hours").in("task_id", taskIds),
    supabase.from(TABLES.bugs).select("task_id, classification, status").in("task_id", taskIds),
    supabase.from(TABLES.task_holds).select("task_id, started_at, ended_at").in("task_id", taskIds),
    supabase.from(TABLES.time_logs).select("id, task_id, user_id, work_date, hours, description").in("task_id", taskIds),
    supabase.from(TABLES.app_users).select("id, username, display_name"),
  ]);
  assertNoError(assigneeRes.error, "smark_task_assignees");
  assertNoError(bugRes.error, "smark_bugs");
  assertNoError(holdRes.error, "smark_task_holds");
  assertNoError(timeLogRes.error, "smark_time_logs");
  assertNoError(userRes.error, "smark_app_users");

  let assignees: DatasetAssignee[] = (assigneeRes.data ?? []).map((a) => ({
    taskId: a.task_id,
    userId: a.user_id,
    estimatedHours: Number(a.estimated_hours),
  }));

  // Employee filter = drill into one engineer: keep only tasks they're assigned to,
  // and only that engineer's own assignee/time-log rows.
  if (filters.employeeId) {
    const employeeId = filters.employeeId;
    const assignedTaskIds = new Set(assignees.filter((a) => a.userId === employeeId).map((a) => a.taskId));
    tasks = tasks.filter((t) => assignedTaskIds.has(t.id));
    assignees = assignees.filter((a) => a.userId === employeeId);
  }

  const keptTaskIds = new Set(tasks.map((t) => t.id));
  const bugs: DatasetBug[] = (bugRes.data ?? [])
    .filter((b) => keptTaskIds.has(b.task_id))
    .map((b) => ({ taskId: b.task_id, classification: b.classification as "bug" | "change_request", status: b.status as BugStatus }));
  const holds: DatasetHold[] = (holdRes.data ?? [])
    .filter((h) => keptTaskIds.has(h.task_id))
    .map((h) => ({ taskId: h.task_id, startedAt: h.started_at, endedAt: h.ended_at }));
  let timeLogs: DatasetTimeLog[] = (timeLogRes.data ?? [])
    .filter((l) => keptTaskIds.has(l.task_id))
    .map((l) => ({ id: l.id, taskId: l.task_id, userId: l.user_id, workDate: l.work_date, hours: Number(l.hours), description: l.description }));
  if (filters.employeeId) timeLogs = timeLogs.filter((l) => l.userId === filters.employeeId);

  const userNames = new Map<string, string>((userRes.data ?? []).map((u) => [u.id, u.display_name ?? u.username]));

  return { filters, projects, tasks, assignees, bugs, holds, timeLogs, userNames };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shared pure helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/** Sum of `timeLogs` for one task, EXCLUDING hours whose work_date falls inside any of the task's hold windows (holds are task-wide, not per-user). */
function actualHoursExcludingHolds(dataset: DashboardDataset, taskId: string): number {
  const taskHolds = dataset.holds.filter((h) => h.taskId === taskId);
  return dataset.timeLogs
    .filter((l) => l.taskId === taskId)
    .filter((l) => !taskHolds.some((h) => dateFallsInHold(l.workDate, h)))
    .reduce((sum, l) => sum + l.hours, 0);
}

/** Sum of `timeLogs` for one (task, user) pair, excluding hold windows — mirrors lib/pm/queries.ts getLoggedHoursExcludingHolds. */
function actualHoursForAssignee(dataset: DashboardDataset, taskId: string, userId: string): number {
  const taskHolds = dataset.holds.filter((h) => h.taskId === taskId);
  return dataset.timeLogs
    .filter((l) => l.taskId === taskId && l.userId === userId)
    .filter((l) => !taskHolds.some((h) => dateFallsInHold(l.workDate, h)))
    .reduce((sum, l) => sum + l.hours, 0);
}

/** Confirmed-bug count for one task (classification='bug', status='confirmed') — feeds effectiveness(). */
function confirmedBugCountForTask(dataset: DashboardDataset, taskId: string): number {
  return dataset.bugs.filter((b) => b.taskId === taskId && b.classification === "bug" && b.status === "confirmed").length;
}

function inRange(date: string, from: string | null, to: string | null): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function displayName(dataset: DashboardDataset, userId: string): string {
  return dataset.userNames.get(userId) ?? "Unknown";
}

/**
 * Same 3-band cut points as lib/pm/kpi.ts `effectiveness()` (<5 / 5–10 / >10
 * confirmed bugs), expressed as a label instead of a 5/4/3 score — the task
 * brief asks for a bug-count distribution, not another effectiveness score.
 */
export type BugBand = "under5" | "5to10" | "over10";
export const BUG_BAND_LABELS: Record<BugBand, string> = { under5: "< 5 bugs", "5to10": "5–10 bugs", over10: "> 10 bugs" };

function bugBandFor(confirmedBugCount: number): BugBand {
  if (confirmedBugCount < 5) return "under5";
  if (confirmedBugCount <= 10) return "5to10";
  return "over10";
}

/* ────────────────────────────────────────────────────────────────────────────
 * Widget 1 — stat tiles
 * ──────────────────────────────────────────────────────────────────────────── */

export interface DashboardStatTiles {
  activeProjects: number;
  tasksOpen: number;
  tasksSubmitted: number;
  tasksDone: number;
  /** Time-based: sum of raw logged hours (not hold-excluded) with `work_date` inside the selected range. */
  hoursLoggedInRange: number;
  /** % of done, estimate-bearing tasks that were NOT overrun. `null` when there are no such tasks. Current-state (not date-scoped). */
  onTimeRate: number | null;
  /** Confirmed bug count across every task in the current structural filter scope. Current-state. */
  confirmedBugs: number;
  /** Average lib/pm/kpi.ts efficiency() across every done, estimate-bearing (task, assignee) pair in scope. Current-state (all-time), same convention as getEmployeeKpiRollup. */
  avgEfficiency: number | null;
  /** Average lib/pm/kpi.ts effectiveness() across every done (task, assignee) pair in scope. Current-state. */
  avgEffectiveness: number | null;
}

export function deriveStatTiles(dataset: DashboardDataset): DashboardStatTiles {
  const { filters } = dataset;
  const activeProjects = dataset.projects.filter((p) => p.archivedAt === null).length;

  const tasksOpen = dataset.tasks.filter((t) => t.status === "open").length;
  const tasksSubmitted = dataset.tasks.filter((t) => t.status === "submitted").length;
  const tasksDone = dataset.tasks.filter((t) => t.status === "done").length;

  const hoursLoggedInRange = dataset.timeLogs
    .filter((l) => inRange(l.workDate, filters.from, filters.to))
    .reduce((sum, l) => sum + l.hours, 0);

  const confirmedBugs = dataset.bugs.filter((b) => b.classification === "bug" && b.status === "confirmed").length;

  const doneTasks = dataset.tasks.filter((t) => t.status === "done");
  const scores: TaskKpiScore[] = [];
  let onTimeCount = 0;
  let overrunEligible = 0;
  for (const task of doneTasks) {
    const taskAssignees = dataset.assignees.filter((a) => a.taskId === task.id);
    const confirmedBugs2 = confirmedBugCountForTask(dataset, task.id);
    for (const a of taskAssignees) {
      const actual = actualHoursForAssignee(dataset, task.id, a.userId);
      scores.push({ efficiency: efficiency(a.estimatedHours, actual), effectiveness: effectiveness(confirmedBugs2) });
      if (a.estimatedHours > 0) {
        overrunEligible += 1;
        if (actual <= a.estimatedHours) onTimeCount += 1;
      }
    }
  }
  const aggregated = aggregateEmployeeKpi(scores);
  const onTimeRate = overrunEligible === 0 ? null : Math.round((100 * onTimeCount) / overrunEligible);

  return {
    activeProjects,
    tasksOpen,
    tasksSubmitted,
    tasksDone,
    hoursLoggedInRange,
    onTimeRate,
    confirmedBugs,
    avgEfficiency: aggregated.efficiencyAvg,
    avgEffectiveness: aggregated.effectivenessAvg,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Widget 2 — projects table (current-state; date range does not scope this)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface DashboardProjectRow {
  id: string;
  name: string;
  client: string | null;
  progressPct: number;
  estimatedHours: number;
  actualHours: number;
  tasksDone: number;
  tasksTotal: number;
  openBugs: number;
  assignees: string[];
  archived: boolean;
}

export function deriveProjectRows(dataset: DashboardDataset): DashboardProjectRow[] {
  return dataset.projects.map((p) => {
    const projectTasks = dataset.tasks.filter((t) => t.projectId === p.id);
    const taskIds = new Set(projectTasks.map((t) => t.id));
    const done = projectTasks.filter((t) => t.status === "done").length;

    const estimatedHours = dataset.assignees.filter((a) => taskIds.has(a.taskId)).reduce((sum, a) => sum + a.estimatedHours, 0);
    const actualHours = projectTasks.reduce((sum, t) => sum + actualHoursExcludingHolds(dataset, t.id), 0);
    const openBugs = dataset.bugs.filter((b) => taskIds.has(b.taskId) && b.status === "open").length;

    const assigneeIds = new Set(dataset.assignees.filter((a) => taskIds.has(a.taskId)).map((a) => a.userId));
    const assignees = Array.from(assigneeIds).map((id) => displayName(dataset, id));

    return {
      id: p.id,
      name: p.name,
      client: p.client,
      progressPct: projectProgress(projectTasks.length, done),
      estimatedHours,
      actualHours,
      tasksDone: done,
      tasksTotal: projectTasks.length,
      openBugs,
      assignees,
      archived: p.archivedAt !== null,
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Widget 3 — employee KPI panel
 * ──────────────────────────────────────────────────────────────────────────── */

export interface EmployeeKpiRow {
  userId: string;
  displayName: string;
  efficiencyAvg: number | null;
  effectivenessAvg: number | null;
  /** Time-based: raw hours logged with `work_date` inside the selected range. */
  hoursInRange: number;
  /** Current-state: count of this engineer's DONE task assignments. */
  tasksCompleted: number;
  /** Current-state: count of this engineer's non-done task assignments. */
  activeTasks: number;
}

export function deriveEmployeeKpiRows(dataset: DashboardDataset): EmployeeKpiRow[] {
  const { filters } = dataset;
  const userIds = Array.from(new Set(dataset.assignees.map((a) => a.userId)));

  return userIds
    .map((userId) => {
      const myAssignments = dataset.assignees.filter((a) => a.userId === userId);
      const taskById = new Map(dataset.tasks.map((t) => [t.id, t]));

      const scores: TaskKpiScore[] = [];
      let tasksCompleted = 0;
      let activeTasks = 0;
      for (const a of myAssignments) {
        const task = taskById.get(a.taskId);
        if (!task) continue;
        if (task.status === "done") {
          tasksCompleted += 1;
          const actual = actualHoursForAssignee(dataset, task.id, userId);
          scores.push({
            efficiency: efficiency(a.estimatedHours, actual),
            effectiveness: effectiveness(confirmedBugCountForTask(dataset, task.id)),
          });
        } else {
          activeTasks += 1;
        }
      }

      const hoursInRange = dataset.timeLogs
        .filter((l) => l.userId === userId && inRange(l.workDate, filters.from, filters.to))
        .reduce((sum, l) => sum + l.hours, 0);

      const aggregated = aggregateEmployeeKpi(scores);
      return {
        userId,
        displayName: displayName(dataset, userId),
        efficiencyAvg: aggregated.efficiencyAvg,
        effectivenessAvg: aggregated.effectivenessAvg,
        hoursInRange,
        tasksCompleted,
        activeTasks,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Widget 4 — hours breakdown (time-based: date range scopes this)
 * ──────────────────────────────────────────────────────────────────────────── */

export type HoursGroupBy = "project" | "employee" | "client";

export interface HoursBreakdownBucket {
  key: string;
  label: string;
  hours: number;
}

export function deriveHoursBreakdown(dataset: DashboardDataset, groupBy: HoursGroupBy): HoursBreakdownBucket[] {
  const { filters } = dataset;
  const logsInRange = dataset.timeLogs.filter((l) => inRange(l.workDate, filters.from, filters.to));
  const taskById = new Map(dataset.tasks.map((t) => [t.id, t]));
  const projectById = new Map(dataset.projects.map((p) => [p.id, p]));

  const buckets = new Map<string, { label: string; hours: number }>();
  for (const log of logsInRange) {
    const task = taskById.get(log.taskId);
    const project = task ? projectById.get(task.projectId) : undefined;

    let key: string;
    let label: string;
    if (groupBy === "employee") {
      key = log.userId;
      label = displayName(dataset, log.userId);
    } else if (groupBy === "client") {
      key = project?.client ?? "__none__";
      label = project?.client ?? "No client";
    } else {
      key = project?.id ?? "__none__";
      label = project?.name ?? "Unknown project";
    }

    const existing = buckets.get(key) ?? { label, hours: 0 };
    existing.hours += log.hours;
    buckets.set(key, existing);
  }

  return Array.from(buckets.entries())
    .map(([key, v]) => ({ key, label: v.label, hours: v.hours }))
    .sort((a, b) => b.hours - a.hours);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Widget 5 — task & bug distribution (current-state)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TaskStatusBucket {
  status: TaskStatus;
  count: number;
}

const TASK_STATUS_ORDER: TaskStatus[] = ["open", "awaiting_client_input", "submitted", "done"];

export function deriveTaskStatusDistribution(dataset: DashboardDataset): TaskStatusBucket[] {
  return TASK_STATUS_ORDER.map((status) => ({
    status,
    count: dataset.tasks.filter((t) => t.status === status).length,
  }));
}

export interface BugBandBucket {
  band: BugBand;
  label: string;
  count: number;
}

/** Buckets TASKS (not engineers) by their own confirmed-bug count into kpi.ts's <5/5–10/>10 bands. */
export function deriveBugBandDistribution(dataset: DashboardDataset): BugBandBucket[] {
  const counts: Record<BugBand, number> = { under5: 0, "5to10": 0, over10: 0 };
  for (const task of dataset.tasks) {
    const band = bugBandFor(confirmedBugCountForTask(dataset, task.id));
    counts[band] += 1;
  }
  return (Object.keys(counts) as BugBand[]).map((band) => ({ band, label: BUG_BAND_LABELS[band], count: counts[band] }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Widget 6 — entries feed (time-based: date range scopes this)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TimeLogEntryRow {
  id: string;
  workDate: string;
  hours: number;
  description: string;
  taskTitle: string;
  projectName: string;
  engineerName: string;
}

export interface TimeLogEntriesPage {
  rows: TimeLogEntryRow[];
  total: number;
}

export function deriveTimeLogEntries(dataset: DashboardDataset, page: number, pageSize: number): TimeLogEntriesPage {
  const { filters } = dataset;
  const taskById = new Map(dataset.tasks.map((t) => [t.id, t]));
  const projectById = new Map(dataset.projects.map((p) => [p.id, p]));

  const inRangeLogs = dataset.timeLogs
    .filter((l) => inRange(l.workDate, filters.from, filters.to))
    .sort((a, b) => (a.workDate < b.workDate ? 1 : a.workDate > b.workDate ? -1 : 0));

  const total = inRangeLogs.length;
  const start = Math.max(0, (page - 1) * pageSize);
  const rows = inRangeLogs.slice(start, start + pageSize).map((l) => {
    const task = taskById.get(l.taskId);
    const project = task ? projectById.get(task.projectId) : undefined;
    return {
      id: l.id,
      workDate: l.workDate,
      hours: l.hours,
      description: l.description,
      taskTitle: task?.title ?? "—",
      projectName: project?.name ?? "—",
      engineerName: displayName(dataset, l.userId),
    };
  });

  return { rows, total };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Widget 7 — est-vs-actual overruns (current-state; excludes hold windows)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface OverrunRow {
  taskId: string;
  title: string;
  projectName: string;
  estimatedHours: number;
  actualHours: number;
  overrunHours: number;
  assignees: string[];
}

export function deriveOverruns(dataset: DashboardDataset): OverrunRow[] {
  const projectById = new Map(dataset.projects.map((p) => [p.id, p]));
  const rows: OverrunRow[] = [];

  for (const task of dataset.tasks) {
    const taskAssignees = dataset.assignees.filter((a) => a.taskId === task.id);
    const estimatedHours = taskAssignees.reduce((sum, a) => sum + a.estimatedHours, 0);
    if (estimatedHours <= 0) continue; // no estimate — same "NA" convention as efficiency()

    const actualHours = actualHoursExcludingHolds(dataset, task.id);
    if (actualHours <= estimatedHours) continue;

    rows.push({
      taskId: task.id,
      title: task.title,
      projectName: projectById.get(task.projectId)?.name ?? "—",
      estimatedHours,
      actualHours,
      overrunHours: actualHours - estimatedHours,
      assignees: taskAssignees.map((a) => displayName(dataset, a.userId)),
    });
  }

  return rows.sort((a, b) => b.overrunHours - a.overrunHours);
}
