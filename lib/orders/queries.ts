/**
 * lib/orders/queries.ts — read-side data fetchers for the Cart surface.
 *
 * All take a `SupabaseClient<Database>` the caller already created (Server
 * Component / Server Action), stay framework-agnostic, and use flat
 * `.select("*")`/`.in(...)` queries + JS-side maps rather than embedded
 * `.select("a,b(c)")` joins — `Database`'s `TableOf` carries no
 * `Relationships` metadata (types/db.ts), matching the pattern in
 * lib/receive/queries.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CartDescriptor, CartItemRow, CartItemSource, CartItemStatus, Database, DistributorRow } from "@/types/db";
import { TABLES } from "@/types/db";
import { getLineDistributorId } from "./types";

type DB = SupabaseClient<Database>;

/* ────────────────────────────────────────────────────────────────────────────
 * Distributors — checkout groups + the per-line distributor select
 * ──────────────────────────────────────────────────────────────────────────── */

export async function getActiveDistributors(supabase: DB): Promise<DistributorRow[]> {
  const { data, error } = await supabase.from(TABLES.distributors).select("*").eq("active", true).order("name");
  if (error) throw error;
  return data ?? [];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Manual add — search the catalog
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PartSearchHit {
  id: string;
  internalPid: string;
  mpn: string | null;
  value: string | null;
  package: string | null;
  totalQty: number;
}

/** "Search any part" for the manual-add panel — PID/MPN/value substring match. */
export async function searchPartsForManualAdd(supabase: DB, query: string): Promise<PartSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const { data, error } = await supabase
    .from(TABLES.parts)
    .select("id, internal_pid, mpn, value, package, total_qty")
    .or(`internal_pid.ilike.%${q}%,mpn.ilike.%${q}%,value.ilike.%${q}%`)
    .order("internal_pid")
    .limit(20);
  if (error) throw error;

  return (data ?? []).map((p) => ({
    id: p.id,
    internalPid: p.internal_pid,
    mpn: p.mpn,
    value: p.value,
    package: p.package,
    totalQty: p.total_qty,
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Cart lines — open + dismissed (the working cart)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface DemandBreakdownView {
  projectId: string;
  projectName: string;
  bomId: string;
  bomName: string;
  qty: number;
}

export interface CartLineView {
  id: string;
  source: CartItemSource;
  status: CartItemStatus;
  partId: string | null;
  internalPid: string | null;
  mpn: string | null;
  lcscPn: string | null;
  value: string | null;
  package: string | null;
  description: string | null;
  /** `smark_parts.total_qty` for catalogued parts — "available in stock". */
  availableQty: number | null;
  qtyToOrder: number;
  unitPrice: number | null;
  demand: DemandBreakdownView[];
  distributorId: string | null;
  chosenResultId: string | null;
  createdAt: string;
}

export async function getCartLines(supabase: DB): Promise<CartLineView[]> {
  const { data: items, error } = await supabase
    .from(TABLES.cart_items)
    .select("*")
    .in("status", ["open", "dismissed"])
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!items || items.length === 0) return [];

  const partIds = Array.from(new Set(items.map((i) => i.part_id).filter((id): id is string => Boolean(id))));
  const projectIds = new Set<string>();
  const bomIds = new Set<string>();
  for (const item of items) {
    for (const slice of item.demand ?? []) {
      if (slice.project_id) projectIds.add(slice.project_id);
      if (slice.bom_id) bomIds.add(slice.bom_id);
    }
  }

  const [partsRes, projectsRes, bomsRes] = await Promise.all([
    partIds.length
      ? supabase.from(TABLES.parts).select("id, internal_pid, mpn, lcsc_pn, value, package, description, total_qty").in("id", partIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.size
      ? supabase.from(TABLES.projects).select("id, name").in("id", Array.from(projectIds))
      : Promise.resolve({ data: [], error: null }),
    bomIds.size
      ? supabase.from(TABLES.boms).select("id, name").in("id", Array.from(bomIds))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (partsRes.error) throw partsRes.error;
  if (projectsRes.error) throw projectsRes.error;
  if (bomsRes.error) throw bomsRes.error;

  const partById = new Map((partsRes.data ?? []).map((p) => [p.id, p]));
  const projectNameById = new Map((projectsRes.data ?? []).map((p) => [p.id, p.name]));
  const bomNameById = new Map((bomsRes.data ?? []).map((b) => [b.id, b.name]));

  return items.map((item): CartLineView => {
    const part = item.part_id ? partById.get(item.part_id) : undefined;
    const descriptor = item.descriptor;

    return {
      id: item.id,
      source: item.source,
      status: item.status,
      partId: item.part_id,
      internalPid: part?.internal_pid ?? null,
      mpn: part?.mpn ?? descriptor?.mpn ?? null,
      lcscPn: part?.lcsc_pn ?? descriptor?.lcsc_pn ?? null,
      value: part?.value ?? descriptor?.value ?? null,
      package: part?.package ?? descriptor?.package ?? null,
      description: part?.description ?? descriptor?.description ?? null,
      availableQty: part?.total_qty ?? null,
      qtyToOrder: item.qty_to_order,
      unitPrice: item.unit_price,
      demand: (item.demand ?? []).map((slice) => ({
        projectId: slice.project_id,
        projectName: projectNameById.get(slice.project_id) ?? "—",
        bomId: slice.bom_id,
        bomName: bomNameById.get(slice.bom_id) ?? "—",
        qty: slice.qty,
      })),
      distributorId: getLineDistributorId(item),
      chosenResultId: item.chosen_result_id,
      createdAt: item.created_at,
    };
  });
}

export async function getCartItemById(supabase: DB, id: string): Promise<CartItemRow | null> {
  const { data, error } = await supabase.from(TABLES.cart_items).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ordered / Arrived — grouped by PO (§3-D)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface OrderLineView {
  orderLineId: string;
  partId: string | null;
  internalPid: string | null;
  mpn: string | null;
  value: string | null;
  package: string | null;
  projectName: string | null;
  bomName: string | null;
  qtyOrdered: number;
  unitPrice: number | null;
  arrivedQty: number;
  arrivedAt: string | null;
}

export interface OrderGroupView {
  orderId: string;
  poNumber: string;
  distributorName: string;
  status: "ordered" | "partially_arrived" | "arrived";
  placedAt: string;
  placedByName: string | null;
  receiptUrl: string | null;
  totalInr: number;
  lines: OrderLineView[];
}

async function buildOrderGroups(
  supabase: DB,
  lineStatusFilter: "ordered" | "arrived",
): Promise<OrderGroupView[]> {
  const { data: lines, error: linesError } = await supabase
    .from(TABLES.order_lines)
    .select("*")
    .eq("line_status", lineStatusFilter);
  if (linesError) throw linesError;
  if (!lines || lines.length === 0) return [];

  const orderIds = Array.from(new Set(lines.map((l) => l.order_id)));
  const partIds = Array.from(new Set(lines.map((l) => l.part_id).filter((id): id is string => Boolean(id))));
  const cartItemIds = Array.from(new Set(lines.map((l) => l.cart_item_id).filter((id): id is string => Boolean(id))));
  const bomLineIds = Array.from(new Set(lines.map((l) => l.bom_line_id).filter((id): id is string => Boolean(id))));
  const projectIds = Array.from(new Set(lines.map((l) => l.project_id).filter((id): id is string => Boolean(id))));

  const [ordersRes, partsRes, cartItemsRes, bomLinesRes, projectsRes] = await Promise.all([
    supabase.from(TABLES.orders).select("*").in("id", orderIds),
    partIds.length
      ? supabase.from(TABLES.parts).select("id, internal_pid, mpn, value, package").in("id", partIds)
      : Promise.resolve({ data: [], error: null }),
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
  const placedByIds = Array.from(
    new Set((ordersRes.data ?? []).map((o) => o.placed_by).filter((id): id is string => Boolean(id))),
  );
  const [distributorsRes, usersRes] = await Promise.all([
    distributorIds.length
      ? supabase.from(TABLES.distributors).select("id, name").in("id", distributorIds)
      : Promise.resolve({ data: [], error: null }),
    placedByIds.length
      ? supabase.from(TABLES.app_users).select("id, display_name, username").in("id", placedByIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (distributorsRes.error) throw distributorsRes.error;
  if (usersRes.error) throw usersRes.error;

  const bomIds = Array.from(new Set((bomLinesRes.data ?? []).map((bl) => bl.bom_id)));
  const bomsRes = bomIds.length
    ? await supabase.from(TABLES.boms).select("id, name").in("id", bomIds)
    : { data: [], error: null };
  if (bomsRes.error) throw bomsRes.error;

  // Every line for these orders (not just the filtered status) — needed for
  // the order-level total ₹ and the "all lines arrived?" status the UI shows.
  const { data: allLinesForOrders, error: allLinesError } = await supabase
    .from(TABLES.order_lines)
    .select("order_id, qty_ordered, unit_price")
    .in("order_id", orderIds);
  if (allLinesError) throw allLinesError;

  const ordersById = new Map((ordersRes.data ?? []).map((o) => [o.id, o]));
  const distributorNameById = new Map((distributorsRes.data ?? []).map((d) => [d.id, d.name]));
  const userNameById = new Map((usersRes.data ?? []).map((u) => [u.id, u.display_name ?? u.username]));
  const partById = new Map((partsRes.data ?? []).map((p) => [p.id, p]));
  const cartItemById = new Map((cartItemsRes.data ?? []).map((c) => [c.id, c]));
  const bomLineById = new Map((bomLinesRes.data ?? []).map((bl) => [bl.id, bl]));
  const bomNameById = new Map((bomsRes.data ?? []).map((b) => [b.id, b.name]));
  const projectNameById = new Map((projectsRes.data ?? []).map((p) => [p.id, p.name]));

  const totalByOrder = new Map<string, number>();
  for (const line of allLinesForOrders ?? []) {
    const existing = totalByOrder.get(line.order_id) ?? 0;
    totalByOrder.set(line.order_id, existing + line.qty_ordered * (line.unit_price ?? 0));
  }

  const groups = new Map<string, OrderGroupView>();

  for (const line of lines) {
    const order = ordersById.get(line.order_id);
    if (!order) continue; // orphaned line — shouldn't happen (FK), skip defensively

    const part = line.part_id ? partById.get(line.part_id) : undefined;
    const descriptor = !line.part_id && line.cart_item_id
      ? (cartItemById.get(line.cart_item_id)?.descriptor as CartDescriptor | null | undefined)
      : undefined;
    const bomLine = line.bom_line_id ? bomLineById.get(line.bom_line_id) : undefined;

    const lineView: OrderLineView = {
      orderLineId: line.id,
      partId: line.part_id,
      internalPid: part?.internal_pid ?? null,
      mpn: part?.mpn ?? descriptor?.mpn ?? null,
      value: part?.value ?? descriptor?.value ?? null,
      package: part?.package ?? descriptor?.package ?? null,
      projectName: line.project_id ? (projectNameById.get(line.project_id) ?? null) : null,
      bomName: bomLine ? (bomNameById.get(bomLine.bom_id) ?? null) : null,
      qtyOrdered: line.qty_ordered,
      unitPrice: line.unit_price,
      arrivedQty: line.arrived_qty,
      arrivedAt: line.arrived_at,
    };

    const existingGroup = groups.get(order.id);
    if (existingGroup) {
      existingGroup.lines.push(lineView);
    } else {
      groups.set(order.id, {
        orderId: order.id,
        poNumber: order.po_number,
        distributorName: distributorNameById.get(order.distributor_id) ?? "—",
        status: order.status,
        placedAt: order.placed_at,
        placedByName: order.placed_by ? (userNameById.get(order.placed_by) ?? null) : null,
        receiptUrl: order.receipt_url,
        totalInr: totalByOrder.get(order.id) ?? 0,
        lines: [lineView],
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.placedAt.localeCompare(a.placedAt));
}

/** "Ordered" section — lines still `line_status='ordered'`, grouped by PO. */
export async function getOrderedGroups(supabase: DB): Promise<OrderGroupView[]> {
  return buildOrderGroups(supabase, "ordered");
}

/**
 * "Arrived" section — lines already marked arrived on THIS screen
 * (`line_status='arrived'`), regardless of whether Receive has put them away
 * yet (`arrived_at` — stamped only by Receive's put-away, lib/receive/core.ts
 * `putAwayArrivalLine`). Grouped by PO, same shape as `getOrderedGroups`.
 */
export async function getArrivedGroups(supabase: DB): Promise<OrderGroupView[]> {
  return buildOrderGroups(supabase, "arrived");
}
