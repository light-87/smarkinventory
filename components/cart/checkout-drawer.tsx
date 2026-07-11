"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerCloseButton, DrawerFooter, DrawerHeader } from "@/components/ui/drawer";
import { Chip } from "@/components/ui/chip";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { DistributorRow } from "@/types/db";
import { formatINR } from "@/lib/format";
import { checkoutCartAction } from "@/lib/orders/actions";
import type { CartLineView } from "@/lib/orders/queries";

export interface CheckoutDrawerProps {
  open: boolean;
  onClose: () => void;
  lines: readonly CartLineView[];
  distributors: readonly DistributorRow[];
  /** Called with the ids of lines whose group placed successfully, so the parent can drop them from selection. */
  onPlaced: (cartItemIds: readonly string[]) => void;
}

interface Group {
  distributorId: string;
  distributorName: string;
  lines: CartLineView[];
  total: number;
}

/** Checkout (§3-C / Q-06): select lines → group by distributor → paste each group's website order number → confirm. */
export function CheckoutDrawer({ open, onClose, lines, distributors, onPlaced }: CheckoutDrawerProps) {
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [poByDistributor, setPoByDistributor] = useState<Record<string, string>>({});

  const groups = useMemo<Group[]>(() => {
    const byDistributor = new Map<string, CartLineView[]>();
    for (const line of lines) {
      if (!line.distributorId) continue;
      const bucket = byDistributor.get(line.distributorId) ?? [];
      bucket.push(line);
      byDistributor.set(line.distributorId, bucket);
    }
    const nameById = new Map(distributors.map((d) => [d.id, d.name]));
    return Array.from(byDistributor.entries())
      .map(([distributorId, groupLines]) => ({
        distributorId,
        distributorName: nameById.get(distributorId) ?? "—",
        lines: groupLines,
        total: groupLines.reduce((sum, l) => sum + l.qtyToOrder * (l.unitPrice ?? 0), 0),
      }))
      .sort((a, b) => a.distributorName.localeCompare(b.distributorName));
  }, [lines, distributors]);

  function confirm() {
    const payload = groups
      .filter((g) => (poByDistributor[g.distributorId] ?? "").trim().length > 0)
      .map((g) => ({
        distributorId: g.distributorId,
        cartItemIds: g.lines.map((l) => l.id),
        poNumber: poByDistributor[g.distributorId]!.trim(),
      }));

    if (payload.length === 0) {
      push({ msg: "Enter at least one order number to place." });
      return;
    }

    startTransition(async () => {
      const { results } = await checkoutCartAction({ groups: payload });
      const placedIds: string[] = [];
      for (const result of results) {
        const group = groups.find((g) => g.distributorId === result.distributorId);
        if (result.ok) {
          placedIds.push(...(group?.lines.map((l) => l.id) ?? []));
          push({ msg: `${group?.distributorName ?? "Order"} placed — PO ${result.poNumber}` });
          if (result.draftExpensePending) {
            push({
              msg: `${result.poNumber}: no expense draft was auto-created — an owner has been notified to add it manually.`,
              dismissable: true,
              timeout: 0,
            });
          }
          setPoByDistributor((prev) => {
            const next = { ...prev };
            delete next[result.distributorId];
            return next;
          });
        } else {
          push({ msg: `${group?.distributorName ?? "Group"}: ${result.error}` });
        }
      }
      if (placedIds.length > 0) onPlaced(placedIds);
      if (placedIds.length === lines.filter((l) => l.distributorId).length) onClose();
    });
  }

  return (
    <Drawer open={open} onClose={onClose} width={480} aria-label="Checkout">
      <DrawerHeader>
        <div>
          <div className="text-[16px] text-snow">Checkout</div>
          <div className="text-caption text-smoke">Grouped by distributor — a group without an order number stays in the cart.</div>
        </div>
        <DrawerCloseButton onClick={onClose} />
      </DrawerHeader>
      <DrawerBody>
        {groups.length === 0 ? (
          <div className="text-[14px] text-smoke">
            Select cart lines with a distributor chosen, then come back here.
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <div key={group.distributorId} className="rounded-xl border border-charcoal p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[14px] text-snow">{group.distributorName}</div>
                  <Chip tone="neutral" mono>
                    {group.lines.length} line{group.lines.length === 1 ? "" : "s"}
                  </Chip>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {group.lines.map((l) => (
                    <Chip key={l.id} tone="default" mono>
                      {l.internalPid ?? l.mpn ?? "part"} ×{l.qtyToOrder}
                    </Chip>
                  ))}
                </div>
                {group.total > 0 && <div className="mt-2 text-caption text-smoke">Total {formatINR(group.total)}</div>}
                <div className="mt-3">
                  <Field label="Distributor website order number">
                    <Input
                      mono
                      placeholder="e.g. SO-48213"
                      value={poByDistributor[group.distributorId] ?? ""}
                      onChange={(e) =>
                        setPoByDistributor((prev) => ({ ...prev, [group.distributorId]: e.target.value }))
                      }
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        )}
      </DrawerBody>
      {groups.length > 0 && (
        <DrawerFooter>
          <Button fullWidth loading={isPending} onClick={confirm}>
            Confirm order{groups.length > 1 ? "s" : ""}
          </Button>
        </DrawerFooter>
      )}
    </Drawer>
  );
}
