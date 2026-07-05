/**
 * lib/notifications/fanout.ts — SERVER helpers other packages import to fan
 * out `smark_notifications` rows (docs/OWNERSHIP.md cross-package import
 * allowance: "lib/notifications (search-notifications) ← cart-orders /
 * projects-hub / ai-memory / portal"). FEATURES.md §5 header spec's event
 * list + SCHEMA.md §7 `smark_notifications.kind`.
 *
 * Every helper takes the CALLER's own `SupabaseClient<Database>` (browser or
 * server — same convention as `lib/scan/resolve.ts` / `lib/movements/service.ts`)
 * and writes through it, never a service-role client: migration 0001's
 * `smark_notifications_insert` policy already allows any active
 * authenticated user to insert a row for ANY recipient ("any active user may
 * insert — covers in-app actor-driven fan-out"), so there's no privilege gap
 * to bridge with the service role here.
 *
 * Audience choices below (who gets which `kind`) are this package's judgment
 * call where FEATURES §5/SCHEMA.md doesn't spell one out — noted per
 * function, flagged in this package's report for the client/integrator to
 * confirm:
 *   - `task_assigned` → the named assignee (caller always knows who).
 *   - `arrival`, `run_done` → the person who placed the order / started the
 *     run (caller knows this — it's whoever's action the event answers).
 *   - `rule_pending`, `expense_draft`, `low_stock`, `portal_comment` → every
 *     ACTIVE owner (FEATURES §2: AI-memory approval, expense confirmation,
 *     and stock oversight are owner-scoped concerns; resolved here via
 *     `activeOwnerIds` so callers don't need to know which user is owner).
 *   - `bug_reported`, `change_requested` → every active owner (pm module;
 *     the client-portal path for these two inserts the row directly in SQL —
 *     supabase/migrations/0010_pm.sql — these wrappers cover the in-app path).
 *   - `client_input_provided` → the task's assignees (caller-supplied; the
 *     client-portal path also notifies active owners directly in SQL).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLES, type Database, type NotificationKind, type NotificationRow } from "@/types/db";
import { orderHref, partHref, projectHref } from "@/lib/search/queries";
import { formatINR } from "@/lib/format";

type Client = SupabaseClient<Database>;

interface NotifyParams {
  userIds: string[];
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
}

async function insertNotifications(
  client: Client,
  rows: Array<{ user_id: string; kind: NotificationKind; title: string; body: string | null; link: string | null }>,
): Promise<NotificationRow[]> {
  if (rows.length === 0) return [];
  const { data, error } = await client.from(TABLES.notifications).insert(rows).select("*");
  if (error) throw new Error(`notification insert failed: ${error.message}`);
  return data ?? [];
}

/** Active owners — the resolved audience for owner-scoped events (see module doc). */
async function activeOwnerIds(client: Client): Promise<string[]> {
  const { data, error } = await client
    .from(TABLES.app_users)
    .select("id")
    .eq("role", "owner")
    .eq("active", true);
  if (error) throw new Error(`owner lookup failed: ${error.message}`);
  return (data ?? []).map((row) => row.id);
}

/**
 * Low-level fan-out — inserts one row per (deduped) recipient. Every
 * `notify*` helper below is a thin, documented wrapper over this; reach for
 * this directly only for an event kind that doesn't have one yet.
 */
export async function notify(client: Client, params: NotifyParams): Promise<NotificationRow[]> {
  const uniqueIds = Array.from(new Set(params.userIds));
  return insertNotifications(
    client,
    uniqueIds.map((user_id) => ({
      user_id,
      kind: params.kind,
      title: params.title,
      body: params.body ?? null,
      link: params.link ?? null,
    })),
  );
}

/** An order (fully or partially) arrived — notifies whoever placed it (cart-orders). */
export async function notifyArrival(
  client: Client,
  params: { orderId: string; poNumber: string; distributorName: string; recipientUserId: string },
): Promise<NotificationRow> {
  const [row] = await notify(client, {
    userIds: [params.recipientUserId],
    kind: "arrival",
    title: `Order ${params.poNumber} arrived`,
    body: `${params.distributorName} — ready for put-away`,
    link: orderHref(params.orderId),
  });
  if (!row) throw new Error("notifyArrival: insert returned no row");
  return row;
}

/** A project task got an assignee (projects-hub). */
export async function notifyTaskAssigned(
  client: Client,
  params: { projectId: string; projectName: string; taskTitle: string; assigneeUserId: string },
): Promise<NotificationRow> {
  const [row] = await notify(client, {
    userIds: [params.assigneeUserId],
    kind: "task_assigned",
    title: `New task: ${params.taskTitle}`,
    body: params.projectName,
    link: projectHref(params.projectId),
  });
  if (!row) throw new Error("notifyTaskAssigned: insert returned no row");
  return row;
}

/** A suggested rule is awaiting owner approval (ai-memory). Audience: every active owner. */
export async function notifyRulePending(client: Client, params: { ruleSummary: string }): Promise<NotificationRow[]> {
  const owners = await activeOwnerIds(client);
  return notify(client, {
    userIds: owners,
    kind: "rule_pending",
    title: "A suggested rule needs your review",
    body: params.ruleSummary,
    link: "/ai-memory",
  });
}

/** A part crossed its reorder point (cart-orders / dashboard). Audience: every active owner. */
export async function notifyLowStock(
  client: Client,
  params: { pid: string; description: string | null; totalQty: number; reorderPoint: number },
): Promise<NotificationRow[]> {
  const owners = await activeOwnerIds(client);
  const descriptor = params.description ? ` — ${params.description}` : "";
  return notify(client, {
    userIds: owners,
    kind: "low_stock",
    title: `${params.pid} is low`,
    body: `${params.totalQty} left (reorder point ${params.reorderPoint})${descriptor}`,
    link: partHref(params.pid),
  });
}

/** An agent run finished (bom-pipeline). Notifies whoever started it. */
export async function notifyRunDone(
  client: Client,
  params: { projectId: string; bomId: string; startedByUserId: string; actualCost: number | null },
): Promise<NotificationRow> {
  const body = params.actualCost != null ? `Actual cost ${formatINR(params.actualCost)}` : null;
  const [row] = await notify(client, {
    userIds: [params.startedByUserId],
    kind: "run_done",
    title: "Agent run finished",
    body,
    // bom-pipeline owns app/(app)/projects/[projectId]/runs/** — deep-link there.
    link: `${projectHref(params.projectId)}/runs?bom=${params.bomId}`,
  });
  if (!row) throw new Error("notifyRunDone: insert returned no row");
  return row;
}

/** Checkout auto-created a draft expense from a PO (cart-orders). Audience: every active owner. */
export async function notifyExpenseDraft(
  client: Client,
  params: { poNumber: string; amount: number },
): Promise<NotificationRow[]> {
  const owners = await activeOwnerIds(client);
  return notify(client, {
    userIds: owners,
    kind: "expense_draft",
    title: `Draft expense from ${params.poNumber}`,
    body: `${formatINR(params.amount)} — confirm in Expenses`,
    link: "/expenses",
  });
}

/** An employee submitted a comp-work claim (attendance). Audience: every active owner. */
export async function notifyCompPending(
  client: Client,
  params: { employeeName: string; workDate: string },
): Promise<NotificationRow[]> {
  const owners = await activeOwnerIds(client);
  return notify(client, {
    userIds: owners,
    kind: "comp_pending",
    title: `${params.employeeName} claimed comp work`,
    body: `Worked ${params.workDate} — approve in Attendance`,
    link: "/attendance",
  });
}

/** An employee submitted a leave request (attendance). Audience: every active owner. */
export async function notifyLeavePending(
  client: Client,
  params: { employeeName: string; startDate: string; endDate: string },
): Promise<NotificationRow[]> {
  const owners = await activeOwnerIds(client);
  const range = params.startDate === params.endDate ? params.startDate : `${params.startDate} – ${params.endDate}`;
  return notify(client, {
    userIds: owners,
    kind: "leave_pending",
    title: `${params.employeeName} requested leave`,
    body: `${range} — approve in Attendance`,
    link: "/attendance",
  });
}

/** Owner decided a comp-work claim (attendance). Notifies the employee. */
export async function notifyCompDecided(
  client: Client,
  params: { userId: string; workDate: string; approved: boolean },
): Promise<NotificationRow> {
  const [row] = await notify(client, {
    userIds: [params.userId],
    kind: "comp_decided",
    title: `Comp work ${params.approved ? "approved" : "rejected"}`,
    body: params.workDate,
    link: "/attendance",
  });
  if (!row) throw new Error("notifyCompDecided: insert returned no row");
  return row;
}

/** Owner decided a leave request (attendance). Notifies the employee. */
export async function notifyLeaveDecided(
  client: Client,
  params: { userId: string; startDate: string; endDate: string; approved: boolean },
): Promise<NotificationRow> {
  const range = params.startDate === params.endDate ? params.startDate : `${params.startDate} – ${params.endDate}`;
  const [row] = await notify(client, {
    userIds: [params.userId],
    kind: "leave_decided",
    title: `Leave ${params.approved ? "approved" : "rejected"}`,
    body: range,
    link: "/attendance",
  });
  if (!row) throw new Error("notifyLeaveDecided: insert returned no row");
  return row;
}

/**
 * A bug/issue was reported against a task (pm). The client-portal path
 * (portal_report_bug, supabase/migrations/0010_pm.sql) inserts this kind
 * directly in SQL — this wrapper is for the in-app path (owner/engineer
 * reporting via lib/pm/actions.ts reportBugAction). Audience: every active owner.
 */
export async function notifyBugReported(
  client: Client,
  params: { projectId: string; taskTitle: string; description: string },
): Promise<NotificationRow[]> {
  const owners = await activeOwnerIds(client);
  return notify(client, {
    userIds: owners,
    kind: "bug_reported",
    title: `Issue reported: ${params.taskTitle}`,
    body: params.description.slice(0, 140),
    link: projectHref(params.projectId),
  });
}

/**
 * A change request was filed against a project (pm). The client-portal path
 * (portal_request_change, 0010_pm.sql) inserts this kind directly in SQL —
 * this wrapper is for the in-app owner-originated path. Audience: every
 * active owner (other than the requester, in a multi-owner shop).
 */
export async function notifyChangeRequested(
  client: Client,
  params: { projectId: string; description: string },
): Promise<NotificationRow[]> {
  const owners = await activeOwnerIds(client);
  return notify(client, {
    userIds: owners,
    kind: "change_requested",
    title: "A change was requested",
    body: params.description.slice(0, 140),
    link: projectHref(params.projectId),
  });
}

/**
 * A hold ("awaiting client input") on a task was cleared (pm). The
 * client-portal path (portal_mark_input_provided, 0010_pm.sql) inserts this
 * kind directly in SQL — this wrapper is for the in-app owner-ends-hold path.
 * Audience: the task's assignees (passed in by the caller, which already
 * knows them from lib/pm/queries.ts).
 */
export async function notifyClientInputProvided(
  client: Client,
  params: { projectId: string; taskTitle: string; assigneeUserIds: string[] },
): Promise<NotificationRow[]> {
  return notify(client, {
    userIds: params.assigneeUserIds,
    kind: "client_input_provided",
    title: `Input provided: ${params.taskTitle}`,
    body: null,
    link: projectHref(params.projectId),
  });
}

/** A client-portal visitor left a comment (portal). Audience: every active owner. */
export async function notifyPortalComment(
  client: Client,
  params: { projectId: string; projectName: string; commentSnippet: string },
): Promise<NotificationRow[]> {
  const owners = await activeOwnerIds(client);
  return notify(client, {
    userIds: owners,
    kind: "portal_comment",
    title: `New comment on ${params.projectName}`,
    body: params.commentSnippet,
    link: projectHref(params.projectId),
  });
}
