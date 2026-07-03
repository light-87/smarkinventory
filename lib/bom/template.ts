/**
 * lib/bom/template.ts — the remembered company Create-BOM structure
 * (`smark_bom_templates` [R2-19]). "One active template for the company (v1)"
 * — a singleton by convention, not a DB constraint, so this reads the
 * most-recently-touched row rather than assuming there's only ever one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BomTemplateColumn, BomTemplateRow, Database } from "@/types/db";
import { TABLES } from "@/types/db";
import { mergeWithStandardColumns, STANDARD_BOM_COLUMNS } from "./columns";

type DB = SupabaseClient<Database>;

/** The current company template row, or `null` if nobody has saved a Create-BOM yet. */
export async function getActiveBomTemplate(supabase: DB): Promise<BomTemplateRow | null> {
  const { data, error } = await supabase
    .from(TABLES.bom_templates)
    .select("*")
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * The columns Create-BOM prefills from and the downloadable xlsx template
 * renders — the standard 11 (current label/type, in case a saved row drifted)
 * plus any custom columns the company has added, in the order they were
 * added.
 */
export async function getEffectiveBomColumns(supabase: DB): Promise<BomTemplateColumn[]> {
  const template = await getActiveBomTemplate(supabase);
  return template ? mergeWithStandardColumns(template.columns) : [...STANDARD_BOM_COLUMNS];
}

/**
 * Saves (inserts or updates) the ONE company template row with the given
 * column set — called after every successful Create-BOM save so the next
 * Create-BOM AND the downloadable template both reflect it [R2-19].
 */
export async function saveBomTemplate(
  supabase: DB,
  columns: readonly BomTemplateColumn[],
  actorId: string,
): Promise<BomTemplateRow> {
  const existing = await getActiveBomTemplate(supabase);
  const now = new Date().toISOString();

  if (existing) {
    const { data, error } = await supabase
      .from(TABLES.bom_templates)
      .update({ columns: [...columns], last_used_at: now })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from(TABLES.bom_templates)
    .insert({ columns: [...columns], created_by: actorId, last_used_at: now })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
