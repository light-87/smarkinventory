/**
 * lib/receive/core.ts — Receive surface DB writes (plan/tab-receive.md).
 *
 * Every exported function takes an already-created `SupabaseClient<Database>`
 * plus the acting user's id, so:
 *   - `lib/receive/actions.ts` ("use server") wraps these for the app, using
 *     the per-request RLS-bound client from `lib/supabase/server.ts`;
 *   - tests call the SAME functions against the local stack with a
 *     service-role client (tests/helpers/supabase.ts) — no `next/headers`
 *     import here, so both call sites work.
 *
 * Invariants preserved everywhere below (FEATURES.md §8/§9, CROSS-FEATURE A3):
 *   - every stock mutation writes `smark_movements` (undoable via `undo_of` —
 *     undo itself is scan/lib/movements' concern, not receive's);
 *   - existing-part top-up NEVER queues a label; a genuinely new part
 *     queues EXACTLY one (the DB's `smark_qr_labels_one_per_target` unique
 *     index is the actual backstop — `lib/labels/queue.ts` just no-ops on
 *     conflict so callers never need an `if` for it);
 *   - New-part save always resolves to a real stock location — falling back
 *     to a proposed "Unsorted" box (lib/receive/storage-suggestion.ts)
 *     instead of ever leaving qty un-homed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CartDescriptor, Database, PartAttributes } from "@/types/db";
import { TABLES } from "@/types/db";
import { matchPart, type MatchMethod } from "@/lib/matcher";
import { recordMovement } from "@/lib/movements";
import { queueLabelForBigBox, queueLabelForPart } from "@/lib/labels/queue";
import { getBoxOptions, getMatchCatalog } from "./queries";
import { slugifyFieldKey } from "./types";
import type {
  CustomFieldTemplateInput,
  NewPartFormInput,
  OnboardingAssignInput,
  PutAwayInput,
  TopUpInput,
} from "./types";
import { FALLBACK_SHELF_CODE, FALLBACK_SHELF_NAME, suggestStorageBox, type StorageSuggestion } from "./storage-suggestion";

type DB = SupabaseClient<Database>;
type PartInsert = Database["public"]["Tables"]["smark_parts"]["Insert"];

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505",
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shared helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Next `SMK-NNNNNN` PID. Zero-padded to a fixed width so lexicographic and
 * numeric ordering agree — good for SmarkStock's ~2000-part scale. This is
 * application-level generation (no DB sequence — migrations 0001–0005 are
 * frozen per OWNERSHIP.md), so `insertPartWithRetry` retries on a unique
 * collision rather than assuming this is race-free under concurrent saves.
 *
 * Filters to the strict `SMK-NNNNNN` shape (both at the query, via `like`,
 * and again in-process via `PID_STRICT_PATTERN`) rather than trusting
 * whatever text sorts last: the local/test database also carries
 * differently-shaped fixture pids (e.g. `SMKTEST-<tag>` from
 * tests/invariants/fixtures.ts, shared across packages) that a naive
 * "highest text, strip non-digits" heuristic would misread as a real,
 * enormous PID and then never recover from.
 */
const PID_STRICT_PATTERN = /^SMK-(\d+)$/;

async function nextInternalPid(supabase: DB): Promise<string> {
  const { data, error } = await supabase
    .from(TABLES.parts)
    .select("internal_pid")
    .like("internal_pid", "SMK-%")
    .order("internal_pid", { ascending: false })
    .limit(20);
  if (error) throw error;

  let max = 0;
  for (const row of data ?? []) {
    const match = PID_STRICT_PATTERN.exec(row.internal_pid);
    if (match) max = Math.max(max, Number.parseInt(match[1]!, 10));
  }
  return `SMK-${String(max + 1).padStart(6, "0")}`;
}

async function insertPartWithRetry(supabase: DB, fields: Omit<PartInsert, "internal_pid">) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const internal_pid = await nextInternalPid(supabase);
    const { data, error } = await supabase
      .from(TABLES.parts)
      .insert({ internal_pid, ...fields })
      .select()
      .single();
    if (!error) return data;
    if (!isUniqueViolation(error)) throw error;
    lastError = error;
  }
  throw lastError instanceof Error ? lastError : new Error("Could not allocate a unique internal PID");
}

async function ensureShelf(supabase: DB, code: string, name?: string): Promise<string> {
  const { data: existing, error } = await supabase.from(TABLES.shelves).select("id").eq("code", code).maybeSingle();
  if (error) throw error;
  if (existing) return existing.id;
  const { data: created, error: insertError } = await supabase
    .from(TABLES.shelves)
    .insert({ code, name: name ?? null })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return created.id;
}

async function ensureBigBox(
  supabase: DB,
  shelfCode: string,
  boxName: string,
  category: string | null,
): Promise<string> {
  const shelfId = await ensureShelf(supabase, shelfCode, shelfCode === FALLBACK_SHELF_CODE ? FALLBACK_SHELF_NAME : undefined);

  const { data: existing, error } = await supabase
    .from(TABLES.big_boxes)
    .select("id")
    .eq("shelf_id", shelfId)
    .eq("name", boxName)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing.id;

  const { data: created, error: insertError } = await supabase
    .from(TABLES.big_boxes)
    .insert({ shelf_id: shelfId, name: boxName, category })
    .select("id")
    .single();
  if (insertError) throw insertError;

  await queueLabelForBigBox(supabase, { id: created.id, name: boxName, category, shelfCode });
  return created.id;
}

async function resolveBox(supabase: DB, suggestion: StorageSuggestion): Promise<string> {
  if (suggestion.kind === "existing") return suggestion.boxId;
  return ensureBigBox(supabase, suggestion.shelfCode, suggestion.boxName, null);
}

interface ReceiveWriteInput {
  partId: string;
  boxId: string;
  qty: number;
  actorId: string;
  orderId?: string | null;
  distributor?: string | null;
  projectId?: string | null;
  /**
   * Pass when this write ALSO needs to add `qty` onto an EXISTING location's
   * qty (top-up / existing-part put-away). Routes the qty change + movement
   * insert through `lib/movements.recordMovement` (scan, cross-package read
   * import per docs/OWNERSHIP.md), which applies the delta with optimistic
   * concurrency (`.eq("qty", expectedQty)` + retry) instead of the bare
   * read-modify-write this used to do — two concurrent receives against the
   * same location could otherwise clobber each other's qty while BOTH still
   * logged a movement, leaving the ledger not reconciling with on-hand qty.
   * Omit when the caller already INSERTed a brand-new location row with the
   * final qty (nothing to reconcile) — this then just logs the movement row.
   */
  existingLocationId?: string | null;
}

interface ReceiveMovementWriteResult {
  /** The new movement's id — surfaced so the UI can offer Undo (FEATURES §9). */
  movementId: string;
  /** Populated only when `existingLocationId` was given — the location's qty after the update. */
  newQty: number | null;
}

/** Writes the `smark_movements` + `smark_part_events` pair every stock arrival stamps (FEATURES §9). */
async function writeReceiveMovementAndEvent(
  supabase: DB,
  input: ReceiveWriteInput,
): Promise<ReceiveMovementWriteResult> {
  let movementId: string;
  let newQty: number | null = null;

  if (input.existingLocationId) {
    const { movement, location } = await recordMovement(supabase, {
      locationId: input.existingLocationId,
      partId: input.partId,
      bigBoxId: input.boxId,
      deltaQty: input.qty,
      reason: "receive",
      actor: input.actorId,
    });
    movementId = movement.id;
    newQty = location.qty;
  } else {
    const { data: movement, error: movementError } = await supabase
      .from(TABLES.movements)
      .insert({
        part_id: input.partId,
        big_box_id: input.boxId,
        delta_qty: input.qty,
        reason: "receive",
        actor: input.actorId,
      })
      .select("id")
      .single();
    if (movementError || !movement) throw movementError ?? new Error("movement insert returned no row");
    movementId = movement.id;
  }

  const { error: eventError } = await supabase.from(TABLES.part_events).insert({
    part_id: input.partId,
    event_type: "received",
    qty: input.qty,
    location_big_box_id: input.boxId,
    actor: input.actorId,
    order_id: input.orderId ?? null,
    distributor: input.distributor ?? null,
    project_id: input.projectId ?? null,
  });
  if (eventError) throw eventError;

  return { movementId, newQty };
}

/** Stamps `smark_parts.last_unit_price` + logs a `price_change` event when it actually moves [R2-11/R2-13]. */
async function stampLastUnitPrice(
  supabase: DB,
  partId: string,
  newPrice: number,
  actorId: string,
  orderId: string | null,
): Promise<void> {
  const { data: part, error } = await supabase.from(TABLES.parts).select("last_unit_price").eq("id", partId).maybeSingle();
  if (error) throw error;
  const oldPrice = part?.last_unit_price ?? null;
  if (oldPrice === newPrice) return;

  const { error: updateError } = await supabase.from(TABLES.parts).update({ last_unit_price: newPrice }).eq("id", partId);
  if (updateError) throw updateError;

  const { error: eventError } = await supabase.from(TABLES.part_events).insert({
    part_id: partId,
    event_type: "price_change",
    price_old: oldPrice,
    price_new: newPrice,
    actor: actorId,
    order_id: orderId,
  });
  if (eventError) throw eventError;
}

/* ────────────────────────────────────────────────────────────────────────────
 * "New part" card [R2-23 #1 · R2-24 voltage · R2-31 duplicate guard]
 * ──────────────────────────────────────────────────────────────────────────── */

export interface DuplicateHit {
  partId: string;
  internalPid: string;
  method: MatchMethod;
  confidence: number;
  /** "0.1µF · 0603, qty 2,568" — the warning card's second line. */
  summary: string;
}

export type CreateNewPartResult =
  | { ok: true; partId: string; internalPid: string; boxLabel: string; labelQueued: boolean }
  | { ok: false; duplicate: DuplicateHit };

export async function createNewPart(
  supabase: DB,
  actorId: string,
  input: NewPartFormInput,
  options: { force?: boolean } = {},
): Promise<CreateNewPartResult> {
  if (!options.force) {
    const catalog = await getMatchCatalog(supabase);
    const hit = matchPart(
      { mpn: input.mpn, value: input.value, package: input.package, voltage: input.voltage },
      catalog,
    );
    if (hit) {
      return {
        ok: false,
        duplicate: {
          partId: hit.part.id,
          internalPid: hit.part.internal_pid,
          method: hit.method,
          confidence: hit.confidence,
          summary: `${hit.part.value ?? "—"} · ${hit.part.package ?? "—"}, qty ${hit.part.total_qty.toLocaleString("en-IN")}`,
        },
      };
    }
  }

  const boxes = await getBoxOptions(supabase);
  const suggestion = suggestStorageBox(input.category, input.package, boxes);
  const boxId = await resolveBox(supabase, suggestion);

  const attributes: PartAttributes = { ...input.customFields };

  const part = await insertPartWithRetry(supabase, {
    mpn: input.mpn?.trim() || null,
    manufacturer: input.manufacturer?.trim() || null,
    category: input.category,
    value: input.value.trim(),
    package: input.package.trim(),
    voltage: input.voltage?.trim() || null,
    attributes,
    needs_review: options.force ? true : false,
    created_by: actorId,
  });

  const { error: locationError } = await supabase
    .from(TABLES.stock_locations)
    .insert({ part_id: part.id, big_box_id: boxId, qty: input.qty, created_by: actorId });
  if (locationError) throw locationError;

  await writeReceiveMovementAndEvent(supabase, { partId: part.id, boxId, qty: input.qty, actorId });

  const label = await queueLabelForPart(supabase, {
    id: part.id,
    internal_pid: part.internal_pid,
    mpn: part.mpn,
    value: part.value,
    package: part.package,
  });

  return {
    ok: true,
    partId: part.id,
    internalPid: part.internal_pid,
    boxLabel: suggestion.label,
    labelQueued: label !== null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * "+ add custom field" [R2-23]
 * ──────────────────────────────────────────────────────────────────────────── */

export type AddCustomFieldResult =
  | { ok: true; fieldKey: string; label: string }
  | { ok: false; error: string };

export async function addCustomFieldTemplate(
  supabase: DB,
  actorId: string,
  input: CustomFieldTemplateInput,
): Promise<AddCustomFieldResult> {
  const fieldKey = slugifyFieldKey(input.label);
  if (!fieldKey) return { ok: false, error: "Enter a field name" };

  const { error } = await supabase.from(TABLES.part_field_templates).insert({
    label: input.label.trim(),
    field_key: fieldKey,
    field_type: input.fieldType,
    active: true,
    created_by: actorId,
  });
  if (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "A field with a matching name already exists." };
    throw error;
  }
  return { ok: true, fieldKey, label: input.label.trim() };
}

/* ────────────────────────────────────────────────────────────────────────────
 * "Top up existing" card [R2-23 #2] — NO label, ever.
 * ──────────────────────────────────────────────────────────────────────────── */

export type TopUpResult =
  | { ok: true; partId: string; internalPid: string; newQty: number; movementId: string }
  | { ok: false; error: string };

export async function topUpExistingPart(supabase: DB, actorId: string, input: TopUpInput): Promise<TopUpResult> {
  const code = input.code.trim();
  const { data: part, error } = await supabase
    .from(TABLES.parts)
    .select("id, internal_pid")
    .eq("internal_pid", code)
    .maybeSingle();
  if (error) throw error;
  if (!part) return { ok: false, error: `No part found for "${code}".` };

  const { data: locations, error: locationsError } = await supabase
    .from(TABLES.stock_locations)
    .select("id, big_box_id, qty")
    .eq("part_id", part.id)
    .order("created_at", { ascending: true });
  if (locationsError) throw locationsError;
  if (!locations || locations.length === 0) {
    return {
      ok: false,
      error: `${part.internal_pid} has no storage location yet — assign one from the onboarding queue first.`,
    };
  }

  const target = locations[0]!;
  const { movementId, newQty } = await writeReceiveMovementAndEvent(supabase, {
    partId: part.id,
    boxId: target.big_box_id,
    qty: input.qty,
    actorId,
    existingLocationId: target.id,
  });

  return { ok: true, partId: part.id, internalPid: part.internal_pid, newQty: newQty!, movementId };
}

/* ────────────────────────────────────────────────────────────────────────────
 * "Put away arrivals" card [R2-23 #3 · R2-12 last_unit_price stamp]
 * ──────────────────────────────────────────────────────────────────────────── */

export type PutAwayResult =
  | { ok: true; partId: string; internalPid: string; labelQueued: boolean; movementId: string }
  | { ok: false; error: string };

export async function putAwayArrivalLine(supabase: DB, actorId: string, input: PutAwayInput): Promise<PutAwayResult> {
  const { data: line, error: lineError } = await supabase
    .from(TABLES.order_lines)
    .select("*")
    .eq("id", input.orderLineId)
    .maybeSingle();
  if (lineError) throw lineError;
  if (!line) return { ok: false, error: "Arrival line not found." };
  if (line.arrived_at) return { ok: false, error: "This line has already been put away." };

  const { data: order, error: orderError } = await supabase
    .from(TABLES.orders)
    .select("id, po_number, distributor_id")
    .eq("id", line.order_id)
    .maybeSingle();
  if (orderError) throw orderError;

  const { data: distributor, error: distributorError } = order
    ? await supabase.from(TABLES.distributors).select("name").eq("id", order.distributor_id).maybeSingle()
    : { data: null, error: null };
  if (distributorError) throw distributorError;

  let partId: string;
  let internalPid: string;
  let boxId: string;
  let labelQueued = false;
  // Set only when topping up an EXISTING location's qty (see
  // `writeReceiveMovementAndEvent`'s `existingLocationId` doc) — left null
  // when a brand-new location was just INSERTed with the final qty already.
  let existingLocationId: string | null = null;

  if (line.part_id) {
    // Existing part — top up, never reprint.
    partId = line.part_id;
    const { data: part, error: partError } = await supabase
      .from(TABLES.parts)
      .select("internal_pid, mpn, value, package, category")
      .eq("id", partId)
      .maybeSingle();
    if (partError) throw partError;
    if (!part) return { ok: false, error: "Linked part no longer exists." };
    internalPid = part.internal_pid;

    const { data: locations, error: locationsError } = await supabase
      .from(TABLES.stock_locations)
      .select("id, big_box_id, qty")
      .eq("part_id", partId)
      .order("created_at", { ascending: true });
    if (locationsError) throw locationsError;

    if (locations && locations.length > 0) {
      const target = locations[0]!;
      boxId = target.big_box_id;
      existingLocationId = target.id;
    } else {
      // Catalogued but never located (shouldn't normally happen) — resolve a home now.
      const boxes = await getBoxOptions(supabase);
      const suggestion = suggestStorageBox(part.category, part.package, boxes);
      boxId = await resolveBox(supabase, suggestion);
      const { error: insertError } = await supabase
        .from(TABLES.stock_locations)
        .insert({ part_id: partId, big_box_id: boxId, qty: input.arrivedQty, created_by: actorId });
      if (insertError) throw insertError;
    }
  } else {
    // Never-catalogued — one new part, one queued label.
    if (!line.cart_item_id) {
      return { ok: false, error: "This arrival has no linked cart details to create the part from." };
    }
    const { data: cartItem, error: cartItemError } = await supabase
      .from(TABLES.cart_items)
      .select("descriptor")
      .eq("id", line.cart_item_id)
      .maybeSingle();
    if (cartItemError) throw cartItemError;
    const descriptor = (cartItem?.descriptor ?? null) as CartDescriptor | null;
    if (!descriptor) return { ok: false, error: "Missing part details for this arrival." };

    const boxes = await getBoxOptions(supabase);
    const suggestion = suggestStorageBox(null, descriptor.package ?? null, boxes);
    boxId = await resolveBox(supabase, suggestion);

    const part = await insertPartWithRetry(supabase, {
      mpn: descriptor.mpn ?? null,
      lcsc_pn: descriptor.lcsc_pn ?? null,
      description: descriptor.description ?? null,
      value: descriptor.value ?? null,
      package: descriptor.package ?? null,
      voltage: descriptor.voltage ?? null,
      attributes: {},
      needs_review: false,
      created_by: actorId,
    });
    partId = part.id;
    internalPid = part.internal_pid;

    const { error: insertLocationError } = await supabase
      .from(TABLES.stock_locations)
      .insert({ part_id: partId, big_box_id: boxId, qty: input.arrivedQty, created_by: actorId });
    if (insertLocationError) throw insertLocationError;

    const label = await queueLabelForPart(supabase, {
      id: partId,
      internal_pid: internalPid,
      mpn: part.mpn,
      value: part.value,
      package: part.package,
    });
    labelQueued = label !== null;
  }

  const { movementId } = await writeReceiveMovementAndEvent(supabase, {
    partId,
    boxId,
    qty: input.arrivedQty,
    actorId,
    orderId: order?.id ?? null,
    distributor: distributor?.name ?? null,
    projectId: line.project_id,
    existingLocationId,
  });

  if (line.unit_price != null) {
    await stampLastUnitPrice(supabase, partId, line.unit_price, actorId, order?.id ?? null);
  }

  const { error: closeOutError } = await supabase
    .from(TABLES.order_lines)
    .update({ line_status: "arrived", arrived_qty: input.arrivedQty, arrived_at: new Date().toISOString() })
    .eq("id", input.orderLineId);
  if (closeOutError) throw closeOutError;

  return { ok: true, partId, internalPid, labelQueued, movementId };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Onboarding queue — "assign Shelf → Box → ESD inline" [FEATURES §14]
 * ──────────────────────────────────────────────────────────────────────────── */

export type OnboardingAssignResult =
  | { ok: true; partId: string; internalPid: string; labelQueued: boolean }
  | { ok: false; error: string };

export async function assignOnboardingLocation(
  supabase: DB,
  actorId: string,
  input: OnboardingAssignInput,
): Promise<OnboardingAssignResult> {
  const { data: part, error } = await supabase
    .from(TABLES.parts)
    .select("id, internal_pid, mpn, value, package, category, total_qty")
    .eq("id", input.partId)
    .maybeSingle();
  if (error) throw error;
  if (!part) return { ok: false, error: "Part not found." };

  let boxId: string;
  if (input.boxId) {
    boxId = input.boxId;
  } else if (input.newBoxName && input.shelfCode) {
    boxId = await ensureBigBox(supabase, input.shelfCode, input.newBoxName, part.category);
  } else {
    return { ok: false, error: "Pick a box, or provide a new box name + shelf." };
  }

  const { data: existingLocations, error: locationsError } = await supabase
    .from(TABLES.stock_locations)
    .select("id")
    .eq("part_id", part.id);
  if (locationsError) throw locationsError;

  if (!existingLocations || existingLocations.length === 0) {
    // First-time placement of already-known (imported) qty — no movement, this isn't new stock arriving.
    const { error: insertError } = await supabase.from(TABLES.stock_locations).insert({
      part_id: part.id,
      big_box_id: boxId,
      qty: part.total_qty,
      esd_note: input.esdNote ?? null,
      created_by: actorId,
    });
    if (insertError) throw insertError;
  }

  const { error: updateError } = await supabase.from(TABLES.parts).update({ needs_review: false }).eq("id", part.id);
  if (updateError) throw updateError;

  const { error: eventError } = await supabase.from(TABLES.part_events).insert({
    part_id: part.id,
    event_type: "location_moved",
    location_big_box_id: boxId,
    actor: actorId,
    qty: part.total_qty,
  });
  if (eventError) throw eventError;

  const label = await queueLabelForPart(supabase, {
    id: part.id,
    internal_pid: part.internal_pid,
    mpn: part.mpn,
    value: part.value,
    package: part.package,
  });

  return { ok: true, partId: part.id, internalPid: part.internal_pid, labelQueued: label !== null };
}
