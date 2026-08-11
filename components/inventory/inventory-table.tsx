"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { TableBody, TableHead, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { minWidthFor, visibleColumns, type InventoryColumn } from "@/lib/inventory/columns";
import type { StockState } from "@/lib/inventory/stock-state";
import type { InventoryPart } from "@/lib/inventory/types";

// Stock state now reads in its own semantic colour: amber = low (caution),
// red = out (danger). Previously both were cobalt, which collided with the
// accent/link colour and carried no urgency.
const TICK_CLASS: Record<StockState, string> = {
  ok: "border-l-transparent",
  low: "border-l-warn",
  out: "border-l-smark-orange-soft",
};

const QTY_CHIP_TONE: Record<StockState, ChipTone> = {
  ok: "bright",
  low: "warn",
  out: "danger",
};

function locationLabel(part: InventoryPart): string {
  const first = part.locations[0];
  if (!first) return "—";
  const base = `Shelf ${first.shelfCode} · ${first.boxName}`;
  const extra = part.locations.length - 1;
  return extra > 0 ? `${base} +${extra}` : base;
}

export interface InventoryTableProps {
  parts: InventoryPart[];
  /** The Category facet's current selection — decides which columns apply. */
  selectedCategories: readonly string[];
}

/**
 * The main inventory grid (tab-inventory.md §2 columns).
 *
 * The header follows the category rather than being fixed — see
 * `lib/inventory/columns.ts` for why and for the column definitions. Filtering
 * to IC swaps Value/V for the columns `ic_smd.csv` actually has; filtering to
 * Resistor brings in resistance, tolerance and power.
 */
export function InventoryTable({ parts, selectedCategories }: InventoryTableProps) {
  const router = useRouter();
  const columns = useMemo(() => visibleColumns(parts, selectedCategories), [parts, selectedCategories]);
  const minWidth = useMemo(() => minWidthFor(columns), [columns]);

  return (
    <TableShell minWidth={minWidth}>
      <TableHead>
        <Tr>
          {columns.map((column) => (
            <Th key={column.id} align={column.align}>
              {column.label}
            </Th>
          ))}
        </Tr>
      </TableHead>
      <TableBody>
        {parts.map((part) => (
          <Tr
            key={part.id}
            interactive
            onClick={() => router.push(`/inventory?pid=${encodeURIComponent(part.internal_pid)}`)}
          >
            {columns.map((column) => (
              <Cell key={column.id} column={column} part={part} />
            ))}
          </Tr>
        ))}
      </TableBody>
    </TableShell>
  );
}

function Cell({ column, part }: { column: InventoryColumn; part: InventoryPart }) {
  switch (column.render) {
    case "pid":
      return (
        <Td mono className={cn("border-l-2", TICK_CLASS[part.stockState])}>
          {part.internal_pid}
        </Td>
      );
    case "qty":
      return (
        <Td align="right">
          <Chip tone={QTY_CHIP_TONE[part.stockState]} mono>
            {formatNumber(part.total_qty)}
          </Chip>
        </Td>
      );
    case "location":
      return (
        <Td>
          <Chip tone="default" mono>
            {locationLabel(part)}
          </Chip>
        </Td>
      );
    case "description": {
      // Descriptions run long ("TH-2P Phototransistors T-1.75 450 to 1080nm
      // +/-20 deg"); clamp the column so one verbose row can't set the width
      // for the whole table. Full text on hover, and in the part drawer.
      const text = column.value(part);
      return (
        <Td className="max-w-[22ch] truncate" title={text ?? undefined}>
          {text ?? "—"}
        </Td>
      );
    }
    default:
      return (
        <Td mono={column.mono} align={column.align}>
          {column.value(part) ?? "—"}
        </Td>
      );
  }
}
