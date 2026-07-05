import { EmptyState } from "@/components/ui/empty-state";
import { TaskCard } from "./task-card";
import type { TaskHoldView, TaskView } from "@/lib/pm/queries";

export interface MyTasksListProps {
  tasks: readonly TaskView[];
  currentUserId: string;
  holdByTask: ReadonlyMap<string, TaskHoldView | null>;
  bugCountByTask: ReadonlyMap<string, number>;
  projectNameById: ReadonlyMap<string, string>;
}

/** "My tasks" — every task the signed-in engineer is assigned to, across every project. */
export function MyTasksList({ tasks, currentUserId, holdByTask, bugCountByTask, projectNameById }: MyTasksListProps) {
  if (tasks.length === 0) {
    return <EmptyState tone="subtle" title="No tasks assigned" description="Tasks the owner assigns to you will show up here." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          isOwner={false}
          canWrite={true}
          currentUserId={currentUserId}
          openHold={holdByTask.get(task.id) ?? null}
          bugCount={bugCountByTask.get(task.id) ?? 0}
          engineers={[]}
          projectName={projectNameById.get(task.projectId)}
        />
      ))}
    </div>
  );
}
