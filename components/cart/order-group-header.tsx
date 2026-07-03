import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { formatDate, formatINR } from "@/lib/format";
import type { OrderGroupView } from "@/lib/orders/queries";
import { ReceiptUpload } from "./receipt-upload";

const STATUS_CHIP: Record<OrderGroupView["status"], { label: string; tone: "default" | "accent" | "success" }> = {
  ordered: { label: "Ordered", tone: "default" },
  partially_arrived: { label: "Partially arrived", tone: "accent" },
  arrived: { label: "Arrived", tone: "success" },
};

/** PO header strip (number, status, date) — the secondary meta line renders in the body below it. */
function OrderGroupHeader({ group }: { group: OrderGroupView }) {
  const status = STATUS_CHIP[group.status];
  return (
    <CardHeader
      title={
        <span className="flex items-center gap-2">
          <span className="font-mono">PO {group.poNumber}</span>
          <Chip tone={status.tone}>{status.label}</Chip>
        </span>
      }
      meta={formatDate(group.placedAt)}
    />
  );
}

/** Shared PO card shell (header + distributor/placed-by/total meta + receipt control) for Ordered/Arrived. */
export function OrderGroupShell({
  group,
  canWrite,
  children,
}: {
  group: OrderGroupView;
  canWrite: boolean;
  children: ReactNode;
}) {
  return (
    <Card padding="none">
      <OrderGroupHeader group={group} />
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-smoke">
          <span>{group.distributorName}</span>
          {group.placedByName && <span>· by {group.placedByName}</span>}
          <span>· {formatINR(group.totalInr)}</span>
        </div>
        {children}
        <div className="border-t border-border-divider pt-3">
          <ReceiptUpload orderId={group.orderId} receiptUrl={group.receiptUrl} canWrite={canWrite} />
        </div>
      </CardBody>
    </Card>
  );
}
