"use client";

import { useRouter } from "next/navigation";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { TableBody, TableHead, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
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

/**
 * `attributes.sub_category` — the finer grain under Category that the real
 * stock import carries (ADC / MOSFET / LDO under IC, LCD vs OLED under
 * Display). For whole categories it is the only column that separates one row
 * from the next, which is why it earns a slot on the grid.
 */
function subCategoryLabel(part: InventoryPart): string {
  const value = part.attributes.sub_category;
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : "—";
}

function locationLabel(part: InventoryPart): string {
  const first = part.locations[0];
  if (!first) return "—";
  const base = `Shelf ${first.shelfCode} · ${first.boxName}`;
  const extra = part.locations.length - 1;
  return extra > 0 ? `${base} +${extra}` : base;
}

export interface InventoryTableProps {
  parts: InventoryPart[];
}

/**
 * The main inventory grid (tab-inventory.md §2 columns).
 *
 * Columns follow the real catalog rather than the demo one. Whole categories
 * imported from the client's stock list have no Value/V/Package at all, so
 * Description and Sub-category are what actually tell two rows apart; Status
 * and Price were near-uniform noise here ("Active" and "—" on every row) and
 * live on the part detail drawer instead, which shows both plus stock value.
 */
export function InventoryTable({ parts }: InventoryTableProps) {
  const router = useRouter();

  return (
    <TableShell minWidth={1000}>
      <TableHead>
        <Tr>
          <Th>PID</Th>
          <Th>MPN</Th>
          <Th>Description</Th>
          <Th>Value</Th>
          <Th>V</Th>
          <Th>Package</Th>
          <Th>Category</Th>
          <Th>Sub-category</Th>
          <Th align="right">Qty</Th>
          <Th>Location</Th>
        </Tr>
      </TableHead>
      <TableBody>
        {parts.map((part) => (
          <Tr
            key={part.id}
            interactive
            onClick={() => router.push(`/inventory?pid=${encodeURIComponent(part.internal_pid)}`)}
          >
            <Td mono className={cn("border-l-2", TICK_CLASS[part.stockState])}>
              {part.internal_pid}
            </Td>
            <Td mono>{part.mpn ?? "—"}</Td>
            {/* Descriptions run long ("TH-2P Phototransistors T-1.75 450 to
                1080nm +/-20 deg"); clamp the column so one verbose row can't
                set the width for the whole table, full text on hover. */}
            <Td className="max-w-[22ch] truncate" title={part.description ?? undefined}>
              {part.description ?? "—"}
            </Td>
            <Td>{part.value ?? "—"}</Td>
            <Td mono>{part.voltage ?? "—"}</Td>
            <Td mono>{part.package ?? "—"}</Td>
            <Td>{part.category ?? "—"}</Td>
            <Td className="text-smoke">{subCategoryLabel(part)}</Td>
            <Td align="right">
              <Chip tone={QTY_CHIP_TONE[part.stockState]} mono>
                {formatNumber(part.total_qty)}
              </Chip>
            </Td>
            <Td>
              <Chip tone="default" mono>
                {locationLabel(part)}
              </Chip>
            </Td>
          </Tr>
        ))}
      </TableBody>
    </TableShell>
  );
}
