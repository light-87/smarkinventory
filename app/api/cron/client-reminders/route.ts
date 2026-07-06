/**
 * app/api/cron/client-reminders/route.ts — daily Vercel Cron job (see
 * vercel.json) that resends "client input still needed" emails for tasks
 * still on hold, and cleans up reminders whose hold has since closed.
 *
 * Auth: this has no user session (cron invocations carry no cookies), so it
 * checks a shared secret instead of going through lib/pm/auth.ts, and uses
 * `createServiceClient()` (lib/supabase/server.ts) — the RLS-bypass client
 * reserved for exactly this kind of trusted, session-less server surface.
 *
 * Per reminder due (`active` and `next_send_at <= now`):
 *   - if the task's hold has closed (no open smark_task_holds row) →
 *     deactivate the reminder, don't send. Belt-and-suspenders: this is the
 *     ONLY place that catches a hold closed via the client portal's
 *     `portal_mark_input_provided` RPC, since that path has no app-code hook
 *     to call lib/pm/actions.ts's `endHoldAction` (which does the same
 *     deactivation in-app, see that function's 0012 addition).
 *   - else → resend via lib/email, bump `next_send_at` by `frequency_days`
 *     FROM THE REMINDER'S OWN `next_send_at` (not `now`) so the cadence
 *     doesn't drift late if the cron fires a few minutes after schedule.
 *
 * `next_send_at` is bumped on every send ATTEMPT regardless of whether Resend
 * actually delivered it — a persistent Resend outage should not pile up a
 * backlog of "make up every missed day" sends once it recovers; it should
 * just keep trying on the normal cadence and surface via the `errors` count
 * in the response (worth alerting on if it stays nonzero).
 */

import { NextResponse } from "next/server";
import { TABLES } from "@/types/db";
import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { getPortalUrl } from "@/lib/url";
import { addDays } from "@/lib/reminders/schedule";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never run un-authed, even in an unconfigured env

  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  const cronHeader = request.headers.get("x-cron-secret");
  return cronHeader === secret;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();

  const { data: dueReminders, error: dueError } = await supabase
    .from(TABLES.task_reminders)
    .select("id, task_id, subject, body, frequency_days, next_send_at")
    .eq("active", true)
    .lte("next_send_at", now.toISOString());

  if (dueError) {
    return NextResponse.json({ error: dueError.message }, { status: 500 });
  }

  let sent = 0;
  let deactivated = 0;
  let errors = 0;

  for (const reminder of dueReminders ?? []) {
    try {
      const { data: task, error: taskError } = await supabase
        .from(TABLES.tasks)
        .select("project_id")
        .eq("id", reminder.task_id)
        .maybeSingle();
      if (taskError || !task) {
        errors++;
        continue;
      }

      const { data: openHold, error: holdError } = await supabase
        .from(TABLES.task_holds)
        .select("id")
        .eq("task_id", reminder.task_id)
        .is("ended_at", null)
        .maybeSingle();
      if (holdError) {
        errors++;
        continue;
      }

      if (!openHold) {
        // Hold closed (in-app or via the portal RPC) since the last cron run — stop resending.
        const { error: deactivateError } = await supabase.from(TABLES.task_reminders).update({ active: false }).eq("id", reminder.id);
        if (deactivateError) errors++;
        else deactivated++;
        continue;
      }

      const { data: project, error: projectError } = await supabase
        .from(TABLES.projects)
        .select("client_email, share_token")
        .eq("id", task.project_id)
        .maybeSingle();
      if (projectError || !project?.client_email) {
        errors++;
        continue;
      }

      const portalUrl = project.share_token ? getPortalUrl(project.share_token) : null;
      const bodyWithLink = portalUrl ? `${reminder.body}\n\nYou can review and respond here: ${portalUrl}` : reminder.body;

      const sendResult = await sendEmail({
        to: project.client_email,
        subject: reminder.subject,
        text: bodyWithLink,
        html: `<p>${reminder.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}</p>${
          portalUrl ? `<p><a href="${portalUrl}">${portalUrl}</a></p>` : ""
        }`,
      });
      if (!sendResult.ok) errors++;

      // Bump on every attempt (see header) — anchored off the reminder's own
      // next_send_at, not `now`, so a late-firing cron doesn't creep the cadence.
      const nextSendAt = addDays(reminder.next_send_at, reminder.frequency_days);
      const { error: updateError } = await supabase
        .from(TABLES.task_reminders)
        .update({ last_sent_at: now.toISOString(), next_send_at: nextSendAt })
        .eq("id", reminder.id);
      if (updateError) errors++;
      else sent++;
    } catch {
      errors++;
    }
  }

  return NextResponse.json({ sent, deactivated, errors, checked: dueReminders?.length ?? 0 });
}
