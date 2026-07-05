"use server";

/**
 * lib/portal/actions.ts — the client portal's ONE write path: posting a
 * comment. Called directly from `components/portal/comment-form.tsx` (a
 * Client Component) — Next.js Server Actions don't need a Route Handler
 * wrapper for this.
 *
 * Always builds a fresh `createPortalAnonClient()` (never the cookie-bound
 * server client) — same anonymous-regardless-of-visitor rationale as
 * `lib/portal/anon-client.ts`.
 */

import { z } from "zod";
import { createPortalAnonClient } from "./anon-client";

const CommentInputSchema = z.object({
  token: z.string().min(1),
  authorName: z.string().trim().min(1, "Please enter your name.").max(200, "Name is too long."),
  body: z.string().trim().min(1, "Please enter a message.").max(2000, "Message is too long (max 2000 characters)."),
});

export interface SubmitPortalCommentResult {
  ok: boolean;
  error?: string;
}

export async function submitPortalComment(input: {
  token: string;
  authorName: string;
  body: string;
}): Promise<SubmitPortalCommentResult> {
  const parsed = CommentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check your name and message." };
  }

  const supabase = createPortalAnonClient();
  const { data, error } = await supabase.rpc("portal_add_comment", {
    p_token: parsed.data.token,
    p_author_name: parsed.data.authorName,
    p_body: parsed.data.body,
  });

  if (error) {
    // portal_add_comment raises plain-text exceptions for both a bad token
    // and an exceeded rate limit (0006_portal_fns.sql) — surfaced verbatim,
    // neither leaks which one it was beyond what the message itself says.
    return { ok: false, error: error.message || "Could not post your message — please try again." };
  }
  if (!data || (data as { ok?: boolean }).ok !== true) {
    return { ok: false, error: "Could not post your message — please try again." };
  }
  return { ok: true };
}

/**
 * The client portal's three PM write paths (supabase/migrations/0010_pm.sql)
 * — same shape as `submitPortalComment` above: a fresh anon client, zod input
 * validation, and the RPC's own plain-text exception surfaced verbatim
 * (0010 never distinguishes a bad token from a legitimate rejection — bad
 * token, wrong task status, rate limit, and empty/over-length description
 * all just raise a message, which is what ends up here).
 */

const BugReportInputSchema = z.object({
  token: z.string().min(1),
  taskId: z.string().min(1),
  description: z.string().trim().min(1, "Please describe the issue.").max(2000, "Description is too long (max 2000 characters)."),
});

export interface PortalBugReportResult {
  ok: boolean;
  error?: string;
  bugId?: string;
}

/** `portal_report_bug` — only accepted while the task's status is `submitted`. */
export async function reportPortalBug(input: {
  token: string;
  taskId: string;
  description: string;
}): Promise<PortalBugReportResult> {
  const parsed = BugReportInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please describe the issue." };
  }

  const supabase = createPortalAnonClient();
  const { data, error } = await supabase.rpc("portal_report_bug", {
    p_token: parsed.data.token,
    p_task_id: parsed.data.taskId,
    p_description: parsed.data.description,
  });

  if (error) {
    return { ok: false, error: error.message || "Could not send your report — please try again." };
  }
  const result = data as { ok?: boolean; bug_id?: string } | null;
  if (!result || result.ok !== true) {
    return { ok: false, error: "Could not send your report — please try again." };
  }
  return { ok: true, bugId: result.bug_id };
}

const ChangeRequestInputSchema = z.object({
  token: z.string().min(1),
  projectId: z.string().min(1),
  description: z
    .string()
    .trim()
    .min(1, "Please describe the change you'd like.")
    .max(2000, "Description is too long (max 2000 characters)."),
});

export interface PortalChangeRequestResult {
  ok: boolean;
  error?: string;
  changeRequestId?: string;
}

/** `portal_request_change` — project-level, not tied to any single task. */
export async function requestPortalChange(input: {
  token: string;
  projectId: string;
  description: string;
}): Promise<PortalChangeRequestResult> {
  const parsed = ChangeRequestInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please describe the change you'd like." };
  }

  const supabase = createPortalAnonClient();
  const { data, error } = await supabase.rpc("portal_request_change", {
    p_token: parsed.data.token,
    p_project_id: parsed.data.projectId,
    p_description: parsed.data.description,
  });

  if (error) {
    return { ok: false, error: error.message || "Could not send your request — please try again." };
  }
  const result = data as { ok?: boolean; change_request_id?: string } | null;
  if (!result || result.ok !== true) {
    return { ok: false, error: "Could not send your request — please try again." };
  }
  return { ok: true, changeRequestId: result.change_request_id };
}

const MarkInputProvidedInputSchema = z.object({
  token: z.string().min(1),
  taskId: z.string().min(1),
});

export interface PortalMarkInputProvidedResult {
  ok: boolean;
  error?: string;
}

/** `portal_mark_input_provided` — closes the task's open `awaiting_client_input` hold. */
export async function markPortalInputProvided(input: {
  token: string;
  taskId: string;
}): Promise<PortalMarkInputProvidedResult> {
  const parsed = MarkInputProvidedInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Something went wrong — please try again." };
  }

  const supabase = createPortalAnonClient();
  const { data, error } = await supabase.rpc("portal_mark_input_provided", {
    p_token: parsed.data.token,
    p_task_id: parsed.data.taskId,
  });

  if (error) {
    return { ok: false, error: error.message || "Could not update this task — please try again." };
  }
  const result = data as { ok?: boolean } | null;
  if (!result || result.ok !== true) {
    return { ok: false, error: "Could not update this task — please try again." };
  }
  return { ok: true };
}
