"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { decideCompWorkAction, decideLeaveRequestAction, decideOvertimeAction } from "@/lib/attendance/actions";
import { countDaysInclusive, HOURS_PER_DAY } from "@/lib/attendance/status";
import type { CompWorkView, LeaveRequestView, OvertimeView } from "@/lib/attendance/queries";

export interface ApprovalsInboxCardProps {
  pendingLeaves: readonly LeaveRequestView[];
  pendingCompWork: readonly CompWorkView[];
  pendingOvertime: readonly OvertimeView[];
  /** (0018) live comp-off HOURS balance per employee with a pending comp leave. */
  compBalanceByUser: ReadonlyMap<string, number>;
  nameById: ReadonlyMap<string, string>;
}

// Pending approvals are "waiting on you" — an amber pod (tint + left accent) so
// the whole row reads as needs-attention, not just the buttons.
const ROW = "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal border-l-4 border-l-warn bg-surface-warn px-4 py-3";

/** Owner's pending inbox — leave (with comp-off hours deduction), comp-work, and overtime. */
export function ApprovalsInboxCard({
  pendingLeaves,
  pendingCompWork,
  pendingOvertime,
  compBalanceByUser,
  nameById,
}: ApprovalsInboxCardProps) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();

  function run(promise: Promise<{ ok: true } | { ok: false; error: string }>, okMsg: string) {
    startTransition(async () => {
      const result = await promise;
      if (result.ok) {
        push({ msg: okMsg });
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  const decideComp = (id: string, approve: boolean) =>
    run(decideCompWorkAction({ id, approve }), approve ? "Comp work approved." : "Comp work rejected.");

  const total = pendingLeaves.length + pendingCompWork.length + pendingOvertime.length;

  return (
    <Card padding="none">
      <CardHeader title="Approvals" meta={total > 0 ? `${total} pending` : "All clear"} />
      <div className="flex flex-col gap-4 px-5 py-[18px]">
        {total === 0 ? (
          <EmptyState tone="subtle" title="Nothing waiting on you" />
        ) : (
          <>
            {pendingLeaves.map((r) => (
              <LeaveApprovalRow
                key={r.id}
                leave={r}
                name={nameById.get(r.userId) ?? "Unknown"}
                balance={compBalanceByUser.get(r.userId) ?? 0}
                pending={pending}
                onDecide={(approve, compHours) =>
                  run(
                    decideLeaveRequestAction({ id: r.id, approve, compHours }),
                    approve ? "Leave approved." : "Leave rejected.",
                  )
                }
              />
            ))}

            {pendingOvertime.map((o) => (
              <OvertimeApprovalRow
                key={o.id}
                overtime={o}
                name={nameById.get(o.userId) ?? "Unknown"}
                pending={pending}
                onDecide={(approve, hoursApproved) =>
                  run(
                    decideOvertimeAction({ id: o.id, approve, hoursApproved }),
                    approve ? "Overtime approved." : "Overtime rejected.",
                  )
                }
              />
            ))}

            {pendingCompWork.map((c) => (
              <div key={c.id} className={ROW}>
                <div className="min-w-0">
                  <div className="truncate text-[15px] text-snow">
                    {nameById.get(c.userId) ?? "Unknown"} — worked {formatDate(c.workDate)}
                  </div>
                  {c.note && <div className="truncate text-caption text-smoke">{c.note}</div>}
                </div>
                <div className="flex flex-none gap-2">
                  <Button size="sm" variant="success" onClick={() => decideComp(c.id, true)} loading={pending}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => decideComp(c.id, false)} loading={pending}>
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </Card>
  );
}

function LeaveApprovalRow({
  leave,
  name,
  balance,
  pending,
  onDecide,
}: {
  leave: LeaveRequestView;
  name: string;
  balance: number;
  pending: boolean;
  onDecide: (approve: boolean, compHours: number | null) => void;
}) {
  const isComp = leave.reason === "compensatory";
  const defaultHours = Math.min(countDaysInclusive(leave.startDate, leave.endDate) * HOURS_PER_DAY, Math.max(balance, 0));
  const [hours, setHours] = useState(String(defaultHours));

  function approve() {
    if (!isComp) return onDecide(true, null);
    const h = Number.parseFloat(hours);
    if (!Number.isFinite(h) || h < 0) return;
    onDecide(true, h);
  }

  return (
    <div className={ROW}>
      <div className="min-w-0">
        <div className="truncate text-[15px] text-snow">
          {name} — leave ({leave.reason})
        </div>
        <div className="truncate text-caption text-smoke">
          {formatDate(leave.startDate)}
          {leave.endDate !== leave.startDate ? ` – ${formatDate(leave.endDate)}` : ""}
          {leave.note ? ` · ${leave.note}` : ""}
        </div>
      </div>
      <div className="flex flex-none flex-wrap items-center gap-2">
        {isComp && (
          <span className="flex items-center gap-1.5 text-caption text-smoke">
            <Chip tone={balance > 0 ? "success" : "warn"} mono>
              {balance}h banked
            </Chip>
            deduct
            <input
              type="number"
              min="0"
              step="0.5"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="h-9 w-20 rounded-lg border border-charcoal bg-surface-well px-2 font-mono text-[14px] text-snow outline-none focus:border-smark-orange"
            />
            h
          </span>
        )}
        <Button size="sm" variant="success" onClick={approve} loading={pending}>
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDecide(false, null)} loading={pending}>
          Reject
        </Button>
      </div>
    </div>
  );
}

function OvertimeApprovalRow({
  overtime,
  name,
  pending,
  onDecide,
}: {
  overtime: OvertimeView;
  name: string;
  pending: boolean;
  onDecide: (approve: boolean, hoursApproved: number | null) => void;
}) {
  const [hours, setHours] = useState(String(overtime.hoursClaimed));

  function approve() {
    const h = Number.parseFloat(hours);
    if (!Number.isFinite(h) || h < 0) return;
    onDecide(true, h);
  }

  return (
    <div className={ROW}>
      <div className="min-w-0">
        <div className="truncate text-[15px] text-snow">
          {name} — overtime {overtime.hoursClaimed}h on {formatDate(overtime.workDate)}
        </div>
        {overtime.note && <div className="truncate text-caption text-smoke">{overtime.note}</div>}
      </div>
      <div className="flex flex-none flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-caption text-smoke">
          approve
          <input
            type="number"
            min="0"
            max="24"
            step="0.5"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="h-9 w-20 rounded-lg border border-charcoal bg-surface-well px-2 font-mono text-[14px] text-snow outline-none focus:border-smark-orange"
          />
          h
        </span>
        <Button size="sm" variant="success" onClick={approve} loading={pending}>
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDecide(false, null)} loading={pending}>
          Reject
        </Button>
      </div>
    </div>
  );
}
