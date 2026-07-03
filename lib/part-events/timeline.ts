/**
 * lib/part-events/timeline.ts — shapes raw `smark_part_events` rows into the
 * living-record timeline (tab-part-detail.md R2-13: "every event timestamped
 * with actor, qty, price, PO + distributor, project → client"). Pure — the
 * actor/project/order lookups are passed in as maps so this stays testable
 * without a DB.
 */

import type { PartEventRow, PartEventType } from "@/types/db";
import type { PartTimelineEntry, TimelineFilterState } from "./types";

export const TIMELINE_EVENT_LABEL: Record<PartEventType, string> = {
  ordered: "Ordered",
  received: "Received",
  adjusted: "Adjusted",
  note: "Note",
  picked: "Picked",
  price_change: "Price changed",
  location_moved: "Moved location",
};

function signedQty(qty: number | null): string | null {
  if (qty === null) return null;
  return qty > 0 ? `+${qty}` : String(qty);
}

export interface TimelineContext {
  /** actor uuid → display name (falls back to username at the query layer). */
  usersById: Map<string, string>;
  /** project uuid → { name, client } — client attribution is a render-time join, never denormalized (R2-13). */
  projectsById: Map<string, { name: string; client: string | null }>;
  /** order uuid → po_number. */
  ordersById: Map<string, string>;
}

export function shapePartTimeline(events: readonly PartEventRow[], ctx: TimelineContext): PartTimelineEntry[] {
  return events.map((event) => {
    const project = event.project_id ? ctx.projectsById.get(event.project_id) : undefined;
    return {
      id: event.id,
      eventType: event.event_type,
      occurredAt: event.occurred_at,
      qty: event.qty,
      qtySigned: signedQty(event.qty),
      unitPrice: event.unit_price,
      priceOld: event.price_old,
      priceNew: event.price_new,
      reason: event.reason,
      actorName: event.actor ? (ctx.usersById.get(event.actor) ?? "Unknown user") : "System",
      projectId: event.project_id,
      projectName: project?.name ?? null,
      clientName: project?.client ?? null,
      distributor: event.distributor,
      poNumber: event.order_id ? (ctx.ordersById.get(event.order_id) ?? null) : null,
      orderId: event.order_id,
    };
  });
}

export function filterTimeline(
  entries: readonly PartTimelineEntry[],
  filter: TimelineFilterState,
): PartTimelineEntry[] {
  return entries.filter((entry) => {
    if (filter.eventTypes.length > 0 && !filter.eventTypes.includes(entry.eventType)) return false;
    if (filter.projectId && entry.projectId !== filter.projectId) return false;
    return true;
  });
}

/** Event types actually present, in first-seen (newest-first) order — drives the filter chips. */
export function distinctEventTypes(entries: readonly PartTimelineEntry[]): PartEventType[] {
  const seen = new Set<PartEventType>();
  const order: PartEventType[] = [];
  for (const entry of entries) {
    if (!seen.has(entry.eventType)) {
      seen.add(entry.eventType);
      order.push(entry.eventType);
    }
  }
  return order;
}

/** Projects actually referenced in this part's history — drives the filter dropdown. */
export function distinctProjects(entries: readonly PartTimelineEntry[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    if (entry.projectId && entry.projectName && !seen.has(entry.projectId)) {
      seen.set(entry.projectId, entry.projectName);
    }
  }
  return Array.from(seen, ([id, name]) => ({ id, name }));
}
