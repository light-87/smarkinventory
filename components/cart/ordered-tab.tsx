"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { markOrderLineArrivedAction } from "@/lib/orders/actions";
import type { OrderGroupView } from "@/lib/orders/queries";
import { OrderGroupShell } from "./order-group-header";

function OrderedLineRow({ line, canWrite }: { line: OrderGroupView["lines"][number]; canWrite: boolean }) {
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();

  function markArrived() {
    startTransition(async () => {
      const result = await markOrderLineArrivedAction({ orderLineId: line.orderLineId });
      if (!result.ok) push({ msg: result.error });
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-charcoal px-3 py-2">
      <div className="min-w-0 text-[13px]">
        {line.internalPid && <span className="font-mono text-snow">{line.internalPid} </span>}
        <span className="text-silver-mist">{line.mpn ?? line.value ?? "—"}</span>
        <span className="ml-1.5 font-mono text-smoke">×{line.qtyOrdered.toLocaleString("en-IN")}</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {line.projectName && <Chip tone="default">{line.projectName}</Chip>}
          {line.bomName && <Chip tone="default">{line.bomName}</Chip>}
        </div>
      </div>
      {canWrite && (
        <Button size="sm" variant="outline" loading={isPending} onClick={markArrived}>
          Mark arrived
        </Button>
      )}
    </div>
  );
}

export function OrderedTab({ groups, canWrite }: { groups: readonly OrderGroupView[]; canWrite: boolean }) {
  if (groups.length === 0) {
    return <EmptyState title="Nothing on order" description="Placed orders show up here until every line is marked arrived." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <OrderGroupShell key={group.orderId} group={group} canWrite={canWrite}>
          <div className="flex flex-col gap-2">
            {group.lines.map((line) => (
              <OrderedLineRow key={line.orderLineId} line={line} canWrite={canWrite} />
            ))}
          </div>
        </OrderGroupShell>
      ))}
    </div>
  );
}
