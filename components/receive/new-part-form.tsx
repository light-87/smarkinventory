"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { PartFieldTemplateRow } from "@/types/db";
import { addCustomFieldTemplateAction, createNewPartAction } from "@/lib/receive/actions";
import type { BoxOption } from "@/lib/receive/storage-suggestion";
import { suggestStorageBox } from "@/lib/receive/storage-suggestion";
import { PART_CATEGORY_OPTIONS, categoryHasVoltage, type NewPartFormInput } from "@/lib/receive/types";
import type { DuplicateHit } from "@/lib/receive/core";
import { CategoryChips } from "./category-chips";

export interface NewPartFormProps {
  boxes: readonly BoxOption[];
  initialCustomFieldTemplates: readonly PartFieldTemplateRow[];
  /** Scan's "Receive into this box" edge (plan/tab-receive.md §4) — presets the suggestion. */
  presetBoxId?: string | null;
  onSwitchToTopUp: (internalPid: string) => void;
}

interface DraftState {
  category: string;
  value: string;
  voltage: string;
  package: string;
  qty: string;
  mpn: string;
  manufacturer: string;
}

const DRAFT_DEFAULTS: DraftState = {
  category: "",
  value: "",
  voltage: "",
  package: "",
  qty: "",
  mpn: "",
  manufacturer: "",
};

/**
 * Plain controlled state rather than react-hook-form here: the numeric `qty`
 * field needs `z.coerce.number()` server-side (a text input's value is
 * always a string), and RHF's resolver typing doesn't reconcile cleanly with
 * an explicit output-shaped generic for a coerced field. The server action
 * is the real validation boundary (zod, lib/receive/actions.ts) — this is
 * just a light client-side required-field check before spending a round trip.
 */
export function NewPartForm({ boxes, initialCustomFieldTemplates, presetBoxId, onSwitchToTopUp }: NewPartFormProps) {
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [templates, setTemplates] = useState(initialCustomFieldTemplates);
  const [addingField, setAddingField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<"text" | "number">("text");
  const [duplicate, setDuplicate] = useState<DuplicateHit | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<DraftState>(DRAFT_DEFAULTS);

  function set<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const showVoltage = categoryHasVoltage(draft.category);

  const presetBox = presetBoxId ? boxes.find((b) => b.id === presetBoxId) : undefined;
  const suggestion = useMemo(() => {
    if (presetBox && !draft.category) {
      return {
        kind: "existing" as const,
        boxId: presetBox.id,
        boxName: presetBox.name,
        shelfCode: presetBox.shelfCode,
        label: `→ ${presetBox.name} · Shelf ${presetBox.shelfCode} (from Scan)`,
      };
    }
    return suggestStorageBox(draft.category, draft.package, boxes);
  }, [draft.category, draft.package, boxes, presetBox]);

  function buildInput(): NewPartFormInput | null {
    const qty = Number.parseInt(draft.qty, 10);
    if (!draft.category) {
      push({ msg: "Pick a category" });
      return null;
    }
    if (!draft.value.trim()) {
      push({ msg: "Value is required" });
      return null;
    }
    if (!draft.package.trim()) {
      push({ msg: "Package is required" });
      return null;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      push({ msg: "Quantity must be a positive whole number" });
      return null;
    }
    return {
      category: draft.category,
      value: draft.value.trim(),
      voltage: draft.voltage.trim() || null,
      package: draft.package.trim(),
      qty,
      mpn: draft.mpn.trim() || null,
      manufacturer: draft.manufacturer.trim() || null,
      customFields: customFieldValues,
    };
  }

  function submit(force = false) {
    const input = buildInput();
    if (!input) return;
    startTransition(async () => {
      const result = await createNewPartAction(input, force);
      if (result.ok) {
        setDuplicate(null);
        push({ msg: `Saved ${result.internalPid} — ${result.labelQueued ? "label queued" : "already labeled"}` });
        setDraft(DRAFT_DEFAULTS);
        setCustomFieldValues({});
      } else {
        setDuplicate(result.duplicate);
      }
    });
  }

  async function handleAddCustomField() {
    if (!newFieldLabel.trim()) return;
    const result = await addCustomFieldTemplateAction({ label: newFieldLabel, fieldType: newFieldType });
    if (result.ok) {
      setTemplates((prev) => [
        ...prev,
        {
          id: `local-${result.fieldKey}`,
          label: result.label,
          field_key: result.fieldKey,
          field_type: newFieldType,
          active: true,
          created_by: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        },
      ]);
      setNewFieldLabel("");
      setAddingField(false);
    } else {
      push({ msg: result.error });
    }
  }

  return (
    <Card padding="lg">
      <div className="mb-4 text-[13px] text-smoke">
        Brand-new part — enter the essentials, we suggest a box and print one ESD label.
      </div>

      {duplicate && (
        <div className="mb-5 rounded-xl border border-smark-orange bg-surface-accent p-4">
          <div className="text-[13px] text-snow">
            Looks like <span className="font-mono text-smark-orange">{duplicate.internalPid}</span> —{" "}
            {duplicate.summary}. Top up instead?
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button size="sm" onClick={() => onSwitchToTopUp(duplicate.internalPid)}>
              Top up instead
            </Button>
            <Button size="sm" variant="outline" onClick={() => submit(true)} disabled={isPending}>
              Create anyway
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDuplicate(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
        className="flex flex-col gap-5"
      >
        <div>
          <SectionLabel className="mb-2">
            Category <span className="text-smark-orange">*</span>
          </SectionLabel>
          <CategoryChips options={PART_CATEGORY_OPTIONS} value={draft.category || null} onChange={(v) => set("category", v)} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={<>Value <span className="text-smark-orange">*</span></>}>
            <Input value={draft.value} onChange={(e) => set("value", e.target.value)} placeholder="0.1µF" />
          </Field>
          {showVoltage && (
            <Field label="Voltage" hint="e.g. 50V — split from Value [R2-24]">
              <Input value={draft.voltage} onChange={(e) => set("voltage", e.target.value)} placeholder="50V" mono />
            </Field>
          )}
          <Field label={<>Package <span className="text-smark-orange">*</span></>}>
            <Input value={draft.package} onChange={(e) => set("package", e.target.value)} placeholder="0603" mono />
          </Field>
          <Field label={<>Quantity <span className="text-smark-orange">*</span></>}>
            <Input
              value={draft.qty}
              onChange={(e) => set("qty", e.target.value)}
              type="number"
              inputMode="numeric"
              placeholder="500"
              mono
            />
          </Field>
          <Field label={<>MPN <span className="text-faint">optional</span></>}>
            <Input value={draft.mpn} onChange={(e) => set("mpn", e.target.value)} placeholder="CL10B104MB8NNNC" mono />
          </Field>
          <Field label={<>Manufacturer <span className="text-faint">optional</span></>}>
            <Input value={draft.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} placeholder="Samsung" />
          </Field>
        </div>

        {templates.length > 0 && (
          <div>
            <SectionLabel className="mb-2">Custom fields</SectionLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((template) => (
                <Field key={template.field_key} label={template.label}>
                  <Input
                    type={template.field_type === "number" ? "number" : "text"}
                    mono={template.field_type === "number"}
                    value={customFieldValues[template.field_key] ?? ""}
                    onChange={(e) =>
                      setCustomFieldValues((prev) => ({ ...prev, [template.field_key]: e.target.value }))
                    }
                  />
                </Field>
              ))}
            </div>
          </div>
        )}

        {addingField ? (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-charcoal p-3">
            <Field label="Field name" className="min-w-[160px] flex-1">
              <Input value={newFieldLabel} onChange={(e) => setNewFieldLabel(e.target.value)} placeholder="Tolerance" />
            </Field>
            <Field label="Type" className="w-32">
              <select
                value={newFieldType}
                onChange={(e) => setNewFieldType(e.target.value as "text" | "number")}
                className="h-10 w-full rounded-lg border border-charcoal bg-surface-well px-3 text-sm text-snow outline-none focus:border-smark-orange"
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
              </select>
            </Field>
            <Button type="button" size="md" variant="outline" onClick={handleAddCustomField}>
              Save field
            </Button>
            <Button type="button" size="md" variant="ghost" onClick={() => setAddingField(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingField(true)}
            className="w-fit cursor-pointer text-[13px] text-smoke transition-colors hover:text-snow"
          >
            + Add custom field
          </button>
        )}

        <div className="flex flex-wrap items-center gap-3.5 border-t border-border-divider pt-4">
          <span className="text-[13px] text-smoke">AI-suggested storage</span>
          <span className="rounded-full border border-charcoal px-3 py-1.5 font-mono text-[13px] text-snow">
            {suggestion.label}
          </span>
        </div>

        <div>
          <Button type="submit" size="lg" loading={isPending}>
            Save &amp; print ESD label
          </Button>
        </div>
      </form>
    </Card>
  );
}
