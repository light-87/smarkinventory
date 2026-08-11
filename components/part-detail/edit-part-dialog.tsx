"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DrawerCloseButton } from "@/components/ui/drawer";
import { Field, Input } from "@/components/ui/input";
import { updatePartDetails, type UpdatePartResult } from "@/lib/part-events/actions";
import {
  EDITABLE_ATTRIBUTE_FIELDS,
  EDITABLE_TEXT_FIELDS,
  PART_STATUSES,
  type EditableAttributeField,
  type EditableTextField,
} from "@/lib/part-events/edit";
import { PART_CATEGORIES, type PartAttributes, type PartRow, type PartStatus } from "@/types/db";

export interface EditPartDialogProps {
  open: boolean;
  onClose: () => void;
  part: PartRow;
  onSaved: (result: Extract<UpdatePartResult, { ok: true }>) => void;
}

const STATUS_LABEL: Record<PartStatus, string> = { active: "Active", nrnd: "NRND", eol: "EOL" };

/** Fields wide enough to want the full row: free text people actually write sentences into. */
const FULL_WIDTH: ReadonlySet<EditableTextField> = new Set<EditableTextField>(["description"]);

function textOf(part: PartRow, key: EditableTextField): string {
  return (part[key] as string | null) ?? "";
}

function attributeOf(part: PartRow, key: EditableAttributeField): string {
  const value = (part.attributes as PartAttributes | null)?.[key];
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Correct a part's details in place (client request, 2026-08-11: "How can I
 * edit the uploaded part - like description or any other value").
 *
 * Every box starts at the part's current value and an empty box clears the
 * field, so this is equally a way to delete something the import got wrong.
 * Saving appends a note to the living record naming each field that moved.
 */
export function EditPartDialog({ open, onClose, part, onSaved }: EditPartDialogProps) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [reorderPoint, setReorderPoint] = useState("");
  const [status, setStatus] = useState<PartStatus>(part.part_status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reload from the part whenever the dialog opens, following the same
  // adjust-state-during-render pattern as AdjustQtyDialog rather than an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFields(Object.fromEntries(EDITABLE_TEXT_FIELDS.map((f) => [f.key, textOf(part, f.key)])));
      setAttributes(Object.fromEntries(EDITABLE_ATTRIBUTE_FIELDS.map((f) => [f.key, attributeOf(part, f.key)])));
      setReorderPoint(part.reorder_point === null ? "" : String(part.reorder_point));
      setStatus(part.part_status);
      setError(null);
    }
  }

  if (!open) return null;

  function submit() {
    startTransition(async () => {
      const result = await updatePartDetails({
        partId: part.id,
        fields: fields as Partial<Record<EditableTextField, string>>,
        attributes: attributes as Partial<Record<EditableAttributeField, string>>,
        reorderPoint,
        status,
      });
      if (result.ok) onSaved(result);
      else setError(result.error);
    });
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-[#1d2130]/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit part"
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-charcoal bg-surface"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border-hairline px-5 py-4">
          <span className="text-[17px] font-medium text-snow">
            Edit · <span className="font-mono">{part.internal_pid}</span>
          </span>
          <DrawerCloseButton onClick={onClose} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-4 text-caption text-smoke">
            Leave a box empty to clear that value. Changes are recorded in this part&apos;s history.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {EDITABLE_TEXT_FIELDS.map(({ key, label }) => (
              <Field key={key} label={label} className={FULL_WIDTH.has(key) ? "sm:col-span-2" : undefined}>
                <Input
                  value={fields[key] ?? ""}
                  onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.value }))}
                  list={key === "category" ? "part-category-options" : undefined}
                  mono={key === "mpn" || key === "lcsc_pn" || key === "package"}
                />
              </Field>
            ))}

            {EDITABLE_ATTRIBUTE_FIELDS.map(({ key, label }) => (
              <Field key={key} label={label}>
                <Input
                  value={attributes[key] ?? ""}
                  onChange={(e) => setAttributes((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              </Field>
            ))}

            <Field label="Reorder point" hint="Blank uses the global low-stock default.">
              <Input
                mono
                type="number"
                min={0}
                step={1}
                value={reorderPoint}
                onChange={(e) => setReorderPoint(e.target.value)}
              />
            </Field>

            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as PartStatus)}
                className="h-10 w-full rounded-lg border border-charcoal bg-surface-well px-3.5 text-sm text-snow outline-none focus:border-smark-orange"
              >
                {PART_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Suggestions, not a constraint — `category` is open text by design
              (types/db.ts), and the import already writes values beyond this list. */}
          <datalist id="part-category-options">
            {[...new Set([...PART_CATEGORIES, part.category ?? ""])].filter(Boolean).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          {error && <p className="mt-3 text-caption text-smark-orange-soft">{error}</p>}
        </div>

        <div className="flex gap-3 border-t border-border-hairline px-5 py-4">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" loading={pending} onClick={submit}>
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
