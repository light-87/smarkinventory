/**
 * lib/part-events/query.ts — server-side data loader for the part-detail
 * drawer/page (`?pid=` on Inventory, `/part/[pid]`). One function, reused by
 * both routes so they can never drift out of sync.
 */

import { accessFor, canWrite as roleCanWrite } from "@/lib/auth/roles";
import { buildPartHumanText } from "@/lib/labels/queue";
import { createClient } from "@/lib/supabase/server";
import {
  AppUserRowSchema,
  BigBoxRowSchema,
  CartItemRowSchema,
  OrderRowSchema,
  PartDemandRowSchema,
  PartEventRowSchema,
  PartRowSchema,
  ProjectRowSchema,
  QrLabelRowSchema,
  ShelfRowSchema,
  StockLocationRowSchema,
  TABLES,
  VIEWS,
} from "@/types/db";
import { buildContestedStock } from "./contested";
import { buildPartSpecs, computeStockValue } from "./specs";
import { shapePartTimeline } from "./timeline";
import type { PartDetailLocation, PartDetailResult } from "./types";

export async function getPartDetailData(pid: string): Promise<PartDetailResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "unauthorized", message: "Sign in to view part details." };

  const { data: role, error: roleError } = await supabase.rpc("smark_role");
  if (roleError) return { ok: false, reason: "error", message: roleError.message };
  if (!role || accessFor(role, "inventory") === "hidden") {
    return { ok: false, reason: "unauthorized", message: "You don't have access to Inventory." };
  }

  const { data: partData, error: partError } = await supabase
    .from(TABLES.parts)
    .select("*")
    .eq("internal_pid", pid)
    .maybeSingle();
  if (partError) return { ok: false, reason: "error", message: partError.message };
  if (!partData) return { ok: false, reason: "not_found" };

  let part;
  try {
    part = PartRowSchema.parse(partData);
  } catch {
    return { ok: false, reason: "error", message: "Part data did not match the expected shape." };
  }

  const [locationsRes, eventsRes, labelRes, usersRes, demandRes, cartRes] = await Promise.all([
    supabase.from(TABLES.stock_locations).select("*").eq("part_id", part.id),
    supabase.from(TABLES.part_events).select("*").eq("part_id", part.id).order("occurred_at", { ascending: false }),
    supabase.from(TABLES.qr_labels).select("*").eq("target_type", "part").eq("target_id", part.id).maybeSingle(),
    supabase.from(TABLES.app_users).select("*"),
    supabase.from(VIEWS.part_demand).select("*").eq("part_id", part.id).maybeSingle(),
    supabase.from(TABLES.cart_items).select("*").eq("part_id", part.id).eq("status", "open"),
  ]);

  const firstError =
    locationsRes.error ?? eventsRes.error ?? labelRes.error ?? usersRes.error ?? demandRes.error ?? cartRes.error;
  if (firstError) return { ok: false, reason: "error", message: firstError.message };

  const locationsRaw = StockLocationRowSchema.array().parse(locationsRes.data ?? []);
  const boxIds = Array.from(new Set(locationsRaw.map((l) => l.big_box_id)));
  const { data: boxesData, error: boxesError } = boxIds.length
    ? await supabase.from(TABLES.big_boxes).select("*").in("id", boxIds)
    : { data: [], error: null };
  if (boxesError) return { ok: false, reason: "error", message: boxesError.message };
  const boxes = BigBoxRowSchema.array().parse(boxesData ?? []);
  const boxById = new Map(boxes.map((b) => [b.id, b]));

  const shelfIds = Array.from(new Set(boxes.map((b) => b.shelf_id)));
  const { data: shelvesData, error: shelvesError } = shelfIds.length
    ? await supabase.from(TABLES.shelves).select("*").in("id", shelfIds)
    : { data: [], error: null };
  if (shelvesError) return { ok: false, reason: "error", message: shelvesError.message };
  const shelfById = new Map(ShelfRowSchema.array().parse(shelvesData ?? []).map((s) => [s.id, s]));

  const locations: PartDetailLocation[] = locationsRaw.map((loc) => {
    const box = boxById.get(loc.big_box_id);
    const shelf = box ? shelfById.get(box.shelf_id) : undefined;
    return {
      id: loc.id,
      qty: loc.qty,
      boxId: loc.big_box_id,
      boxName: box?.name ?? "—",
      shelfCode: shelf?.code ?? "—",
      esdNote: loc.esd_note,
      lastCountedAt: loc.last_counted_at,
    };
  });

  const events = PartEventRowSchema.array().parse(eventsRes.data ?? []);
  const users = AppUserRowSchema.array().parse(usersRes.data ?? []);
  const usersById = new Map(users.map((u) => [u.id, u.display_name ?? u.username]));

  const projectIds = Array.from(new Set(events.map((e) => e.project_id).filter((id): id is string => id != null)));
  const { data: projectsData, error: projectsError } = projectIds.length
    ? await supabase.from(TABLES.projects).select("*").in("id", projectIds)
    : { data: [], error: null };
  if (projectsError) return { ok: false, reason: "error", message: projectsError.message };
  const projectsById = new Map(
    ProjectRowSchema.array()
      .parse(projectsData ?? [])
      .map((p) => [p.id, { name: p.name, client: p.client }]),
  );

  const orderIds = Array.from(new Set(events.map((e) => e.order_id).filter((id): id is string => id != null)));
  const { data: ordersData, error: ordersError } = orderIds.length
    ? await supabase.from(TABLES.orders).select("*").in("id", orderIds)
    : { data: [], error: null };
  if (ordersError) return { ok: false, reason: "error", message: ordersError.message };
  const ordersById = new Map(
    OrderRowSchema.array()
      .parse(ordersData ?? [])
      .map((o) => [o.id, o.po_number]),
  );

  const timeline = shapePartTimeline(events, { usersById, projectsById, ordersById });

  const label = labelRes.data ? QrLabelRowSchema.parse(labelRes.data) : null;

  let contested = null;
  if (demandRes.data) {
    const demandRow = PartDemandRowSchema.parse(demandRes.data);
    if (demandRow.shortfall > 0) {
      const cartItems = CartItemRowSchema.array().parse(cartRes.data ?? []);
      const inCartQty = cartItems.reduce((sum, item) => sum + item.qty_to_order, 0);
      contested = buildContestedStock(demandRow, inCartQty);
    }
  }

  return {
    ok: true,
    data: {
      part,
      locations,
      specs: buildPartSpecs(part),
      stockValue: computeStockValue(part),
      label: {
        humanText: label?.human_text ?? buildPartHumanText(part),
        printStatus: label?.print_status ?? null,
      },
      timeline,
      contested,
      canWrite: roleCanWrite(role, "inventory"),
    },
  };
}
