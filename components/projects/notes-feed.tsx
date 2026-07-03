"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatRelativeTime } from "@/lib/format";
import type { ActivityWithNames } from "@/lib/projects/queries";
import { editActivityAction, toggleTaskDoneAction } from "@/lib/projects/notes-actions";

const TYPE_TONE: Record<ActivityWithNames["type"], ChipTone> = {
  note: "default",
  meeting: "neutral",
  change: "accent",
  task: "bright",
};

const TYPE_LABEL: Record<ActivityWithNames["type"], string> = {
  note: "Note",
  meeting: "Meeting",
  change: "Change",
  task: "Task",
};

export interface NotesFeedProps {
  projectId: string;
  activities: readonly ActivityWithNames[];
  currentUserId: string | null;
  isOwner: boolean;
}

/** Notes & tasks feed (R2-06): append-only, 15-min author edit window, task done toggle. */
export function NotesFeed({ projectId, activities, currentUserId, isOwner }: NotesFeedProps) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  function toggleDone(activity: ActivityWithNames) {
    startTransition(async () => {
      try {
        await toggleTaskDoneAction(projectId, activity.id, !activity.task_done);
        router.refresh();
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't update that task." });
      }
    });
  }

  function startEdit(activity: ActivityWithNames) {
    setEditingId(activity.id);
    setEditTitle(activity.title ?? "");
    setEditBody(activity.body ?? "");
  }

  function saveEdit(activity: ActivityWithNames) {
    startTransition(async () => {
      try {
        await editActivityAction({
          projectId,
          activityId: activity.id,
          title: editTitle || null,
          body: editBody || null,
        });
        setEditingId(null);
        router.refresh();
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't save that edit." });
      }
    });
  }

  if (activities.length === 0) {
    return (
      <Card>
        <p className="text-caption text-smoke">No notes, meetings, changes or tasks yet.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {activities.map((activity) => {
        const isAuthor = activity.created_by === currentUserId;
        // The 15-minute author edit window is enforced authoritatively by
        // editActivityAction (lib/projects/notes-actions.ts) — showing "Edit"
        // here for any author (window elapsed or not) keeps this render pure
        // (no Date.now() during render); a past-window attempt just surfaces
        // the server's rejection as a toast instead of hiding the link early.
        const canEdit = isOwner || isAuthor;
        const isEditing = editingId === activity.id;

        return (
          <Card key={activity.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Chip tone={TYPE_TONE[activity.type]}>{TYPE_LABEL[activity.type]}</Chip>
                {activity.type === "task" && activity.task_done && <Chip tone="success">Done</Chip>}
                {activity.shared_to_portal && <Chip tone="soft">Shared to portal</Chip>}
              </div>
              <span className="text-caption text-smoke">
                {activity.authorName ?? "—"} · {formatRelativeTime(activity.created_at)}
              </span>
            </div>

            {isEditing ? (
              <div className="flex flex-col gap-2">
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Title"
                  className="rounded-lg border border-charcoal bg-surface-well px-3 py-2 text-sm text-snow outline-none focus:border-smark-orange"
                />
                <textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={3}
                  className="rounded-lg border border-charcoal bg-surface-well px-3 py-2 text-sm text-snow outline-none focus:border-smark-orange"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => saveEdit(activity)} loading={isPending}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {activity.title && <div className="text-[14px] text-snow">{activity.title}</div>}
                {activity.body && (
                  <div className="text-[13px] whitespace-pre-wrap text-silver-mist">{activity.body}</div>
                )}
                {activity.type === "task" && (
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-caption text-smoke">
                    {activity.assigneeName && <span>Assignee: {activity.assigneeName}</span>}
                    {activity.task_due && <span>Due {formatDate(activity.task_due)}</span>}
                    <button
                      type="button"
                      onClick={() => toggleDone(activity)}
                      disabled={isPending}
                      className="cursor-pointer text-smark-orange hover:underline disabled:opacity-50"
                    >
                      {activity.task_done ? "Mark not done" : "Mark done"}
                    </button>
                  </div>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => startEdit(activity)}
                    className="mt-1 cursor-pointer self-start text-caption text-smoke hover:text-snow"
                  >
                    Edit
                  </button>
                )}
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
