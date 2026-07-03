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
