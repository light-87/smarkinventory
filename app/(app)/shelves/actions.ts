"use server";

/**
 * app/(app)/shelves/actions.ts — box-detail server actions (print queueing).
 * The guided-audit write path lives in `lib/audit/actions.ts` instead (this
 * package's one `lib/` folder, per docs/OWNERSHIP.md); this file only holds
 * the "Print Big-Box label" action, which isn't audit logic.
 *
 * Reuses receive's `lib/labels/queue.ts` (OWNERSHIP.md cross-import
 * allowance: "lib/labels (receive) ← shelves/part-detail") rather than
 * re-deriving the label-text format or the print-queue insert here.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/types/db";
import { queueLabelForBigBox } from "@/lib/labels/queue";

export interface PrintBigBoxLabelResult {
  /** "queued" = first label ever created for this box; "requeued" = a reprint request. */
  status: "queued" | "requeued";
}

/**
 * Queues the box's one-and-only label for the next Avery batch print
 * (FEATURES.md §8). Unlike parts, a box MAY legitimately need a reprint
 * (label lost/damaged) — `queueLabelForBigBox` treats an existing label as a
 * no-op (print-rule invariant: one label row per target, ever), so when that
 * happens this flips the EXISTING row's `print_status` back to `queued`
 * itself rather than editing `lib/labels/queue.ts` to add a re-queue helper
 * (owned by receive — flagged in the package report as a candidate for them
 * to fold in later).
 */
export async function printBigBoxLabel(boxId: string): Promise<PrintBigBoxLabelResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: box, error: boxError } = await supabase
    .from(TABLES.big_boxes)
    .select("id, name, category, shelf_id, qr_label_id")
    .eq("id", boxId)
    .maybeSingle();
  if (boxError) throw new Error(boxError.message);
  if (!box) throw new Error("Box not found.");

  const { data: shelf, error: shelfError } = await supabase
    .from(TABLES.shelves)
    .select("code")
    .eq("id", box.shelf_id)
    .maybeSingle();
  if (shelfError) throw new Error(shelfError.message);

  const created = await queueLabelForBigBox(supabase, {
    id: box.id,
    name: box.name,
    category: box.category,
    shelfCode: shelf?.code ?? "?",
  });

  let status: PrintBigBoxLabelResult["status"] = "queued";

  if (!created) {
    if (!box.qr_label_id) {
      throw new Error("This box has a conflicting label record — ask the integrator to check smark_qr_labels.");
    }
    const { error: requeueError } = await supabase
      .from(TABLES.qr_labels)
      .update({ print_status: "queued" })
      .eq("id", box.qr_label_id);
    if (requeueError) throw new Error(requeueError.message);
    status = "requeued";
  }

  revalidatePath(`/shelves/${boxId}`);
  return { status };
}

export type RenameBoxResult = { ok: true } | { ok: false; error: string };

/**
 * Renames a box and/or moves it to another shelf.
 *
 * Client request, 2026-08-13: "need option to change created box name and
 * position". Boxes are created in passing during put-away — you type a name to
 * get the stock off your desk — so the first name is often provisional, and
 * until now there was no way back to it.
 *
 * The shelf is addressed by its human code ("A", "B", "U") and created if it
 * doesn't exist yet, mirroring how put-away already invents shelves. The box's
 * stock moves with it implicitly: locations point at the box, not the shelf.
 */
export async function renameBigBox(input: {
  boxId: string;
  name: string;
  shelfCode: string;
}): Promise<RenameBoxResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const name = input.name.trim();
  const shelfCode = input.shelfCode.trim().toUpperCase();
  if (!name) return { ok: false, error: "Box name is required." };
  if (!shelfCode) return { ok: false, error: "Shelf is required." };

  const { data: shelf, error: shelfError } = await supabase
    .from(TABLES.shelves)
    .select("id")
    .eq("code", shelfCode)
    .maybeSingle();
  if (shelfError) return { ok: false, error: shelfError.message };

  let shelfId = shelf?.id;
  if (!shelfId) {
    const { data: created, error: createError } = await supabase
      .from(TABLES.shelves)
      .insert({ code: shelfCode, name: null })
      .select("id")
      .single();
    if (createError) return { ok: false, error: createError.message };
    shelfId = created.id;
  }

  const { data: updated, error } = await supabase
    .from(TABLES.big_boxes)
    .update({ name, shelf_id: shelfId })
    .eq("id", input.boxId)
    .select("id");
  if (error) {
    // A box name is unique within its shelf — say so in words rather than
    // leaking the constraint name.
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, error: `Shelf ${shelfCode} already has a box called "${name}".` };
    }
    return { ok: false, error: error.message };
  }
  // PostgREST answers 200 with an empty body when RLS blocks an UPDATE.
  if (!updated || updated.length === 0) {
    return { ok: false, error: "That box could not be updated — you may not have permission." };
  }

  revalidatePath("/shelves", "layout");
  return { ok: true };
}
