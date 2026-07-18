"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Drawer, DrawerBody, DrawerCloseButton, DrawerFooter, DrawerHeader } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatINR } from "@/lib/format";
import { confirmReceiptExtractionAction } from "@/lib/orders/actions";
import { groupOrderLines, mapReceiptLinesToOrderGroups, type OrderLineGroup } from "@/lib/orders/receipt-map";
import type { OrderGroupView } from "@/lib/orders/queries";
import type { ReceiptExtractResult } from "@/lib/ai";
import { DistributorSelect } from "./distributor-select";

type OrderLineViewItem = OrderGroupView["lines"][number];

export interface ReceiptExtractDialogProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  poNumber: string;
  extraction: ReceiptExtractResult;
  lines: readonly OrderLineViewItem[];
}

interface RowState {
  include: boolean;
  /** "" = unmatched/skipped — mirrors `<select>`'s empty-string convention. */
  groupKey: string;
  unitPrice: string;
}

function groupLabel(group: OrderLineGroup): string {
  const identity = group.internalPid ?? group.mpn ?? group.value ?? "part";
  return `${identity} ×${group.qtyOrdered.toLocaleString("en-IN")}`;
}

/**
 * "Extract prices" confirm dialog (§3-C · FEATURES §5.12 · §20 risk #3:
 * "always user-confirmed, never silent writes"). Every row starts from
 * `mapReceiptLinesToOrderGroups`'s best guess (lib/orders/receipt-map.ts) but
 * is fully editable — reassign the part, uncheck a row, correct the price —
 * before anything reaches the server.
 */
export function ReceiptExtractDialog({ open, onClose, orderId, poNumber, extraction, lines }: ReceiptExtractDialogProps) {
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();

  const groups = useMemo<OrderLineGroup[]>(
    () =>
      groupOrderLines(
        lines.map((line) => ({
          orderLineId: line.orderLineId,
          cartItemId: line.cartItemId,
          mpn: line.mpn,
          lcscPn: line.lcscPn,
          value: line.value,
          package: line.package,
          internalPid: line.internalPid,
          qtyOrdered: line.qtyOrdered,
          unitPrice: line.unitPrice,
        })),
      ),
    [lines],
  );

  const groupByKey = useMemo(() => new Map(groups.map((g) => [g.groupKey, g])), [groups]);
  const mappings = useMemo(() => mapReceiptLinesToOrderGroups(extraction.lines, groups), [extraction, groups]);

  const [rows, setRows] = useState<RowState[]>(() =>
    mappings.map((m) => ({
      include: m.groupKey !== null,
      groupKey: m.groupKey ?? "",
      unitPrice: String(m.unitPrice),
    })),
  );

  function updateRow(index: number, patch: Partial<RowState>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function confirm() {
    const payload = rows
      .map((row) => ({ row, group: row.groupKey ? groupByKey.get(row.groupKey) : undefined }))
      .filter((entry): entry is { row: RowState; group: OrderLineGroup } => entry.row.include && Boolean(entry.group))
      .map(({ row, group }) => ({
        orderLineIds: group.orderLineIds,
        cartItemId: group.cartItemId,
        unitPrice: Number.parseFloat(row.unitPrice),
      }))
      .filter((line) => Number.isFinite(line.unitPrice) && line.unitPrice >= 0);

    if (payload.length === 0) {
      push({ msg: "Map at least one line to a part before confirming." });
      return;
    }

    startTransition(async () => {
      const result = await confirmReceiptExtractionAction({ orderId, raw: extraction, lines: payload });
      if (result.ok) {
        push({ msg: `Updated ${result.updatedOrderLines} order line${result.updatedOrderLines === 1 ? "" : "s"}.` });
        onClose();
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <Drawer open={open} onClose={onClose} width={520} aria-label="Confirm extracted receipt prices">
      <DrawerHeader>
        <div>
          <div className="text-[17px] text-snow">Confirm extracted prices</div>
          <div className="text-caption text-smoke">PO {poNumber} — nothing is saved until you confirm.</div>
        </div>
        <DrawerCloseButton onClick={onClose} />
      </DrawerHeader>
      <DrawerBody>
        <div className="flex flex-col gap-3">
          {mappings.map((mapping, index) => {
            const row = rows[index]!;
            const matchedGroup = row.groupKey ? groupByKey.get(row.groupKey) : undefined;
            return (
              <div key={index} className="rounded-xl border border-charcoal p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-[15px]">
                    <div className="truncate text-snow">{mapping.desc}</div>
                    <div className="text-caption text-smoke">
                      extracted ×{mapping.qty.toLocaleString("en-IN")} @ {formatINR(mapping.unitPrice)}
                    </div>
                  </div>
                  <label className="flex flex-none items-center gap-1.5 text-caption text-smoke">
                    <input
                      type="checkbox"
                      checked={row.include}
                      disabled={!matchedGroup}
                      onChange={(e) => updateRow(index, { include: e.target.checked })}
                      className="size-[16px] cursor-pointer accent-smark-orange disabled:cursor-not-allowed"
                    />
                    apply
                  </label>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <DistributorSelect
                    className="w-auto min-w-[160px] flex-1"
                    placeholder="Unmatched — pick a line"
                    value={row.groupKey}
                    onChange={(e) => updateRow(index, { groupKey: e.target.value, include: e.target.value !== "" })}
                    options={groups.map((g) => ({ value: g.groupKey, label: groupLabel(g) }))}
                  />
                  {matchedGroup ? (
                    <Chip tone={mapping.matchMethod === "mpn" ? "success" : "accent"}>
                      {mapping.matchMethod === "mpn" ? "MPN match" : `Fuzzy match ${mapping.confidence}%`}
                    </Chip>
                  ) : (
                    <Chip tone="default">Unmatched</Chip>
                  )}
                  <Input
                    uiSize="sm"
                    mono
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    aria-label={`Unit price for ${mapping.desc}`}
                    className="w-28"
                    value={row.unitPrice}
                    onChange={(e) => updateRow(index, { unitPrice: e.target.value })}
                  />
                </div>
              </div>
            );
          })}

          {extraction.total != null && (
            <div className="text-caption text-smoke">Receipt total: {formatINR(extraction.total)}</div>
          )}
        </div>
      </DrawerBody>
      <DrawerFooter>
        <Button fullWidth loading={isPending} onClick={confirm}>
          Confirm &amp; apply prices
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}
