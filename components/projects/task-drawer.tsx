"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Drawer, DrawerHeader, DrawerBody, DrawerCloseButton } from "@/components/ui/drawer";
import { SectionLabel } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import type { EngineerOption, TaskHoldView, TaskView } from "@/lib/pm/queries";
import type { TaskReminderView } from "@/lib/reminders/queries";
import { NativeSelect } from "./native-select";
import {
  assignTaskAction,
  endHoldAction,
  logTimeAction,
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

export interface TaskDrawerProps {
  open: boolean;
  onClose: () => void;
  task: TaskView;
  isOwner: boolean;
  canWrite: boolean;
  currentUserId: string | null;
  openHold: TaskHoldView | null;
  engineers: readonly EngineerOption[];
  projectId?: string;
  clientEmail?: string | null;
  activeReminder?: TaskReminderView | null;
}

/** One drawer section: a labelled block with an optional helper caption. */
function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-border-divider pt-5 first:border-t-0 first:pt-0">
      <div>
        <SectionLabel>{label}</SectionLabel>
        {hint && <p className="mt-1 text-caption text-faint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * TaskDrawer — every secondary task action lives here (progressive
 * disclosure), so the task card face stays calm. Sections are role-gated and
 * reuse the exact same server actions the old inline panels called. Employees
 * see only "Your work"; owners see the rest.
 */
export function TaskDrawer({
  open,
  onClose,
  task,
  isOwner,
  canWrite,
  currentUserId,
  openHold,
  engineers,
  projectId,
  clientEmail,
  activeReminder,
}: TaskDrawerProps) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();

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
  const assignedIds = new Set(task.assignees.map((a) => a.userId));
  const unassignedEngineers = engineers.filter((e) => !assignedIds.has(e.id));

  function run(action: () => Promise<{ ok: boolean; error?: string }>, onDone?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        onDone?.();
        router.refresh();
      } else {
        push({ msg: result.error ?? "Something went wrong." });
      }
    });
  }

  const FREQUENCY_OPTIONS = [
    { value: "1", label: "Daily" },
    { value: "3", label: "Every 3d" },
    { value: "7", label: "Weekly" },
  ] as const;

  const showYourWork = engineerControlsVisible && task.status === "open";
  const showReminders = isOwner && Boolean(projectId) && Boolean(openHold);

  return (
    <Drawer open={open} onClose={onClose} aria-label={`Manage task: ${task.title}`}>
      <DrawerHeader>
        <div className="min-w-0">
          <SectionLabel>Manage task</SectionLabel>
          <div className="mt-1 truncate text-[17px] text-snow">{task.title}</div>
        </div>
        <DrawerCloseButton onClick={onClose} />
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-6">
        {/* Your work — the assigned engineer's own controls */}
        {showYourWork && (
          <Section label="Your work" hint="Log the time you spent, then submit the task for the owner to review.">
            {!openHold && (
              <>
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
                  className="self-start"
                  onClick={() => {
                    if (!logDescription.trim()) return push({ msg: "Please describe what you did" });
                    run(
                      () => logTimeAction({ taskId: task.id, workDate, hours: Number(hours), description: logDescription.trim() }),
                      () => setLogDescription(""),
                    );
                  }}
                >
                  Save time log
                </Button>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" loading={isPending} onClick={() => run(() => submitTaskAction({ taskId: task.id }))}>
                Submit for review
              </Button>
              {!openHold && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={isPending}
                  onClick={() => run(() => startHoldAction({ taskId: task.id, reason: "awaiting_client_input" }))}
                >
                  Put on hold (awaiting client)
                </Button>
              )}
            </div>
          </Section>
        )}

        {/* Assignees — owner */}
        {isOwner && (
          <Section label="Engineers" hint="Assign engineers and their estimated hours. Estimates drive the efficiency score.">
            {task.assignees.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {task.assignees.map((a) => (
                  <Chip
                    key={a.userId}
                    tone="soft"
                    onRemove={() => run(() => removeAssigneeAction({ taskId: task.id, userId: a.userId }))}
                  >
                    {a.displayName ?? a.username} · {a.estimatedHours}h est.
                  </Chip>
                ))}
              </div>
            )}
            {unassignedEngineers.length > 0 ? (
              <div className="flex items-end gap-2">
                <Field label="Add engineer" className="flex-1">
                  <NativeSelect
                    placeholder="Select…"
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                    options={unassignedEngineers.map((e) => ({ value: e.id, label: e.displayName ?? e.username }))}
                  />
                </Field>
                <Field label="Est. hours" className="w-24">
                  <Input type="number" min="0.5" step="0.5" value={assignHours} onChange={(e) => setAssignHours(e.target.value)} />
                </Field>
                <Button
                  size="sm"
                  loading={isPending}
                  onClick={() => {
                    if (!assignUserId) return push({ msg: "Pick an engineer" });
                    run(
                      () => assignTaskAction({ taskId: task.id, userId: assignUserId, estimatedHours: Number(assignHours) }),
                      () => setAssignUserId(""),
                    );
                  }}
                >
                  Assign
                </Button>
              </div>
            ) : (
              <p className="text-caption text-faint">Everyone is already assigned.</p>
            )}
          </Section>
        )}

        {/* Log on behalf — owner */}
        {isOwner && task.assignees.length > 0 && (
          <Section label="Log time on behalf" hint="Record hours for an engineer who couldn't log them.">
            <Field label="Engineer">
              <NativeSelect
                placeholder="Select…"
                value={onBehalfUserId}
                onChange={(e) => setOnBehalfUserId(e.target.value)}
                options={task.assignees.map((a) => ({ value: a.userId, label: a.displayName ?? a.username }))}
              />
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
              className="self-start"
              onClick={() => {
                if (!onBehalfUserId) return push({ msg: "Pick an engineer" });
                if (!logDescription.trim()) return push({ msg: "Please describe what they did" });
                run(
                  () =>
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
            >
              Save time log
            </Button>
          </Section>
        )}

        {/* Report an issue — any writer */}
        {canWrite && (
          <Section label="Report an issue" hint="Log a bug found in this work, or request a change to the scope.">
            <SegmentedControl
              aria-label="Issue type"
              options={[
                { value: "bug", label: "Bug" },
                { value: "change_request", label: "Change request" },
              ]}
              value={bugKind}
              onChange={setBugKind}
            />
            <Field label="Describe the issue">
              <Input value={bugDescription} onChange={(e) => setBugDescription(e.target.value)} />
            </Field>
            <Button
              size="sm"
              loading={isPending}
              className="self-start"
              onClick={() => {
                if (!bugDescription.trim()) return push({ msg: "Please describe the issue" });
                run(
                  () => reportBugAction({ taskId: task.id, description: bugDescription.trim(), classification: bugKind }),
                  () => setBugDescription(""),
                );
              }}
            >
              Report
            </Button>
          </Section>
        )}

        {/* Client input & reminders — owner, only while awaiting client input */}
        {showReminders && projectId && (
          <Section
            label="Client input & reminders"
            hint="This task is paused waiting on the client. Mark it received, or send an email reminder."
          >
            {openHold && (
              <p className="text-[15px] text-smoke">Awaiting client input since {formatDate(openHold.startedAt)}.</p>
            )}
            <Button
              size="sm"
              variant="outline"
              loading={isPending}
              className="self-start"
              onClick={() => run(() => endHoldAction({ taskId: task.id }))}
            >
              Mark input received
            </Button>

            {!clientEmail ? (
              <>
                <Field label="Client email" hint="Add the client's email before sending reminders.">
                  <Input type="email" value={clientEmailDraft} onChange={(e) => setClientEmailDraft(e.target.value)} />
                </Field>
                <Button
                  size="sm"
                  loading={isPending}
                  className="self-start"
                  onClick={() => {
                    if (!clientEmailDraft.trim()) return push({ msg: "Enter a client email" });
                    run(() => setProjectClientEmailAction({ projectId, clientEmail: clientEmailDraft.trim() }));
                  }}
                >
                  Save client email
                </Button>
              </>
            ) : activeReminder ? (
              <>
                <p className="text-[15px] text-snow">
                  Reminder active — {FREQUENCY_OPTIONS.find((o) => o.value === String(activeReminder.frequencyDays))?.label ??
                    `every ${activeReminder.frequencyDays} days`}
                  .
                </p>
                <p className="text-caption text-smoke">
                  {activeReminder.lastSentAt ? `Last sent ${formatDate(activeReminder.lastSentAt)}` : "Not sent yet"} · Next{" "}
                  {formatDate(activeReminder.nextSendAt)}
                </p>
                <Field label="Change frequency">
                  <SegmentedControl
                    aria-label="Reminder frequency"
                    options={FREQUENCY_OPTIONS}
                    value={String(reminderFrequencyDraft)}
                    onChange={(v) => setReminderFrequencyDraft(Number(v))}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    loading={isPending}
                    onClick={() =>
                      run(() => updateReminderFrequencyAction({ reminderId: activeReminder.id, frequencyDays: reminderFrequencyDraft }))
                    }
                  >
                    Update frequency
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={isPending}
                    onClick={() => run(() => cancelReminderAction({ reminderId: activeReminder.id }))}
                  >
                    Cancel reminder
                  </Button>
                </div>
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
                <Field label="Resend frequency">
                  <SegmentedControl
                    aria-label="Resend frequency"
                    options={FREQUENCY_OPTIONS}
                    value={String(reminderFrequency)}
                    onChange={(v) => setReminderFrequency(Number(v))}
                  />
                </Field>
                <Button
                  size="sm"
                  loading={isPending}
                  className="self-start"
                  onClick={() => {
                    if (!reminderSubject.trim() || !reminderBody.trim()) return push({ msg: "Subject and message are required" });
                    startTransition(async () => {
                      const result = await composeAndSendReminderAction({
                        taskId: task.id,
                        subject: reminderSubject.trim(),
                        body: reminderBody.trim(),
                        frequencyDays: reminderFrequency,
                      });
                      if (result.ok) {
                        if (result.warning) push({ msg: result.warning });
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
          </Section>
        )}
      </DrawerBody>
    </Drawer>
  );
}
