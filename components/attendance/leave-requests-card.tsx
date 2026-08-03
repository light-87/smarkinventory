"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field, Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { NativeSelect } from "./native-select";
import { formatDate } from "@/lib/format";
import { submitLeaveRequestAction } from "@/lib/attendance/actions";
import { countDaysInclusive } from "@/lib/attendance/status";
import { canSpendCompDays, compDaysForLeave, formatCompDays } from "@/lib/attendance/comp-days";
import type { LeaveRequestView } from "@/lib/attendance/queries";
import type { LeaveReason } from "@/types/db";

export interface LeaveRequestsCardProps {
  myRequests: readonly LeaveRequestView[];
  compBalance: number;
  canWrite: boolean;
}

const REASON_OPTIONS: { value: LeaveReason; label: string }[] = [
  { value: "personal", label: "Personal" },
  { value: "sick", label: "Sick" },
  { value: "compensatory", label: "Compensatory" },
];

const STATUS_TONE = { pending: "soft", approved: "success", rejected: "default" } as const;

/** Employee's own leave requests + a new-request form (prompt: Employee bullet — "new-leave form ... shows comp balance and blocks a compensatory leave that exceeds balance"). */
export function LeaveRequestsCard({ myRequests, compBalance, canWrite }: LeaveRequestsCardProps) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState<LeaveReason>("personal");
  const [note, setNote] = useState("");
  const [halfDay, setHalfDay] = useState(false);

  const requestedDays = startDate && endDate && endDate >= startDate ? countDaysInclusive(startDate, endDate) : 0;
  // (0020) comp-off is DAYS: half a day costs 0.5, otherwise one per calendar
  // day. The cost is a property of the request, so the employee sees the price
  // before submitting instead of learning it at approval.
  const singleDay = requestedDays === 1;
  const compCost = reason === "compensatory" ? compDaysForLeave(requestedDays, halfDay && singleDay) : 0;
  const noCompBalance = reason === "compensatory" && compBalance <= 0;
  const cantAfford = reason === "compensatory" && compCost > 0 && !canSpendCompDays(compBalance, compCost);

  function submit() {
    if (!startDate || !endDate) {
      push({ msg: "Pick a start and end date." });
      return;
    }
    if (endDate < startDate) {
      push({ msg: "End date can't be before start date." });
      return;
    }
    if (noCompBalance) {
      push({ msg: "You have no comp-off days banked yet." });
      return;
    }
    if (cantAfford) {
      push({ msg: `That costs ${formatCompDays(compCost)} and you have ${formatCompDays(compBalance)} banked.` });
      return;
    }
    startTransition(async () => {
      const result = await submitLeaveRequestAction({
        startDate,
        endDate,
        reason,
        note: note || null,
        halfDay: halfDay && singleDay,
      });
      if (result.ok) {
        push({ msg: "Leave request submitted." });
        setStartDate("");
        setEndDate("");
        setNote("");
        setHalfDay(false);
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <Card padding="none">
      <CardHeader title="My leave requests" meta={<span className="font-mono">{formatCompDays(compBalance)} comp-off</span>} />
      <div className="flex flex-col gap-4 px-5 py-[18px]">
        {canWrite && (
          <div className="flex flex-col gap-3 rounded-xl border border-charcoal bg-surface-panel p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field label="End date">
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
            </div>
            <Field label="Reason" hint="Compensatory draws on the comp-off days you earned from extra hours / holiday work.">
              <NativeSelect
                value={reason}
                onChange={(e) => setReason(e.target.value as LeaveReason)}
                options={REASON_OPTIONS}
              />
            </Field>
            <Field label="Note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason / details" />
            </Field>
            {reason === "compensatory" && singleDay && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px] text-snow select-none">
                <input
                  type="checkbox"
                  checked={halfDay}
                  onChange={(e) => setHalfDay(e.target.checked)}
                  className="size-[18px] flex-none accent-smark-orange"
                />
                Half day (costs 0.5)
              </label>
            )}
            {reason === "compensatory" && (
              <p className={noCompBalance || cantAfford ? "text-caption text-smark-orange-soft" : "text-caption text-smoke"}>
                {formatCompDays(compBalance)} banked
                {noCompBalance
                  ? " — nothing to draw on yet"
                  : compCost > 0
                    ? ` · this leave costs ${formatCompDays(compCost)}`
                    : ""}
              </p>
            )}
            <Button size="sm" onClick={submit} loading={pending} disabled={noCompBalance || cantAfford}>
              Submit request
            </Button>
          </div>
        )}

        {myRequests.length === 0 ? (
          <EmptyState tone="subtle" title="No leave requests yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {myRequests.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-charcoal bg-surface-panel px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] text-snow">
                    {formatDate(r.startDate)}
                    {r.endDate !== r.startDate ? ` – ${formatDate(r.endDate)}` : ""} · {r.reason}
                  </div>
                  {r.note && <div className="truncate text-caption text-smoke">{r.note}</div>}
                </div>
                <Chip tone={STATUS_TONE[r.status]} size="sm">
                  {r.status}
                </Chip>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
