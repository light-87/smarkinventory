import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { formatHours } from "@/lib/format";
import { TASK_STATUS_LABEL, TASK_STATUS_TONE } from "@/lib/pm/task-status-ui";
import type { TaskView } from "@/lib/pm/queries";

export interface MyOpenTasksCardProps {
  tasks: TaskView[] | null;
  projectNameById: ReadonlyMap<string, string>;
  /** Whose row to read hours from — a task can carry several assignees, each with their own estimate. */
  currentUserId: string;
  error?: string | null;
}

/**
 * An engineer's own unfinished work, on their dashboard.
 *
 * Added when the stock cards moved to /inventory-dashboard: without it an
 * employee's dashboard would have been a nav launcher and a holiday list.
 * This is the one thing they open the app to check, and each row carries the
 * hours they've logged against the estimate — the same "2h of 4h" reading the
 * task board uses.
 */
export function MyOpenTasksCard({ tasks, projectNameById, currentUserId, error }: MyOpenTasksCardProps) {
  return (
    <Card>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <span className="text-[17px] font-medium text-snow">My open tasks</span>
        <Link href="/projects" className="text-caption text-smoke transition-colors hover:text-snow">
          All my tasks →
        </Link>
      </div>
      {error || !tasks ? (
        <div className="text-body-sm text-smoke">{error ?? "Task data unavailable."}</div>
      ) : tasks.length === 0 ? (
        <EmptyState tone="subtle" title="Nothing open" description="Tasks the owner assigns to you will show up here." />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {tasks.map((task) => {
            const mine = task.assignees.find((a) => a.userId === currentUserId);
            return (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-snow">{task.title}</span>
                  <span className="text-caption text-smoke">
                    {projectNameById.get(task.projectId) ?? "Project"}
                    {mine && ` · ${formatHours(mine.loggedHours)} of ${formatHours(mine.estimatedHours)}`}
                  </span>
                </div>
                <Chip tone={TASK_STATUS_TONE[task.status]} size="sm">
                  {TASK_STATUS_LABEL[task.status]}
                </Chip>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
