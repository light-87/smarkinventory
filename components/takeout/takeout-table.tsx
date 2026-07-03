"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { TableBody, TableHead, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { ResolvedTakeoutLine } from "@/lib/takeout/types";

export interface TakeoutTableProps {
  lines: readonly ResolvedTakeoutLine[];
  checked: Readonly<Record<string, boolean>>;
  onToggle: (key: string) => void;
  onFinish: () => void;
  finishing: boolean;
}

/** "Manual add" deep-link hint for the smart cart (cart-orders owns the actual add-to-cart UI — plan/tab-bulk-pick.md "deep-link /cart with a manual-add hint"). */
function toOrderHref(line: ResolvedTakeoutLine): string {
  const params = new URLSearchParams({ addManual: "1", qty: String(line.pickQty) });
  if (line.references) params.set("ref", line.references);
  if (line.value) params.set("value", line.value);
  return `/cart?${params.toString()}`;
}

function TakeoutCheckbox({ checked, onClick }: { checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      aria-label={checked ? "Mark as not picked" : "Mark as picked"}
      className={cn(
        "flex size-[18px] flex-none items-center justify-center rounded-[5px] border transition-colors",
        checked ? "border-smark-orange bg-smark-orange" : "border-graphite bg-transparent hover:border-smoke",
      )}
    >
      {checked && (
        <span aria-hidden className="text-[11px] font-medium text-obsidian">
          ✓
        </span>
      )}
    </button>
  );
}

/** Progress bar + lines table + Finish button — the "loaded" half of Bulk takeout (plan/tab-bulk-pick.md §2). */
export function TakeoutTable({ lines, checked, onToggle, onFinish, finishing }: TakeoutTableProps) {
  const inStockLines = lines.filter((line) => line.matchState === "in_stock");
  const done = inStockLines.filter((line) => checked[line.key]).length;
  const total = inStockLines.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const anyChecked = done > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-well">
          <div className="h-full rounded-full bg-smark-orange transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <span className="flex-none font-mono text-[13px] text-snow">
          {done} of {total} picked
        </span>
      </div>

      <TableShell minWidth={640}>
        <TableHead>
          <tr>
            <Th style={{ width: 40 }} aria-label="Picked" />
            <Th>Reference</Th>
            <Th align="right">Pick</Th>
            <Th>Value</Th>
            <Th>Location</Th>
          </tr>
        </TableHead>
        <TableBody>
          {lines.map((line) => {
            const isChecked = line.matchState === "in_stock" && Boolean(checked[line.key]);
            return (
              <Tr key={line.key} className={isChecked ? "opacity-50" : undefined}>
                <Td>
                  {line.matchState === "in_stock" && (
                    <TakeoutCheckbox checked={isChecked} onClick={() => onToggle(line.key)} />
                  )}
                </Td>
                <Td mono className="whitespace-nowrap">
                  {line.references ?? "—"}
                </Td>
                <Td align="right" mono>
                  {line.pickQty.toLocaleString("en-IN")}
                </Td>
                <Td className="whitespace-nowrap">{line.value ?? "—"}</Td>
                <Td>
                  {line.matchState === "in_stock" && line.location ? (
                    <Chip tone="default" mono>
                      {line.location.label}
                    </Chip>
                  ) : (
                    <Link href={toOrderHref(line)}>
                      <Chip tone="accent" className="cursor-pointer hover:bg-surface-accent-hover">
                        To order →
                      </Chip>
                    </Link>
                  )}
                </Td>
              </Tr>
            );
          })}
        </TableBody>
      </TableShell>

      <Button size="xl" onClick={onFinish} loading={finishing} disabled={!anyChecked} className="self-start">
        Finish takeout
      </Button>
    </div>
  );
}
