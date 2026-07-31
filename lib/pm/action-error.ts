/**
 * lib/pm/action-error.ts — the one place a Project-Management Server Action
 * turns a thrown error into a value the UI can show.
 *
 * Why this exists: every action in this package used to call
 * `Schema.parse(input)` (throws on bad input) and `requirePm*()` (throws on an
 * expired session) with nothing catching either. A thrown Server Action
 * rejects the client transition, and with no `error.tsx` in the tree that
 * replaces the ENTIRE page with Next's built-in "This page couldn't load"
 * screen — the user loses the form, the drawer, and their scroll position, and
 * the only way back is a reload. Clearing the "Hours" box and hitting Save was
 * enough to trigger it.
 *
 * So: actions wrap their body in `guardAction()` and always RESOLVE with
 * `{ ok: false, error, code }`. `code` lets the client react — "auth" sends
 * the user to /login instead of showing a dead-end toast.
 */

import { ZodError } from "zod";
import { PmAuthError } from "./auth";

export type ActionErrorCode = "auth" | "forbidden" | "invalid" | "unknown";

export interface ActionFailure {
  ok: false;
  error: string;
  /** Absent on plain DB-level failures returned by lib/pm/core.ts. */
  code?: ActionErrorCode;
}

/**
 * First human-readable message out of a ZodError. Our schemas carry custom
 * messages ("Hours must be greater than 0", "Please describe what you did"),
 * so the first issue is nearly always the one the user needs; the generic
 * fallback covers schema-level failures with no custom message.
 */
function zodMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Please check the form and try again.";
  const field = issue.path.length > 0 ? String(issue.path[issue.path.length - 1]) : null;
  if (issue.message && issue.message !== "Invalid input") return issue.message;
  return field ? `Please enter a valid ${field}.` : "Please check the form and try again.";
}

export function toActionFailure(error: unknown): ActionFailure {
  if (error instanceof ZodError) {
    return { ok: false, error: zodMessage(error), code: "invalid" };
  }

  if (error instanceof PmAuthError) {
    return error.kind === "signed_out"
      ? { ok: false, error: "Your session has expired — please log in again.", code: "auth" }
      : { ok: false, error: error.message, code: "forbidden" };
  }

  // Anything else is a genuine defect (a broken query, a failed notification
  // fan-out…). Log the real cause server-side, hand the user something calm.
  console.error("[pm] server action failed:", error);
  return { ok: false, error: "Something went wrong on our side. Please try again.", code: "unknown" };
}

/**
 * Runs an action body and converts any throw into a returned failure. Next.js
 * `redirect()`/`notFound()` signal themselves by throwing, so those are
 * deliberately re-thrown rather than swallowed.
 */
export async function guardAction<T extends { ok: boolean }>(body: () => Promise<T>): Promise<T | ActionFailure> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof Error && "digest" in error && typeof error.digest === "string" && error.digest.startsWith("NEXT_")) {
      throw error;
    }
    return toActionFailure(error);
  }
}

/**
 * Side effects that must never take the whole action down with them —
 * notification fan-out, mainly. `notify*` (lib/notifications/fanout.ts) throws
 * when its insert fails, and actions await it AFTER the row is written: a
 * failure there used to crash the page on a task that had in fact been
 * created, so the owner would create it again. The write is what matters; a
 * missed bell is not worth losing the task over.
 */
export async function bestEffort(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`[pm] ${label} failed (non-fatal):`, error);
  }
}
