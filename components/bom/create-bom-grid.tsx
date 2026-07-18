"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import type { BomTemplateColumn, FieldType } from "@/types/db";
import { createBomInAppAction, previewCustomColumnAction } from "@/app/(app)/projects/[projectId]/boms/actions";
import type { CreateBomRowInput } from "@/lib/bom/types";
import { validateBomRows } from "@/lib/bom/validate";

export interface CreateBomGridProps {
  projectId: string;
  initialColumns: BomTemplateColumn[];
}

/** Blank cells for a fresh row, keyed by every current column. */
function blankRow(columns: readonly BomTemplateColumn[]): CreateBomRowInput {
  const row: CreateBomRowInput = {};
  for (const column of columns) row[column.key] = column.key === "dnp" ? false : "";
  return row;
}

/** How a cell renders regardless of the column's STORED type (text/number) — `dnp`/`qty`/`line_no` get dedicated widgets. */
function cellKind(column: BomTemplateColumn): "checkbox" | "number" | "text" {
  if (column.key === "dnp") return "checkbox";
  if (column.key === "qty" || column.type === "number") return "number";
  return "text";
}

/**
 * "Create BOM" in-app grid editor (R2-19): starts from the standard columns,
 * "+ Add field" appends a custom text/number column, required-field
 * validation mirrors the template rules, and on save the column structure
 * becomes the remembered company template.
 */
export function CreateBomGrid({ projectId, initialColumns }: CreateBomGridProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [columns, setColumns] = useState<BomTemplateColumn[]>(initialColumns);
  const [rows, setRows] = useState<CreateBomRowInput[]>(() => [blankRow(initialColumns), blankRow(initialColumns)]);
  const [name, setName] = useState("");
  const [buildQty, setBuildQty] = useState("1");
  const [priorityNotes, setPriorityNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [addingField, setAddingField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<FieldType>("text");

  const editableColumns = useMemo(() => columns.filter((c) => c.key !== "line_no"), [columns]);

  function setCell(rowIndex: number, key: string, value: string | number | boolean | null) {
    setRows((prev) => prev.map((row, i) => (i === rowIndex ? { ...row, [key]: value } : row)));
  }

  function addRow() {
    setRows((prev) => [...prev, blankRow(columns)]);
  }

  function removeRow(index: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function addField() {
    if (!newFieldLabel.trim()) return;
    const result = await previewCustomColumnAction({ label: newFieldLabel, type: newFieldType });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setColumns((prev) => [...prev, result.column]);
    setRows((prev) => prev.map((row) => ({ ...row, [result.column.key]: "" })));
    setNewFieldLabel("");
    setAddingField(false);
  }

  function submit() {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name this BOM.");
      return;
    }
    const qty = Number.parseInt(buildQty, 10);
    if (!Number.isFinite(qty) || qty < 1) {
      setError("Build qty must be at least 1.");
      return;
    }
    const rowErrors = validateBomRows(columns, rows);
    if (rowErrors.length > 0) {
      setError(rowErrors[0]!);
      return;
    }

    startTransition(async () => {
      const result = await createBomInAppAction({
        projectId,
        name: trimmedName,
        buildQty: qty,
        priorityNotes: priorityNotes.trim() || null,
        columns,
        rows,
      });
      if (result.ok) {
        router.push(`/projects/${projectId}/boms/${result.bomId}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={<>Name <span className="text-smark-orange">*</span></>}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mainboard v1.2" />
        </Field>
        <Field label="Build qty ×N">
          <Input value={buildQty} onChange={(e) => setBuildQty(e.target.value)} type="number" inputMode="numeric" mono />
        </Field>
        <Field label="Overall priorities" hint="Optional">
          <Input value={priorityNotes} onChange={(e) => setPriorityNotes(e.target.value)} placeholder="Prefer LCSC…" />
        </Field>
      </div>

      <div className="overflow-x-auto rounded-xl border border-charcoal">
        <table className="w-full border-collapse" style={{ minWidth: editableColumns.length * 140 }}>
          <thead>
            <tr>
              <th className="sticky top-0 z-[2] w-10 border-b border-charcoal bg-canvas px-2 py-2 text-[13px] text-smoke">
                #
              </th>
              {editableColumns.map((column) => (
                <th
                  key={column.key}
                  className="sticky top-0 z-[2] border-b border-charcoal bg-canvas px-2 py-2 text-left text-[13px] font-medium tracking-[0.04em] whitespace-nowrap text-smoke uppercase"
                >
                  {column.label}
                  {column.required && <span className="text-smark-orange"> *</span>}
                </th>
              ))}
              <th className="sticky top-0 z-[2] w-10 border-b border-charcoal bg-canvas" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td className="border-b border-border-hairline px-2 py-1.5 text-center font-mono text-[14px] text-smoke">
                  {rowIndex + 1}
                </td>
                {editableColumns.map((column) => {
                  const kind = cellKind(column);
                  const value = row[column.key];
                  if (kind === "checkbox") {
                    return (
                      <td key={column.key} className="border-b border-border-hairline px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={value === true}
                          onChange={(e) => setCell(rowIndex, column.key, e.target.checked)}
                          className="size-4 accent-smark-orange"
                        />
                      </td>
                    );
                  }
                  return (
                    <td key={column.key} className="border-b border-border-hairline px-1.5 py-1">
                      <input
                        type={kind === "number" ? "number" : "text"}
                        value={value === null || value === undefined ? "" : String(value)}
                        onChange={(e) => setCell(rowIndex, column.key, e.target.value)}
                        className="h-8 w-full min-w-[100px] rounded-md border border-transparent bg-transparent px-2 text-[15px] text-snow outline-none focus:border-smark-orange focus:bg-surface-well"
                      />
                    </td>
                  );
                })}
                <td className="border-b border-border-hairline px-2 py-1.5 text-center">
                  <button
                    type="button"
                    aria-label={`Remove row ${rowIndex + 1}`}
                    onClick={() => removeRow(rowIndex)}
                    className="cursor-pointer text-smoke hover:text-smark-orange"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          + Add row
        </Button>

        {addingField ? (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-charcoal p-2.5">
            <Input
              uiSize="sm"
              value={newFieldLabel}
              onChange={(e) => setNewFieldLabel(e.target.value)}
              placeholder="Field name"
              className="w-36"
            />
            <select
              value={newFieldType}
              onChange={(e) => setNewFieldType(e.target.value as FieldType)}
              className="h-[34px] rounded-lg border border-charcoal bg-surface-well px-2.5 text-[15px] text-snow outline-none focus:border-smark-orange"
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
            </select>
            <Button type="button" size="sm" variant="outline" onClick={addField}>
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAddingField(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingField(true)}
            className="cursor-pointer text-[15px] text-smoke transition-colors hover:text-snow"
          >
            + Add field
          </button>
        )}
      </div>

      {error && <div className="text-caption text-smark-orange-soft">{error}</div>}

      <div>
        <Button size="lg" onClick={submit} loading={isPending}>
          Save &amp; reconcile
        </Button>
      </div>
      <SectionLabel>
        Saving remembers this column structure as the company template — the next Create-BOM and the downloadable
        template both start from it.
      </SectionLabel>
    </Card>
  );
}
