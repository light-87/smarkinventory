"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import type { EngineerOption, TaskHoldView, TaskView } from "@/lib/pm/queries";
import type { TaskReminderView } from "@/lib/reminders/queries";
import { markTaskDoneAction, submitTaskAction } from "@/lib/pm/actions";
import { TASK_STATUS_CARD_TONE, TASK_STATUS_LABEL, TASK_STATUS_TONE } from "@/lib/pm/task-status-ui";
import { TaskDrawer } from "./task-drawer";

export interface TaskCardProps {
  task: TaskView;
  isOwner: boolean;
  canWrite: boolean;
  currentUserId: string | null;
  openHold: TaskHoldView | null;
  bugCount: number;
  engineers: readonly EngineerOption[];
  /** Shown when rendered outside a project page (e.g. "My tasks"). */
  projectName?: string;
  /** Reminder feature (0012) — owner-only, all optional so non-PM-overview callers (e.g. "My tasks") don't need to wire it. */
  projectId?: string;
  clientEmail?: string | null;
  activeReminder?: TaskReminderView | null;
}

/**
 * One task row — a calm face: title, status, assignees, and at most a primary
 * next-step button plus "Manage", which opens the TaskDrawer holding every
 * secondary action (log on behalf, assign, report issue, hold, reminders).
 * Permission is prop-gated; server actions re-check regardless.
 */
export function TaskCard({
  task,
  isOwner,
  canWrite,
  currentUserId,
  openHold,
  bugCount,
  engineers,
  projectName,
  projectId,
  clientEmail,
  activeReminder,
}: TaskCardProps) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isAssignedToMe = currentUserId != null && task.assignees.some((a) => a.userId === currentUserId);
  const engineerControlsVisible = canWrite && (isAssignedToMe || isOwner);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) router.refresh();
      else push({ msg: result.error ?? "Something went wrong." });
    });
  }

  // Card face shows one primary next-step; everything else lives in the drawer.
  const canMarkDone = isOwner && task.status === "submitted";
  const canLog = engineerControlsVisible && task.status === "open" && !openHold;
  const canSubmitOnly = engineerControlsVisible && task.status === "open" && openHold;
  const hasManage = canWrite || isOwner;

  return (
    <Card tone={TASK_STATUS_CARD_TONE[task.status]} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {projectName && <div className="text-caption text-smoke">{projectName}</div>}
          <div className="text-[17px] text-snow">{task.title}</div>
          {task.description && <p className="mt-1 text-[15px] text-smoke">{task.description}</p>}
        </div>
        <Chip tone={TASK_STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Chip>
      </div>

      {openHold && (
        <div className="rounded-lg border border-warn bg-warn/10 px-3.5 py-2.5 text-[15px] text-warn">
          Awaiting client input since {formatDate(openHold.startedAt)} — time logging is paused.
          {isOwner && " Open Manage to mark it received or send a reminder."}
        </div>
      )}

      {task.assignees.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {task.assignees.map((a) => (
            <Chip key={a.userId} tone="soft">
              {a.displayName ?? a.username} · {a.estimatedHours}h est.
            </Chip>
          ))}
        </div>
      )}

      {bugCount > 0 && <Chip tone="warn">{bugCount} confirmed bug{bugCount === 1 ? "" : "s"}</Chip>}

      {(canMarkDone || canLog || canSubmitOnly || hasManage) && (
        <div className="flex flex-wrap gap-2">
          {canMarkDone && (
            <Button size="sm" loading={isPending} onClick={() => run(() => markTaskDoneAction({ taskId: task.id }))}>
              Mark done
            </Button>
          )}
          {canLog && (
            <Button size="sm" onClick={() => setDrawerOpen(true)}>
              Log time
            </Button>
          )}
          {canSubmitOnly && (
            <Button size="sm" variant="outline" loading={isPending} onClick={() => run(() => submitTaskAction({ taskId: task.id }))}>
              Submit for review
            </Button>
          )}
          {hasManage && (
            <Button size="sm" variant="outline" onClick={() => setDrawerOpen(true)}>
              Manage
            </Button>
          )}
        </div>
      )}

      {hasManage && (
        <TaskDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          task={task}
          isOwner={isOwner}
          canWrite={canWrite}
          currentUserId={currentUserId}
          openHold={openHold}
          engineers={engineers}
          projectId={projectId}
          clientEmail={clientEmail}
          activeReminder={activeReminder}
        />
      )}
    </Card>
  );
}
