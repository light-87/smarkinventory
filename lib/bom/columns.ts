/**
 * lib/bom/columns.ts — the standard BOM column set (FEATURES.md §5.8 · R2-19).
 *
 * "# Reference Qty Value Footprint DNP Description MPN Manufacturer PartLink
 * LCSC PN Priority/Notes" — the same 11 columns the Create-BOM grid starts
 * from, the downloadable xlsx template renders, and `smark_bom_templates`
 * remembers alongside any company-added custom columns. Keys here are
 * intentionally identical to the matching `smark_bom_lines` column names so
 * `lib/bom/service.ts` can map a grid row straight onto an insert payload
 * without a second lookup table.
 */

import type { BomTemplateColumn, FieldType } from "@/types/db";

/** The 11 standard keys — anything else in a template/grid is a custom column. */
export const STANDARD_BOM_COLUMN_KEYS = [
  "line_no",
  "references",
  "qty",
  "value",
  "footprint",
  "dnp",
  "description",
  "mpn",
  "manufacturer",
  "part_link",
  "lcsc_pn",
  "priority_note",
] as const;

export type StandardBomColumnKey = (typeof STANDARD_BOM_COLUMN_KEYS)[number];

const STANDARD_KEY_SET = new Set<string>(STANDARD_BOM_COLUMN_KEYS);

/** True when `key` is one of the 11 standard columns (maps onto a real `smark_bom_lines` column). */
export function isStandardBomColumnKey(key: string): key is StandardBomColumnKey {
  return STANDARD_KEY_SET.has(key);
}

/**
 * The starting-point column set every company begins with (mirrors
 * `smark_bom_templates.columns` shape exactly — `[{key,label,type,required,
 * is_custom}]`). `type` is schema-constrained to text/number (FieldTypeSchema
 * has no boolean) — the grid editor renders `dnp` as a checkbox regardless of
 * the stored type, and `line_no`/`qty` as numeric inputs; see
 * `components/bom/create-bom-grid.tsx`'s per-key render map.
 */
export const STANDARD_BOM_COLUMNS: readonly BomTemplateColumn[] = [
  { key: "line_no", label: "#", type: "number", required: false, is_custom: false },
  { key: "references", label: "Reference", type: "text", required: true, is_custom: false },
  { key: "qty", label: "Qty", type: "number", required: true, is_custom: false },
  { key: "value", label: "Value", type: "text", required: true, is_custom: false },
  { key: "footprint", label: "Footprint", type: "text", required: false, is_custom: false },
  { key: "dnp", label: "DNP", type: "text", required: false, is_custom: false },
  { key: "description", label: "Description", type: "text", required: false, is_custom: false },
  { key: "mpn", label: "MPN", type: "text", required: false, is_custom: false },
  { key: "manufacturer", label: "Manufacturer", type: "text", required: false, is_custom: false },
  { key: "part_link", label: "PartLink", type: "text", required: false, is_custom: false },
  { key: "lcsc_pn", label: "LCSC PN", type: "text", required: false, is_custom: false },
  { key: "priority_note", label: "Priority/Notes", type: "text", required: false, is_custom: false },
];

/** Slugifies a user-typed custom-field name into a `smark_bom_lines.extra` jsonb key. */
export function slugifyColumnKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Builds a fresh custom-column definition, guarding against clashing with a standard key. */
export function makeCustomColumn(label: string, type: FieldType): BomTemplateColumn | null {
  const key = slugifyColumnKey(label);
  if (!key || isStandardBomColumnKey(key)) return null;
  return { key, label: label.trim(), type, required: false, is_custom: true };
}

/**
 * Merges a saved template's columns with the always-present standard set —
 * standard columns first (in canonical order, using the CURRENT label/type
 * even if the saved row drifted), then any custom columns the template added,
 * order preserved. Used both to prefill the Create-BOM grid and to render the
 * downloadable xlsx template (`lib/bom/xlsx-template.ts`).
 */
export function mergeWithStandardColumns(saved: readonly BomTemplateColumn[] | null | undefined): BomTemplateColumn[] {
  const customFromSaved = (saved ?? []).filter((col) => !isStandardBomColumnKey(col.key));
  return [...STANDARD_BOM_COLUMNS, ...customFromSaved];
}
