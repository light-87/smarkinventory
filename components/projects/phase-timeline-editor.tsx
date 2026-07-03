"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableBody, TableHead, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { Chip } from "@/components/ui/chip";
import { useToast } from "@/components/ui/toast";
import type { PhaseRowKind, ProjectPhaseRow } from "@/types/db";
import {
  addPhaseAction,
  advancePhaseAction,
  removePhaseAction,
  reorderPhasesAction,
  updatePhaseAction,
} from "@/lib/projects/phase-actions";
import { reorderRows } from "@/lib/projects/phase-math";

const ROW_KIND_OPTIONS: { value: PhaseRowKind; label: string }[] = [
  { value: "phase", label: "Phase" },
  { value: "parallel", label: "Parallel" },
  { value: "buffer", label: "Buffer" },
  { value: "footnote", label: "Footnote" },
];

const STATUS_LABEL: Record<ProjectPhaseRow["status"], string> = {
  pending: "Pending",
  active: "Active",
  done: "Done",
};

function dateInputValue(value: string | null): string {
  return value ?? "";
}

interface DraftPhase {
  name: string;
  row_kind: PhaseRowKind;
  start_date: string;
  end_date: string;
  duration_text: string;
  notes: string;
}

const EMPTY_DRAFT: DraftPhase = {
  name: "",
  row_kind: "phase",
  start_date: "",
  end_date: "",
  duration_text: "",
  notes: "",
};

export interface PhaseTimelineEditorProps {
  projectId: string;
  phases: readonly ProjectPhaseRow[];
  writable: boolean;
  /** Only the owner advances the timeline (FEATURES §10/R2-30 — finding #4); row edits stay `writable`. */
  canAdvance: boolean;
}

/**
 * Phase-timeline editor (R2-30): rows of name/dates/duration-text/notes with
 * `phase | parallel | buffer | footnote` kinds; add/remove/reorder; exactly
 * one active row at a time (owner advances). Inline "spreadsheet"
 * editing — each field commits its ROW on blur/change (no separate save
 * step), which keeps the mobile UX to one tap per edit.
 */
export function PhaseTimelineEditor({ projectId, phases, writable, canAdvance }: PhaseTimelineEditorProps) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<ProjectPhaseRow[]>(() => [...phases]);
  const [draft, setDraft] = useState<DraftPhase>(EMPTY_DRAFT);
  const [showAddForm, setShowAddForm] = useState(false);

  // Server re-renders (revalidatePath after every action) hand back a new
  // `phases` array — resync the local editable copy so in-flight edits never
  // fight stale state. Adjusting state during render (React's documented
  // "storing information from previous renders" pattern) rather than in a
  // useEffect, so this doesn't cause an extra commit-then-effect round trip.
  const [prevPhases, setPrevPhases] = useState(phases);
  if (phases !== prevPhases) {
    setPrevPhases(phases);
    setRows([...phases]);
  }

  const activePhase = rows.find((r) => r.status === "active") ?? null;
  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order);

  function patchLocal(id: string, patch: Partial<ProjectPhaseRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function commitRow(row: ProjectPhaseRow) {
    startTransition(async () => {
      try {
        await updatePhaseAction(projectId, {
          id: row.id,
          name: row.name,
          start_date: row.start_date,
          end_date: row.end_date,
          duration_text: row.duration_text,
          notes: row.notes,
          row_kind: row.row_kind,
        });
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't save that change." });
        router.refresh();
      }
    });
  }

  function handleAdd() {
    if (!draft.name.trim()) {
      push({ msg: "Phase name is required" });
      return;
    }
    startTransition(async () => {
      try {
        await addPhaseAction(projectId, {
          name: draft.name.trim(),
          row_kind: draft.row_kind,
          start_date: draft.start_date || null,
          end_date: draft.end_date || null,
          duration_text: draft.duration_text.trim() || null,
          notes: draft.notes.trim() || null,
        });
        setDraft(EMPTY_DRAFT);
        setShowAddForm(false);
        router.refresh();
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't add that phase." });
      }
    });
  }

  function handleRemove(row: ProjectPhaseRow) {
    if (!window.confirm(`Remove "${row.name}" from the timeline?`)) return;
    startTransition(async () => {
      try {
        await removePhaseAction(projectId, row.id);
        router.refresh();
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't remove that phase." });
      }
    });
  }

  function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const reordered = reorderRows(sorted, index, target);
    startTransition(async () => {
      try {
        await reorderPhasesAction({ projectId, orderedIds: reordered.map((r) => r.id) });
        router.refresh();
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't reorder the timeline." });
      }
    });
  }

  function handleAdvance() {
    startTransition(async () => {
      try {
        await advancePhaseAction(projectId, activePhase?.id ?? null);
        router.refresh();
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't advance the timeline." });
      }
    });
  }

  return (
    <Card padding="none">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-divider px-5 py-4">
        <SectionLabel>Phase timeline</SectionLabel>
        {canAdvance && (
          <Button size="sm" variant="outline" onClick={handleAdvance} loading={isPending}>
            {activePhase ? `Mark "${activePhase.name}" done & advance →` : "Start timeline →"}
          </Button>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="px-5 py-8 text-center text-caption text-smoke">
          No phases yet — add the first one below.
        </div>
      ) : (
        <TableShell minWidth={880}>
          <TableHead>
            <Tr>
              <Th style={{ width: 26 }} />
              <Th>Name</Th>
              <Th>Kind</Th>
              <Th>Start</Th>
              <Th>End</Th>
              <Th>Duration</Th>
              <Th>Notes</Th>
              <Th align="center">Status</Th>
              <Th align="right">v</Th>
              {writable && <Th style={{ width: 70 }} />}
            </Tr>
          </TableHead>
          <TableBody>
            {sorted.map((row, index) => (
              <Tr key={row.id}>
                <Td>
                  {writable && (
                    <div className="flex flex-col">
                      <button
                        type="button"
                        aria-label="Move up"
                        disabled={index === 0}
                        onClick={() => handleMove(index, -1)}
                        className="cursor-pointer text-smoke hover:text-snow disabled:pointer-events-none disabled:opacity-30"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        disabled={index === sorted.length - 1}
                        onClick={() => handleMove(index, 1)}
                        className="cursor-pointer text-smoke hover:text-snow disabled:pointer-events-none disabled:opacity-30"
                      >
                        ▼
                      </button>
                    </div>
                  )}
                </Td>
                <Td>
                  {writable ? (
                    <Input
                      uiSize="sm"
                      value={row.name}
                      onChange={(e) => patchLocal(row.id, { name: e.target.value })}
                      onBlur={() => commitRow(rows.find((r) => r.id === row.id)!)}
                      className="min-w-[160px]"
                    />
                  ) : (
                    row.name
                  )}
                </Td>
                <Td>
                  {writable ? (
                    <select
                      value={row.row_kind}
                      onChange={(e) => {
                        const next = { ...row, row_kind: e.target.value as PhaseRowKind };
                        patchLocal(row.id, { row_kind: next.row_kind });
                        commitRow(next);
                      }}
                      className="h-[30px] rounded-lg border border-charcoal bg-surface-well px-2 text-[13px] text-snow outline-none focus:border-smark-orange"
                    >
                      {ROW_KIND_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    ROW_KIND_OPTIONS.find((o) => o.value === row.row_kind)?.label
                  )}
                </Td>
                <Td>
                  {writable ? (
                    <Input
                      uiSize="sm"
                      type="date"
                      value={dateInputValue(row.start_date)}
                      onChange={(e) => patchLocal(row.id, { start_date: e.target.value || null })}
                      onBlur={() => commitRow(rows.find((r) => r.id === row.id)!)}
                    />
                  ) : (
                    row.start_date || "—"
                  )}
                </Td>
                <Td>
                  {writable ? (
                    <Input
                      uiSize="sm"
                      type="date"
                      value={dateInputValue(row.end_date)}
                      onChange={(e) => patchLocal(row.id, { end_date: e.target.value || null })}
                      onBlur={() => commitRow(rows.find((r) => r.id === row.id)!)}
                    />
                  ) : (
                    row.end_date || "—"
                  )}
                </Td>
                <Td>
                  {writable ? (
                    <Input
                      uiSize="sm"
                      value={row.duration_text ?? ""}
                      placeholder="9-10 days"
                      onChange={(e) => patchLocal(row.id, { duration_text: e.target.value })}
                      onBlur={() => commitRow(rows.find((r) => r.id === row.id)!)}
                      className="min-w-[130px]"
                    />
                  ) : (
                    row.duration_text || "—"
                  )}
                </Td>
                <Td>
                  {writable ? (
                    <Input
                      uiSize="sm"
                      value={row.notes ?? ""}
                      onChange={(e) => patchLocal(row.id, { notes: e.target.value })}
                      onBlur={() => commitRow(rows.find((r) => r.id === row.id)!)}
                      className="min-w-[140px]"
                    />
                  ) : (
                    row.notes || "—"
                  )}
                </Td>
                <Td align="center">
                  <Chip tone={row.status === "active" ? "accent" : row.status === "done" ? "success" : "default"}>
                    {STATUS_LABEL[row.status]}
                  </Chip>
                </Td>
                <Td align="right" mono>
                  v{row.version_label}
                </Td>
                {writable && (
                  <Td align="right">
                    <button
                      type="button"
                      aria-label="Remove phase"
                      onClick={() => handleRemove(row)}
                      className="cursor-pointer px-1.5 text-smoke hover:text-smark-orange"
                    >
                      ×
                    </button>
                  </Td>
                )}
              </Tr>
            ))}
          </TableBody>
        </TableShell>
      )}

      {writable && (
        <div className="border-t border-border-divider px-5 py-4">
          {showAddForm ? (
            <div className="flex flex-col gap-2.5">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Input
                  uiSize="sm"
                  placeholder="Phase name"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
                <select
                  value={draft.row_kind}
                  onChange={(e) => setDraft((d) => ({ ...d, row_kind: e.target.value as PhaseRowKind }))}
                  className="h-[34px] rounded-lg border border-charcoal bg-surface-well px-2 text-[13px] text-snow outline-none focus:border-smark-orange"
                >
                  {ROW_KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Input
                  uiSize="sm"
                  type="date"
                  value={draft.start_date}
                  onChange={(e) => setDraft((d) => ({ ...d, start_date: e.target.value }))}
                />
                <Input
                  uiSize="sm"
                  type="date"
                  value={draft.end_date}
                  onChange={(e) => setDraft((d) => ({ ...d, end_date: e.target.value }))}
                />
              </div>
              <Input
                uiSize="sm"
                placeholder='Duration text — "9-10 days", "Running parallel with design"'
                value={draft.duration_text}
                onChange={(e) => setDraft((d) => ({ ...d, duration_text: e.target.value }))}
              />
              <Input
                uiSize="sm"
                placeholder="Notes / tasks"
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAdd} loading={isPending}>
                  Add phase
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowAddForm(true)}>
              + Add phase
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
