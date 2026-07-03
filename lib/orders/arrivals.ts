/**
 * lib/orders/arrivals.ts — "arrival allocation" (docs/OWNERSHIP.md): the
 * Ordered section's "Mark arrived" per line (plan/tab-on-order.md §3-D,
 * partial arrivals OK).
 *
 * This flips `smark_order_lines.line_status` `ordered → arrived` ONLY — it
 * deliberately does NOT touch `arrived_qty`/`arrived_at`. Those two are
 * lib/receive/core.ts `putAwayArrivalLine`'s job (physical put-away),
 * which specifically queries `line_status='arrived' AND arrived_at IS NULL`
 * (lib/receive/queries.ts `getArrivedOrderLines`) to find lines marked
 * arrived here but not yet put away — setting `arrived_at` from this side
 * would make Receive's put-away queue silently skip them. Same reason
 * `last_unit_price` stamping + the `price_change` part_event happen at
 * put-away, not here (lib/receive/core.ts `stampLastUnitPrice`) — this
 * package never writes `smark_movements` or `smark_part_events` at all.
 *
 * The parent `smark_orders.status` is recomputed from its lines' statuses
 * and only ever written FORWARD (A3 invariant: ordered → partially_arrived →
 * arrived, never backwards, never skips to `arrived` while a line is still
 * `ordered`). Every forward transition notifies whoever placed the order
 * (`notifyArrival`, lib/notifications — cross-package import allowance,
 * docs/OWNERSHIP.md) — skipped gracefully if the order has no `placed_by`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OrderStatus } from "@/types/db";
import { TABLES } from "@/types/db";
import { notifyArrival } from "@/lib/notifications";

type DB = SupabaseClient<Database>;

const STATUS_RANK: Record<OrderStatus, number> = { ordered: 0, partially_arrived: 1, arrived: 2 };

function deriveOrderStatus(lineStatuses: readonly ("ordered" | "arrived")[]): OrderStatus {
  if (lineStatuses.every((s) => s === "arrived")) return "arrived";
  if (lineStatuses.some((s) => s === "arrived")) return "partially_arrived";
  return "ordered";
}

export type MarkOrderLineArrivedResult = { ok: true } | { ok: false; error: string };

export async function markOrderLineArrived(supabase: DB, orderLineId: string): Promise<MarkOrderLineArrivedResult> {
  const { data: line, error: lineError } = await supabase
    .from(TABLES.order_lines)
    .select("id, order_id, line_status")
    .eq("id", orderLineId)
    .maybeSingle();
  if (lineError) throw lineError;
  if (!line) return { ok: false, error: "Order line not found." };
  if (line.line_status !== "ordered") return { ok: false, error: "This line has already been marked arrived." };

  const { error: updateError } = await supabase
    .from(TABLES.order_lines)
    .update({ line_status: "arrived" })
    .eq("id", orderLineId);
  if (updateError) throw updateError;

  const { data: siblingLines, error: siblingsError } = await supabase
    .from(TABLES.order_lines)
    .select("line_status")
    .eq("order_id", line.order_id);
  if (siblingsError) throw siblingsError;

  const nextStatus = deriveOrderStatus((siblingLines ?? []).map((l) => l.line_status));

  const { data: order, error: orderError } = await supabase
    .from(TABLES.orders)
    .select("id, po_number, status, placed_by, distributor_id")
    .eq("id", line.order_id)
    .maybeSingle();
  if (orderError) throw orderError;

  if (order && STATUS_RANK[nextStatus] > STATUS_RANK[order.status]) {
    const { error: statusError } = await supabase.from(TABLES.orders).update({ status: nextStatus }).eq("id", line.order_id);
    if (statusError) throw statusError;

    if (order.placed_by) {
      const { data: distributor } = await supabase
        .from(TABLES.distributors)
        .select("name")
        .eq("id", order.distributor_id)
        .maybeSingle();
      await notifyArrival(supabase, {
        orderId: order.id,
        poNumber: order.po_number,
        distributorName: distributor?.name ?? "Distributor",
        recipientUserId: order.placed_by,
      });
    }
  }

  return { ok: true };
}
