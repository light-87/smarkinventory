/**
 * lib/categories/queries.ts — the category and sub-category lists, derived.
 *
 * There is no categories table, and deliberately so. `smark_parts.category` is
 * free text and sub-category lives in `attributes.sub_category`, which means
 * the set of categories in use is already a fact about the data — a table would
 * be a second copy of it, free to drift. So "define a new category" is simply
 * "type one on a part", and this module reports what exists.
 *
 * The built-in list is unioned in so the chips still offer the standard set
 * before any part uses it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PartAttributes } from "@/types/db";
import { PART_CATEGORIES, TABLES } from "@/types/db";
import { selectAllRows } from "@/lib/supabase/select-all";

type DB = SupabaseClient<Database>;

export interface CategoryUsage {
  name: string;
  partCount: number;
  /** Sub-categories seen on parts of this category, with their own counts. */
  subCategories: { name: string; partCount: number }[];
}

interface CategoryRow {
  category: string | null;
  attributes: PartAttributes | null;
}

/** Every category in use (plus the built-ins), each with its sub-categories. */
export async function getCategoryUsage(supabase: DB): Promise<CategoryUsage[]> {
  const rows = await selectAllRows<CategoryRow>((from, to) =>
    supabase.from(TABLES.parts).select("category, attributes").order("id").range(from, to),
  );

  const byCategory = new Map<string, { partCount: number; subs: Map<string, number> }>();
  const ensure = (name: string) => {
    const existing = byCategory.get(name);
    if (existing) return existing;
    const created = { partCount: 0, subs: new Map<string, number>() };
    byCategory.set(name, created);
    return created;
  };

  // Built-ins first so a standard category with no stock still shows up.
  for (const name of PART_CATEGORIES) ensure(name);

  for (const row of rows) {
    const category = (row.category ?? "").trim();
    if (category === "") continue;
    const bucket = ensure(category);
    bucket.partCount += 1;

    const rawSub = row.attributes?.sub_category;
    const sub = rawSub === null || rawSub === undefined ? "" : String(rawSub).trim();
    if (sub === "") continue;
    bucket.subs.set(sub, (bucket.subs.get(sub) ?? 0) + 1);
  }

  return Array.from(byCategory.entries())
    .map(([name, bucket]) => ({
      name,
      partCount: bucket.partCount,
      subCategories: Array.from(bucket.subs.entries())
        .map(([subName, partCount]) => ({ name: subName, partCount }))
        .sort((a, b) => b.partCount - a.partCount || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.partCount - a.partCount || a.name.localeCompare(b.name));
}
