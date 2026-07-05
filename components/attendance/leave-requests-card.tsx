"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field, Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
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
  const exceedsBalance = reason === "compensatory" && requestedDays > compBalance;

  function submit() {
    if (!startDate || !endDate) {
      push({ msg: "Pick a start and end date." });
      return;
    }
    if (endDate < startDate) {
      push({ msg: "End date can't be before start date." });
      return;
    }
    if (exceedsBalance) {
      push({ msg: `Not enough comp balance: requesting ${requestedDays}, only ${Math.max(compBalance, 0)} available.` });
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
      <CardHeader title="My leave requests" meta={<span className="font-mono">{compBalance >= 0 ? `+${compBalance}` : compBalance} comp bal.</span>} />
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
            <Field label="Reason">
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as LeaveReason)}
                className="h-10 w-full rounded-lg border border-charcoal bg-surface-well px-3.5 text-sm text-snow outline-none focus:border-smark-orange"
              >
                {REASON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason / details" />
            </Field>
            {reason === "compensatory" && requestedDays > 0 && (
              <p className={exceedsBalance ? "text-caption text-smark-orange-soft" : "text-caption text-smoke"}>
                {requestedDays} day(s) requested · {compBalance} comp day(s) available
                {exceedsBalance ? " — exceeds balance" : ""}
              </p>
            )}
            <Button size="sm" onClick={submit} loading={pending} disabled={exceedsBalance}>
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
                  <div className="truncate text-[13px] text-snow">
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
