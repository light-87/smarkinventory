"use server";

/**
 * lib/part-events/actions.ts — part-detail Server Actions (Adjust qty +
 * undo, Print-label enqueue). FEATURES.md §9: "Every stock mutation writes
 * smark_movements ... and is undoable (undo_of)."
 *
 * Adjust/undo delegate to `lib/movements` (owned by `scan`) — that module's
 * own docstring already names part-detail as an intended caller ("anywhere
 * Part-detail eventually surfaces an undo action) calls undoMovement"), and
 * it does the qty write + movement row atomically-enough (optimistic
 * concurrency retry) rather than duplicating that logic here. Print-label
 * enqueue delegates to `lib/labels` (owned by `receive`) for the same
 * reason — both are explicit cross-package read imports per
 * docs/OWNERSHIP.md ("lib/movements (scan) ← ...", "lib/labels (receive) ←
 * shelves/part-detail"). Note for integrator: `lib/movements`'s allowlist
 * comment doesn't list part-detail explicitly yet — worth adding now that
 * this is a real caller.
 */

import { revalidatePath } from "next/cache";
import { buildPartEdit, type PartEditInput } from "./edit";
import { buildPartHumanText, queueLabelForPart, type LabelPartInput } from "@/lib/labels/queue";
import { recordMovement, undoMovement } from "@/lib/movements";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/types/db";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function requireInventoryWriter(
  supabase: SupabaseServerClient,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to make changes." };

  // (0017) view/edit-aware: owner or an edit-granted employee. The RPC is the
  // exact twin of the write RLS on the inventory tables, so this pre-check and
  // the DB boundary never disagree.
  const { data: canEdit, error } = await supabase.rpc("smark_can_edit_inventory");
  if (error) return { ok: false, error: error.message };
  if (!canEdit) {
    return { ok: false, error: "You have view-only access to inventory." };
  }
  return { ok: true, userId: user.id };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Adjust qty + undo
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AdjustQtyInput {
  partId: string;
  locationId: string;
  newQty: number;
  note?: string;
}

export type AdjustQtyResult = { ok: true; movementId: string; delta: number } | { ok: false; error: string };

export async function adjustPartQty(input: AdjustQtyInput): Promise<AdjustQtyResult> {
  if (!Number.isInteger(input.newQty) || input.newQty < 0) {
    return { ok: false, error: "Quantity must be a whole number, 0 or more." };
  }

  const supabase = await createClient();
  const auth = await requireInventoryWriter(supabase);
  if (!auth.ok) return auth;

  const { data: location, error: locationError } = await supabase
    .from(TABLES.stock_locations)
    .select("id, part_id, big_box_id, qty")
    .eq("id", input.locationId)
    .maybeSingle();
  if (locationError) return { ok: false, error: locationError.message };
  if (!location || location.part_id !== input.partId) {
    return { ok: false, error: "That location no longer exists." };
  }

  const delta = input.newQty - location.qty;
  if (delta === 0) return { ok: false, error: "That's already the current quantity." };

  try {
    const { movement } = await recordMovement(supabase, {
      locationId: location.id,
      partId: input.partId,
      bigBoxId: location.big_box_id,
      deltaQty: delta,
      reason: "adjust",
      actor: auth.userId,
    });

    const { error: eventError } = await supabase.from(TABLES.part_events).insert({
      part_id: input.partId,
      event_type: "adjusted",
      qty: delta,
      actor: auth.userId,
      reason: input.note ?? null,
      location_big_box_id: location.big_box_id,
      occurred_at: new Date().toISOString(),
    });
    if (eventError) return { ok: false, error: eventError.message };

    revalidatePath("/inventory");
    return { ok: true, movementId: movement.id, delta };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Could not record the adjustment.") };
  }
}

export type UndoMovementResult = { ok: true } | { ok: false; error: string };

export async function undoStockMovement(movementId: string): Promise<UndoMovementResult> {
  const supabase = await createClient();
  const auth = await requireInventoryWriter(supabase);
  if (!auth.ok) return auth;

  try {
    const { movement } = await undoMovement(supabase, movementId, auth.userId);

    await supabase.from(TABLES.part_events).insert({
      part_id: movement.part_id,
      event_type: "adjusted",
      qty: movement.delta_qty,
      actor: auth.userId,
      reason: "Undo of adjustment",
      location_big_box_id: movement.big_box_id,
      occurred_at: new Date().toISOString(),
    });

    revalidatePath("/inventory");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Could not undo that adjustment.") };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Edit part details
 * ──────────────────────────────────────────────────────────────────────────── */

export type UpdatePartResult = { ok: true; changed: number } | { ok: false; error: string };

/**
 * Writes the corrections the client makes while verifying the imported catalog.
 * The change itself is appended to the living record as a `note` event — the
 * event-type CHECK has no "edited" member, and a note carrying "Description: —
 * → 0.1uF/100nF" says the same thing in the timeline the part detail already
 * renders, without a migration.
 */
export async function updatePartDetails(input: PartEditInput): Promise<UpdatePartResult> {
  const supabase = await createClient();
  const auth = await requireInventoryWriter(supabase);
  if (!auth.ok) return auth;

  const { data: part, error: readError } = await supabase
    .from(TABLES.parts)
    .select("*")
    .eq("id", input.partId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!part) return { ok: false, error: "That part no longer exists." };

  const built = buildPartEdit(part, input);
  if (!built.ok) return built;
  const { patch, changes } = built.result;
  if (changes.length === 0) return { ok: false, error: "Nothing changed." };

  // `.select()` so a write that matched NO rows is caught. PostgREST answers a
  // blocked UPDATE with 200 and an empty body rather than an error, so without
  // this an RLS denial reports success and the client watches their correction
  // vanish on the next refresh — the exact silent-no-op class migration 0019's
  // audit went after elsewhere in this codebase.
  const { data: updated, error: updateError } = await supabase
    .from(TABLES.parts)
    .update(patch)
    .eq("id", input.partId)
    .select("id");
  if (updateError) return { ok: false, error: updateError.message };
  if (!updated || updated.length === 0) {
    return { ok: false, error: "The save did not go through — you may not have permission to edit inventory." };
  }

  const { error: eventError } = await supabase.from(TABLES.part_events).insert({
    part_id: input.partId,
    event_type: "note",
    actor: auth.userId,
    reason: `Edited — ${changes.join("; ")}`,
    occurred_at: new Date().toISOString(),
  });
  // The part is already corrected; failing the whole action because the
  // timeline entry didn't write would tell the client their edit was lost.
  if (eventError) console.error("[part-edit] note event failed:", eventError.message);

  revalidatePath("/inventory");
  revalidatePath(`/part/${part.internal_pid}`);
  return { ok: true, changed: changes.length };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Print label — enqueue only (batch PDF rendering is receive's lib/labels/**)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface QueuePrintInput {
  part: LabelPartInput;
}

export type QueuePrintResult = { ok: true } | { ok: false; error: string };

export async function queuePartLabelPrint(input: QueuePrintInput): Promise<QueuePrintResult> {
  const supabase = await createClient();
  const auth = await requireInventoryWriter(supabase);
  if (!auth.ok) return auth;

  const { data: existing, error: existingError } = await supabase
    .from(TABLES.qr_labels)
    .select("id, print_status")
    .eq("target_type", "part")
    .eq("target_id", input.part.id)
    .maybeSingle();
  if (existingError) return { ok: false, error: existingError.message };

  if (existing) {
    // Already-labeled part: `queueLabelForPart` is insert-only (the
    // print-rule invariant lives at the DB unique index — new part → exactly
    // one label, never a second insert). Re-queuing a previously-PRINTED
    // label for a reprint is this action's own extra capability.
    if (existing.print_status === "queued") return { ok: true };
    const { error } = await supabase
      .from(TABLES.qr_labels)
      .update({ print_status: "queued", printed_at: null })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/inventory");
    return { ok: true };
  }

  try {
    await queueLabelForPart(supabase, input.part);
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Could not queue the label.") };
  }

  revalidatePath("/inventory");
  return { ok: true };
}

export { buildPartHumanText };
