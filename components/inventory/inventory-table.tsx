"use client";

import { useRouter } from "next/navigation";
import { Chip } from "@/components/ui/chip";
import { TableBody, TableHead, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatINR, formatNumber } from "@/lib/format";
import type { StockState } from "@/lib/inventory/stock-state";
import type { InventoryPart } from "@/lib/inventory/types";

const TICK_CLASS: Record<StockState, string> = {
  ok: "border-l-transparent",
  low: "border-l-smark-orange",
  out: "border-l-smark-orange",
};

const STATUS_LABEL: Record<string, string> = { active: "Active", nrnd: "NRND", eol: "EOL" };

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

/** The main inventory grid (tab-inventory.md §2 columns + R2-11 optional Price column). */
export function InventoryTable({ parts }: InventoryTableProps) {
  const router = useRouter();

  return (
    <TableShell minWidth={900}>
      <TableHead>
        <Tr>
          <Th>PID</Th>
          <Th>MPN</Th>
          <Th>Value</Th>
          <Th>V</Th>
          <Th>Package</Th>
          <Th>Category</Th>
          <Th align="right">Qty</Th>
          <Th>Location</Th>
          <Th>Status</Th>
          <Th align="right" className="hidden lg:table-cell">
            Price
          </Th>
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
            <Td>{part.value ?? "—"}</Td>
            <Td mono>{part.voltage ?? "—"}</Td>
            <Td mono>{part.package ?? "—"}</Td>
            <Td>{part.category ?? "—"}</Td>
            <Td align="right">
              <Chip tone={part.stockState === "ok" ? "bright" : "accent"} mono>
                {formatNumber(part.total_qty)}
              </Chip>
            </Td>
            <Td>
              <Chip tone="default" mono>
                {locationLabel(part)}
              </Chip>
            </Td>
            <Td className="text-smoke">{STATUS_LABEL[part.part_status] ?? part.part_status}</Td>
            <Td align="right" mono className="hidden lg:table-cell">
              {part.last_unit_price != null ? formatINR(part.last_unit_price, { decimals: 2 }) : "—"}
            </Td>
          </Tr>
        ))}
      </TableBody>
    </TableShell>
  );
}
