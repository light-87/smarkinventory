"use server";

/**
 * lib/pm/actions.ts — Server Actions for the Project-Management module.
 *
 * Thin wrappers: validate with zod (lib/pm/types.ts) FIRST, resolve the
 * caller's session + role via lib/pm/auth.ts (the per-request RLS-bound
 * client — never the service client), then delegate to lib/pm/core.ts.
 * Mirrors lib/attendance/actions.ts's shape.
 */

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { TABLES } from "@/types/db";
import { isOwner } from "@/lib/auth/roles";
import { notifyBugReported, notifyChangeRequested, notifyClientInputProvided, notifyTaskAssigned } from "@/lib/notifications/fanout";
import { requirePmOwner, requirePmWriter } from "./auth";
import * as core from "./core";
import { getHoldsForTask, getProjectTasks } from "./queries";
import {
  AcceptChangeRequestInputSchema,
  AssignTaskInputSchema,
  CreateChangeRequestInputSchema,
  CreateProjectInputSchema,
  CreateTaskInputSchema,
  EndHoldInputSchema,
  LogTimeInputSchema,
  MarkTaskDoneInputSchema,
  OwnerLogOnBehalfInputSchema,
  RejectChangeRequestInputSchema,
  RemoveAssigneeInputSchema,
  ReportBugInputSchema,
  SetShowTimeToClientInputSchema,
  StartHoldInputSchema,
  SubmitTaskInputSchema,
  TriageBugInputSchema,
  type AcceptChangeRequestInput,
  type AssignTaskInput,
  type CreateChangeRequestInput,
  type CreateProjectInput,
  type CreateTaskInput,
  type EndHoldInput,
  type LogTimeInput,
  type MarkTaskDoneInput,
  type OwnerLogOnBehalfInput,
  type RejectChangeRequestInput,
  type RemoveAssigneeInput,
  type ReportBugInput,
  type SetShowTimeToClientInput,
  type StartHoldInput,
  type SubmitTaskInput,
  type TriageBugInput,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };
type ActionResultWithId = { ok: true; id: string } | { ok: false; error: string };

function revalidateProject(projectId: string): void {
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
}

async function taskProjectId(supabase: Awaited<ReturnType<typeof requirePmWriter>>["supabase"], taskId: string): Promise<string> {
  const { data, error } = await supabase.from(TABLES.tasks).select("project_id").eq("id", taskId).single();
  if (error || !data) throw new Error("Task not found.");
  return data.project_id as string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Projects
 * ──────────────────────────────────────────────────────────────────────────── */

export async function createProjectAction(input: CreateProjectInput): Promise<ActionResultWithId> {
  const parsed = CreateProjectInputSchema.parse(input);
  const { supabase, actorId } = await requirePmOwner();
  const result = await core.createProject(supabase, actorId, parsed);
  if (result.ok) revalidatePath("/projects");
  return result;
}

export async function setShowTimeToClientAction(input: SetShowTimeToClientInput): Promise<ActionResult> {
  const parsed = SetShowTimeToClientInputSchema.parse(input);
  const { supabase } = await requirePmOwner();
  const result = await core.setShowTimeToClient(supabase, parsed);
  if (result.ok) revalidateProject(parsed.projectId);
  return result;
}

/**
 * Capability token for `/p/:share_token` — regenerate = revoke the old link.
 * Carried forward from the old `lib/projects/actions.ts`
 * `regenerateShareTokenAction` (same `randomBytes(18).toString("base64url")`
 * scheme) — `smark_projects.share_token` is unchanged by migration 0010.
 */
export async function regenerateShareTokenAction(projectId: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const { supabase } = await requirePmOwner();
  const token = randomBytes(18).toString("base64url");

  const { error } = await supabase.from(TABLES.projects).update({ share_token: token }).eq("id", projectId);
  if (error) return { ok: false, error: error.message };

  revalidateProject(projectId);
  return { ok: true, token };
}

/**
 * Documents tab delete (owner or the uploader) — carried forward from the old
 * `lib/projects/documents-actions.ts` `deleteProjectDocumentAction` (same
 * "owner or uploader" rule, soft delete via `deleted_at`).
 */
export async function deleteProjectDocumentAction(projectId: string, documentId: string): Promise<ActionResult> {
  const { supabase, actorId, role } = await requirePmWriter();

  const { data: doc, error: fetchError } = await supabase
    .from(TABLES.project_documents)
    .select("id, uploaded_by")
    .eq("id", documentId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!doc) return { ok: false, error: "Document not found." };
  if (role !== "owner" && doc.uploaded_by !== actorId) {
    return { ok: false, error: "Only the owner or the uploader can delete this document." };
  }

  const { error } = await supabase
    .from(TABLES.project_documents)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projects/${projectId}/documents`);
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tasks + assignees
 * ──────────────────────────────────────────────────────────────────────────── */

export async function createTaskAction(input: CreateTaskInput): Promise<ActionResultWithId> {
  const parsed = CreateTaskInputSchema.parse(input);
  const { supabase, actorId } = await requirePmOwner();
  const result = await core.createTask(supabase, actorId, parsed);
  if (result.ok) {
    revalidateProject(parsed.projectId);
    if (parsed.assignees.length > 0) {
      const { data: project } = await supabase.from(TABLES.projects).select("name").eq("id", parsed.projectId).maybeSingle();
      for (const assignee of parsed.assignees) {
        await notifyTaskAssigned(supabase, {
          projectId: parsed.projectId,
          projectName: project?.name ?? "",
          taskTitle: parsed.title,
          assigneeUserId: assignee.userId,
        });
      }
    }
  }
  return result;
}

export async function assignTaskAction(input: AssignTaskInput): Promise<ActionResult> {
  const parsed = AssignTaskInputSchema.parse(input);
  const { supabase, actorId } = await requirePmOwner();
  const projectId = await taskProjectId(supabase, parsed.taskId);
  const result = await core.assignTask(supabase, actorId, parsed);
  if (result.ok) revalidateProject(projectId);
  return result;
}

export async function removeAssigneeAction(input: RemoveAssigneeInput): Promise<ActionResult> {
  const parsed = RemoveAssigneeInputSchema.parse(input);
  const { supabase } = await requirePmOwner();
  const projectId = await taskProjectId(supabase, parsed.taskId);
  const result = await core.removeAssignee(supabase, parsed);
  if (result.ok) revalidateProject(projectId);
  return result;
}

export async function submitTaskAction(input: SubmitTaskInput): Promise<ActionResult> {
  const parsed = SubmitTaskInputSchema.parse(input);
  const { supabase } = await requirePmWriter();
  const projectId = await taskProjectId(supabase, parsed.taskId);
  const result = await core.submitTask(supabase, parsed.taskId);
  if (result.ok) revalidateProject(projectId);
  return result;
}

export async function markTaskDoneAction(input: MarkTaskDoneInput): Promise<ActionResult> {
  const parsed = MarkTaskDoneInputSchema.parse(input);
  const { supabase } = await requirePmOwner();
  const projectId = await taskProjectId(supabase, parsed.taskId);
  const result = await core.markTaskDone(supabase, parsed.taskId);
  if (result.ok) revalidateProject(projectId);
  return result;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Time logs — logTime BLOCKS while the task has an open hold.
 * ──────────────────────────────────────────────────────────────────────────── */

export async function logTimeAction(input: LogTimeInput): Promise<ActionResultWithId> {
  const parsed = LogTimeInputSchema.parse(input);
  const { supabase, actorId } = await requirePmWriter();

  if (await core.hasOpenHold(supabase, parsed.taskId)) {
    return { ok: false, error: "This task is awaiting client input — time logging is paused until it's resolved." };
  }

  const result = await core.logTime(supabase, actorId, parsed);
  if (result.ok) {
    const projectId = await taskProjectId(supabase, parsed.taskId);
    revalidateProject(projectId);
  }
  return result;
}

export async function ownerLogOnBehalfAction(input: OwnerLogOnBehalfInput): Promise<ActionResultWithId> {
  const parsed = OwnerLogOnBehalfInputSchema.parse(input);
  const { supabase, actorId } = await requirePmOwner();

  if (await core.hasOpenHold(supabase, parsed.taskId)) {
    return { ok: false, error: "This task is awaiting client input — time logging is paused until it's resolved." };
  }

  const result = await core.ownerLogOnBehalf(supabase, actorId, parsed);
  if (result.ok) {
    const projectId = await taskProjectId(supabase, parsed.taskId);
    revalidateProject(projectId);
  }
  return result;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Bugs
 * ──────────────────────────────────────────────────────────────────────────── */

export async function reportBugAction(input: ReportBugInput): Promise<ActionResultWithId> {
  const parsed = ReportBugInputSchema.parse(input);
  const { supabase, actorId, role } = await requirePmWriter();
  const reportedSource = isOwner(role) ? "owner" : "engineer";

  const result = await core.reportBug(supabase, actorId, parsed, reportedSource);
  if (result.ok) {
    const projectId = await taskProjectId(supabase, parsed.taskId);
    const { data: task } = await supabase.from(TABLES.tasks).select("title").eq("id", parsed.taskId).maybeSingle();
    if (reportedSource === "engineer") {
      await notifyBugReported(supabase, { projectId, taskTitle: task?.title ?? "a task", description: parsed.description });
    }
    revalidateProject(projectId);
  }
  return result;
}

export async function triageBugAction(input: TriageBugInput): Promise<ActionResult> {
  const parsed = TriageBugInputSchema.parse(input);
  const { supabase, actorId } = await requirePmOwner();
  const result = await core.triageBug(supabase, actorId, parsed);
  if (!result.ok) return result;

  const projectId = await taskProjectId(supabase, result.taskId);
  revalidateProject(projectId);
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Change requests
 * ──────────────────────────────────────────────────────────────────────────── */

export async function createChangeRequestAction(input: CreateChangeRequestInput): Promise<ActionResultWithId> {
  const parsed = CreateChangeRequestInputSchema.parse(input);
  const { supabase } = await requirePmOwner();
  const result = await core.createChangeRequest(supabase, parsed);
  if (result.ok) {
    await notifyChangeRequested(supabase, { projectId: parsed.projectId, description: parsed.description });
    revalidateProject(parsed.projectId);
  }
  return result;
}

export async function acceptChangeRequestAction(input: AcceptChangeRequestInput): Promise<ActionResultWithId> {
  const parsed = AcceptChangeRequestInputSchema.parse(input);
  const { supabase, actorId } = await requirePmOwner();
  const result = await core.acceptChangeRequest(supabase, actorId, parsed);
  if (!result.ok) return result;

  revalidateProject(result.projectId);
  if (parsed.assignees.length > 0) {
    const { data: project } = await supabase.from(TABLES.projects).select("name").eq("id", result.projectId).maybeSingle();
    for (const assignee of parsed.assignees) {
      await notifyTaskAssigned(supabase, {
        projectId: result.projectId,
        projectName: project?.name ?? "",
        taskTitle: parsed.title,
        assigneeUserId: assignee.userId,
      });
    }
  }
  return { ok: true, id: result.taskId };
}

export async function rejectChangeRequestAction(input: RejectChangeRequestInput): Promise<ActionResult> {
  const parsed = RejectChangeRequestInputSchema.parse(input);
  const { supabase, actorId } = await requirePmOwner();
  const { data: cr } = await supabase.from(TABLES.change_requests).select("project_id").eq("id", parsed.changeRequestId).maybeSingle();
  const result = await core.rejectChangeRequest(supabase, actorId, parsed);
  if (result.ok && cr) revalidateProject(cr.project_id as string);
  return result;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Holds — "awaiting client input"
 * ──────────────────────────────────────────────────────────────────────────── */

export async function startHoldAction(input: StartHoldInput): Promise<ActionResultWithId> {
  const parsed = StartHoldInputSchema.parse(input);
  const { supabase, actorId } = await requirePmWriter();
  const result = await core.startHold(supabase, actorId, parsed);
  if (result.ok) {
    const projectId = await taskProjectId(supabase, parsed.taskId);
    revalidateProject(projectId);
  }
  return result;
}

/** Owner marks input received — closes the hold and notifies the task's assignees. */
export async function endHoldAction(input: EndHoldInput): Promise<ActionResult> {
  const parsed = EndHoldInputSchema.parse(input);
  const { supabase, actorId } = await requirePmOwner();

  const projectId = await taskProjectId(supabase, parsed.taskId);
  const [tasks, holdsBefore] = await Promise.all([getProjectTasks(supabase, projectId), getHoldsForTask(supabase, parsed.taskId)]);
  const task = tasks.find((t) => t.id === parsed.taskId);
  const hadOpenHold = holdsBefore.some((h) => h.endedAt === null);

  const result = await core.endHold(supabase, actorId, parsed.taskId);
  if (!result.ok) return result;

  if (hadOpenHold && task && task.assignees.length > 0) {
    await notifyClientInputProvided(supabase, {
      projectId,
      taskTitle: task.title,
      assigneeUserIds: task.assignees.map((a) => a.userId),
    });
  }
  revalidateProject(projectId);
  return { ok: true };
}
