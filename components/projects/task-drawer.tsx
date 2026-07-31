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
import { useActionRunner } from "@/hooks/use-action-runner";
import { formatDate, formatHours, toDateOnlyString } from "@/lib/format";
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

/** Today as `YYYY-MM-DD` in the user's OWN timezone. `toISOString()` would give
 *  the UTC day, which in IST is still yesterday until 5:30am — quietly filing
 *  early-morning work against the wrong date. */
function todayLocal(): string {
  return toDateOnlyString(new Date()) ?? "";
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
  const { run, isPending } = useActionRunner();
  const [isSending, startSending] = useTransition();

  // "Your work" form.
  const [hours, setHours] = useState("1");
  const [workDate, setWorkDate] = useState(todayLocal);
  const [logDescription, setLogDescription] = useState("");

  // "Log time on behalf" form — its own state. These used to share `hours` /
  // `workDate` / `logDescription` with the form above, so typing in one
  // visibly filled the other and the owner couldn't tell the two apart.
  const [onBehalfUserId, setOnBehalfUserId] = useState("");
  const [onBehalfHours, setOnBehalfHours] = useState("1");
  const [onBehalfDate, setOnBehalfDate] = useState(todayLocal);
  const [onBehalfDescription, setOnBehalfDescription] = useState("");

  const [bugDescription, setBugDescription] = useState("");
  const [bugKind, setBugKind] = useState<"bug" | "change_request">("bug");
  const [assignUserId, setAssignUserId] = useState("");
  const [assignHours, setAssignHours] = useState("1");
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
  const nameByUserId = new Map(task.assignees.map((a) => [a.userId, a.displayName ?? a.username]));

  const busy = isPending || isSending;

  const FREQUENCY_OPTIONS = [
    { value: "1", label: "Daily" },
    { value: "3", label: "Every 3d" },
    { value: "7", label: "Weekly" },
  ] as const;

  // A hold parks the task on `awaiting_client_input`, so gating this on
  // `status === "open"` alone hid the engineer's whole panel — including
  // Submit — the instant they pressed "Put on hold".
  const showYourWork = engineerControlsVisible && (task.status === "open" || task.status === "awaiting_client_input");
  const showReminders = isOwner && Boolean(projectId) && Boolean(openHold);
  const showEntries = task.timeLogs.length > 0;

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
                  <Field label="Date" htmlFor="log-date" className="flex-1">
                    <Input id="log-date" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
                  </Field>
                  <Field label="Hours" htmlFor="log-hours" className="w-24">
                    <Input
                      id="log-hours"
                      type="number"
                      min="0.5"
                      step="0.5"
                      max="24"
                      value={hours}
                      onChange={(e) => setHours(e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="What did you do?" htmlFor="log-description">
                  <Input id="log-description" value={logDescription} onChange={(e) => setLogDescription(e.target.value)} />
                </Field>
                <Button
                  size="sm"
                  loading={busy}
                  className="self-start"
                  onClick={() => {
                    if (!workDate) return push({ msg: "Pick the date you did the work" });
                    if (!(Number(hours) > 0)) return push({ msg: "Enter how many hours you spent" });
                    if (!logDescription.trim()) return push({ msg: "Please describe what you did" });
                    run(
                      () => logTimeAction({ taskId: task.id, workDate, hours: Number(hours), description: logDescription.trim() }),
                      { success: `Logged ${formatHours(Number(hours))}`, onDone: () => setLogDescription("") },
                    );
                  }}
                >
                  Save time log
                </Button>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                loading={busy}
                onClick={() => run(() => submitTaskAction({ taskId: task.id }), { success: "Sent for review" })}
              >
                Submit for review
              </Button>
              {!openHold && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy}
                  onClick={() =>
                    run(() => startHoldAction({ taskId: task.id, reason: "awaiting_client_input" }), {
                      success: "Task paused — waiting on the client",
                    })
                  }
                >
                  Put on hold (awaiting client)
                </Button>
              )}
            </div>
          </Section>
        )}

        {/* Time logged so far — the record that used to be invisible everywhere */}
        {showEntries && (
          <Section
            label="Time logged"
            hint={isOwner ? "Every entry on this task." : "Your entries on this task."}
          >
            <p className="text-[15px] text-snow">{formatHours(task.loggedHours)} logged in total.</p>
            <ul className="flex flex-col divide-y divide-border-hairline">
              {task.timeLogs.map((log) => (
                <li key={log.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[15px] text-snow">{log.description}</div>
                    <div className="text-caption text-smoke">
                      {formatDate(log.workDate)}
                      {isOwner && ` · ${nameByUserId.get(log.userId) ?? "Team member"}`}
                    </div>
                  </div>
                  <span className="flex-none text-[15px] text-smoke">{formatHours(log.hours)}</span>
                </li>
              ))}
            </ul>
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
                    onRemove={() =>
                      run(() => removeAssigneeAction({ taskId: task.id, userId: a.userId }), { success: "Engineer removed" })
                    }
                  >
                    {a.displayName ?? a.username} · {formatHours(a.loggedHours)} of {formatHours(a.estimatedHours)}
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
                  loading={busy}
                  onClick={() => {
                    if (!assignUserId) return push({ msg: "Pick an engineer" });
                    if (!(Number(assignHours) > 0)) return push({ msg: "Estimated hours must be more than 0" });
                    run(() => assignTaskAction({ taskId: task.id, userId: assignUserId, estimatedHours: Number(assignHours) }), {
                      success: "Engineer assigned",
                      onDone: () => setAssignUserId(""),
                    });
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

        {/* Log on behalf — owner. Hidden while the task is on hold: the server
            refuses time logs then, so offering the form only wastes the typing. */}
        {isOwner && task.assignees.length > 0 && !openHold && (
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
              <Field label="Date" htmlFor="behalf-date" className="flex-1">
                <Input id="behalf-date" type="date" value={onBehalfDate} onChange={(e) => setOnBehalfDate(e.target.value)} />
              </Field>
              <Field label="Hours" htmlFor="behalf-hours" className="w-24">
                <Input
                  id="behalf-hours"
                  type="number"
                  min="0.5"
                  step="0.5"
                  max="24"
                  value={onBehalfHours}
                  onChange={(e) => setOnBehalfHours(e.target.value)}
                />
              </Field>
            </div>
            <Field label="What did they do?" htmlFor="behalf-description">
              <Input
                id="behalf-description"
                value={onBehalfDescription}
                onChange={(e) => setOnBehalfDescription(e.target.value)}
              />
            </Field>
            <Button
              size="sm"
              loading={busy}
              className="self-start"
              onClick={() => {
                if (!onBehalfUserId) return push({ msg: "Pick an engineer" });
                if (!onBehalfDate) return push({ msg: "Pick the date the work was done" });
                if (!(Number(onBehalfHours) > 0)) return push({ msg: "Enter how many hours they spent" });
                if (!onBehalfDescription.trim()) return push({ msg: "Please describe what they did" });
                run(
                  () =>
                    ownerLogOnBehalfAction({
                      taskId: task.id,
                      userId: onBehalfUserId,
                      workDate: onBehalfDate,
                      hours: Number(onBehalfHours),
                      description: onBehalfDescription.trim(),
                    }),
                  {
                    success: `Logged ${formatHours(Number(onBehalfHours))} for ${nameByUserId.get(onBehalfUserId) ?? "them"}`,
                    onDone: () => setOnBehalfDescription(""),
                  },
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
            <Field label="Describe the issue" htmlFor="bug-description">
              <Input id="bug-description" value={bugDescription} onChange={(e) => setBugDescription(e.target.value)} />
            </Field>
            <Button
              size="sm"
              loading={busy}
              className="self-start"
              onClick={() => {
                if (!bugDescription.trim()) return push({ msg: "Please describe the issue" });
                run(() => reportBugAction({ taskId: task.id, description: bugDescription.trim(), classification: bugKind }), {
                  success: bugKind === "bug" ? "Bug reported" : "Change request sent",
                  onDone: () => setBugDescription(""),
                });
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
              loading={busy}
              className="self-start"
              onClick={() => run(() => endHoldAction({ taskId: task.id }), { success: "Task resumed" })}
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
                  loading={busy}
                  className="self-start"
                  onClick={() => {
                    if (!clientEmailDraft.trim()) return push({ msg: "Enter a client email" });
                    run(() => setProjectClientEmailAction({ projectId, clientEmail: clientEmailDraft.trim() }), {
                      success: "Client email saved",
                    });
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
                    loading={busy}
                    onClick={() =>
                      run(
                        () =>
                          updateReminderFrequencyAction({ reminderId: activeReminder.id, frequencyDays: reminderFrequencyDraft }),
                        { success: "Reminder frequency updated" },
                      )
                    }
                  >
                    Update frequency
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy}
                    onClick={() => run(() => cancelReminderAction({ reminderId: activeReminder.id }), { success: "Reminder cancelled" })}
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
                  loading={busy}
                  className="self-start"
                  onClick={() => {
                    if (!reminderSubject.trim() || !reminderBody.trim()) return push({ msg: "Subject and message are required" });
                    startSending(async () => {
                      try {
                        const result = await composeAndSendReminderAction({
                          taskId: task.id,
                          subject: reminderSubject.trim(),
                          body: reminderBody.trim(),
                          frequencyDays: reminderFrequency,
                        });
                        if (result.ok) {
                          push({ msg: result.warning ?? "Reminder sent" });
                          router.refresh();
                        } else {
                          push({ msg: result.error });
                        }
                      } catch (error) {
                        console.error("[pm] send reminder failed:", error);
                        push({ msg: "Couldn't reach the server — reload the page and try again." });
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
