"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { decideCompWorkAction, decideLeaveRequestAction } from "@/lib/attendance/actions";
import type { CompWorkView, LeaveRequestView } from "@/lib/attendance/queries";

export interface ApprovalsInboxCardProps {
  pendingLeaves: readonly LeaveRequestView[];
  pendingCompWork: readonly CompWorkView[];
  nameById: ReadonlyMap<string, string>;
}

/** Owner's pending comp-work + leave-request inbox — approve/reject inline (prompt: Owner bullet). */
export function ApprovalsInboxCard({ pendingLeaves, pendingCompWork, nameById }: ApprovalsInboxCardProps) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();

  function decideLeave(id: string, approve: boolean) {
    startTransition(async () => {
      const result = await decideLeaveRequestAction({ id, approve });
      if (result.ok) {
        push({ msg: approve ? "Leave approved." : "Leave rejected." });
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  function decideComp(id: string, approve: boolean) {
    startTransition(async () => {
      const result = await decideCompWorkAction({ id, approve });
      if (result.ok) {
        push({ msg: approve ? "Comp work approved." : "Comp work rejected." });
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  const totalPending = pendingLeaves.length + pendingCompWork.length;

  return (
    <Card padding="none">
      <CardHeader title="Approvals" meta={totalPending > 0 ? `${totalPending} pending` : "All clear"} />
      <div className="flex flex-col gap-4 px-5 py-[18px]">
        {totalPending === 0 ? (
          <EmptyState tone="subtle" title="Nothing waiting on you" />
        ) : (
          <>
            {pendingLeaves.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-charcoal bg-surface-panel px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-snow">
                    {nameById.get(r.userId) ?? "Unknown"} — leave ({r.reason})
                  </div>
                  <div className="truncate text-caption text-smoke">
                    {formatDate(r.startDate)}
                    {r.endDate !== r.startDate ? ` – ${formatDate(r.endDate)}` : ""}
                    {r.note ? ` · ${r.note}` : ""}
                  </div>
                </div>
                <div className="flex flex-none gap-2">
                  <Button size="sm" onClick={() => decideLeave(r.id, true)} loading={pending}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => decideLeave(r.id, false)} loading={pending}>
                    Reject
                  </Button>
                </div>
              </div>
            ))}

            {pendingCompWork.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-charcoal bg-surface-panel px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-snow">
                    {nameById.get(c.userId) ?? "Unknown"} — worked {formatDate(c.workDate)}
                  </div>
                  {c.note && <div className="truncate text-caption text-smoke">{c.note}</div>}
                </div>
                <div className="flex flex-none gap-2">
                  <Button size="sm" onClick={() => decideComp(c.id, true)} loading={pending}>
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
