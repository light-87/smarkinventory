import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { BugBandBucket, TaskStatusBucket } from "@/lib/pm/dashboard";
import type { TaskStatus } from "@/types/db";

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  awaiting_client_input: "Awaiting client input",
  submitted: "Submitted",
  done: "Done",
};

/** One hand-rolled horizontal bar row — plain divs, no chart library. */
function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[14px]">
        <span className="truncate text-silver-mist">{label}</span>
        <span className="flex-none font-mono text-smoke">{count}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-well">
        <div className="h-full rounded-full bg-smark-orange transition-[width]" style={{ width: `${(100 * count) / max}%` }} />
      </div>
    </div>
  );
}

export interface TaskBugDistributionProps {
  taskStatus: TaskStatusBucket[];
  bugBands: BugBandBucket[];
}

export function TaskBugDistribution({ taskStatus, bugBands }: TaskBugDistributionProps) {
  const taskMax = Math.max(1, ...taskStatus.map((b) => b.count));
  const bugMax = Math.max(1, ...bugBands.map((b) => b.count));
  const hasAnyTasks = taskStatus.some((b) => b.count > 0);
  const hasAnyBugs = bugBands.some((b) => b.count > 0);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card padding="none">
        <CardHeader title="Tasks by status" />
        <div className="flex flex-col gap-3 px-5 py-[18px]">
          {!hasAnyTasks ? (
            <EmptyState tone="subtle" title="No tasks match the current filters" />
          ) : (
            taskStatus.map((b) => <BarRow key={b.status} label={TASK_STATUS_LABEL[b.status]} count={b.count} max={taskMax} />)
          )}
        </div>
      </Card>
      <Card padding="none">
        <CardHeader title="Tasks by confirmed-bug band" />
        <div className="flex flex-col gap-3 px-5 py-[18px]">
          {!hasAnyBugs ? (
            <EmptyState tone="subtle" title="No confirmed bugs in scope" />
          ) : (
            bugBands.map((b) => <BarRow key={b.band} label={b.label} count={b.count} max={bugMax} />)
          )}
        </div>
      </Card>
    </div>
  );
}
