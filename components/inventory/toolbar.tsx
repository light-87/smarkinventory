"use client";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import type { ActiveChip, FacetGroupName } from "@/lib/inventory/filter";

export interface InventoryToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  activeChips: ActiveChip[];
  onRemoveChip: (group: FacetGroupName, value: string) => void;
  resultCount: number;
  totalCount: number;
  exportHref: string;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/** Search field + result count + active-filter chips + CSV export (tab-inventory.md §2, R2-33). */
export function InventoryToolbar({
  search,
  onSearchChange,
  activeChips,
  onRemoveChip,
  resultCount,
  totalCount,
  exportHref,
}: InventoryToolbarProps) {
  return (
    <div className="flex-none border-b border-border-faint px-4 py-3.5 sm:px-6">
      <Input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search PID, MPN, value, manufacturer, LCSC…"
        mono
        leading={<SearchIcon />}
        className="mb-3"
        aria-label="Search inventory"
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex-none text-[13px] text-smoke">
          Showing {resultCount} of {totalCount} parts
        </span>
        {activeChips.map((chip) => (
          <Chip key={`${chip.group}:${chip.value}`} tone="soft" onRemove={() => onRemoveChip(chip.group, chip.value)}>
            {chip.label}
          </Chip>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto flex-none"
          onClick={() => {
            window.location.href = exportHref;
          }}
        >
          Export CSV ↓
        </Button>
      </div>
    </div>
  );
}
