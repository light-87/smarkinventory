"use server";

/**
 * lib/categories/actions.ts — renaming and removing categories / sub-categories.
 *
 * Client request, 2026-08-13: "need option to define new category and
 * subcategory, also need option to edit category and subcategory names", plus
 * the specific correction "remove subcategory 'IC 555' from all the items
 * having it. It is wrong. Also delete this subcategory."
 *
 * Defining a new one needs no code: category is free text on the part, so
 * typing it on a part IS creating it (lib/categories/queries.ts derives the
 * list from the data). Renaming is the operation that needs care, because a
 * half-applied rename splits one category into two in every filter.
 *
 * A rename therefore rewrites every affected part. `category` is a column, so
 * that is one UPDATE; sub-category lives inside the `attributes` JSON, so those
 * rows are read and rewritten in chunks. Deleting a sub-category is the same
 * pass with the key removed rather than replaced — the parts are untouched
 * otherwise, and none is deleted.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { PartAttributes } from "@/types/db";
import { TABLES } from "@/types/db";
import { selectAllRows } from "@/lib/supabase/select-all";

export type CategoryEditResult = { ok: true; updated: number } | { ok: false; error: string };

async function requireInventoryEditor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, allowed: false as const };
  const { data: canEdit } = await supabase.rpc("smark_can_edit_inventory");
  return { supabase, allowed: Boolean(canEdit) };
}

/** Renames a category on every part carrying it. */
export async function renameCategoryAction(input: { from: string; to: string }): Promise<CategoryEditResult> {
  const { supabase, allowed } = await requireInventoryEditor();
  if (!allowed) return { ok: false, error: "You have view-only access to inventory." };

  const from = input.from.trim();
  const to = input.to.trim();
  if (!from || !to) return { ok: false, error: "Both the old and new name are required." };
  if (from === to) return { ok: true, updated: 0 };

  const { data, error } = await supabase
    .from(TABLES.parts)
    .update({ category: to })
    .eq("category", from)
    .select("id");
  if (error) return { ok: false, error: error.message };

  revalidatePath("/inventory");
  revalidatePath("/settings/categories");
  return { ok: true, updated: data?.length ?? 0 };
}

/**
 * Renames a sub-category, or removes it entirely when `to` is blank.
 *
 * Removing sets the key aside rather than storing an empty string: a blank
 * value would still count as a distinct facet option and the sub-category would
 * reappear in the filter list as an unnamed row.
 */
export async function renameSubCategoryAction(input: {
  category: string;
  from: string;
  to: string | null;
}): Promise<CategoryEditResult> {
  const { supabase, allowed } = await requireInventoryEditor();
  if (!allowed) return { ok: false, error: "You have view-only access to inventory." };

  const from = input.from.trim();
  const to = input.to?.trim() ?? "";
  if (!from) return { ok: false, error: "Pick a sub-category to change." };

  const rows = await selectAllRows<{ id: string; attributes: PartAttributes | null }>((rangeFrom, rangeTo) =>
    supabase
      .from(TABLES.parts)
      .select("id, attributes")
      .eq("category", input.category)
      .order("id")
      .range(rangeFrom, rangeTo),
  );

  const affected = rows.filter((row) => String(row.attributes?.sub_category ?? "").trim() === from);
  if (affected.length === 0) return { ok: true, updated: 0 };

  // One statement per part: `attributes` is a JSON blob, so a bulk UPDATE would
  // have to rewrite it server-side, and PostgREST offers no jsonb_set. At the
  // scale of a sub-category (tens to low hundreds of parts) this is fine.
  let updated = 0;
  for (const row of affected) {
    const next: PartAttributes = { ...(row.attributes ?? {}) };
    if (to === "") delete next.sub_category;
    else next.sub_category = to;

    const { error } = await supabase.from(TABLES.parts).update({ attributes: next }).eq("id", row.id);
    if (error) return { ok: false, error: `Stopped after ${updated} parts: ${error.message}` };
    updated += 1;
  }

  revalidatePath("/inventory");
  revalidatePath("/settings/categories");
  return { ok: true, updated };
}
