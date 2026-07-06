"use server";

/**
 * lib/reminders/actions.ts — Server Actions for the client-reminder feature
 * (migration 0012). Same thin-wrapper shape as lib/pm/actions.ts: validate
 * with zod (lib/reminders/types.ts) FIRST, resolve the caller via
 * lib/pm/auth.ts's `requirePmOwner()` (0012's RLS is owner-only — reminders
 * are an owner tool, not part of the "projects" area read/write matrix), then
 * read/write directly (no separate core.ts — the logic here is small enough
 * not to warrant lib/pm/core.ts's split).
 *
 * First-send vs recurrence: `composeAndSendReminderAction` sends the email
 * immediately AND upserts the task's one active `smark_task_reminders` row
 * (update in place if one already exists, per 0012's header — never a second
 * active row for the same task). Recurrence after that is entirely
 * app/api/cron/client-reminders — this file never resends on its own.
 */

import { revalidatePath } from "next/cache";
import { TABLES } from "@/types/db";
import { sendEmail } from "@/lib/email";
import { getPortalUrl } from "@/lib/url";
import { requirePmOwner } from "@/lib/pm/auth";
import { getActiveReminderForTask } from "./queries";
import { firstNextSendAt, addDays } from "./schedule";
import {
  CancelReminderInputSchema,
  ComposeAndSendReminderInputSchema,
  SetProjectClientEmailInputSchema,
  UpdateReminderFrequencyInputSchema,
  type CancelReminderInput,
  type ComposeAndSendReminderInput,
  type SetProjectClientEmailInput,
  type UpdateReminderFrequencyInput,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };
/** `warning` carries a non-fatal problem (e.g. the email failed to send) that still left state saved. */
type SendResult = { ok: true; warning?: string } | { ok: false; error: string };

function revalidateProject(projectId: string): void {
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
}

/** Owner sets/updates the client's email on a project — the only email address on file for them (0012). */
export async function setProjectClientEmailAction(input: SetProjectClientEmailInput): Promise<ActionResult> {
  const parsed = SetProjectClientEmailInputSchema.parse(input);
  const { supabase } = await requirePmOwner();

  const { error } = await supabase.from(TABLES.projects).update({ client_email: parsed.clientEmail }).eq("id", parsed.projectId);
  if (error) return { ok: false, error: error.message };

  revalidateProject(parsed.projectId);
  return { ok: true };
}

/**
 * Owner composes + sends a client reminder for a task that's on hold. Looks
 * up the task's project; if it has no `client_email` yet, fails clearly
 * rather than silently proceeding (the owner needs to add one first — see
 * setProjectClientEmailAction / the inline field in task-card.tsx).
 *
 * Sends the email now (not deferred to cron), always including the portal
 * link when the project has a share token. A Resend failure never throws —
 * the reminder row is upserted regardless, so the schedule is tracked and the
 * cron route will retry it on its next run; the failure comes back as a
 * `warning`, not a hard `error`, since the state was still saved.
 */
export async function composeAndSendReminderAction(input: ComposeAndSendReminderInput): Promise<SendResult> {
  const parsed = ComposeAndSendReminderInputSchema.parse(input);
  const { supabase, actorId } = await requirePmOwner();

  const { data: task, error: taskError } = await supabase
    .from(TABLES.tasks)
    .select("id, project_id, title")
    .eq("id", parsed.taskId)
    .maybeSingle();
  if (taskError) return { ok: false, error: taskError.message };
  if (!task) return { ok: false, error: "Task not found." };

  const { data: project, error: projectError } = await supabase
    .from(TABLES.projects)
    .select("id, name, client_email, share_token")
    .eq("id", task.project_id)
    .maybeSingle();
  if (projectError) return { ok: false, error: projectError.message };
  if (!project) return { ok: false, error: "Project not found." };
  if (!project.client_email) {
    return { ok: false, error: "This project has no client email on file yet — add one before sending a reminder." };
  }

  const portalUrl = project.share_token ? getPortalUrl(project.share_token) : null;
  const bodyWithLink = portalUrl ? `${parsed.body}\n\nYou can review and respond here: ${portalUrl}` : parsed.body;
  const htmlWithLink = portalUrl
    ? `<p>${escapeHtml(parsed.body).replace(/\n/g, "<br/>")}</p><p><a href="${portalUrl}">${portalUrl}</a></p>`
    : `<p>${escapeHtml(parsed.body).replace(/\n/g, "<br/>")}</p>`;

  const sendResult = await sendEmail({
    to: project.client_email,
    subject: parsed.subject,
    html: htmlWithLink,
    text: bodyWithLink,
  });

  const now = new Date();
  const existing = await getActiveReminderForTask(supabase, parsed.taskId);
  const nextSendAt = firstNextSendAt(now, parsed.frequencyDays);

  const row = {
    task_id: parsed.taskId,
    subject: parsed.subject,
    body: parsed.body,
    frequency_days: parsed.frequencyDays,
    last_sent_at: now.toISOString(),
    next_send_at: nextSendAt,
    active: true,
  };

  const { error: upsertError } = existing
    ? await supabase.from(TABLES.task_reminders).update(row).eq("id", existing.id)
    : await supabase.from(TABLES.task_reminders).insert({ ...row, created_by: actorId });

  if (upsertError) return { ok: false, error: `Email ${sendResult.ok ? "sent" : "failed"}, but saving the reminder failed: ${upsertError.message}` };

  revalidateProject(task.project_id);

  if (!sendResult.ok) {
    return { ok: true, warning: `Reminder saved, but the email didn't go out: ${sendResult.error}` };
  }
  return { ok: true };
}

async function reminderTaskAndProject(
  supabase: Awaited<ReturnType<typeof requirePmOwner>>["supabase"],
  reminderId: string,
): Promise<{ ok: true; taskId: string; projectId: string } | { ok: false; error: string }> {
  const { data: reminder, error } = await supabase.from(TABLES.task_reminders).select("task_id").eq("id", reminderId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!reminder) return { ok: false, error: "Reminder not found." };

  const { data: task, error: taskError } = await supabase.from(TABLES.tasks).select("project_id").eq("id", reminder.task_id).maybeSingle();
  if (taskError) return { ok: false, error: taskError.message };
  if (!task) return { ok: false, error: "Task not found." };

  return { ok: true, taskId: reminder.task_id, projectId: task.project_id };
}

/** Owner cancels a reminder — sets `active=false`, no more resends from the cron route. */
export async function cancelReminderAction(input: CancelReminderInput): Promise<ActionResult> {
  const parsed = CancelReminderInputSchema.parse(input);
  const { supabase } = await requirePmOwner();

  const lookup = await reminderTaskAndProject(supabase, parsed.reminderId);
  if (!lookup.ok) return lookup;

  const { error } = await supabase.from(TABLES.task_reminders).update({ active: false }).eq("id", parsed.reminderId);
  if (error) return { ok: false, error: error.message };

  revalidateProject(lookup.projectId);
  return { ok: true };
}

/**
 * Owner changes an active reminder's frequency. Re-anchors `next_send_at` off
 * `last_sent_at` (if the reminder has already sent once) so the new cadence
 * takes effect from the last actual send, not from `now` — consistent with
 * the cron route's own drift-avoidance rule (lib/reminders/schedule.ts).
 */
export async function updateReminderFrequencyAction(input: UpdateReminderFrequencyInput): Promise<ActionResult> {
  const parsed = UpdateReminderFrequencyInputSchema.parse(input);
  const { supabase } = await requirePmOwner();

  const lookup = await reminderTaskAndProject(supabase, parsed.reminderId);
  if (!lookup.ok) return lookup;

  const { data: reminder, error: fetchError } = await supabase
    .from(TABLES.task_reminders)
    .select("last_sent_at")
    .eq("id", parsed.reminderId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!reminder) return { ok: false, error: "Reminder not found." };

  const nextSendAt = reminder.last_sent_at ? addDays(reminder.last_sent_at, parsed.frequencyDays) : firstNextSendAt(new Date(), parsed.frequencyDays);

  const { error } = await supabase
    .from(TABLES.task_reminders)
    .update({ frequency_days: parsed.frequencyDays, next_send_at: nextSendAt })
    .eq("id", parsed.reminderId);
  if (error) return { ok: false, error: error.message };

  revalidateProject(lookup.projectId);
  return { ok: true };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
