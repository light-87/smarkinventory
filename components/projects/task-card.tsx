"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import type { TaskStatus } from "@/types/db";
import type { EngineerOption, TaskHoldView, TaskView } from "@/lib/pm/queries";
import type { TaskReminderView } from "@/lib/reminders/queries";
import {
  assignTaskAction,
  endHoldAction,
  logTimeAction,
  markTaskDoneAction,
  ownerLogOnBehalfAction,
  removeAssigneeAction,
  reportBugAction,
  startHoldAction,
  submitTaskAction,
} from "@/lib/pm/actions";
import {
  cancelReminderAction,
  composeAndSendReminderAction,
  setProjectClientEmailAction,
  updateReminderFrequencyAction,
} from "@/lib/reminders/actions";

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  awaiting_client_input: "Awaiting client input",
  submitted: "Submitted",
  done: "Done",
};

const STATUS_TONE: Record<TaskStatus, ChipTone> = {
  open: "neutral",
  awaiting_client_input: "accent",
  submitted: "bright",
  done: "success",
};

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
 * One task row: status, assignees + estimated hours, and every action a
 * caller is entitled to — owner controls (mark done, assign, triage) and the
 * assigned engineer's own controls (log time, submit, hold), gated purely by
 * props (server actions re-check permission regardless).
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
  const [panel, setPanel] = useState<null | "log" | "bug" | "assign" | "ownerLog" | "reminder">(null);

  const [hours, setHours] = useState("1");
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logDescription, setLogDescription] = useState("");
  const [bugDescription, setBugDescription] = useState("");
  const [bugKind, setBugKind] = useState<"bug" | "change_request">("bug");
  const [assignUserId, setAssignUserId] = useState("");
  const [assignHours, setAssignHours] = useState("1");
  const [onBehalfUserId, setOnBehalfUserId] = useState("");

  const [clientEmailDraft, setClientEmailDraft] = useState(clientEmail ?? "");
  const [reminderSubject, setReminderSubject] = useState(`Action needed: ${task.title}`);
  const [reminderBody, setReminderBody] = useState(
    `Hi,\n\nWe're waiting on your input for "${task.title}" before we can move forward. Could you take a look when you get a chance?`,
  );
  const [reminderFrequency, setReminderFrequency] = useState(3);
  const [reminderFrequencyDraft, setReminderFrequencyDraft] = useState(activeReminder?.frequencyDays ?? 3);

  const isAssignedToMe = currentUserId != null && task.assignees.some((a) => a.userId === currentUserId);
  const engineerControlsVisible = canWrite && (isAssignedToMe || isOwner);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, onDone?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        onDone?.();
        setPanel(null);
        router.refresh();
      } else {
        push({ msg: result.error ?? "Something went wrong." });
      }
    });
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {projectName && <div className="text-caption text-smoke">{projectName}</div>}
          <div className="text-[15px] text-snow">{task.title}</div>
          {task.description && <p className="mt-1 text-[13px] text-smoke">{task.description}</p>}
        </div>
        <Chip tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Chip>
      </div>

      {openHold && (
        <div className="rounded-lg border border-smark-orange bg-surface-accent px-3.5 py-2.5 text-[13px] text-snow">
          Awaiting client input since {formatDate(openHold.startedAt)} — time logging is paused.
          {isOwner && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => endHoldAction({ taskId: task.id }))}
              className="ml-2 cursor-pointer font-medium text-smark-orange underline disabled:opacity-50"
            >
              Mark input received
            </button>
          )}
          {isOwner && projectId && (
            <button
              type="button"
              onClick={() => setPanel(panel === "reminder" ? null : "reminder")}
              className="ml-2 cursor-pointer font-medium text-smark-orange underline disabled:opacity-50"
            >
              {activeReminder ? "Client reminder" : "Send client reminder"}
            </button>
          )}
        </div>
      )}

      {task.assignees.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {task.assignees.map((a) => (
            <Chip key={a.userId} tone="soft">
              {a.displayName ?? a.username} · {a.estimatedHours}h est.
              {isOwner && (
                <button
                  type="button"
                  aria-label={`Remove ${a.displayName ?? a.username}`}
                  onClick={() => run(() => removeAssigneeAction({ taskId: task.id, userId: a.userId }))}
                  className="ml-1 cursor-pointer text-smoke hover:text-smark-orange"
                >
                  ×
                </button>
              )}
            </Chip>
          ))}
        </div>
      )}

      {bugCount > 0 && <Chip tone="accent">{bugCount} confirmed bug{bugCount === 1 ? "" : "s"}</Chip>}

      <div className="flex flex-wrap gap-2">
        {engineerControlsVisible && task.status === "open" && !openHold && (
          <Button size="sm" variant="outline" onClick={() => setPanel(panel === "log" ? null : "log")}>
            Log time
          </Button>
        )}
        {engineerControlsVisible && task.status === "open" && (
          <Button size="sm" variant="ghost" onClick={() => run(() => submitTaskAction({ taskId: task.id }))} loading={isPending}>
            Submit for review
          </Button>
        )}
        {engineerControlsVisible && task.status === "open" && !openHold && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => run(() => startHoldAction({ taskId: task.id, reason: "awaiting_client_input" }))}
            loading={isPending}
          >
            Put on hold
          </Button>
        )}
        {isOwner && task.status === "submitted" && (
          <Button size="sm" onClick={() => run(() => markTaskDoneAction({ taskId: task.id }))} loading={isPending}>
            Mark done
          </Button>
        )}
        {isOwner && (
          <Button size="sm" variant="ghost" onClick={() => setPanel(panel === "ownerLog" ? null : "ownerLog")}>
            Log on behalf
          </Button>
        )}
        {canWrite && (
          <Button size="sm" variant="ghost" onClick={() => setPanel(panel === "bug" ? null : "bug")}>
            Report issue
          </Button>
        )}
        {isOwner && engineers.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setPanel(panel === "assign" ? null : "assign")}>
            Assign engineer
          </Button>
        )}
      </div>

      {panel === "log" && (
        <div className="flex flex-col gap-2 rounded-lg border border-charcoal p-3">
          <div className="flex gap-2">
            <Field label="Date" className="flex-1">
              <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
            </Field>
            <Field label="Hours" className="w-24">
              <Input type="number" min="0.5" step="0.5" max="24" value={hours} onChange={(e) => setHours(e.target.value)} />
            </Field>
          </div>
          <Field label="What did you do?">
            <Input value={logDescription} onChange={(e) => setLogDescription(e.target.value)} />
          </Field>
          <Button
            size="sm"
            loading={isPending}
            onClick={() => {
              if (!logDescription.trim()) {
                push({ msg: "Please describe what you did" });
                return;
              }
              run(() =>
                logTimeAction({
                  taskId: task.id,
                  workDate,
                  hours: Number(hours),
                  description: logDescription.trim(),
                }),
                () => setLogDescription(""),
              );
            }}
            className="self-start"
          >
            Save log
          </Button>
        </div>
      )}

      {panel === "ownerLog" && (
        <div className="flex flex-col gap-2 rounded-lg border border-charcoal p-3">
          <Field label="Engineer">
            <select
              value={onBehalfUserId}
              onChange={(e) => setOnBehalfUserId(e.target.value)}
              className="h-10 w-full rounded-lg border border-charcoal bg-surface-well px-3.5 text-sm text-snow outline-none focus:border-smark-orange"
            >
              <option value="">Select…</option>
              {task.assignees.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.displayName ?? a.username}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex gap-2">
            <Field label="Date" className="flex-1">
              <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
            </Field>
            <Field label="Hours" className="w-24">
              <Input type="number" min="0.5" step="0.5" max="24" value={hours} onChange={(e) => setHours(e.target.value)} />
            </Field>
          </div>
          <Field label="What did they do?">
            <Input value={logDescription} onChange={(e) => setLogDescription(e.target.value)} />
          </Field>
          <Button
            size="sm"
            loading={isPending}
            onClick={() => {
              if (!onBehalfUserId) {
                push({ msg: "Pick an engineer" });
                return;
              }
              if (!logDescription.trim()) {
                push({ msg: "Please describe what they did" });
                return;
              }
              run(() =>
                ownerLogOnBehalfAction({
                  taskId: task.id,
                  userId: onBehalfUserId,
                  workDate,
                  hours: Number(hours),
                  description: logDescription.trim(),
                }),
                () => setLogDescription(""),
              );
            }}
            className="self-start"
          >
            Save log
          </Button>
        </div>
      )}

      {panel === "bug" && (
        <div className="flex flex-col gap-2 rounded-lg border border-charcoal p-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setBugKind("bug")}
              className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${bugKind === "bug" ? "border-smark-orange text-smark-orange" : "border-charcoal text-smoke"}`}
            >
              Bug
            </button>
            <button
              type="button"
              onClick={() => setBugKind("change_request")}
              className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${bugKind === "change_request" ? "border-smark-orange text-smark-orange" : "border-charcoal text-smoke"}`}
            >
              Change request
            </button>
          </div>
          <Field label="Describe the issue">
            <Input value={bugDescription} onChange={(e) => setBugDescription(e.target.value)} />
          </Field>
          <Button
            size="sm"
            loading={isPending}
            onClick={() => {
              if (!bugDescription.trim()) {
                push({ msg: "Please describe the issue" });
                return;
              }
              run(() => reportBugAction({ taskId: task.id, description: bugDescription.trim(), classification: bugKind }), () =>
                setBugDescription(""),
              );
            }}
            className="self-start"
          >
            Report
          </Button>
        </div>
      )}

      {panel === "assign" && (
        <div className="flex flex-col gap-2 rounded-lg border border-charcoal p-3">
          <Field label="Engineer">
            <select
              value={assignUserId}
              onChange={(e) => setAssignUserId(e.target.value)}
              className="h-10 w-full rounded-lg border border-charcoal bg-surface-well px-3.5 text-sm text-snow outline-none focus:border-smark-orange"
            >
              <option value="">Select…</option>
              {engineers.map((eng) => (
                <option key={eng.id} value={eng.id}>
                  {eng.displayName ?? eng.username}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Estimated hours" className="w-24">
            <Input type="number" min="0.5" step="0.5" value={assignHours} onChange={(e) => setAssignHours(e.target.value)} />
          </Field>
          <Button
            size="sm"
            loading={isPending}
            onClick={() => {
              if (!assignUserId) {
                push({ msg: "Pick an engineer" });
                return;
              }
              run(() => assignTaskAction({ taskId: task.id, userId: assignUserId, estimatedHours: Number(assignHours) }));
            }}
            className="self-start"
          >
            Assign
          </Button>
        </div>
      )}

      {panel === "reminder" && projectId && (
        <div className="flex flex-col gap-3 rounded-lg border border-charcoal p-3">
          {!clientEmail ? (
            <>
              <p className="text-[13px] text-smoke">Add the client&apos;s email before sending a reminder.</p>
              <Field label="Client email">
                <Input type="email" value={clientEmailDraft} onChange={(e) => setClientEmailDraft(e.target.value)} />
              </Field>
              <Button
                size="sm"
                loading={isPending}
                className="self-start"
                onClick={() => {
                  if (!clientEmailDraft.trim()) {
                    push({ msg: "Enter a client email" });
                    return;
                  }
                  startTransition(async () => {
                    const result = await setProjectClientEmailAction({ projectId, clientEmail: clientEmailDraft.trim() });
                    if (result.ok) {
                      router.refresh();
                    } else {
                      push({ msg: result.error });
                    }
                  });
                }}
              >
                Save client email
              </Button>
            </>
          ) : activeReminder ? (
            <>
              <p className="text-[13px] text-snow">
                Reminder active — every {activeReminder.frequencyDays} day{activeReminder.frequencyDays === 1 ? "" : "s"}.
              </p>
              <p className="text-caption text-smoke">
                {activeReminder.lastSentAt ? `Last sent ${formatDate(activeReminder.lastSentAt)}` : "Not sent yet"} · Next send{" "}
                {formatDate(activeReminder.nextSendAt)}
              </p>
              <div className="flex items-center gap-2">
                <Field label="Change frequency (days)" className="w-32">
                  <Input
                    type="number"
                    min="1"
                    value={reminderFrequencyDraft}
                    onChange={(e) => setReminderFrequencyDraft(Number(e.target.value))}
                  />
                </Field>
                <Button
                  size="sm"
                  variant="outline"
                  loading={isPending}
                  onClick={() =>
                    run(() => updateReminderFrequencyAction({ reminderId: activeReminder.id, frequencyDays: reminderFrequencyDraft }))
                  }
                >
                  Update
                </Button>
              </div>
              <Button
                size="sm"
                variant="ghost"
                loading={isPending}
                className="self-start"
                onClick={() => run(() => cancelReminderAction({ reminderId: activeReminder.id }))}
              >
                Cancel reminder
              </Button>
            </>
          ) : (
            <>
              <Field label="Subject">
                <Input value={reminderSubject} onChange={(e) => setReminderSubject(e.target.value)} />
              </Field>
              <Field label="Message">
                <textarea
                  value={reminderBody}
                  onChange={(e) => setReminderBody(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-charcoal bg-surface-well px-3.5 py-2 text-sm text-snow outline-none focus:border-smark-orange"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-caption text-smoke">Resend every</span>
                {[1, 3, 7].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setReminderFrequency(days)}
                    className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${reminderFrequency === days ? "border-smark-orange text-smark-orange" : "border-charcoal text-smoke"}`}
                  >
                    {days}d
                  </button>
                ))}
                <Input
                  type="number"
                  min="1"
                  value={reminderFrequency}
                  onChange={(e) => setReminderFrequency(Number(e.target.value))}
                  className="w-16"
                />
              </div>
              <Button
                size="sm"
                loading={isPending}
                className="self-start"
                onClick={() => {
                  if (!reminderSubject.trim() || !reminderBody.trim()) {
                    push({ msg: "Subject and message are required" });
                    return;
                  }
                  startTransition(async () => {
                    const result = await composeAndSendReminderAction({
                      taskId: task.id,
                      subject: reminderSubject.trim(),
                      body: reminderBody.trim(),
                      frequencyDays: reminderFrequency,
                    });
                    if (result.ok) {
                      if (result.warning) push({ msg: result.warning });
                      setPanel(null);
                      router.refresh();
                    } else {
                      push({ msg: result.error });
                    }
                  });
                }}
              >
                Send reminder
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
