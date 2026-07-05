/**
 * lib/pm/core.ts — Project-Management module DB writes. Every exported
 * function takes an already-created `SupabaseClient<Database>` plus the
 * acting user's id, mirroring lib/attendance/core.ts, so lib/pm/actions.ts
 * ("use server") wraps these with the per-request RLS-bound client while
 * tests can call the same functions with a service-role client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";
import type {
  AcceptChangeRequestInput,
  AssignTaskInput,
  CreateChangeRequestInput,
  CreateProjectInput,
  CreateTaskInput,
  LogTimeInput,
  OwnerLogOnBehalfInput,
  RejectChangeRequestInput,
  RemoveAssigneeInput,
  ReportBugInput,
  SetShowTimeToClientInput,
  StartHoldInput,
  TriageBugInput,
} from "./types";

type DB = SupabaseClient<Database>;

type Result = { ok: true } | { ok: false; error: string };
type ResultWithId = { ok: true; id: string } | { ok: false; error: string };

/** Is there a currently-OPEN hold (`ended_at is null`) on this task? Time-logging is blocked while true. */
export async function hasOpenHold(supabase: DB, taskId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(TABLES.task_holds)
    .select("id")
    .eq("task_id", taskId)
    .is("ended_at", null)
    .limit(1);
  if (error) throw new Error(`[pm] hasOpenHold: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Owner creates a project (PM-module surface). */
export async function createProject(supabase: DB, actorId: string, input: CreateProjectInput): Promise<ResultWithId> {
  const { data, error } = await supabase
    .from(TABLES.projects)
    .insert({
      name: input.name,
      client: input.client?.trim() || null,
      notes: input.notes?.trim() || null,
      show_time_to_client: input.showTimeToClient,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

/** Owner creates a task, optionally assigning engineers with their own estimated hours in the same call. */
export async function createTask(supabase: DB, actorId: string, input: CreateTaskInput): Promise<ResultWithId> {
  const { data: task, error: taskError } = await supabase
    .from(TABLES.tasks)
    .insert({
      project_id: input.projectId,
      title: input.title,
      description: input.description ?? null,
      status: "open",
      source: "manual",
      created_by: actorId,
    })
    .select("id")
    .single();
  if (taskError) return { ok: false, error: taskError.message };
  const taskId = task.id as string;

  if (input.assignees.length > 0) {
    const { error: assignError } = await supabase.from(TABLES.task_assignees).insert(
      input.assignees.map((a) => ({
        task_id: taskId,
        user_id: a.userId,
        estimated_hours: a.estimatedHours,
        assigned_by: actorId,
      })),
    );
    if (assignError) return { ok: false, error: assignError.message };
  }

  return { ok: true, id: taskId };
}

/** Owner adds (or, on a duplicate (task,user), updates) one assignee's estimated hours. */
export async function assignTask(supabase: DB, actorId: string, input: AssignTaskInput): Promise<Result> {
  const { error } = await supabase
    .from(TABLES.task_assignees)
    .upsert(
      { task_id: input.taskId, user_id: input.userId, estimated_hours: input.estimatedHours, assigned_by: actorId },
      { onConflict: "task_id,user_id" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function removeAssignee(supabase: DB, input: RemoveAssigneeInput): Promise<Result> {
  const { error } = await supabase
    .from(TABLES.task_assignees)
    .delete()
    .eq("task_id", input.taskId)
    .eq("user_id", input.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Engineer logs time against their own assignment. Caller (actions.ts) MUST check `hasOpenHold` first. */
export async function logTime(supabase: DB, actorId: string, input: LogTimeInput): Promise<ResultWithId> {
  const { data, error } = await supabase
    .from(TABLES.time_logs)
    .insert({
      task_id: input.taskId,
      user_id: actorId,
      work_date: input.workDate,
      hours: input.hours,
      description: input.description,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

/** Owner logs time on behalf of an engineer (correction / backfill). Caller MUST check `hasOpenHold` first. */
export async function ownerLogOnBehalf(supabase: DB, actorId: string, input: OwnerLogOnBehalfInput): Promise<ResultWithId> {
  const { data, error } = await supabase
    .from(TABLES.time_logs)
    .insert({
      task_id: input.taskId,
      user_id: input.userId,
      work_date: input.workDate,
      hours: input.hours,
      description: input.description,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

/** Engineer (or owner) submits a task for review. */
export async function submitTask(supabase: DB, taskId: string): Promise<Result> {
  const { error } = await supabase
    .from(TABLES.tasks)
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Owner marks a task fully done. */
export async function markTaskDone(supabase: DB, taskId: string): Promise<Result> {
  const { error } = await supabase
    .from(TABLES.tasks)
    .update({ status: "done", done_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Owner or an assigned engineer reports a bug/issue against a task. */
export async function reportBug(
  supabase: DB,
  actorId: string,
  input: ReportBugInput,
  reportedSource: "owner" | "engineer",
): Promise<ResultWithId> {
  const { data, error } = await supabase
    .from(TABLES.bugs)
    .insert({
      task_id: input.taskId,
      description: input.description,
      classification: input.classification,
      status: "open",
      reported_source: reportedSource,
      reported_by: actorId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

export interface TriageBugResult {
  ok: true;
  taskId: string;
  /** Set only when `decision === "reclassify"` — the spawned change request. */
  changeRequestId: string | null;
}

/** Owner triage: confirm (counts toward effectiveness), dismiss, or reclassify (spawns a smark_change_requests row). */
export async function triageBug(
  supabase: DB,
  actorId: string,
  input: TriageBugInput,
): Promise<TriageBugResult | { ok: false; error: string }> {
  const { data: bug, error: fetchError } = await supabase
    .from(TABLES.bugs)
    .select("id, task_id, description")
    .eq("id", input.bugId)
    .single();
  if (fetchError) return { ok: false, error: fetchError.message };

  const { data: task, error: taskError } = await supabase
    .from(TABLES.tasks)
    .select("project_id")
    .eq("id", bug.task_id as string)
    .single();
  if (taskError) return { ok: false, error: taskError.message };

  if (input.decision === "confirm") {
    const { error } = await supabase
      .from(TABLES.bugs)
      .update({ status: "confirmed", decided_by: actorId })
      .eq("id", input.bugId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, taskId: bug.task_id as string, changeRequestId: null };
  }

  if (input.decision === "dismiss") {
    const { error } = await supabase
      .from(TABLES.bugs)
      .update({ status: "dismissed", decided_by: actorId })
      .eq("id", input.bugId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, taskId: bug.task_id as string, changeRequestId: null };
  }

  // reclassify → spawns a smark_change_requests row.
  const { error: bugUpdateError } = await supabase
    .from(TABLES.bugs)
    .update({ classification: "change_request", status: "resolved", decided_by: actorId })
    .eq("id", input.bugId);
  if (bugUpdateError) return { ok: false, error: bugUpdateError.message };

  const { data: cr, error: crError } = await supabase
    .from(TABLES.change_requests)
    .insert({
      project_id: task.project_id as string,
      description: bug.description as string,
      status: "pending",
      requested_source: "owner",
    })
    .select("id")
    .single();
  if (crError) return { ok: false, error: crError.message };

  return { ok: true, taskId: bug.task_id as string, changeRequestId: cr.id as string };
}

/** Owner (in-app) files a change request. */
export async function createChangeRequest(supabase: DB, input: CreateChangeRequestInput): Promise<ResultWithId> {
  const { data, error } = await supabase
    .from(TABLES.change_requests)
    .insert({
      project_id: input.projectId,
      description: input.description,
      status: "pending",
      requested_source: "owner",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

export interface AcceptChangeRequestResult {
  ok: true;
  taskId: string;
  projectId: string;
}

/** Owner accepts a pending change request: spawns a task (source='change_request'), assigns engineers, links both ways. */
export async function acceptChangeRequest(
  supabase: DB,
  actorId: string,
  input: AcceptChangeRequestInput,
): Promise<AcceptChangeRequestResult | { ok: false; error: string }> {
  const { data: cr, error: crFetchError } = await supabase
    .from(TABLES.change_requests)
    .select("id, project_id, description, status")
    .eq("id", input.changeRequestId)
    .single();
  if (crFetchError) return { ok: false, error: crFetchError.message };
  if (cr.status !== "pending") return { ok: false, error: "This change request has already been decided." };

  const { data: task, error: taskError } = await supabase
    .from(TABLES.tasks)
    .insert({
      project_id: cr.project_id as string,
      title: input.title,
      description: cr.description as string,
      status: "open",
      source: "change_request",
      origin_change_request_id: cr.id as string,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (taskError) return { ok: false, error: taskError.message };
  const taskId = task.id as string;

  if (input.assignees.length > 0) {
    const { error: assignError } = await supabase.from(TABLES.task_assignees).insert(
      input.assignees.map((a) => ({
        task_id: taskId,
        user_id: a.userId,
        estimated_hours: a.estimatedHours,
        assigned_by: actorId,
      })),
    );
    if (assignError) return { ok: false, error: assignError.message };
  }

  const { error: crUpdateError } = await supabase
    .from(TABLES.change_requests)
    .update({ status: "accepted", decided_by: actorId, resulting_task_id: taskId })
    .eq("id", input.changeRequestId);
  if (crUpdateError) return { ok: false, error: crUpdateError.message };

  return { ok: true, taskId, projectId: cr.project_id as string };
}

export async function rejectChangeRequest(supabase: DB, actorId: string, input: RejectChangeRequestInput): Promise<Result> {
  const { error } = await supabase
    .from(TABLES.change_requests)
    .update({ status: "rejected", decided_by: actorId })
    .eq("id", input.changeRequestId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Owner or the assigned engineer opens a hold; the task's status moves to `awaiting_client_input`. */
export async function startHold(supabase: DB, actorId: string, input: StartHoldInput): Promise<ResultWithId> {
  const { data, error } = await supabase
    .from(TABLES.task_holds)
    .insert({ task_id: input.taskId, reason: input.reason, started_by: actorId })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  const { error: taskUpdateError } = await supabase
    .from(TABLES.tasks)
    .update({ status: "awaiting_client_input" })
    .eq("id", input.taskId)
    .in("status", ["open"]);
  if (taskUpdateError) return { ok: false, error: taskUpdateError.message };

  return { ok: true, id: data.id as string };
}

export interface EndHoldResult {
  ok: true;
  holdId: string | null;
}

/** Owner marks input received — closes the task's open hold, reverting the task to `open`. */
export async function endHold(supabase: DB, actorId: string, taskId: string): Promise<EndHoldResult | { ok: false; error: string }> {
  const { data: hold, error: holdError } = await supabase
    .from(TABLES.task_holds)
    .update({ ended_at: new Date().toISOString(), ended_source: "owner", ended_by: actorId })
    .eq("task_id", taskId)
    .is("ended_at", null)
    .select("id")
    .maybeSingle();
  if (holdError) return { ok: false, error: holdError.message };

  const { error: taskUpdateError } = await supabase
    .from(TABLES.tasks)
    .update({ status: "open" })
    .eq("id", taskId)
    .eq("status", "awaiting_client_input");
  if (taskUpdateError) return { ok: false, error: taskUpdateError.message };

  return { ok: true, holdId: (hold?.id as string | undefined) ?? null };
}

export async function setShowTimeToClient(supabase: DB, input: SetShowTimeToClientInput): Promise<Result> {
  const { error } = await supabase
    .from(TABLES.projects)
    .update({ show_time_to_client: input.show })
    .eq("id", input.projectId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
