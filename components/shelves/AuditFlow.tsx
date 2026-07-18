"use client";

import { useMemo, useState, useTransition } from "react";
import { Drawer, DrawerBody, DrawerCloseButton, DrawerFooter, DrawerHeader } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import {
  auditCompletionCount,
  clearAuditProgress,
  confirmAuditCount,
  createAuditProgress,
  isVariance,
  loadAuditProgress,
  markLocationDone,
  nextPendingLocationId,
  saveAuditProgress,
  undoAuditCount,
  type AuditContentItem,
} from "@/lib/audit";

export interface AuditFlowProps {
  boxId: string;
  boxCode: string;
  items: readonly AuditContentItem[];
  /** Drawer dismissed via Pause/Escape/backdrop — progress persists, resumable next time. */
  onClose: () => void;
  /** Every ESD confirmed — caller clears its own "resume" affordance + refreshes data. */
  onFinished: () => void;
}

/**
 * Guided box-audit drawer (FEATURES.md §5.4/§9, plan/tab-shelves.md R2-25):
 * walk each ESD, confirm the on-screen qty or type the counted one; a
 * variance writes an undoable `adjust` movement tagged `audit` server-side
 * (see `lib/audit/actions.ts`) the moment it's confirmed — not batched at the
 * end — so a paused/closed audit has already applied every count it got to.
 */
export function AuditFlow({ boxId, boxCode, items, onClose, onFinished }: AuditFlowProps) {
  const { push } = useToast();
  const [progress, setProgress] = useState(() => loadAuditProgress(boxId) ?? createAuditProgress(boxId));
  const [countedInputs, setCountedInputs] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const doneIds = useMemo(() => new Set(progress.doneLocationIds), [progress.doneLocationIds]);
  const completion = auditCompletionCount(items, doneIds);
  const currentId = nextPendingLocationId(items, doneIds);
  const current = items.find((item) => item.locationId === currentId) ?? null;

  const inputValue = current ? (countedInputs[current.locationId] ?? String(current.recordedQty)) : "";

  function handlePause(): void {
    if (progress.doneLocationIds.length > 0) saveAuditProgress(progress);
    onClose();
  }

  function handleConfirm(): void {
    if (!current) return;
    const parsed = Number.parseInt(inputValue, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || String(parsed) !== inputValue.trim()) {
      push({ msg: "Enter a whole number, 0 or more." });
      return;
    }

    const target = current;
    startTransition(async () => {
      try {
        const result = await confirmAuditCount({ boxId, locationId: target.locationId, countedQty: parsed });
        if (isVariance(target.recordedQty, parsed)) {
          const movementId = result.movementId;
          push({
            msg: `${target.pid}: ${result.delta > 0 ? "+" : ""}${result.delta} adjusted`,
            undo: movementId != null,
            onUndo: movementId
              ? () => {
                  void undoAuditCount(movementId).then((undoResult) => {
                    if (!undoResult.ok) push({ msg: undoResult.error });
                  });
                }
              : undefined,
          });
        }

        const next = markLocationDone(progress, target.locationId);
        setProgress(next);

        const nextCompletion = auditCompletionCount(items, new Set(next.doneLocationIds));
        if (nextCompletion.done >= nextCompletion.total) {
          clearAuditProgress(boxId);
          push({ msg: `Box ${boxCode} — audit complete` });
          onFinished();
        } else {
          saveAuditProgress(next);
        }
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Could not save the count." });
      }
    });
  }

  const progressPct = completion.total > 0 ? Math.round((completion.done / completion.total) * 100) : 0;

  return (
    <Drawer open onClose={handlePause} width={440} aria-label={`Audit box ${boxCode}`}>
      <DrawerHeader>
        <div>
          <div className="text-[17px] text-snow">Audit · Box {boxCode}</div>
          <div className="mt-1 text-caption text-smoke">
            {completion.done} of {completion.total} counted
          </div>
        </div>
        <DrawerCloseButton onClick={handlePause} />
      </DrawerHeader>

      <DrawerBody>
        <div className="mb-5 h-1 w-full overflow-hidden rounded-full bg-surface-well">
          <div
            className="h-full rounded-full bg-smark-orange transition-[width]"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {current ? (
          <div className="rounded-2xl border border-charcoal p-5">
            <div className="font-mono text-lg text-snow">{current.pid}</div>
            <div className="mt-1 font-mono text-[15px] text-silver-mist">{current.mpn ?? "—"}</div>
            {current.value && <div className="mt-1 text-[15px] text-smoke">{current.value}</div>}

            <div className="mt-4 text-caption text-smoke">
              On shelf: <span className="font-mono text-snow">{current.recordedQty}</span>
              {current.lastCountedAt && <> · last counted {formatDateTime(current.lastCountedAt)}</>}
            </div>

            <Field label="Counted quantity" className="mt-4">
              <Input
                mono
                uiSize="lg"
                inputMode="numeric"
                autoFocus
                value={inputValue}
                onChange={(event) =>
                  setCountedInputs((prev) => ({ ...prev, [current.locationId]: event.target.value }))
                }
              />
            </Field>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate bg-surface-panel py-10 text-center text-[15px] text-smoke">
            Nothing left to count — box fully audited.
          </div>
        )}
      </DrawerBody>

      <DrawerFooter>
        <Button variant="outline" onClick={handlePause} fullWidth>
          Pause
        </Button>
        <Button variant="primary" onClick={handleConfirm} loading={isPending} disabled={!current} fullWidth>
          Confirm count
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}
