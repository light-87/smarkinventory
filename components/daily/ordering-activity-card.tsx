import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTime } from "@/lib/format";
import type { OrderingActivityItem, OrderingActivityKind } from "@/lib/daily/compute";

export interface OrderingActivityCardProps {
  items: OrderingActivityItem[] | null;
  error?: string | null;
  nameById: ReadonlyMap<string, string>;
}

const KIND_LABEL: Record<OrderingActivityKind, string> = {
  bom_uploaded: "BOM",
  run_started: "run",
  run_finished: "run",
  cart_add: "cart",
  order_placed: "order",
  arrival: "arrival",
};

/** Section 3 — Ordering activity today (FEATURES.md §5.13): uploads, runs, cart adds, orders, arrivals. */
export function OrderingActivityCard({ items, error, nameById }: OrderingActivityCardProps) {
  return (
    <Card padding="none">
      <CardHeader title="Ordering activity today" />

      {error || !items ? (
        <div className="px-5 py-6 text-body-sm text-smoke">{error ?? "Ordering activity unavailable."}</div>
      ) : items.length === 0 ? (
        <div className="px-5 py-5">
          <EmptyState tone="subtle" title="No ordering activity" description="BOM uploads, runs, cart adds, orders and arrivals will show up here." />
        </div>
      ) : (
        <div>
          {items.map((item) => (
            <div key={item.id} className="flex items-start gap-2.5 border-b border-border-faint px-5 py-3 text-body-sm last:border-b-0">
              <span className="w-11 flex-none font-mono text-[12px] text-smoke">{formatTime(item.occurredAt)}</span>
              <Chip tone="default" size="sm" className="mt-0.5 flex-none">
                {KIND_LABEL[item.kind]}
              </Chip>
              <span className="min-w-0 text-silver-mist">
                {item.actorId && <span className="text-snow">{nameById.get(item.actorId) ?? "Unknown"} </span>}
                {item.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
