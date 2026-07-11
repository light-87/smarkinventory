import Link from "next/link";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import type { OrderGroupView } from "@/lib/orders/queries";
import { OrderGroupShell } from "./order-group-header";

function ArrivedLineRow({ line }: { line: OrderGroupView["lines"][number] }) {
  const putAway = line.arrivedAt !== null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-charcoal px-3 py-2">
      <div className="min-w-0 text-[14px]">
        {line.internalPid && <span className="font-mono text-snow">{line.internalPid} </span>}
        <span className="text-silver-mist">{line.mpn ?? line.value ?? "—"}</span>
        <span className="ml-1.5 font-mono text-smoke">×{line.qtyOrdered.toLocaleString("en-IN")}</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {line.projectName && <Chip tone="default">{line.projectName}</Chip>}
          {line.bomName && <Chip tone="default">{line.bomName}</Chip>}
        </div>
      </div>
      <Chip tone={putAway ? "success" : "accent"}>{putAway ? "Put away" : "Pending put-away"}</Chip>
    </div>
  );
}

/** Arrived section — hand-off to Receive's put-away queue (plan/tab-on-order.md §3-D). */
export function ArrivedTab({ groups, canWrite }: { groups: readonly OrderGroupView[]; canWrite: boolean }) {
  if (groups.length === 0) {
    return <EmptyState title="Nothing arrived yet" description="Lines you mark arrived on the Ordered tab land here." />;
  }

  const pendingPutAway = groups.some((g) => g.lines.some((l) => l.arrivedAt === null));

  return (
    <div className="flex flex-col gap-4">
      {pendingPutAway && (
        <Link
          href="/receive?card=put-away"
          className="rounded-xl border border-smark-orange bg-surface-accent px-4 py-3 text-[14px] text-snow no-underline transition-colors hover:bg-surface-accent-hover"
        >
          Put away arrivals in Receive →
        </Link>
      )}
      {groups.map((group) => (
        <OrderGroupShell key={group.orderId} group={group} canWrite={canWrite}>
          <div className="flex flex-col gap-2">
            {group.lines.map((line) => (
              <ArrivedLineRow key={line.orderLineId} line={line} />
            ))}
          </div>
        </OrderGroupShell>
      ))}
    </div>
  );
}
