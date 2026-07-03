"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { saveDistributorSequenceAction } from "@/app/(app)/projects/[projectId]/ordering/[bomId]/actions";
import type { EffectiveDistributorRow } from "@/lib/runs/distributor-sequence";

export interface DistributorSequenceCardProps {
  bomId: string;
  initialSequence: EffectiveDistributorRow[];
  writable: boolean;
}

/** Drag-reorder + on/off toggle rows (plan/tab-ordering-workspace.md §2.1) — auto-saves on every change. */
export function DistributorSequenceCard({ bomId, initialSequence, writable }: DistributorSequenceCardProps) {
  const [rows, setRows] = useState(initialSequence);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function persist(next: EffectiveDistributorRow[]) {
    setError(null);
    startTransition(async () => {
      const result = await saveDistributorSequenceAction({
        bomId,
        sequence: next.map((r) => ({ distributorId: r.id, enabled: r.enabled })),
      });
      if (!result.ok) setError(result.error);
    });
  }

  function reorder(from: number, to: number) {
    setRows((current) => {
      const next = current.slice();
      const [moved] = next.splice(from, 1);
      if (!moved) return current;
      next.splice(to, 0, moved);
      const renumbered = next.map((r, i) => ({ ...r, rank: i + 1 }));
      persist(renumbered);
      return renumbered;
    });
  }

  function toggle(id: string) {
    setRows((current) => {
      const next = current.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
      persist(next);
      return next;
    });
  }

  return (
    <Card padding="lg">
      <div className="mb-1 text-[15px] font-medium text-snow">Distributor sequence</div>
      <div className="mb-4 text-caption text-smoke">Drag to reorder — agents try sites top to bottom · single per BOM</div>
      <div className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <div
            key={row.id}
            // HTML5 drag-and-drop is a DESKTOP-ONLY enhancement — it never
            // fires from touch gestures on mobile browsers (no fallback
            // exists in the spec), so the ↑/↓ buttons below are the primary,
            // touch-capable way to reorder (this is a mobile-first PWA).
            draggable={writable}
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => {
              if (dragIndex === null) return;
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex === null || dragIndex === index) return;
              reorder(dragIndex, index);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
            className="flex min-h-11 items-center gap-3 rounded-full border border-charcoal bg-surface px-3.5 py-2"
            style={{ opacity: row.enabled ? 1 : 0.55 }}
          >
            <span className="w-4 flex-none font-mono text-xs text-graphite">{row.rank}</span>
            {writable && (
              <span aria-hidden className="hidden flex-none cursor-grab flex-col gap-0.5 text-smoke sm:flex">
                <span className="block h-[1.5px] w-3 rounded bg-current" />
                <span className="block h-[1.5px] w-3 rounded bg-current" />
                <span className="block h-[1.5px] w-3 rounded bg-current" />
              </span>
            )}
            <span className="flex-1 font-mono text-sm text-snow">{row.name}</span>
            {writable && (
              <div className="flex flex-none items-center">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => reorder(index, index - 1)}
                  aria-label={`Move ${row.name} up`}
                  className="flex size-11 flex-none cursor-pointer items-center justify-center text-smoke hover:text-snow disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <span aria-hidden className="text-base leading-none">
                    ↑
                  </span>
                </button>
                <button
                  type="button"
                  disabled={index === rows.length - 1}
                  onClick={() => reorder(index, index + 1)}
                  aria-label={`Move ${row.name} down`}
                  className="flex size-11 flex-none cursor-pointer items-center justify-center text-smoke hover:text-snow disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <span aria-hidden className="text-base leading-none">
                    ↓
                  </span>
                </button>
              </div>
            )}
            <span className="flex size-11 flex-none items-center justify-center">
              <button
                type="button"
                disabled={!writable}
                onClick={() => toggle(row.id)}
                aria-pressed={row.enabled}
                aria-label={`${row.enabled ? "Disable" : "Enable"} ${row.name}`}
                className={`relative h-[22px] w-10 flex-none cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed ${
                  row.enabled ? "bg-smark-orange" : "bg-slate"
                }`}
              >
                <span
                  className="absolute top-0.5 size-[18px] rounded-full bg-snow transition-[left]"
                  style={{ left: row.enabled ? 20 : 2 }}
                />
              </button>
            </span>
          </div>
        ))}
      </div>
      {isPending && <div className="mt-2 text-caption text-smoke">Saving…</div>}
      {error && <div className="mt-2 text-caption text-smark-orange-soft">{error}</div>}
    </Card>
  );
}
