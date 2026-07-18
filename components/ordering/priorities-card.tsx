"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { savePrioritiesAction } from "@/app/(app)/projects/[projectId]/ordering/[bomId]/actions";
import type { PerLineNote } from "@/lib/runs/types";

export interface PrioritiesCardProps {
  bomId: string;
  initialPriorities: string | null;
  perLineNotes: PerLineNote[];
  writable: boolean;
}

/** Free-text priorities (prefilled from the sheet) + read-only per-line notes (plan/tab-ordering-workspace.md §2.2). */
export function PrioritiesCard({ bomId, initialPriorities, perLineNotes, writable }: PrioritiesCardProps) {
  const [value, setValue] = useState(initialPriorities ?? "");
  const [saved, setSaved] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await savePrioritiesAction({ bomId, priorities: value.trim() || null });
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  return (
    <Card padding="lg">
      <div className="mb-1 text-[17px] font-medium text-snow">Priorities</div>
      <div className="mb-3.5 text-caption text-smoke">The AI reads these in your own words</div>
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        disabled={!writable}
        placeholder="e.g. prefer in-stock over cheapest · connectors only from Digikey"
        className="min-h-[72px] w-full resize-y rounded-lg border border-charcoal bg-surface-well px-3.5 py-3 text-sm leading-normal text-snow outline-none placeholder:text-smoke focus:border-smark-orange disabled:opacity-50"
      />
      {writable && (
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={save} loading={isPending} disabled={saved}>
            Save priorities
          </Button>
          {error && <span className="text-caption text-smark-orange-soft">{error}</span>}
        </div>
      )}
      {perLineNotes.length > 0 && (
        <div className="mt-3.5 flex flex-col gap-1.5">
          <div className="mb-0.5 text-[13px] tracking-[0.06em] text-smoke uppercase">Per-line notes</div>
          {perLineNotes.map((note, i) => (
            <div key={i} className="flex items-baseline gap-2.5 text-[15px]">
              <span className="min-w-16 flex-none font-mono text-silver-mist">{note.ref}</span>
              <span className="text-smoke">&ldquo;{note.note}&rdquo;</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
