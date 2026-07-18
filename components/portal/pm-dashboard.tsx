import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import type { PortalTask, PortalTaskStatus } from "@/lib/portal/types";
import { TASK_STATUS_ACCENT, TASK_STATUS_TONE } from "@/lib/pm/task-status-ui";
import { MarkInputProvidedButton } from "./mark-input-provided-button";
import { ReportBugForm } from "./report-bug-form";

/**
 * Client-facing status labels — deliberately NOT the shared owner labels:
 * "Awaiting your input" (second person) reads to the client, where the owner
 * board says "Awaiting client input". Tone + left-accent colour ARE shared
 * (lib/pm/task-status-ui.ts) so the colour language matches both views.
 */
const STATUS_LABEL: Record<PortalTaskStatus, string> = {
  open: "Open",
  awaiting_client_input: "Awaiting your input",
  submitted: "Submitted",
  done: "Done",
};

/** `null` means the owner's `show_time_to_client` toggle is off — never render a fabricated value in its place. */
function formatHours(hours: number | null): string {
  return hours === null ? "—" : `${hours}h`;
}

export interface PmDashboardProps {
  token: string;
  progress: number;
  tasks: PortalTask[];
}

/**
 * `portal_get_pm(p_token)` (supabase/migrations/0010_pm.sql) rendered as a
 * progress bar (percent of tasks `done`) + task list. `estimated_hours`/
 * `actual_hours` are only ever non-null when the owner's
 * `show_time_to_client` toggle is on — the RPC itself enforces that, this
 * component just renders whatever it's given (null → hours line omitted
 * entirely, both fields are always null/non-null together).
 */
export function PmDashboard({ token, progress, tasks }: PmDashboardProps) {
  if (tasks.length === 0) {
    return (
      <EmptyState tone="subtle" title="No tasks yet" description="Tasks Smark is working on will show up here." />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-body-sm text-silver-mist">Tasks complete</span>
          <span className="font-mono text-[17px] text-snow">{progress}%</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-surface-well"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-smark-orange transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <ol className="flex flex-col gap-3">
        {tasks.map((task) => (
          <li
            key={task.id}
            className={`flex flex-col gap-2 rounded-xl border border-l-[3px] border-charcoal bg-surface-panel px-4 py-3 ${TASK_STATUS_ACCENT[task.status]}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="min-w-0 flex-1 text-[15px] font-medium break-words text-snow">{task.title}</span>
              <Chip tone={TASK_STATUS_TONE[task.status]} size="sm">
                {STATUS_LABEL[task.status]}
              </Chip>
            </div>

            {task.assignees.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {task.assignees.map((name) => (
                  <Chip key={name} tone="neutral" size="sm">
                    {name}
                  </Chip>
                ))}
              </div>
            )}

            {(task.estimated_hours !== null || task.actual_hours !== null) && (
              <p className="text-caption text-smoke">
                {formatHours(task.actual_hours)} logged of {formatHours(task.estimated_hours)} estimated
              </p>
            )}

            {task.status === "submitted" && <ReportBugForm token={token} taskId={task.id} />}
            {task.status === "awaiting_client_input" && (
              <MarkInputProvidedButton token={token} taskId={task.id} />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
