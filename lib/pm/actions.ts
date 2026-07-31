"use server";

/**
 * lib/pm/actions.ts — Server Actions for the Project-Management module.
 *
 * Thin wrappers: validate with zod (lib/pm/types.ts) FIRST, resolve the
 * caller's session + role via lib/pm/auth.ts (the per-request RLS-bound
 * client — never the service client), then delegate to lib/pm/core.ts.
 * Mirrors lib/attendance/actions.ts's shape.
 *
 * Every exported action runs its body inside `guardAction()` (lib/pm/
 * action-error.ts): validation failures and expired sessions come back as
 * `{ ok: false, error, code }` instead of throwing. A throw here rejects the
 * caller's transition and takes the whole page down with it — see that file's
 * header. Notification fan-out runs through `bestEffort()` for the same
 * reason: it happens after the row is written, so a failed bell must not
 * report the write as failed.
 */

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { TABLES } from "@/types/db";
import { isOwner } from "@/lib/auth/roles";
import { notifyBugReported, notifyChangeRequested, notifyClientInputProvided, notifyTaskAssigned } from "@/lib/notifications/fanout";
import { bestEffort, guardAction, type ActionErrorCode } from "./action-error";
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
  SetProjectArchivedInputSchema,
  SetShowTimeToClientInputSchema,
  StartHoldInputSchema,
  SubmitTaskInputSchema,
  TriageBugInputSchema,
  UpdateProjectInputSchema,
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
  type SetProjectArchivedInput,
  type SetShowTimeToClientInput,
  type StartHoldInput,
  type SubmitTaskInput,
  type TriageBugInput,
  type UpdateProjectInput,
} from "./types";

type ActionFailureResult = { ok: false; error: string; code?: ActionErrorCode };
type ActionResult = { ok: true } | ActionFailureResult;
type ActionResultWithId = { ok: true; id: string } | ActionFailureResult;

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
  return guardAction(async () => {
    const parsed = CreateProjectInputSchema.parse(input);
    const { supabase, actorId } = await requirePmOwner();
    const result = await core.createProject(supabase, actorId, parsed);
    if (result.ok) revalidatePath("/projects");
    return result;
  });
}

export async function setShowTimeToClientAction(input: SetShowTimeToClientInput): Promise<ActionResult> {
  return guardAction(async () => {
    const parsed = SetShowTimeToClientInputSchema.parse(input);
    const { supabase } = await requirePmOwner();
    const result = await core.setShowTimeToClient(supabase, parsed);
    if (result.ok) revalidateProject(parsed.projectId);
    return result;
  });
}

/** Owner edits a project's name + client label (Manage tab). */
export async function updateProjectAction(input: UpdateProjectInput): Promise<ActionResult> {
  return guardAction(async () => {
    const parsed = UpdateProjectInputSchema.parse(input);
    const { supabase } = await requirePmOwner();
    const result = await core.updateProject(supabase, parsed);
    if (result.ok) revalidateProject(parsed.projectId);
    return result;
  });
}

/** Owner archives / restores a whole project (reversible). Releases demand + suspends the portal. */
export async function setProjectArchivedAction(input: SetProjectArchivedInput): Promise<ActionResult> {
  return guardAction(async () => {
    const parsed = SetProjectArchivedInputSchema.parse(input);
    const { supabase } = await requirePmOwner();
    const result = await core.setProjectArchived(supabase, parsed);
    if (result.ok) {
      revalidateProject(parsed.projectId);
      revalidatePath("/projects", "layout");
    }
    return result;
  });
}

/**
 * Capability token for `/p/:share_token` — regenerate = revoke the old link.
 * Carried forward from the old `lib/projects/actions.ts`
 * `regenerateShareTokenAction` (same `randomBytes(18).toString("base64url")`
 * scheme) — `smark_projects.share_token` is unchanged by migration 0010.
 */
export async function regenerateShareTokenAction(
  projectId: string,
): Promise<{ ok: true; token: string } | ActionFailureResult> {
  return guardAction(async () => {
    const { supabase } = await requirePmOwner();
    const token = randomBytes(18).toString("base64url");

    const { data, error } = await supabase
      .from(TABLES.projects)
      .update({ share_token: token })
      .eq("id", projectId)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!data) return { ok: false as const, error: "Couldn't update this project — refresh and try again." };

    revalidateProject(projectId);
    return { ok: true as const, token };
  });
}

/**
 * Documents tab delete (owner or the uploader) — carried forward from the old
 * `lib/projects/documents-actions.ts` `deleteProjectDocumentAction` (same
 * "owner or uploader" rule, soft delete via `deleted_at`).
 */
export async function deleteProjectDocumentAction(projectId: string, documentId: string): Promise<ActionResult> {
  return guardAction(async () => {
    const { supabase, actorId, role } = await requirePmWriter();

    const { data: doc, error: fetchError } = await supabase
      .from(TABLES.project_documents)
      .select("id, uploaded_by")
      .eq("id", documentId)
      .maybeSingle();
    if (fetchError) return { ok: false as const, error: fetchError.message };
    if (!doc) return { ok: false as const, error: "Document not found." };
    if (role !== "owner" && doc.uploaded_by !== actorId) {
      return { ok: false as const, error: "Only the owner or the uploader can delete this document." };
    }

    const { error } = await supabase
      .from(TABLES.project_documents)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", documentId);
    if (error) return { ok: false as const, error: error.message };

    revalidatePath(`/projects/${projectId}/documents`);
    return { ok: true as const };
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tasks + assignees
 * ──────────────────────────────────────────────────────────────────────────── */

export async function createTaskAction(input: CreateTaskInput): Promise<ActionResultWithId> {
  return guardAction(async () => {
    const parsed = CreateTaskInputSchema.parse(input);
    const { supabase, actorId } = await requirePmOwner();
    const result = await core.createTask(supabase, actorId, parsed);
    if (result.ok) {
      revalidateProject(parsed.projectId);
      if (parsed.assignees.length > 0) {
        await bestEffort("notifyTaskAssigned (create task)", async () => {
          const { data: project } = await supabase.from(TABLES.projects).select("name").eq("id", parsed.projectId).maybeSingle();
          for (const assignee of parsed.assignees) {
            await notifyTaskAssigned(supabase, {
              projectId: parsed.projectId,
              projectName: project?.name ?? "",
              taskTitle: parsed.title,
              assigneeUserId: assignee.userId,
            });
          }
        });
      }
    }
    return result;
  });
}

export async function assignTaskAction(input: AssignTaskInput): Promise<ActionResult> {
  return guardAction(async () => {
    const parsed = AssignTaskInputSchema.parse(input);
    const { supabase, actorId } = await requirePmOwner();
    const projectId = await taskProjectId(supabase, parsed.taskId);
    const result = await core.assignTask(supabase, actorId, parsed);
    if (result.ok) revalidateProject(projectId);
    return result;
  });
}

export async function removeAssigneeAction(input: RemoveAssigneeInput): Promise<ActionResult> {
  return guardAction(async () => {
    const parsed = RemoveAssigneeInputSchema.parse(input);
    const { supabase } = await requirePmOwner();
    const projectId = await taskProjectId(supabase, parsed.taskId);
    const result = await core.removeAssignee(supabase, parsed);
    if (result.ok) revalidateProject(projectId);
    return result;
  });
}

export async function submitTaskAction(input: SubmitTaskInput): Promise<ActionResult> {
  return guardAction(async () => {
    const parsed = SubmitTaskInputSchema.parse(input);
    const { supabase } = await requirePmWriter();
    const projectId = await taskProjectId(supabase, parsed.taskId);
    const result = await core.submitTask(supabase, parsed.taskId);
    if (result.ok) revalidateProject(projectId);
    return result;
  });
}

export async function markTaskDoneAction(input: MarkTaskDoneInput): Promise<ActionResult> {
  return guardAction(async () => {
    const parsed = MarkTaskDoneInputSchema.parse(input);
    const { supabase } = await requirePmOwner();
    const projectId = await taskProjectId(supabase, parsed.taskId);
    const result = await core.markTaskDone(supabase, parsed.taskId);
    if (result.ok) revalidateProject(projectId);
    return result;
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Time logs — logTime BLOCKS while the task has an open hold.
 * ──────────────────────────────────────────────────────────────────────────── */

export async function logTimeAction(input: LogTimeInput): Promise<ActionResultWithId> {
  return guardAction(async () => {
    const parsed = LogTimeInputSchema.parse(input);
    const { supabase, actorId } = await requirePmWriter();

    if (await core.hasOpenHold(supabase, parsed.taskId)) {
      return { ok: false as const, error: "This task is awaiting client input — time logging is paused until it's resolved." };
    }

    const result = await core.logTime(supabase, actorId, parsed);
    if (result.ok) {
      const projectId = await taskProjectId(supabase, parsed.taskId);
      revalidateProject(projectId);
    }
    return result;
  });
}

export async function ownerLogOnBehalfAction(input: OwnerLogOnBehalfInput): Promise<ActionResultWithId> {
  return guardAction(async () => {
    const parsed = OwnerLogOnBehalfInputSchema.parse(input);
    const { supabase, actorId } = await requirePmOwner();

    if (await core.hasOpenHold(supabase, parsed.taskId)) {
      return { ok: false as const, error: "This task is awaiting client input — time logging is paused until it's resolved." };
    }

    const result = await core.ownerLogOnBehalf(supabase, actorId, parsed);
    if (result.ok) {
      const projectId = await taskProjectId(supabase, parsed.taskId);
      revalidateProject(projectId);
    }
    return result;
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Bugs
 * ──────────────────────────────────────────────────────────────────────────── */

export async function reportBugAction(input: ReportBugInput): Promise<ActionResultWithId> {
  return guardAction(async () => {
    const parsed = ReportBugInputSchema.parse(input);
    const { supabase, actorId, role } = await requirePmWriter();
    const reportedSource = isOwner(role) ? "owner" : "engineer";

    const result = await core.reportBug(supabase, actorId, parsed, reportedSource);
    if (result.ok) {
      const projectId = await taskProjectId(supabase, parsed.taskId);
      if (reportedSource === "engineer") {
        await bestEffort("notifyBugReported", async () => {
          const { data: task } = await supabase.from(TABLES.tasks).select("title").eq("id", parsed.taskId).maybeSingle();
          await notifyBugReported(supabase, { projectId, taskTitle: task?.title ?? "a task", description: parsed.description });
        });
      }
      revalidateProject(projectId);
    }
    return result;
  });
}

export async function triageBugAction(input: TriageBugInput): Promise<ActionResult> {
  return guardAction(async () => {
    const parsed = TriageBugInputSchema.parse(input);
    const { supabase, actorId } = await requirePmOwner();
    const result = await core.triageBug(supabase, actorId, parsed);
    if (!result.ok) return result;

    const projectId = await taskProjectId(supabase, result.taskId);
    revalidateProject(projectId);
    return { ok: true as const };
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Change requests
 * ──────────────────────────────────────────────────────────────────────────── */

export async function createChangeRequestAction(input: CreateChangeRequestInput): Promise<ActionResultWithId> {
  return guardAction(async () => {
    const parsed = CreateChangeRequestInputSchema.parse(input);
    const { supabase } = await requirePmOwner();
    const result = await core.createChangeRequest(supabase, parsed);
    if (result.ok) {
      await bestEffort("notifyChangeRequested", () =>
        notifyChangeRequested(supabase, { projectId: parsed.projectId, description: parsed.description }),
      );
      revalidateProject(parsed.projectId);
    }
    return result;
  });
}

export async function acceptChangeRequestAction(input: AcceptChangeRequestInput): Promise<ActionResultWithId> {
  return guardAction(async () => {
    const parsed = AcceptChangeRequestInputSchema.parse(input);
    const { supabase, actorId } = await requirePmOwner();
    const result = await core.acceptChangeRequest(supabase, actorId, parsed);
    if (!result.ok) return result;

    revalidateProject(result.projectId);
    if (parsed.assignees.length > 0) {
      await bestEffort("notifyTaskAssigned (accept change request)", async () => {
        const { data: project } = await supabase.from(TABLES.projects).select("name").eq("id", result.projectId).maybeSingle();
        for (const assignee of parsed.assignees) {
          await notifyTaskAssigned(supabase, {
            projectId: result.projectId,
            projectName: project?.name ?? "",
            taskTitle: parsed.title,
            assigneeUserId: assignee.userId,
          });
        }
      });
    }
    return { ok: true as const, id: result.taskId };
  });
}

export async function rejectChangeRequestAction(input: RejectChangeRequestInput): Promise<ActionResult> {
  return guardAction(async () => {
    const parsed = RejectChangeRequestInputSchema.parse(input);
    const { supabase, actorId } = await requirePmOwner();
    const { data: cr } = await supabase.from(TABLES.change_requests).select("project_id").eq("id", parsed.changeRequestId).maybeSingle();
    const result = await core.rejectChangeRequest(supabase, actorId, parsed);
    if (result.ok && cr) revalidateProject(cr.project_id as string);
    return result;
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Holds — "awaiting client input"
 * ──────────────────────────────────────────────────────────────────────────── */

export async function startHoldAction(input: StartHoldInput): Promise<ActionResultWithId> {
  return guardAction(async () => {
    const parsed = StartHoldInputSchema.parse(input);
    const { supabase, actorId } = await requirePmWriter();
    const result = await core.startHold(supabase, actorId, parsed);
    if (result.ok) {
      const projectId = await taskProjectId(supabase, parsed.taskId);
      revalidateProject(projectId);
    }
    return result;
  });
}

/** Owner marks input received — closes the hold and notifies the task's assignees. */
export async function endHoldAction(input: EndHoldInput): Promise<ActionResult> {
  return guardAction(async () => {
    const parsed = EndHoldInputSchema.parse(input);
    const { supabase, actorId } = await requirePmOwner();

    const projectId = await taskProjectId(supabase, parsed.taskId);
    const [tasks, holdsBefore] = await Promise.all([getProjectTasks(supabase, projectId), getHoldsForTask(supabase, parsed.taskId)]);
    const task = tasks.find((t) => t.id === parsed.taskId);
    const hadOpenHold = holdsBefore.some((h) => h.endedAt === null);

    const result = await core.endHold(supabase, actorId, parsed.taskId);
    if (!result.ok) return result;

    if (hadOpenHold && task && task.assignees.length > 0) {
      await bestEffort("notifyClientInputProvided", () =>
        notifyClientInputProvided(supabase, {
          projectId,
          taskTitle: task.title,
          assigneeUserIds: task.assignees.map((a) => a.userId),
        }),
      );
    }

    // (0012) Input's in — the client no longer needs chasing. Deactivate the
    // task's active reminder, if any, in the same action as the hold closing.
    await supabase.from(TABLES.task_reminders).update({ active: false }).eq("task_id", parsed.taskId).eq("active", true);

    revalidateProject(projectId);
    return { ok: true as const };
  });
}
