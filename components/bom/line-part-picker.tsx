"use client";

import { useState, useTransition } from "react";
import { Chip } from "@/components/ui/chip";
import { useToast } from "@/components/ui/toast";
import { formatNumber } from "@/lib/format";
import { chooseBomLinePartAction } from "@/app/(app)/projects/[projectId]/boms/actions";
import type { BomLineOption } from "@/lib/bom/queries";

export interface LinePartPickerProps {
  bomId: string;
  lineId: string;
  options: readonly BomLineOption[];
  writable: boolean;
}

/**
 * "In stock — N options": the line's stock rows, for a human to choose between.
 *
 * The matcher will not pick between two rows that share a value and a package,
 * because charging a line's whole demand to an arbitrary half of the stock
 * corrupts the shortfall and to-order arithmetic. Before this existed, that
 * refusal was reported to the operator as "To order" — the client's complaint
 * on 2026-08-13 was a 100nF 0603 line reading as out of stock with 1,604 pieces
 * on the shelf, because the catalog held it at two voltages.
 *
 * So the refusal stays, and the decision surfaces. The rows differ by something
 * real — voltage, tolerance, which reel they came from — and only the person
 * building the board knows which one the design meant. Their answer is written
 * to the line and survives re-reconcile.
 */
export function LinePartPicker({ bomId, lineId, options, writable }: LinePartPickerProps) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (options.length === 0) return null;

  function choose(partId: string) {
    startTransition(async () => {
      const result = await chooseBomLinePartAction({ bomId, lineId, partId });
      if (result.ok) {
        setOpen(false);
        push({ msg: "Line matched — stock updated" });
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => writable && setOpen((v) => !v)}
        disabled={!writable}
        className="cursor-pointer disabled:cursor-default"
        title={writable ? "Pick which stock item this line is" : "Read-only"}
      >
        <Chip tone="warn">In stock · {options.length} options</Chip>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-20 mt-1 w-[320px] rounded-xl border border-border-divider bg-surface p-2 shadow-lg">
          <div className="px-2 py-1.5 text-caption text-smoke">
            Same value and package — pick the one this line means.
          </div>
          {options.map((option) => (
            <button
              key={option.partId}
              type="button"
              onClick={() => choose(option.partId)}
              disabled={isPending}
              className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-raised disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block font-mono text-[14px] text-snow">{option.internalPid}</span>
                <span className="block text-caption text-smoke">
                  {[option.value, option.voltage, option.package].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
              <span className="flex-none font-mono text-caption text-silver-mist">
                {formatNumber(option.totalQty)} pcs
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
