/**
 * lib/receive/queries.ts — read-side data fetchers for the Receive surface.
 *
 * All take a `SupabaseClient<Database>` the caller already created (Server
 * Component / Server Action) so this module stays framework-agnostic and
 * testable against the local stack (tests/helpers/supabase.ts) without
 * pulling in `next/headers`. No embedded-resource `.select("a,b(c)")` joins
 * anywhere — `Database`'s `TableOf` carries no `Relationships` metadata
 * (types/db.ts), so joins are done here in plain TS over a handful of flat
 * queries instead of leaning on postgrest-js's relationship inference.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CartDescriptor, Database, PartRow } from "@/types/db";
import { TABLES } from "@/types/db";
import type { MatchCatalogEntry } from "@/lib/matcher";
import type { BoxOption } from "./storage-suggestion";

type DB = SupabaseClient<Database>;

/* ────────────────────────────────────────────────────────────────────────────
 * Custom field templates [R2-23]
 * ──────────────────────────────────────────────────────────────────────────── */

export async function getActiveCustomFieldTemplates(supabase: DB) {
  const { data, error } = await supabase
    .from(TABLES.part_field_templates)
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shelf / Big Box options (storage suggestion + onboarding assign)
 * ──────────────────────────────────────────────────────────────────────────── */

export async function getShelfOptions(supabase: DB) {
  const { data, error } = await supabase.from(TABLES.shelves).select("id, code, name").order("code");
  if (error) throw error;
  return data ?? [];
}

/** Flattened box list (shelf code inlined) — what `suggestStorageBox` and the assign UI need. */
export async function getBoxOptions(supabase: DB): Promise<BoxOption[]> {
  const [{ data: boxes, error: boxErr }, shelves] = await Promise.all([
    supabase.from(TABLES.big_boxes).select("id, name, category, shelf_id"),
    getShelfOptions(supabase),
  ]);
  if (boxErr) throw boxErr;
  const shelfCodeById = new Map(shelves.map((s) => [s.id, s.code]));
  return (boxes ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    category: b.category,
    shelfCode: shelfCodeById.get(b.shelf_id) ?? "?",
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Duplicate guard catalog [R2-31]
 * ──────────────────────────────────────────────────────────────────────────── */

export interface MatchCatalogPart extends MatchCatalogEntry {
  internal_pid: string;
  total_qty: number;
}

/** Slim catalog for `lib/matcher.matchPart` — whole table, ~2000 rows at SmarkStock's scale. */
export async function getMatchCatalog(supabase: DB): Promise<MatchCatalogPart[]> {
  const { data, error } = await supabase
    .from(TABLES.parts)
    .select("id, internal_pid, mpn, lcsc_pn, value, package, voltage, part_status, total_qty");
  if (error) throw error;
  return data ?? [];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Top-up lookup — "Find" preview card (identity, location, current qty)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TopUpPreview {
  partId: string;
  internalPid: string;
  mpn: string | null;
  value: string | null;
  package: string | null;
  currentQty: number;
  boxName: string | null;
  shelfCode: string | null;
}

export async function findPartForTopUp(supabase: DB, code: string): Promise<TopUpPreview | null> {
  const { data: part, error } = await supabase
    .from(TABLES.parts)
    .select("id, internal_pid, mpn, value, package, total_qty")
    .eq("internal_pid", code.trim())
    .maybeSingle();
  if (error) throw error;
  if (!part) return null;

  const { data: locations, error: locationsError } = await supabase
    .from(TABLES.stock_locations)
    .select("big_box_id")
    .eq("part_id", part.id)
    .order("created_at", { ascending: true })
    .limit(1);
  if (locationsError) throw locationsError;

  let boxName: string | null = null;
  let shelfCode: string | null = null;
  const boxId = locations?.[0]?.big_box_id;
  if (boxId) {
    const { data: box, error: boxError } = await supabase
      .from(TABLES.big_boxes)
      .select("name, shelf_id")
      .eq("id", boxId)
      .maybeSingle();
    if (boxError) throw boxError;
    if (box) {
      boxName = box.name;
      const { data: shelf, error: shelfError } = await supabase
        .from(TABLES.shelves)
        .select("code")
        .eq("id", box.shelf_id)
        .maybeSingle();
      if (shelfError) throw shelfError;
      shelfCode = shelf?.code ?? null;
    }
  }

  return {
    partId: part.id,
    internalPid: part.internal_pid,
    mpn: part.mpn,
    value: part.value,
    package: part.package,
    currentQty: part.total_qty,
    boxName,
    shelfCode,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Label print queue strip
 * ──────────────────────────────────────────────────────────────────────────── */

export async function getQueuedLabelCount(supabase: DB): Promise<number> {
  const { count, error } = await supabase
    .from(TABLES.qr_labels)
    .select("id", { count: "exact", head: true })
    .eq("print_status", "queued");
  if (error) throw error;
  return count ?? 0;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Onboarding queue — imported parts with no location yet, or flagged [R2-31]
 * ──────────────────────────────────────────────────────────────────────────── */

export interface OnboardingRow {
  part: PartRow;
  suggestion: BoxOption | null;
  /** Part already has a location but is `needs_review` (e.g. duplicate-guard "Create anyway") — assign is not the fix, reviewing it is. */
  hasLocation: boolean;
}

export async function getOnboardingQueue(supabase: DB, boxes: readonly BoxOption[]): Promise<OnboardingRow[]> {
  const [{ data: parts, error: partsErr }, { data: locatedRows, error: locErr }] = await Promise.all([
    supabase.from(TABLES.parts).select("*").order("created_at", { ascending: true }).limit(5000),
    supabase.from(TABLES.stock_locations).select("part_id"),
  ]);
  if (partsErr) throw partsErr;
  if (locErr) throw locErr;

  const locatedPartIds = new Set((locatedRows ?? []).map((r) => r.part_id));

  return (parts ?? [])
    .filter((p) => p.needs_review || !locatedPartIds.has(p.id))
    .map((part) => ({
      part,
      hasLocation: locatedPartIds.has(part.id),
      suggestion: locatedPartIds.has(part.id)
        ? null
        : (() => {
            const match = boxes.find((b) => (b.category ?? "").toLowerCase() === (part.category ?? "").toLowerCase());
            return match ?? null;
          })(),
    }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Arrived order lines — "Put away arrivals" (grouped by PO [R2-12 ripple])
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ArrivedLine {
  orderLineId: string;
  orderId: string;
  poNumber: string;
  distributorName: string;
  projectName: string | null;
  bomName: string | null;
  /** true = already-catalogued part (top-up, no reprint); false = never-catalogued (one new label). */
  existing: boolean;
  internalPid: string | null;
  mpn: string | null;
  value: string | null;
  package: string | null;
  qtyOrdered: number;
  unitPrice: number | null;
}

export interface ArrivedPoGroup {
  orderId: string;
  poNumber: string;
  distributorName: string;
  lines: ArrivedLine[];
}

/** Lines marked arrived (on-order screen) but not yet put away (`arrived_at is null`). */
export async function getArrivedOrderLines(supabase: DB): Promise<ArrivedPoGroup[]> {
  const { data: lines, error: linesErr } = await supabase
    .from(TABLES.order_lines)
    .select("*")
    .eq("line_status", "arrived")
    .is("arrived_at", null);
  if (linesErr) throw linesErr;
  if (!lines || lines.length === 0) return [];

  const orderIds = Array.from(new Set(lines.map((l) => l.order_id)));
  const partIds = Array.from(new Set(lines.map((l) => l.part_id).filter((id): id is string => Boolean(id))));
  const cartItemIds = Array.from(
    new Set(lines.map((l) => l.cart_item_id).filter((id): id is string => Boolean(id))),
  );
  const bomLineIds = Array.from(
    new Set(lines.map((l) => l.bom_line_id).filter((id): id is string => Boolean(id))),
  );
  const projectIds = Array.from(
    new Set(lines.map((l) => l.project_id).filter((id): id is string => Boolean(id))),
  );

  const [ordersRes, partsRes, cartItemsRes, bomLinesRes, projectsRes] = await Promise.all([
    supabase.from(TABLES.orders).select("*").in("id", orderIds),
    partIds.length ? supabase.from(TABLES.parts).select("id, internal_pid, mpn, value, package").in("id", partIds) : Promise.resolve({ data: [], error: null }),
    cartItemIds.length
      ? supabase.from(TABLES.cart_items).select("id, descriptor").in("id", cartItemIds)
      : Promise.resolve({ data: [], error: null }),
    bomLineIds.length
      ? supabase.from(TABLES.bom_lines).select("id, bom_id").in("id", bomLineIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase.from(TABLES.projects).select("id, name").in("id", projectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (ordersRes.error) throw ordersRes.error;
  if (partsRes.error) throw partsRes.error;
  if (cartItemsRes.error) throw cartItemsRes.error;
  if (bomLinesRes.error) throw bomLinesRes.error;
  if (projectsRes.error) throw projectsRes.error;

  const distributorIds = Array.from(new Set((ordersRes.data ?? []).map((o) => o.distributor_id)));
  const distributorsRes = distributorIds.length
    ? await supabase.from(TABLES.distributors).select("id, name").in("id", distributorIds)
    : { data: [], error: null };
  if (distributorsRes.error) throw distributorsRes.error;

  const bomIds = Array.from(new Set((bomLinesRes.data ?? []).map((bl) => bl.bom_id)));
  const bomsRes = bomIds.length
    ? await supabase.from(TABLES.boms).select("id, name").in("id", bomIds)
    : { data: [], error: null };
  if (bomsRes.error) throw bomsRes.error;

  const ordersById = new Map((ordersRes.data ?? []).map((o) => [o.id, o]));
  const distributorNameById = new Map((distributorsRes.data ?? []).map((d) => [d.id, d.name]));
  const partById = new Map((partsRes.data ?? []).map((p) => [p.id, p]));
  const cartItemById = new Map((cartItemsRes.data ?? []).map((c) => [c.id, c]));
  const bomLineById = new Map((bomLinesRes.data ?? []).map((bl) => [bl.id, bl]));
  const bomNameById = new Map((bomsRes.data ?? []).map((b) => [b.id, b.name]));
  const projectNameById = new Map((projectsRes.data ?? []).map((p) => [p.id, p.name]));

  const groups = new Map<string, ArrivedPoGroup>();

  for (const line of lines) {
    const order = ordersById.get(line.order_id);
    if (!order) continue; // orphaned line — shouldn't happen (FK), skip defensively

    const part = line.part_id ? partById.get(line.part_id) : undefined;
    const descriptor = !line.part_id && line.cart_item_id
      ? (cartItemById.get(line.cart_item_id)?.descriptor as CartDescriptor | null | undefined)
      : undefined;
    const bomLine = line.bom_line_id ? bomLineById.get(line.bom_line_id) : undefined;

    const arrivedLine: ArrivedLine = {
      orderLineId: line.id,
      orderId: order.id,
      poNumber: order.po_number,
      distributorName: distributorNameById.get(order.distributor_id) ?? "—",
      projectName: line.project_id ? (projectNameById.get(line.project_id) ?? null) : null,
      bomName: bomLine ? (bomNameById.get(bomLine.bom_id) ?? null) : null,
      existing: Boolean(part),
      internalPid: part?.internal_pid ?? null,
      mpn: part?.mpn ?? descriptor?.mpn ?? null,
      value: part?.value ?? descriptor?.value ?? null,
      package: part?.package ?? descriptor?.package ?? null,
      qtyOrdered: line.qty_ordered,
      unitPrice: line.unit_price,
    };

    const existingGroup = groups.get(order.id);
    if (existingGroup) {
      existingGroup.lines.push(arrivedLine);
    } else {
      groups.set(order.id, {
        orderId: order.id,
        poNumber: order.po_number,
        distributorName: arrivedLine.distributorName,
        lines: [arrivedLine],
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.poNumber.localeCompare(b.poNumber));
}
