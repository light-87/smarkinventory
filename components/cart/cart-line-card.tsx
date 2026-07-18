"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { DistributorRow } from "@/types/db";
import { formatINR } from "@/lib/format";
import { removeCartLineAction, updateCartLineAction } from "@/lib/orders/actions";
import type { CartLineView } from "@/lib/orders/queries";
import { DistributorSelect } from "./distributor-select";

const SOURCE_CHIP: Record<CartLineView["source"], { label: string; tone: "accent" | "success" | "neutral" }> = {
  auto_shortfall: { label: "Auto · shortfall", tone: "accent" },
  review_add: { label: "From review", tone: "success" },
  manual: { label: "Manual", tone: "neutral" },
};

export interface CartLineCardProps {
  line: CartLineView;
  distributors: readonly DistributorRow[];
  canWrite: boolean;
  selected: boolean;
  onToggleSelected: (id: string) => void;
}

export function CartLineCard({ line, distributors, canWrite, selected, onToggleSelected }: CartLineCardProps) {
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [qty, setQty] = useState(String(line.qtyToOrder));
  const [price, setPrice] = useState(line.unitPrice != null ? String(line.unitPrice) : "");

  const isDismissed = line.status === "dismissed";
  const sourceChip = SOURCE_CHIP[line.source];
  const selectable = canWrite && !isDismissed && Boolean(line.distributorId);

  function commitQty() {
    const parsed = Number.parseInt(qty, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setQty(String(line.qtyToOrder));
      return;
    }
    if (parsed === line.qtyToOrder) return;
    startTransition(async () => {
      const result = await updateCartLineAction({ cartItemId: line.id, qtyToOrder: parsed });
      if (!result.ok) push({ msg: result.error });
    });
  }

  function commitPrice() {
    const trimmed = price.trim();
    const parsed = trimmed === "" ? null : Number.parseFloat(trimmed);
    if (trimmed !== "" && (!Number.isFinite(parsed) || (parsed as number) < 0)) {
      setPrice(line.unitPrice != null ? String(line.unitPrice) : "");
      return;
    }
    if (parsed === line.unitPrice) return;
    startTransition(async () => {
      const result = await updateCartLineAction({ cartItemId: line.id, unitPrice: parsed });
      if (!result.ok) push({ msg: result.error });
    });
  }

  function changeDistributor(distributorId: string) {
    startTransition(async () => {
      const result = await updateCartLineAction({ cartItemId: line.id, distributorId: distributorId || null });
      if (!result.ok) push({ msg: result.error });
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await removeCartLineAction({ cartItemId: line.id });
      if (!result.ok) push({ msg: result.error });
      else push({ msg: isDismissed ? "Removed" : line.source === "auto_shortfall" ? "Dismissed" : "Removed from cart" });
    });
  }

  return (
    <Card tone={isDismissed ? "panel" : "surface"} className={isDismissed ? "opacity-60" : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {selectable && (
            <input
              type="checkbox"
              aria-label={`Select ${line.internalPid ?? line.mpn ?? "line"} for checkout`}
              checked={selected}
              onChange={() => onToggleSelected(line.id)}
              className="size-[18px] flex-none cursor-pointer accent-smark-orange"
            />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {line.internalPid && <span className="font-mono text-[15px] text-snow">{line.internalPid}</span>}
              {line.mpn && <span className="truncate text-[15px] text-silver-mist">{line.mpn}</span>}
              {!line.internalPid && !line.mpn && <span className="text-[15px] text-smoke">New part</span>}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {line.value && (
                <Chip tone="default" mono>
                  {line.value}
                </Chip>
              )}
              {line.package && (
                <Chip tone="default" mono>
                  {line.package}
                </Chip>
              )}
              {line.availableQty !== null && (
                <Chip tone="neutral" mono>
                  {line.availableQty.toLocaleString("en-IN")} in stock
                </Chip>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-none items-center gap-2">
          <Chip tone={sourceChip.tone}>{sourceChip.label}</Chip>
          {canWrite && (
            <button
              type="button"
              aria-label="Remove from cart"
              onClick={remove}
              disabled={isPending}
              className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full text-smoke transition-colors hover:bg-ash hover:text-snow disabled:opacity-50"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {line.demand.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {line.demand.map((slice, i) => (
            <Chip key={`${slice.bomId}-${i}`} tone="soft" mono>
              {slice.bomName !== "—" ? slice.bomName : slice.projectName} {slice.qty.toLocaleString("en-IN")}
            </Chip>
          ))}
        </div>
      )}

      {isDismissed ? (
        <div className="mt-3 text-caption text-smoke">
          Dismissed at qty {line.qtyToOrder.toLocaleString("en-IN")} — reappears only if the shortfall grows past that.
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Qty to order">
            <Input
              uiSize="sm"
              mono
              type="number"
              inputMode="numeric"
              value={qty}
              disabled={!canWrite}
              onChange={(e) => setQty(e.target.value)}
              onBlur={commitQty}
            />
          </Field>
          <Field label="Unit price (₹)">
            <Input
              uiSize="sm"
              mono
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              value={price}
              disabled={!canWrite}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={commitPrice}
            />
          </Field>
          <Field label="Distributor" className="col-span-2 sm:col-span-1">
            <DistributorSelect
              placeholder="— pick —"
              value={line.distributorId ?? ""}
              disabled={!canWrite}
              onChange={(e) => changeDistributor(e.target.value)}
              options={distributors.map((d) => ({ value: d.id, label: d.name }))}
            />
          </Field>
        </div>
      )}

      {line.unitPrice != null && line.qtyToOrder > 0 && !isDismissed && (
        <div className="mt-2 text-caption text-smoke">
          Line total {formatINR(line.unitPrice * line.qtyToOrder)}
        </div>
      )}
    </Card>
  );
}
