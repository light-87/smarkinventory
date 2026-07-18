"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useToast } from "@/components/ui/toast";
import { markOutAction, markPresentAction, submitCompWorkAction, submitOvertimeAction } from "@/lib/attendance/actions";
import type { AttendanceStatus } from "@/lib/attendance/status";
import type { ApprovalStatus } from "@/types/db";
import { StatusBadge } from "./status-badge";
import { NativeSelect } from "./native-select";
import type { ProjectOption } from "@/lib/daily/queries";

export interface MarkPresentCardProps {
  todayDate: string;
  status: AttendanceStatus;
  holidayName: string | null;
  canWriteSelf: boolean;
  isTodayHoliday: boolean;
  hasPendingOrApprovedCompClaimToday: boolean;
  /** (0018) HOURS comp-off balance. */
  compBalance: number;
  /** (0018) present (checked in) today. */
  iAmPresentToday: boolean;
  /** (0018) already stamped a check-out today. */
  hasCheckedOutToday: boolean;
  /** (0018) today's overtime claim, if any. */
  overtimeToday: { hours: number; status: ApprovalStatus } | null;
  myProjectOptions: readonly ProjectOption[];
}

const OVERTIME_TONE: Record<ApprovalStatus, "warn" | "success" | "danger"> = {
  pending: "warn",
  approved: "success",
  rejected: "danger",
};

/**
 * Self "mark present / mark out today", overtime capture, and "I worked this
 * holiday" affordances. `status` is today's DERIVED status
 * (lib/attendance/status.ts). At mark-out the employee can report extra hours,
 * which go to the owner for approval and bank as comp-off HOURS (0018).
 */
export function MarkPresentCard({
  todayDate,
  status,
  holidayName,
  canWriteSelf,
  isTodayHoliday,
  hasPendingOrApprovedCompClaimToday,
  compBalance,
  iAmPresentToday,
  hasCheckedOutToday,
  overtimeToday,
  myProjectOptions,
}: MarkPresentCardProps) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState("");
  const [compNote, setCompNote] = useState("");
  const [showCompForm, setShowCompForm] = useState(false);
  const [markingOut, setMarkingOut] = useState(false);
  const [overtimeHours, setOvertimeHours] = useState("");

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

  function handleMarkOut() {
    const hours = overtimeHours.trim() ? Number.parseFloat(overtimeHours.trim()) : 0;
    if (overtimeHours.trim() && (!Number.isFinite(hours) || hours <= 0 || hours > 24)) {
      push({ msg: "Extra hours must be between 0 and 24." });
      return;
    }
    startTransition(async () => {
      const out = await markOutAction();
      if (!out.ok) {
        push({ msg: out.error });
        return;
      }
      if (hours > 0) {
        const ot = await submitOvertimeAction({ workDate: todayDate, hours, note: null });
        if (!ot.ok) {
          push({ msg: `Marked out, but overtime failed: ${ot.error}` });
          setMarkingOut(false);
          router.refresh();
          return;
        }
        push({ msg: `Marked out · ${hours}h overtime sent for approval.` });
      } else {
        push({ msg: "Marked out for today." });
      }
      setMarkingOut(false);
      setOvertimeHours("");
      router.refresh();
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

  const compLabel = `${compBalance > 0 ? "+" : ""}${compBalance}h comp-off`;

  return (
    <Card padding="none">
      <CardHeader title="Today" meta={<span className="font-mono">{compLabel}</span>} />
      <div className="flex flex-col gap-4 px-5 py-[18px]">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={status} holidayName={holidayName} />
          {isTodayHoliday && <Chip tone="neutral">Today is a holiday</Chip>}
          {overtimeToday && (
            <Chip tone={OVERTIME_TONE[overtimeToday.status]}>
              Overtime {overtimeToday.hours}h · {overtimeToday.status}
            </Chip>
          )}
        </div>

        {canWriteSelf && (status === "not_marked" || status === "absent") && (
          <div className="flex flex-wrap items-center gap-2">
            {myProjectOptions.length > 0 && (
              <NativeSelect
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="h-9 w-auto"
                aria-label="Working on"
                placeholder="No project"
                options={myProjectOptions.map((p) => ({ value: p.id, label: p.name }))}
              />
            )}
            <Button size="sm" onClick={handleMarkPresent} loading={pending}>
              Mark in
            </Button>
          </div>
        )}

        {/* Mark out (with optional overtime) — only while present and not yet clocked out. */}
        {canWriteSelf && iAmPresentToday && !hasCheckedOutToday && (
          <div className="border-t border-border-faint pt-3">
            {!markingOut ? (
              <Button size="sm" variant="accent" onClick={() => setMarkingOut(true)}>
                Mark out
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <label className="text-caption text-smoke" htmlFor="overtime-hours">
                  Worked extra hours today? (optional — sent to owner for approval)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="overtime-hours"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="24"
                    step="0.5"
                    value={overtimeHours}
                    onChange={(e) => setOvertimeHours(e.target.value)}
                    placeholder="e.g. 3"
                    className="h-9 w-24 rounded-lg border border-charcoal bg-surface-well px-3 font-mono text-[14px] text-snow outline-none placeholder:text-smoke focus:border-smark-orange"
                  />
                  <span className="text-caption text-smoke">hours</span>
                  <Button size="sm" onClick={handleMarkOut} loading={pending}>
                    Confirm mark-out
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setMarkingOut(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {canWriteSelf && isTodayHoliday && status === "not_marked" && !hasPendingOrApprovedCompClaimToday && (
          <div className="border-t border-border-faint pt-3">
            {!showCompForm ? (
              <>
                <Button size="sm" variant="accent-outline" onClick={() => setShowCompForm(true)}>
                  I worked today — claim comp
                </Button>
                <p className="mt-2 text-caption text-faint">
                  Worked on a holiday? Claim a comp day. Once the owner approves, it adds to your balance and you can take it as paid leave later.
                </p>
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <input
                  value={compNote}
                  onChange={(e) => setCompNote(e.target.value)}
                  placeholder="What did you work on? (optional)"
                  className="h-9 rounded-lg border border-charcoal bg-surface-well px-3 text-[14px] text-snow outline-none placeholder:text-smoke focus:border-smark-orange"
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
