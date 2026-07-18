"use client";

import { Input } from "@/components/ui/input";
import type { TakeoutSourceKind } from "@/lib/takeout/types";

export interface MultiplierBannerProps {
  value: number;
  onChange: (next: number) => void;
  /** Locked once the walk has started (any row checked) — change requires "Start over" (plan/tab-bulk-pick.md R2-27: "adjustable BEFORE starting"). */
  locked: boolean;
  sourceKind: TakeoutSourceKind;
}

/** "×N builds" banner [R2-27] — prefilled from the BOM's build_qty, optional (default 1) for ad-hoc sources. */
export function MultiplierBanner({ value, onChange, locked, sourceKind }: MultiplierBannerProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-charcoal bg-surface-panel px-4 py-3">
      <span className="text-[15px] text-smoke">
        {sourceKind === "project_bom" ? "Builds required" : "Multiply pick quantities"}
      </span>
      <div className="flex items-center gap-1.5">
        <span aria-hidden className="font-mono text-base text-snow">
          ×
        </span>
        <Input
          uiSize="sm"
          mono
          inputMode="numeric"
          aria-label="Build multiplier"
          className="w-16 text-center"
          value={String(value)}
          disabled={locked}
          onChange={(e) => {
            const next = Number.parseInt(e.target.value, 10);
            onChange(Number.isFinite(next) && next > 0 ? next : 1);
          }}
        />
      </div>
      {locked && (
        <span className="text-caption text-smoke">Locked once you start checking off lines — &ldquo;Start over&rdquo; to change it.</span>
      )}
    </div>
  );
}
