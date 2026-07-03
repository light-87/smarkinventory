/**
 * lib/projects/queries.ts — read queries for the Projects surface. Every
 * Server Component page in `app/(app)/projects/**` (this package's routes)
 * goes through these rather than inlining `.from(...)` calls, so the derived
 * status/joins logic lives in one place.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AgentRunStatus,
  BomSourcingStatus,
  Database,
  ExpenseRow,
  ProjectActivityRow,
  ProjectDocumentRow,
  ProjectMemberRow,
  ProjectPhaseRow,
  ProjectRow,
  ProjectStatus,
  TimeEntryRow,
} from "@/types/db";
import { TABLES } from "@/types/db";
import { deriveProjectStatus } from "./status";

type DB = SupabaseClient<Database>;

/* ────────────────────────────────────────────────────────────────────────────
 * Projects list — derived status + BOM count [R2-03]
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ProjectListItem extends ProjectRow {
  bomCount: number;
  status: ProjectStatus;
}

export async function listProjects(supabase: DB): Promise<ProjectListItem[]> {
  const { data: projects, error } = await supabase
    .from(TABLES.projects)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  if (!projects || projects.length === 0) return [];

  const { data: boms, error: bomsError } = await supabase
    .from(TABLES.boms)
    .select("project_id, sourcing_status, saved_run_id");
  if (bomsError) throw new Error(bomsError.message);
  const bomRows = boms ?? [];

  const runIds = Array.from(
    new Set(bomRows.map((b) => b.saved_run_id).filter((id): id is string => Boolean(id))),
  );

  let runsById = new Map<string, { status: AgentRunStatus }>();
  if (runIds.length > 0) {
    const { data: runs, error: runsError } = await supabase
      .from(TABLES.agent_runs)
      .select("id, status")
      .in("id", runIds);
    if (runsError) throw new Error(runsError.message);
    runsById = new Map((runs ?? []).map((r) => [r.id, { status: r.status as AgentRunStatus }]));
  }

  return projects.map((project) => {
    const projectBoms = bomRows.filter((b) => b.project_id === project.id) as {
      sourcing_status: BomSourcingStatus;
      saved_run_id: string | null;
    }[];
    const activeRuns = projectBoms
      .map((b) => (b.saved_run_id ? runsById.get(b.saved_run_id) : undefined))
      .filter((r): r is { status: AgentRunStatus } => Boolean(r));

    return {
      ...(project as ProjectRow),
      bomCount: projectBoms.length,
      status: deriveProjectStatus(projectBoms, activeRuns),
    };
  });
}

export async function getProject(supabase: DB, projectId: string): Promise<ProjectRow | null> {
  const { data, error } = await supabase.from(TABLES.projects).select("*").eq("id", projectId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ProjectRow) ?? null;
}

export interface ProjectDerivedStatus {
  status: ProjectStatus;
  bomCount: number;
}

/** Single-project version of `listProjects`' derived-status calc — for the hub Overview header. */
export async function getProjectDerivedStatus(supabase: DB, projectId: string): Promise<ProjectDerivedStatus> {
  const { data: boms, error } = await supabase
    .from(TABLES.boms)
    .select("sourcing_status, saved_run_id")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  const bomRows = (boms ?? []) as { sourcing_status: BomSourcingStatus; saved_run_id: string | null }[];

  const runIds = Array.from(new Set(bomRows.map((b) => b.saved_run_id).filter((id): id is string => Boolean(id))));
  let runs: { status: AgentRunStatus }[] = [];
  if (runIds.length > 0) {
    const { data: runRows, error: runsError } = await supabase
      .from(TABLES.agent_runs)
      .select("status")
      .in("id", runIds);
    if (runsError) throw new Error(runsError.message);
    runs = (runRows ?? []) as { status: AgentRunStatus }[];
  }

  return { status: deriveProjectStatus(bomRows, runs), bomCount: bomRows.length };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Phase timeline [R2-30]
 * ──────────────────────────────────────────────────────────────────────────── */

export async function getPhases(supabase: DB, projectId: string): Promise<ProjectPhaseRow[]> {
  const { data, error } = await supabase
    .from(TABLES.project_phases)
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectPhaseRow[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Team & hours [R2-04]
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AppUserOption {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
}

/** Every active login — feeds the owner's "add member" picker and task-assignee lists. */
export async function listActiveUsers(supabase: DB): Promise<AppUserOption[]> {
  const { data, error } = await supabase
    .from(TABLES.app_users)
    .select("id, username, display_name, role")
    .eq("active", true)
    .order("display_name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface ProjectMemberWithUser {
  membership: ProjectMemberRow;
  user: AppUserOption | null;
}

export async function getProjectMembers(supabase: DB, projectId: string): Promise<ProjectMemberWithUser[]> {
  const { data: members, error } = await supabase
    .from(TABLES.project_members)
    .select("*")
    .eq("project_id", projectId)
    .eq("active", true);
  if (error) throw new Error(error.message);
  const rows = (members ?? []) as ProjectMemberRow[];
  if (rows.length === 0) return [];

  const userIds = Array.from(new Set(rows.map((m) => m.user_id)));
  const { data: users, error: usersError } = await supabase
    .from(TABLES.app_users)
    .select("id, username, display_name, role")
    .in("id", userIds);
  if (usersError) throw new Error(usersError.message);
  const userById = new Map((users ?? []).map((u) => [u.id, u]));

  return rows.map((membership) => ({ membership, user: userById.get(membership.user_id) ?? null }));
}

export async function getProjectTimeEntries(supabase: DB, projectId: string): Promise<TimeEntryRow[]> {
  const { data, error } = await supabase
    .from(TABLES.time_entries)
    .select("*")
    .eq("project_id", projectId)
    .order("work_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as TimeEntryRow[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Documents [R2-16]
 * ──────────────────────────────────────────────────────────────────────────── */

export async function getProjectDocuments(supabase: DB, projectId: string): Promise<ProjectDocumentRow[]> {
  const { data, error } = await supabase
    .from(TABLES.project_documents)
    .select("*")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectDocumentRow[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Notes & tasks feed [R2-06]
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ActivityWithNames extends ProjectActivityRow {
  authorName: string | null;
  assigneeName: string | null;
}

export async function getProjectActivities(supabase: DB, projectId: string): Promise<ActivityWithNames[]> {
  const { data, error } = await supabase
    .from(TABLES.project_activities)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ProjectActivityRow[];
  if (rows.length === 0) return [];

  const ids = Array.from(
    new Set(rows.flatMap((r) => [r.created_by, r.task_assignee]).filter((id): id is string => Boolean(id))),
  );

  let userById = new Map<string, { username: string; display_name: string | null }>();
  if (ids.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from(TABLES.app_users)
      .select("id, username, display_name")
      .in("id", ids);
    if (usersError) throw new Error(usersError.message);
    userById = new Map((users ?? []).map((u) => [u.id, u]));
  }

  const nameFor = (id: string | null): string | null => {
    if (!id) return null;
    const u = userById.get(id);
    return u ? (u.display_name ?? u.username) : null;
  };

  return rows.map((r) => ({
    ...r,
    authorName: r.from_portal ? "Client portal" : nameFor(r.created_by),
    assigneeName: nameFor(r.task_assignee),
  }));
}

/** Open-task badge (section header + project card, R2-06). */
export async function getOpenTaskCount(supabase: DB, projectId: string): Promise<number> {
  const { count, error } = await supabase
    .from(TABLES.project_activities)
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("type", "task")
    .or("task_done.is.null,task_done.eq.false");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Payments strip [R2-15] — owner + accountant only (caller gates the UI;
 * RLS additionally hides these rows entirely from an employee session).
 * ──────────────────────────────────────────────────────────────────────────── */

export async function getProjectPayments(supabase: DB, projectId: string): Promise<ExpenseRow[]> {
  const { data, error } = await supabase
    .from(TABLES.expenses)
    .select("*")
    .eq("project_id", projectId)
    .eq("entry_type", "income")
    .is("deleted_at", null)
    .order("entry_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ExpenseRow[];
}
