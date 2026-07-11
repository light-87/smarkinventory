/**
 * lib/pm/task-status-ui.ts — the single source of truth for how a task's
 * status is voiced visually, shared by the OWNER board (components/projects/
 * task-card.tsx) and the anonymous CLIENT portal (components/portal/
 * pm-dashboard.tsx) so the colour language can never drift between them.
 *
 * The 4-colour language (grey → amber → cobalt → green):
 *   open                  neutral (grey)   — not started
 *   awaiting_client_input warn   (amber)   — waiting on the client
 *   submitted             accent (cobalt)  — needs owner review
 *   done                  success (green)  — complete
 *
 * Pure consts only (no server imports) so both the app shell and the anon
 * portal route can import it. `PortalTaskStatus` is the same 4-value union as
 * `TaskStatus`, so these maps serve both.
 */

import type { TaskStatus } from "@/types/db";
import type { ChipTone } from "@/components/ui/chip";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  awaiting_client_input: "Awaiting client input",
  submitted: "Submitted",
  done: "Done",
};

export const TASK_STATUS_TONE: Record<TaskStatus, ChipTone> = {
  open: "neutral",
  awaiting_client_input: "warn", // amber — waiting on the client
  submitted: "accent", // cobalt — needs owner review
  done: "success", // green — complete
};

/** Left-edge accent colour per status — gives a card/row its colour at a glance (matches the chip tone). */
export const TASK_STATUS_ACCENT: Record<TaskStatus, string> = {
  open: "border-l-slate",
  awaiting_client_input: "border-l-warn",
  submitted: "border-l-smark-orange",
  done: "border-l-phosphor-green",
};
