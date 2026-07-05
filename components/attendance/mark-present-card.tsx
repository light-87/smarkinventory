"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useToast } from "@/components/ui/toast";
import { markPresentAction, submitCompWorkAction } from "@/lib/attendance/actions";
import type { AttendanceStatus } from "@/lib/attendance/status";
import { StatusBadge } from "./status-badge";
import type { ProjectOption } from "@/lib/daily/queries";

export interface MarkPresentCardProps {
  todayDate: string;
  status: AttendanceStatus;
  holidayName: string | null;
  canWriteSelf: boolean;
  isTodayHoliday: boolean;
  hasPendingOrApprovedCompClaimToday: boolean;
  compBalance: number;
  myProjectOptions: readonly ProjectOption[];
}

/**
 * Self "mark present today" + "I worked this holiday" affordances
 * (prompt: Employee bullet). `status` is today's DERIVED status
 * (lib/attendance/status.ts) — "not_marked" is the only state either button
 * makes sense from.
 */
export function MarkPresentCard({
  todayDate,
  status,
  holidayName,
  canWriteSelf,
  isTodayHoliday,
  hasPendingOrApprovedCompClaimToday,
  compBalance,
  myProjectOptions,
}: MarkPresentCardProps) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState("");
  const [compNote, setCompNote] = useState("");
  const [showCompForm, setShowCompForm] = useState(false);

  function handleMarkPresent() {
    startTransition(async () => {
      const result = await markPresentAction({ projectId: projectId || null });
      if (result.ok) {
        push({ msg: "Marked present for today." });
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  function handleSubmitCompWork() {
    startTransition(async () => {
      const result = await submitCompWorkAction({ workDate: todayDate, note: compNote || null });
      if (result.ok) {
        push({ msg: "Comp-work claim submitted — awaiting owner approval." });
        setShowCompForm(false);
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <Card padding="none">
      <CardHeader title="Today" meta={<span className="font-mono">{compBalance >= 0 ? `+${compBalance}` : compBalance} comp days</span>} />
      <div className="flex flex-col gap-4 px-5 py-[18px]">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={status} holidayName={holidayName} />
          {isTodayHoliday && <Chip tone="neutral">Today is a holiday</Chip>}
        </div>

        {canWriteSelf && (status === "not_marked" || status === "absent") && (
          <div className="flex flex-wrap items-center gap-2">
            {myProjectOptions.length > 0 && (
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="h-9 rounded-lg border border-charcoal bg-surface-well px-3 text-[13px] text-snow outline-none focus:border-smark-orange"
                aria-label="Working on"
              >
                <option value="">No project</option>
                {myProjectOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <Button size="sm" onClick={handleMarkPresent} loading={pending}>
              Mark present
            </Button>
          </div>
        )}

        {canWriteSelf && isTodayHoliday && status === "not_marked" && !hasPendingOrApprovedCompClaimToday && (
          <div className="border-t border-border-faint pt-3">
            {!showCompForm ? (
              <Button size="sm" variant="accent-outline" onClick={() => setShowCompForm(true)}>
                I worked today — claim comp
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <input
                  value={compNote}
                  onChange={(e) => setCompNote(e.target.value)}
                  placeholder="What did you work on? (optional)"
                  className="h-9 rounded-lg border border-charcoal bg-surface-well px-3 text-[13px] text-snow outline-none placeholder:text-smoke focus:border-smark-orange"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSubmitCompWork} loading={pending}>
                    Submit claim
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowCompForm(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {canWriteSelf && isTodayHoliday && hasPendingOrApprovedCompClaimToday && (
          <Chip tone="soft">Comp-work claim already submitted for today</Chip>
        )}
      </div>
    </Card>
  );
}
