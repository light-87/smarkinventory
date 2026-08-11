/**
 * lib/part-events/edit.ts — editing a part's details (client request,
 * 2026-08-11: "How can I edit the uploaded part - like description or any
 * other value").
 *
 * Until now a part could only be created (Receive) or have its quantity
 * adjusted. Everything else was whatever the import produced, which is
 * untenable for a catalog the client is verifying row by row: the whole point
 * of the verification pass is that some values are wrong.
 *
 * Kept pure and separate from `actions.ts` so the interesting parts — which
 * fields exist, what "no change" means, and how a change is described in the
 * living record — are unit-testable without a database or a session.
 *
 * Two rules the diff enforces, both about not lying in the audit trail:
 *   - An empty box CLEARS the field (writes null) rather than being ignored.
 *     "Delete this wrong description" has to be expressible.
 *   - A field the user did not touch is absent from the patch entirely, so
 *     `updated_at` and the logged note only move when something really changed.
 */

import type { PartAttributes, PartRow, PartStatus } from "@/types/db";

/** Columns on `smark_parts` this form can write, with their display labels. */
export const EDITABLE_TEXT_FIELDS = [
  { key: "mpn", label: "MPN" },
  { key: "manufacturer", label: "Manufacturer" },
  { key: "lcsc_pn", label: "LCSC PN" },
  { key: "description", label: "Description" },
  { key: "value", label: "Value" },
  { key: "voltage", label: "Voltage" },
  { key: "package", label: "Package" },
  { key: "category", label: "Category" },
] as const;

export type EditableTextField = (typeof EDITABLE_TEXT_FIELDS)[number]["key"];

/**
 * Attribute keys the form exposes. Deliberately the two that earn a column or
 * a facet of their own (`Sub-category` on the grid, `Mount type` in the
 * sidebar) rather than every key the importer happens to write — the long tail
 * is per-category and belongs in a category-aware form, not this one.
 */
export const EDITABLE_ATTRIBUTE_FIELDS = [
  { key: "sub_category", label: "Sub-category" },
  { key: "mount_type", label: "Mount type" },
] as const;

export type EditableAttributeField = (typeof EDITABLE_ATTRIBUTE_FIELDS)[number]["key"];

export const PART_STATUSES: readonly PartStatus[] = ["active", "nrnd", "eol"];

export interface PartEditInput {
  partId: string;
  fields: Partial<Record<EditableTextField, string>>;
  attributes: Partial<Record<EditableAttributeField, string>>;
  /** Blank clears the per-part threshold and falls back to the global default. */
  reorderPoint: string;
  status: PartStatus;
}

export interface PartEditPatch {
  patch: Partial<PartRow>;
  /** Human summary of what changed, for the living record. Empty = no change. */
  changes: string[];
}

export type PartEditValidation = { ok: true; result: PartEditPatch } | { ok: false; error: string };

/** Trimmed, with empty meaning "clear this field". */
function normalize(raw: string | undefined): string | null {
  if (raw === undefined) return undefined as unknown as null;
  const text = raw.trim();
  return text === "" ? null : text;
}

function describe(label: string, before: unknown, after: unknown): string {
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
  return `${label}: ${show(before)} → ${show(after)}`;
}

/**
 * Builds the column patch and the change summary. Returns an error only for
 * input a person could reasonably type wrong; anything else is accepted as
 * typed, because this form exists precisely to let the client correct data the
 * import got wrong and second-guessing them would defeat it.
 */
export function buildPartEdit(part: PartRow, input: PartEditInput): PartEditValidation {
  const patch: Partial<PartRow> = {};
  const changes: string[] = [];

  for (const { key, label } of EDITABLE_TEXT_FIELDS) {
    const raw = input.fields[key];
    if (raw === undefined) continue;
    const next = normalize(raw);
    const current = (part[key] ?? null) as string | null;
    if (next === current) continue;
    patch[key] = next as never;
    changes.push(describe(label, current, next));
  }

  const currentAttributes = (part.attributes ?? {}) as PartAttributes;
  let attributesChanged = false;
  const nextAttributes: PartAttributes = { ...currentAttributes };
  for (const { key, label } of EDITABLE_ATTRIBUTE_FIELDS) {
    const raw = input.attributes[key];
    if (raw === undefined) continue;
    const next = normalize(raw);
    const currentValue = currentAttributes[key];
    const current = currentValue === undefined || currentValue === null ? null : String(currentValue);
    if (next === current) continue;
    // Clearing removes the key rather than storing null, so the attribute stops
    // contributing a facet value instead of contributing an empty one.
    if (next === null) delete nextAttributes[key];
    else nextAttributes[key] = next;
    attributesChanged = true;
    changes.push(describe(label, current, next));
  }
  if (attributesChanged) patch.attributes = nextAttributes;

  const reorderText = input.reorderPoint.trim();
  let nextReorder: number | null = null;
  if (reorderText !== "") {
    const parsed = Number(reorderText);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { ok: false, error: "Reorder point must be a whole number, 0 or more." };
    }
    nextReorder = parsed;
  }
  if (nextReorder !== (part.reorder_point ?? null)) {
    patch.reorder_point = nextReorder;
    changes.push(describe("Reorder point", part.reorder_point, nextReorder));
  }

  if (!PART_STATUSES.includes(input.status)) {
    return { ok: false, error: "Unknown part status." };
  }
  if (input.status !== part.part_status) {
    patch.part_status = input.status;
    changes.push(describe("Status", part.part_status, input.status));
  }

  return { ok: true, result: { patch, changes } };
}
