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

/**
 * Distributor sequence as a mobile-first checklist (plan #9).
 *
 * Check a site to include it — enabled sites auto-float to the top in run order
 * and get ↑/↓ arrows to reorder; unchecked sites sink to the bottom, dimmed.
 * No drag-and-drop (it never fires on touch, and this is a PWA). Auto-saves on
 * every change. The stored shape is unchanged: `sequence` is emitted in display
 * order ([…enabled, …disabled]), which enqueue filters + ranks positionally.
 */
export function DistributorSequenceCard({ bomId, initialSequence, writable }: DistributorSequenceCardProps) {
  const [rows, setRows] = useState(() => sortEnabledFirst(initialSequence));
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

  function commit(next: EffectiveDistributorRow[]) {
    const renumbered = next.map((r, i) => ({ ...r, rank: i + 1 }));
    setRows(renumbered);
    persist(renumbered);
  }

  function reorder(from: number, to: number) {
    if (to < 0 || to >= rows.length) return;
    const next = rows.slice();
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    commit(next);
  }

  function toggle(id: string) {
    // Flip enabled, then stable-partition so enabled rows float to the top in
    // their existing relative order and disabled rows sink to the bottom.
    const flipped = rows.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
    commit(sortEnabledFirst(flipped));
  }

  const enabledCount = rows.filter((r) => r.enabled).length;

  return (
    <Card padding="lg">
      <div className="mb-1 text-[16px] font-medium text-snow">Distributor sequence</div>
      <div className="mb-4 text-caption text-smoke">
        Check the sites to use — agents try them top to bottom · single per BOM
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const isFirstEnabled = index === 0;
          const isLastEnabled = index === enabledCount - 1;
          return (
            <div
              key={row.id}
              className="flex min-h-11 items-center gap-3 rounded-full border border-charcoal bg-surface px-3.5 py-2"
              style={{ opacity: row.enabled ? 1 : 0.55 }}
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={row.enabled}
                disabled={!writable}
                onClick={() => toggle(row.id)}
                aria-label={`${row.enabled ? "Remove" : "Add"} ${row.name}`}
                className="flex size-11 flex-none cursor-pointer items-center justify-center disabled:cursor-not-allowed"
              >
                <span
                  className={`flex size-5 flex-none items-center justify-center rounded-[6px] border-2 transition-colors ${
                    row.enabled ? "border-smark-orange bg-smark-orange text-snow" : "border-charcoal bg-transparent text-transparent"
                  }`}
                >
                  <span aria-hidden className="text-xs font-bold leading-none">
                    ✓
                  </span>
                </span>
              </button>

              <span className="w-4 flex-none text-center font-mono text-xs text-graphite">
                {row.enabled ? row.rank : ""}
              </span>

              <span className="flex-1 font-mono text-sm text-snow">{row.name}</span>

              {writable && row.enabled && (
                <div className="flex flex-none items-center">
                  <button
                    type="button"
                    disabled={isFirstEnabled}
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
                    disabled={isLastEnabled}
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
            </div>
          );
        })}
      </div>
      {isPending && <div className="mt-2 text-caption text-smoke">Saving…</div>}
      {error && <div className="mt-2 text-caption text-smark-orange-soft">{error}</div>}
    </Card>
  );
}

/** Stable-partition: enabled rows first (keeping relative order), disabled after. */
function sortEnabledFirst(rows: EffectiveDistributorRow[]): EffectiveDistributorRow[] {
  const enabled = rows.filter((r) => r.enabled);
  const disabled = rows.filter((r) => !r.enabled);
  return [...enabled, ...disabled].map((r, i) => ({ ...r, rank: i + 1 }));
}
