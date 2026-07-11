import { Card, SectionLabel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TaskCard } from "./task-card";
import type { EngineerOption, TaskHoldView, TaskView } from "@/lib/pm/queries";
import type { TaskReminderView } from "@/lib/reminders/queries";

export interface TaskListProps {
  tasks: readonly TaskView[];
  progress: number;
  isOwner: boolean;
  canWrite: boolean;
  currentUserId: string | null;
  holdByTask: ReadonlyMap<string, TaskHoldView | null>;
  bugCountByTask: ReadonlyMap<string, number>;
  engineers: readonly EngineerOption[];
  /** Reminder feature (0012) — owner-only, undefined props are fine for non-owner renders. */
  projectId?: string;
  clientEmail?: string | null;
  reminderByTask?: ReadonlyMap<string, TaskReminderView | null>;
}

/** Task list + completion progress bar (done/total). */
export function TaskList({
  tasks,
  progress,
  isOwner,
  canWrite,
  currentUserId,
  holdByTask,
  bugCountByTask,
  engineers,
  projectId,
  clientEmail,
  reminderByTask,
}: TaskListProps) {
  const done = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-[14px]">
          <SectionLabel>Progress</SectionLabel>
          <span className="text-smoke">
            {done}/{tasks.length} done · {progress}%
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-well">
          <div className="h-full rounded-full bg-smark-orange transition-all" style={{ width: `${progress}%` }} />
        </div>
      </Card>

      {tasks.length === 0 ? (
        <EmptyState tone="subtle" title="No tasks yet" description="Add the first task to start tracking work on this project." />
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isOwner={isOwner}
              canWrite={canWrite}
              currentUserId={currentUserId}
              openHold={holdByTask.get(task.id) ?? null}
              bugCount={bugCountByTask.get(task.id) ?? 0}
              engineers={engineers}
              projectId={projectId}
              clientEmail={clientEmail}
              activeReminder={reminderByTask?.get(task.id) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
