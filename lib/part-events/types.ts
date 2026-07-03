import type { PartEventType, PartRow, PrintStatus } from "@/types/db";

/** One `smark_stock_locations` row, joined out to shelf code + box name. */
export interface PartDetailLocation {
  id: string;
  qty: number;
  boxId: string;
  boxName: string;
  shelfCode: string;
  esdNote: string | null;
  lastCountedAt: string | null;
}

export interface SpecEntry {
  label: string;
  value: string;
}

/** A `smark_part_events` row, shaped for the living-record timeline (R2-13). */
export interface PartTimelineEntry {
  id: string;
  eventType: PartEventType;
  occurredAt: string;
  qty: number | null;
  qtySigned: string | null;
  unitPrice: number | null;
  priceOld: number | null;
  priceNew: number | null;
  reason: string | null;
  actorName: string;
  projectId: string | null;
  projectName: string | null;
  clientName: string | null;
  distributor: string | null;
  poNumber: string | null;
  orderId: string | null;
}

export interface TimelineFilterState {
  eventTypes: PartEventType[];
  projectId: string | null;
}

/** R2-10 contested-stock strip: cross-project demand exceeding this part's stock. */
export interface ContestedStock {
  partId: string;
  demand: number;
  available: number;
  shortfall: number;
  projectCount: number;
  inCartQty: number;
}

export interface PartLabel {
  humanText: string;
  printStatus: PrintStatus | null;
}

export interface PartDetailData {
  part: PartRow;
  locations: PartDetailLocation[];
  specs: SpecEntry[];
  stockValue: number | null;
  label: PartLabel;
  timeline: PartTimelineEntry[];
  contested: ContestedStock | null;
  /** Owner/employee = true, accountant (read-only) = false — gates Adjust qty / Print label. */
  canWrite: boolean;
}

export type PartDetailResult =
  | { ok: true; data: PartDetailData }
  | { ok: false; reason: "not_found" | "unauthorized" | "error"; message?: string };
