"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import type { DistributorRow } from "@/types/db";
import { recomputeShortfallAction } from "@/lib/orders/actions";
import type { CartLineView } from "@/lib/orders/queries";
import { CartLineCard } from "./cart-line-card";
import { CheckoutDrawer } from "./checkout-drawer";
import { ManualAddPanel } from "./manual-add-panel";

export interface CartTabProps {
  lines: readonly CartLineView[];
  distributors: readonly DistributorRow[];
  canWrite: boolean;
}

export function CartTab({ lines, distributors, canWrite }: CartTabProps) {
  const { push } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();

  const openLines = useMemo(() => lines.filter((l) => l.status === "open"), [lines]);
  const dismissedLines = useMemo(() => lines.filter((l) => l.status === "dismissed"), [lines]);
  const selectedLines = useMemo(() => openLines.filter((l) => selected.has(l.id)), [openLines, selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function refresh() {
    startRefresh(async () => {
      const summary = await recomputeShortfallAction();
      const total = summary.created + summary.updated + summary.resurrected + summary.closed;
      push({ msg: total > 0 ? `Demand refreshed — ${total} line${total === 1 ? "" : "s"} updated` : "Demand is already up to date" });
    });
  }

  function onPlaced(cartItemIds: readonly string[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of cartItemIds) next.delete(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ManualAddPanel canWrite={canWrite} />
        <Button variant="ghost" size="sm" onClick={refresh} loading={isRefreshing}>
          Refresh demand
        </Button>
      </div>

      {openLines.length === 0 && dismissedLines.length === 0 ? (
        <EmptyState
          title="Cart is empty"
          description="Shortfalls across active projects show up here automatically. Add a part manually, or send items from a BOM review."
        />
      ) : (
        <>
          {openLines.length === 0 ? (
            <EmptyState tone="subtle" title="Nothing to order right now" />
          ) : (
            <div className="flex flex-col gap-3">
              {openLines.map((line) => (
                <CartLineCard
                  key={line.id}
                  line={line}
                  distributors={distributors}
                  canWrite={canWrite}
                  selected={selected.has(line.id)}
                  onToggleSelected={toggle}
                />
              ))}
            </div>
          )}

          {dismissedLines.length > 0 && (
            <div className="mt-2 flex flex-col gap-3">
              <div className="text-caption text-smoke uppercase tracking-[0.06em]">Dismissed suggestions</div>
              {dismissedLines.map((line) => (
                <CartLineCard
                  key={line.id}
                  line={line}
                  distributors={distributors}
                  canWrite={canWrite}
                  selected={false}
                  onToggleSelected={() => {}}
                />
              ))}
            </div>
          )}
        </>
      )}

      {selectedLines.length > 0 && (
        // Mobile bottom bar is `fixed bottom-0 h-[60px] z-40` (components/shell/bottom-bar.tsx) —
        // without the mobile offset + matching z-index this CTA sits behind it and is untappable
        // on <768px (finding #9). Matches the 76px mobile offset already used for the toast viewport.
        <div className="sticky bottom-[76px] z-40 flex justify-center md:bottom-4 md:z-10">
          <Button size="lg" onClick={() => setCheckoutOpen(true)} className="shadow-lg">
            Checkout ({selectedLines.length})
          </Button>
        </div>
      )}

      <CheckoutDrawer
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        lines={selectedLines}
        distributors={distributors}
        onPlaced={onPlaced}
      />
    </div>
  );
}
