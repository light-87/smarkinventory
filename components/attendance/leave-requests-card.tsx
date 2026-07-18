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

  const requestedDays = startDate && endDate && endDate >= startDate ? countDaysInclusive(startDate, endDate) : 0;
  // (0018) comp-off is HOURS and the owner picks the deduction at approval — so
  // here we only guard against requesting a comp leave with nothing banked.
  const noCompBalance = reason === "compensatory" && compBalance <= 0;

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
      push({ msg: "You have no comp-off hours banked yet." });
      return;
    }
    startTransition(async () => {
      const result = await submitLeaveRequestAction({ startDate, endDate, reason, note: note || null });
      if (result.ok) {
        push({ msg: "Leave request submitted." });
        setStartDate("");
        setEndDate("");
        setNote("");
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <Card padding="none">
      <CardHeader title="My leave requests" meta={<span className="font-mono">{compBalance > 0 ? "+" : ""}{compBalance}h comp-off</span>} />
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
            <Field label="Reason" hint="Compensatory draws on the comp-off hours you earned from overtime / holiday work.">
              <NativeSelect
                value={reason}
                onChange={(e) => setReason(e.target.value as LeaveReason)}
                options={REASON_OPTIONS}
              />
            </Field>
            <Field label="Note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason / details" />
            </Field>
            {reason === "compensatory" && (
              <p className={noCompBalance ? "text-caption text-smark-orange-soft" : "text-caption text-smoke"}>
                {compBalance}h comp-off banked
                {noCompBalance ? " — nothing to draw on yet" : " · the owner sets the hours to deduct when approving"}
              </p>
            )}
            <Button size="sm" onClick={submit} loading={pending} disabled={noCompBalance}>
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
                  <div className="truncate text-[14px] text-snow">
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
