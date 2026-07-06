/**
 * lib/reminders/queries.ts — server-only reads for the client-reminder
 * feature (migration 0012). Same shape as lib/pm/queries.ts: every function
 * takes an already-created request Supabase client and runs under the
 * caller's session + RLS (owner-only per 0012's policies) — never the
 * service-role client. The cron route (app/api/cron/client-reminders) reads
 * this table itself via the service client instead, since it has no session.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";

type DB = SupabaseClient<Database>;

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`[reminders] ${context}: ${error.message}`);
}

export interface TaskReminderView {
  id: string;
  taskId: string;
  subject: string;
  body: string;
  frequencyDays: number;
  lastSentAt: string | null;
  nextSendAt: string;
  active: boolean;
}

function toTaskReminderView(row: {
  id: string;
  task_id: string;
  subject: string;
  body: string;
  frequency_days: number;
  last_sent_at: string | null;
  next_send_at: string;
  active: boolean;
}): TaskReminderView {
  return {
    id: row.id,
    taskId: row.task_id,
    subject: row.subject,
    body: row.body,
    frequencyDays: row.frequency_days,
    lastSentAt: row.last_sent_at,
    nextSendAt: row.next_send_at,
    active: row.active,
  };
}

/**
 * Owner-entered client email for a project (0012's `smark_projects.client_email`).
 * Kept in lib/reminders rather than lib/pm/queries.ts's `getPmProjectFull` so
 * this feature doesn't need to touch that (fenced-off) module.
 */
export async function getProjectClientEmail(supabase: DB, projectId: string): Promise<string | null> {
  const { data, error } = await supabase.from(TABLES.projects).select("client_email").eq("id", projectId).maybeSingle();
  assertNoError(error, "smark_projects (client_email)");
  return data?.client_email ?? null;
}

/** The task's current ACTIVE reminder, if any (one active row per task, see 0012's header). */
export async function getActiveReminderForTask(supabase: DB, taskId: string): Promise<TaskReminderView | null> {
  const { data, error } = await supabase
    .from(TABLES.task_reminders)
    .select("id, task_id, subject, body, frequency_days, last_sent_at, next_send_at, active")
    .eq("task_id", taskId)
    .eq("active", true)
    .maybeSingle();
  assertNoError(error, "smark_task_reminders (active for task)");
  return data ? toTaskReminderView(data) : null;
}
