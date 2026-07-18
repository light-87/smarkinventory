"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DrawerCloseButton } from "@/components/ui/drawer";
import { Field, Input } from "@/components/ui/input";
import { adjustPartQty, type AdjustQtyResult } from "@/lib/part-events/actions";
import type { PartDetailLocation } from "@/lib/part-events/types";
import type { PartRow } from "@/types/db";

export interface AdjustQtyDialogProps {
  open: boolean;
  onClose: () => void;
  part: PartRow;
  locations: PartDetailLocation[];
  /** Only called with `{ ok: true, ... }` results — errors stay in the dialog. */
  onAdjusted: (result: Extract<AdjustQtyResult, { ok: true }>) => void;
}

/** Footer "Adjust qty" action → dialog → movement w/ undo toast (tab-part-detail.md §2/§6). */
export function AdjustQtyDialog({ open, onClose, part, locations, onAdjusted }: AdjustQtyDialogProps) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [qty, setQty] = useState(String(locations[0]?.qty ?? 0));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reset the form fields whenever the dialog transitions closed → open —
  // done here (during render, following the "adjusting state when a prop
  // changes" pattern from react.dev/learn/you-might-not-need-an-effect)
  // rather than in a useEffect, so it never fires a synchronous setState
  // inside an effect body.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const first = locations[0];
      setLocationId(first?.id ?? "");
      setQty(String(first?.qty ?? 0));
      setNote("");
      setError(null);
    }
  }

  if (!open) return null;

  function submit() {
    const newQty = Number(qty);
    if (!Number.isFinite(newQty) || !Number.isInteger(newQty) || newQty < 0) {
      setError("Enter a whole number, 0 or more.");
      return;
    }
    if (!locationId) {
      setError("No location to adjust.");
      return;
    }
    startTransition(async () => {
      const result = await adjustPartQty({ partId: part.id, locationId, newQty, note: note.trim() || undefined });
      if (result.ok) onAdjusted(result);
      else setError(result.error);
    });
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-[#1d2130]/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Adjust quantity"
        className="relative w-full max-w-sm rounded-2xl border border-charcoal bg-surface p-5"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="text-[17px] font-medium text-snow">
            Adjust qty · <span className="font-mono">{part.internal_pid}</span>
          </span>
          <DrawerCloseButton onClick={onClose} />
        </div>

        {locations.length > 1 && (
          <Field label="Location" className="mb-3">
            <select
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value);
                const loc = locations.find((l) => l.id === e.target.value);
                setQty(String(loc?.qty ?? 0));
              }}
              className="h-10 w-full rounded-lg border border-charcoal bg-surface-well px-3.5 text-sm text-snow outline-none focus:border-smark-orange"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  Shelf {loc.shelfCode} · {loc.boxName} (currently {loc.qty})
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="New quantity" className="mb-3">
          <Input
            mono
            uiSize="lg"
            type="number"
            min={0}
            step={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </Field>

        <Field label="Note (optional)" hint="Reason for the adjustment — shows in the living record." className="mb-4">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. recount, damaged, found extra" />
        </Field>

        {error && <p className="mb-3 text-caption text-smark-orange-soft">{error}</p>}

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" loading={pending} onClick={submit}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
