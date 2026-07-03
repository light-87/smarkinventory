/**
 * app/(app)/shelves/queries.ts — read-side data fetchers for the Shelves
 * surface (rack browser + box detail). Colocated with the route rather than
 * under `lib/` because this package only owns `lib/audit/**`
 * (docs/OWNERSHIP.md) — everything else shelves-specific that isn't a React
 * component lives here.
 *
 * Style matches the sibling packages already landed (lib/dashboard/queries.ts,
 * lib/receive/queries.ts): functions take an already-created
 * `SupabaseClient<Database>` (the caller's per-request server client) and
 * hand-join across tables with follow-up `.in()` queries instead of
 * PostgREST embedded selects — `types/db.ts`'s `Database` generic carries no
 * `Relationships` metadata for supabase-js to type embeds against.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";
import { buildBigBoxHumanText } from "@/lib/labels/queue";
import { renderQrPngDataUrl } from "@/lib/labels/qr";
import { deriveBoxLastAuditedAt, type AuditContentItem } from "@/lib/audit";
import { isLowState, stockStateForPart } from "@/components/shelves/stock-state";

type DB = SupabaseClient<Database>;

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`[shelves] ${context}: ${error.message}`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shared: stock_locations × parts, grouped per box
 * ──────────────────────────────────────────────────────────────────────────── */

interface LocationWithPart {
  locationId: string;
  bigBoxId: string;
  qty: number;
  lastCountedAt: string | null;
  partId: string;
  pid: string;
  mpn: string | null;
  value: string | null;
  totalQty: number;
  reorderPoint: number | null;
}

/** Every ESD location (+ its part) for a set of boxes, grouped by `big_box_id`, PID-sorted. */
async function fetchLocationsByBox(
  supabase: DB,
  boxIds: readonly string[],
): Promise<Map<string, LocationWithPart[]>> {
  if (boxIds.length === 0) return new Map();

  const { data: locations, error: locationsError } = await supabase
    .from(TABLES.stock_locations)
    .select("id, big_box_id, part_id, qty, last_counted_at")
    .in("big_box_id", boxIds);
  assertNoError(locationsError, "stock_locations");
  if (!locations || locations.length === 0) return new Map();

  const partIds = Array.from(new Set(locations.map((location) => location.part_id)));
  const { data: parts, error: partsError } = await supabase
    .from(TABLES.parts)
    .select("id, internal_pid, mpn, value, total_qty, reorder_point")
    .in("id", partIds);
  assertNoError(partsError, "smark_parts");

  const partById = new Map((parts ?? []).map((part) => [part.id, part]));
  const grouped = new Map<string, LocationWithPart[]>();

  for (const location of locations) {
    const part = partById.get(location.part_id);
    if (!part) continue; // defensive — an FK-orphaned location shouldn't happen

    const entry: LocationWithPart = {
      locationId: location.id,
      bigBoxId: location.big_box_id,
      qty: location.qty,
      lastCountedAt: location.last_counted_at,
      partId: part.id,
      pid: part.internal_pid,
      mpn: part.mpn,
      value: part.value,
      totalQty: part.total_qty,
      reorderPoint: part.reorder_point,
    };
    const list = grouped.get(location.big_box_id) ?? [];
    list.push(entry);
    grouped.set(location.big_box_id, list);
  }

  for (const list of grouped.values()) {
    list.sort((a, b) => a.pid.localeCompare(b.pid));
  }
  return grouped;
}

function toAuditContentItem(location: LocationWithPart): AuditContentItem {
  return {
    locationId: location.locationId,
    partId: location.partId,
    pid: location.pid,
    mpn: location.mpn,
    value: location.value,
    recordedQty: location.qty,
    lastCountedAt: location.lastCountedAt,
    totalQty: location.totalQty,
    reorderPoint: location.reorderPoint,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Rack view (root)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RackPartChip {
  pid: string;
  qty: number;
  low: boolean;
}

export interface RackBoxCard {
  id: string;
  /** `smark_big_boxes.name` — the short box code (e.g. "A-03"), per the schema comment. */
  code: string;
  category: string | null;
  typeCount: number;
  low: boolean;
  chips: RackPartChip[];
  moreCount: number;
}

export interface RackShelfBand {
  id: string;
  code: string;
  name: string | null;
  boxCount: number;
  boxes: RackBoxCard[];
}

const RACK_CHIP_LIMIT = 5;

function shapeBoxCard(box: { id: string; name: string; category: string | null }, locations: LocationWithPart[]): RackBoxCard {
  const chips: RackPartChip[] = locations.slice(0, RACK_CHIP_LIMIT).map((location) => ({
    pid: location.pid,
    qty: location.qty,
    low: isLowState(stockStateForPart({ total_qty: location.totalQty, reorder_point: location.reorderPoint })),
  }));

  return {
    id: box.id,
    code: box.name,
    category: box.category,
    typeCount: locations.length,
    low: locations.some((location) =>
      isLowState(stockStateForPart({ total_qty: location.totalQty, reorder_point: location.reorderPoint })),
    ),
    chips,
    moreCount: Math.max(0, locations.length - RACK_CHIP_LIMIT),
  };
}

/** Shelf bands with their big-box cards, for `/shelves` (the immersive rack root). */
export async function getRackShelves(supabase: DB): Promise<RackShelfBand[]> {
  const [{ data: shelves, error: shelvesError }, { data: boxes, error: boxesError }] = await Promise.all([
    supabase.from(TABLES.shelves).select("id, code, name").order("code", { ascending: true }),
    supabase.from(TABLES.big_boxes).select("id, shelf_id, name, category").order("name", { ascending: true }),
  ]);
  assertNoError(shelvesError, "smark_shelves");
  assertNoError(boxesError, "smark_big_boxes");

  const boxList = boxes ?? [];
  const locationsByBox = await fetchLocationsByBox(supabase, boxList.map((box) => box.id));

  return (shelves ?? []).map((shelf) => {
    const shelfBoxes = boxList.filter((box) => box.shelf_id === shelf.id);
    return {
      id: shelf.id,
      code: shelf.code,
      name: shelf.name,
      boxCount: shelfBoxes.length,
      boxes: shelfBoxes.map((box) => shapeBoxCard(box, locationsByBox.get(box.id) ?? [])),
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Box detail
 * ──────────────────────────────────────────────────────────────────────────── */

export interface BoxDetailData {
  box: { id: string; code: string; category: string | null; hasLabel: boolean };
  shelf: { id: string; code: string; name: string | null };
  items: AuditContentItem[];
  lastAuditedAt: string | null;
  labelText: string;
  /** Real-encoded QR (payload = box code, matching `lib/labels/queue.ts`'s `code_value`) as a PNG data URL. */
  qrDataUrl: string;
}

/** Everything the box-detail route needs, or `null` if the box doesn't exist. */
export async function getBoxDetail(supabase: DB, boxId: string): Promise<BoxDetailData | null> {
  const { data: box, error: boxError } = await supabase
    .from(TABLES.big_boxes)
    .select("id, shelf_id, name, category, qr_label_id")
    .eq("id", boxId)
    .maybeSingle();
  assertNoError(boxError, "smark_big_boxes");
  if (!box) return null;

  const { data: shelf, error: shelfError } = await supabase
    .from(TABLES.shelves)
    .select("id, code, name")
    .eq("id", box.shelf_id)
    .maybeSingle();
  assertNoError(shelfError, "smark_shelves");

  const locationsByBox = await fetchLocationsByBox(supabase, [boxId]);
  const locations = locationsByBox.get(boxId) ?? [];
  const items = locations.map(toAuditContentItem);

  const lastAuditedAt = deriveBoxLastAuditedAt(locations.map((location) => ({ last_counted_at: location.lastCountedAt })));

  const shelfCode = shelf?.code ?? "?";
  const labelText = buildBigBoxHumanText({ id: box.id, name: box.name, category: box.category, shelfCode });
  const qrDataUrl = await renderQrPngDataUrl(box.name);

  return {
    box: { id: box.id, code: box.name, category: box.category, hasLabel: box.qr_label_id != null },
    shelf: { id: shelf?.id ?? box.shelf_id, code: shelfCode, name: shelf?.name ?? null },
    items,
    lastAuditedAt,
    labelText,
    qrDataUrl,
  };
}
