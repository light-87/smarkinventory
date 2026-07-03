"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { formatNumber } from "@/lib/format";
import type { ResolvedPart, StockLocationWithBox } from "@/lib/scan";

export interface PartScanCardProps {
  data: ResolvedPart;
  step: number;
  onStepChange: (next: number) => void;
  selectedLocationId: string | null;
  onSelectLocation: (id: string) => void;
  onTakeOut: () => void;
  onAdd: () => void;
  pending: boolean;
  /** FEATURES.md §2: accountant is read-only on Scan — hides the stepper + Take out/Add when false. Defaults to `true`. */
  canWrite?: boolean;
}

function locationLabel(location: StockLocationWithBox): string {
  const box = location.big_box;
  if (!box) return "Unassigned box";
  return box.shelf ? `Shelf ${box.shelf.code} · Box ${box.name}` : `Box ${box.name}`;
}

/**
 * Part scan result card (plan/tab-scan.md: "PID/MPN/value/loc/qty, stepper,
 * Take out (orange) / Add"). When a part has more than one location (the
 * documented reel + working-box bulk case — SCHEMA.md §2), a row of location
 * chips lets the technician pick which ESD plastic the stepper applies to;
 * with exactly one location (the common case) it's just the qty stepper.
 */
export function PartScanCard({
  data,
  step,
  onStepChange,
  selectedLocationId,
  onSelectLocation,
  onTakeOut,
  onAdd,
  pending,
  canWrite = true,
}: PartScanCardProps) {
  const { part, locations } = data;
  const selected = locations.find((location) => location.id === selectedLocationId) ?? locations[0] ?? null;

  return (
    <Card padding="lg" className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate font-mono text-[22px] text-snow">{part.internal_pid}</div>
          {part.mpn && <div className="mt-1 truncate font-mono text-[13px] text-silver-mist">{part.mpn}</div>}
          <div className="mt-1.5 truncate text-body-sm text-smoke">
            {[part.value, selected ? locationLabel(selected) : "No location on file"].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="flex-none text-right">
          <div className="font-mono text-[28px] text-snow">{formatNumber(part.total_qty)}</div>
          <div className="text-caption text-smoke">in stock</div>
        </div>
      </div>

      {locations.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {locations.map((location) => (
            <button
              key={location.id}
              type="button"
              onClick={() => onSelectLocation(location.id)}
              className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-smark-orange"
            >
              <Chip tone={location.id === selected?.id ? "accent" : "default"} mono>
                {locationLabel(location)} · {formatNumber(location.qty)}
              </Chip>
            </button>
          ))}
        </div>
      )}

      {canWrite ? (
        <>
          <div className="flex items-center gap-3.5">
            <span className="text-body-sm text-smoke">Quantity</span>
            <div className="flex items-center gap-0.5 rounded-full border border-charcoal p-[3px]">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => onStepChange(step - 1)}
                className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full text-lg text-snow hover:bg-ash"
              >
                −
              </button>
              <span className="w-12 text-center font-mono text-base text-snow">{step}</span>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => onStepChange(step + 1)}
                className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full text-lg text-snow hover:bg-ash"
              >
                +
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="primary" size="xl" fullWidth onClick={onTakeOut} loading={pending} disabled={!selected}>
              Take out
            </Button>
            <Button variant="outline" size="xl" fullWidth onClick={onAdd} loading={pending} disabled={!selected}>
              Add
            </Button>
          </div>
        </>
      ) : (
        <div className="text-body-sm text-smoke">Read-only — your role can view stock but can&apos;t adjust it here.</div>
      )}
    </Card>
  );
}
