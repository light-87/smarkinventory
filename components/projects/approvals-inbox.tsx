"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { acceptChangeRequestAction, rejectChangeRequestAction, triageBugAction } from "@/lib/pm/actions";
import type { BugView, ChangeRequestView, EngineerOption } from "@/lib/pm/queries";
import { EngineerHoursMatrix } from "./engineer-hours-matrix";

export interface ApprovalsInboxProps {
  bugs: readonly BugView[];
  changeRequests: readonly ChangeRequestView[];
  taskTitleById: ReadonlyMap<string, string>;
  engineers: readonly EngineerOption[];
}

/** Owner approvals inbox: pending bugs (confirm/dismiss/reclassify) + pending change requests (accept/reject). */
export function ApprovalsInbox({ bugs, changeRequests, taskTitleById, engineers }: ApprovalsInboxProps) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [hoursByUser, setHoursByUser] = useState<Record<string, string>>({});

  const openBugs = bugs.filter((b) => b.status === "open");
  const pendingCrs = changeRequests.filter((c) => c.status === "pending");

  function triage(bugId: string, decision: "confirm" | "dismiss" | "reclassify") {
    startTransition(async () => {
      const result = await triageBugAction({ bugId, decision });
      if (result.ok) router.refresh();
      else push({ msg: result.error });
    });
  }

  function reject(changeRequestId: string) {
    startTransition(async () => {
      const result = await rejectChangeRequestAction({ changeRequestId });
      if (result.ok) router.refresh();
      else push({ msg: result.error });
    });
  }

  function accept(changeRequestId: string) {
    const trimmed = taskTitle.trim();
    if (!trimmed) {
      push({ msg: "Task title is required" });
      return;
    }
    const assignees = Object.entries(hoursByUser).map(([userId, hours]) => ({ userId, estimatedHours: Number(hours) || 0 }));
    startTransition(async () => {
      const result = await acceptChangeRequestAction({ changeRequestId, title: trimmed, assignees });
      if (result.ok) {
        setAcceptingId(null);
        setTaskTitle("");
        setHoursByUser({});
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  if (openBugs.length === 0 && pendingCrs.length === 0) {
    return <EmptyState tone="subtle" title="Nothing pending" description="Bug reports and change requests will show up here." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {openBugs.length > 0 && (
        <Card padding="none" className="border-l-[3px] border-l-warn">
          <div className="border-b border-border-divider px-5 py-4">
            <SectionLabel className="text-warn">Bugs pending triage</SectionLabel>
            <p className="mt-1 text-caption text-faint">
              Confirm a real bug (counts toward effectiveness), dismiss a non-issue, or reclassify it as a change request. The
              chip shows who reported it.
            </p>
          </div>
          <ul className="divide-y divide-border-hairline">
            {openBugs.map((bug) => (
              <li key={bug.id} className="flex flex-col gap-2 px-5 py-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-caption text-smoke">{taskTitleById.get(bug.taskId) ?? "Task"}</div>
                    <p className="text-[14px] text-snow">{bug.description}</p>
                  </div>
                  <Chip tone={bug.reportedSource === "client" ? "accent" : "neutral"}>{bug.reportedSource}</Chip>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => triage(bug.id, "confirm")} loading={isPending}>
                    Confirm
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => triage(bug.id, "dismiss")} loading={isPending}>
                    Dismiss
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => triage(bug.id, "reclassify")} loading={isPending}>
                    Reclassify as change request
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pendingCrs.length > 0 && (
        <Card padding="none" className="border-l-[3px] border-l-smark-orange">
          <div className="border-b border-border-divider px-5 py-4">
            <SectionLabel className="text-smark-orange">Change requests pending</SectionLabel>
            <p className="mt-1 text-caption text-faint">
              Accept to turn it into a new task (assign engineers below), or reject. The client sees the outcome in their portal.
            </p>
          </div>
          <ul className="divide-y divide-border-hairline">
            {pendingCrs.map((cr) => (
              <li key={cr.id} className="flex flex-col gap-2 px-5 py-3.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-[14px] text-snow">{cr.description}</p>
                  <Chip tone={cr.requestedSource === "client" ? "accent" : "neutral"}>{cr.requestedSource}</Chip>
                </div>

                {acceptingId === cr.id ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-charcoal p-3">
                    <Field label="New task title">
                      <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
                    </Field>
                    <EngineerHoursMatrix engineers={engineers} value={hoursByUser} onChange={setHoursByUser} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => accept(cr.id)} loading={isPending}>
                        Create task + accept
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAcceptingId(null)} disabled={isPending}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setAcceptingId(cr.id)}>
                      Accept
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => reject(cr.id)} loading={isPending}>
                      Reject
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
