/**
 * lib/reminders/types.ts — form/action input contracts for the client-reminder
 * feature (migration 0012). Mirrors lib/pm/types.ts's shape: every server
 * action in lib/reminders/actions.ts validates its payload against one of
 * these zod schemas before touching the DB.
 */

import { z } from "zod";
import { zUuid } from "@/types/db";

/** Owner sets/updates the client's email on a project — the only place this address lives. */
export const SetProjectClientEmailInputSchema = z.object({
  projectId: zUuid,
  clientEmail: z.string().trim().email("Enter a valid email address"),
});
export type SetProjectClientEmailInput = z.infer<typeof SetProjectClientEmailInputSchema>;

/**
 * Owner composes + sends the first reminder email for a task that's on hold.
 * Upserts the task's ACTIVE `smark_task_reminders` row (one active row per
 * task) — see composeAndSendReminderAction's doc comment for the upsert rule.
 */
export const ComposeAndSendReminderInputSchema = z.object({
  taskId: zUuid,
  subject: z.string().trim().min(1, "Subject is required"),
  body: z.string().trim().min(1, "Message is required"),
  frequencyDays: z.coerce.number().int().positive("Frequency must be at least 1 day"),
});
export type ComposeAndSendReminderInput = z.infer<typeof ComposeAndSendReminderInputSchema>;

export const CancelReminderInputSchema = z.object({
  reminderId: zUuid,
});
export type CancelReminderInput = z.infer<typeof CancelReminderInputSchema>;

export const UpdateReminderFrequencyInputSchema = z.object({
  reminderId: zUuid,
  frequencyDays: z.coerce.number().int().positive("Frequency must be at least 1 day"),
});
export type UpdateReminderFrequencyInput = z.infer<typeof UpdateReminderFrequencyInputSchema>;
