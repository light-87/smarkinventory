/**
 * lib/pm/types.ts — form/action input contracts for the (rebuilt)
 * Project-Management module. Every server action (lib/pm/actions.ts)
 * validates its payload against one of these zod schemas before touching the
 * DB — mirrors lib/attendance/types.ts / lib/projects/types.ts.
 *
 * This module is intentionally self-contained (no imports from lib/projects
 * or lib/attendance — those are other packages' surfaces, see docs/
 * OWNERSHIP.md); it only reuses the shared `types/db.ts` contracts and
 * `lib/auth/roles.ts`'s existing "projects" area.
 */

import { z } from "zod";
import { BugClassificationSchema, zDateOnly, zUuid } from "@/types/db";

/** One assignee + their OWN estimated hours for a task (owner sets this per engineer). */
export const TaskAssigneeInputSchema = z.object({
  userId: zUuid,
  estimatedHours: z.coerce.number().positive("Estimated hours must be greater than 0"),
});
export type TaskAssigneeInput = z.infer<typeof TaskAssigneeInputSchema>;

/** Owner creates a project (PM-module surface — sets `client` + the hours-visibility toggle). */
export const CreateProjectInputSchema = z.object({
  name: z.string().trim().min(1, "Project name is required"),
  client: z.string().trim().nullish(),
  notes: z.string().trim().nullish(),
  showTimeToClient: z.boolean().default(false),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

/** Owner edits a project's basic details (name + client). */
export const UpdateProjectInputSchema = z.object({
  projectId: zUuid,
  name: z.string().trim().min(1, "Project name is required"),
  client: z.string().trim().nullish(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;

/** Owner archives / restores a whole project (reversible soft-archive). */
export const SetProjectArchivedInputSchema = z.object({
  projectId: zUuid,
  archived: z.boolean(),
});
export type SetProjectArchivedInput = z.infer<typeof SetProjectArchivedInputSchema>;

/** Owner creates a task, optionally assigning engineers with their own estimated hours. */
export const CreateTaskInputSchema = z.object({
  projectId: zUuid,
  title: z.string().trim().min(1, "Task title is required"),
  description: z.string().trim().nullish(),
  assignees: z.array(TaskAssigneeInputSchema).default([]),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

/** Owner adds/updates one assignee's estimated hours on an existing task. */
export const AssignTaskInputSchema = z.object({
  taskId: zUuid,
  userId: zUuid,
  estimatedHours: z.coerce.number().positive("Estimated hours must be greater than 0"),
});
export type AssignTaskInput = z.infer<typeof AssignTaskInputSchema>;

export const RemoveAssigneeInputSchema = z.object({
  taskId: zUuid,
  userId: zUuid,
});
export type RemoveAssigneeInput = z.infer<typeof RemoveAssigneeInputSchema>;

/** Engineer logs time against a task — description is MANDATORY ("what I did"). */
export const LogTimeInputSchema = z.object({
  taskId: zUuid,
  workDate: zDateOnly,
  hours: z.coerce.number().positive("Hours must be greater than 0").max(24, "24 hours is the max for one day"),
  description: z.string().trim().min(1, "Please describe what you did"),
});
export type LogTimeInput = z.infer<typeof LogTimeInputSchema>;

/** Owner logs time on behalf of an engineer (correction / backfill). */
export const OwnerLogOnBehalfInputSchema = LogTimeInputSchema.extend({
  userId: zUuid,
});
export type OwnerLogOnBehalfInput = z.infer<typeof OwnerLogOnBehalfInputSchema>;

export const SubmitTaskInputSchema = z.object({
  taskId: zUuid,
});
export type SubmitTaskInput = z.infer<typeof SubmitTaskInputSchema>;

export const MarkTaskDoneInputSchema = z.object({
  taskId: zUuid,
});
export type MarkTaskDoneInput = z.infer<typeof MarkTaskDoneInputSchema>;

/** Owner or an assigned engineer reports a bug/issue against a task. */
export const ReportBugInputSchema = z.object({
  taskId: zUuid,
  description: z.string().trim().min(1, "Please describe the issue"),
  classification: BugClassificationSchema.default("bug"),
});
export type ReportBugInput = z.infer<typeof ReportBugInputSchema>;

/** Owner triages a bug: confirm (counts toward effectiveness), dismiss, or reclassify → spawns a change request. */
export const TriageBugInputSchema = z.object({
  bugId: zUuid,
  decision: z.enum(["confirm", "dismiss", "reclassify"]),
});
export type TriageBugInput = z.infer<typeof TriageBugInputSchema>;

/** Owner (or the client-portal RPC, out of scope here) files a change request. */
export const CreateChangeRequestInputSchema = z.object({
  projectId: zUuid,
  description: z.string().trim().min(1, "Please describe the requested change"),
});
export type CreateChangeRequestInput = z.infer<typeof CreateChangeRequestInputSchema>;

/** Owner accepts a change request — spawns a task (source='change_request'), assigns engineers + hours. */
export const AcceptChangeRequestInputSchema = z.object({
  changeRequestId: zUuid,
  title: z.string().trim().min(1, "Task title is required"),
  assignees: z.array(TaskAssigneeInputSchema).default([]),
});
export type AcceptChangeRequestInput = z.infer<typeof AcceptChangeRequestInputSchema>;

export const RejectChangeRequestInputSchema = z.object({
  changeRequestId: zUuid,
});
export type RejectChangeRequestInput = z.infer<typeof RejectChangeRequestInputSchema>;

/** Owner or the assigned engineer opens a hold ("awaiting client input") on a task. */
export const StartHoldInputSchema = z.object({
  taskId: zUuid,
  reason: z.string().trim().min(1).default("awaiting_client_input"),
});
export type StartHoldInput = z.infer<typeof StartHoldInputSchema>;

/** Owner marks input received — closes the task's open hold. */
export const EndHoldInputSchema = z.object({
  taskId: zUuid,
});
export type EndHoldInput = z.infer<typeof EndHoldInputSchema>;

export const SetShowTimeToClientInputSchema = z.object({
  projectId: zUuid,
  show: z.boolean(),
});
export type SetShowTimeToClientInput = z.infer<typeof SetShowTimeToClientInputSchema>;
