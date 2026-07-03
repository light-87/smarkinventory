"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { putAwayArrivalLineAction, undoReceiveMovementAction } from "@/lib/receive/actions";
import type { ArrivedLine, ArrivedPoGroup } from "@/lib/receive/queries";

export interface PutAwayListProps {
  groups: readonly ArrivedPoGroup[];
}

/**
 * "Put away arrivals" card — only lines marked arrived on the On-order screen
 * show here, grouped by PO [R2-12 ripple]. Populated by the future On-order /
 * cart-orders package (WF-2); this builds the UI + empty state now against
 * the real schema (plan/tab-receive.md mission brief).
 */
export function PutAwayList({ groups }: PutAwayListProps) {
  const { push } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [arrivedQty, setArrivedQty] = useState("");
  const [isPending, startTransition] = useTransition();

  const selected = groups.flatMap((g) => g.lines).find((l) => l.orderLineId === selectedId) ?? null;

  function selectLine(line: ArrivedLine) {
    setSelectedId(line.orderLineId);
    setArrivedQty(String(line.qtyOrdered));
  }

  function confirm() {
    const qty = Number.parseInt(arrivedQty, 10);
    if (!selected || !Number.isFinite(qty) || qty <= 0) {
      push({ msg: "Enter a valid arrived quantity" });
      return;
    }
    startTransition(async () => {
      const result = await putAwayArrivalLineAction({ orderLineId: selected.orderLineId, arrivedQty: qty });
      if (result.ok) {
        const movementId = result.movementId;
        push({
          msg: `Put away ${qty} × ${result.internalPid}${result.labelQueued ? " — label queued" : " — no reprint"}`,
          undo: true,
          onUndo: () => {
            // Reverses the STOCK movement only — the order line's "arrived"
            // status is left as-is (see lib/receive/actions.ts note).
            void undoReceiveMovementAction(movementId).then((undoResult) => {
              if (!undoResult.ok) push({ msg: undoResult.error });
            });
          },
        });
        setSelectedId(null);
        setArrivedQty("");
      } else {
        push({ msg: result.error });
      }
    });
  }

  const hasLines = groups.length > 0;

  return (
    <Card padding="none">
      <CardHeader
        title="Arrived — ready to put away"
        meta="only items marked arrived show here"
      />

      {!hasLines && (
        <div className="p-5">
          <EmptyState tone="subtle">
            Nothing waiting. On the <span className="text-smark-orange-soft">On-order &amp; arrivals</span> screen tap
            &ldquo;Mark arrived&rdquo; — the item appears here to put away.
          </EmptyState>
        </div>
      )}

      {groups.map((group) => (
        <div key={group.orderId} className="border-b border-border-divider last:border-b-0">
          <div className="flex items-center justify-between gap-3 bg-canvas px-5 py-2.5">
            <span className="font-mono text-[13px] text-snow">PO {group.poNumber}</span>
            <span className="text-caption text-smoke">{group.distributorName}</span>
          </div>
          {group.lines.map((line) => {
            const active = line.orderLineId === selectedId;
            return (
              <button
                key={line.orderLineId}
                type="button"
                onClick={() => selectLine(line)}
                className="flex w-full items-center gap-3 border-t border-border-hairline px-5 py-3 text-left transition-colors hover:bg-surface-hover"
              >
                <span
                  aria-hidden
                  className="relative size-3.5 flex-none rounded-full border"
                  style={{ borderColor: active ? "#f57d05" : "#2e2e2e" }}
                >
                  {active && <span className="absolute inset-[3px] rounded-full bg-smark-orange" />}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-snow">
                  {line.internalPid ?? line.mpn ?? "New part"}
                </span>
                <Chip tone={line.existing ? "neutral" : "accent"} size="sm">
                  {line.existing ? "EXISTING" : "NEW"}
                </Chip>
                {line.projectName && (
                  <span className="hidden text-caption text-smoke sm:inline">
                    {line.projectName}
                    {line.bomName ? ` · ${line.bomName}` : ""}
                  </span>
                )}
                <span className="flex-none font-mono text-caption text-silver-mist">×{line.qtyOrdered}</span>
              </button>
            );
          })}
        </div>
      ))}

      {selected && (
        <div className="bg-surface-panel border-t border-border-divider p-5">
          <div className="mb-3 text-[13px] leading-relaxed text-snow">
            {selected.existing
              ? `Top up ${selected.internalPid ?? "the part"} — no reprint.`
              : `New part — 1 ESD label will be queued.`}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={arrivedQty}
              onChange={(e) => setArrivedQty(e.target.value)}
              placeholder="Arrived qty"
              mono
              inputMode="numeric"
              className="w-32"
            />
            <Button onClick={confirm} loading={isPending}>
              Confirm &amp; put away
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
