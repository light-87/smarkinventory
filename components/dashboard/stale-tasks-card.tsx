import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/format";
import type { StaleTaskView } from "@/lib/pm/queries";

const STATUS_LABEL: Record<StaleTaskView["status"], string> = {
  open: "Open",
  awaiting_client_input: "Awaiting client input",
  submitted: "Submitted",
  done: "Done",
};

export interface StaleTasksCardProps {
  tasks: StaleTaskView[] | null;
  error?: string | null;
}

/**
 * Owner-only: "Oldest Open Tasks (no due dates in this system)" — a labeled
 * PROXY for a task-expiry widget. `smark_tasks` (migration 0010) has no
 * due-date/deadline column at all, so there is no real "expiring soon" signal
 * to compute; this shows the open/awaiting-input tasks that have been
 * sitting the longest (oldest `created_at`) instead, and says so in the
 * title rather than pretending it's a real due-date feature.
 */
export function StaleTasksCard({ tasks, error }: StaleTasksCardProps) {
  return (
    <Card>
      <div className="mb-1 text-[15px] font-medium text-snow">Oldest open tasks</div>
      <div className="mb-4 text-caption text-smoke">Proxy for task expiry — this system has no due-date field.</div>
      {error || !tasks ? (
        <div className="text-body-sm text-smoke">{error ?? "Task data unavailable."}</div>
      ) : tasks.length === 0 ? (
        <EmptyState tone="subtle" title="No open tasks" />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <div className="flex flex-col">
                <span className="text-snow">{task.title}</span>
                <span className="text-caption text-smoke">{task.projectName}</span>
              </div>
              <span className="flex items-center gap-2 text-smoke">
                Opened {formatDate(task.createdAt)}
                <Chip tone={task.status === "awaiting_client_input" ? "accent" : "default"} size="sm">
                  {STATUS_LABEL[task.status]}
                </Chip>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
