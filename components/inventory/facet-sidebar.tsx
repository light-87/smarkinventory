"use client";

import { cn } from "@/lib/cn";
import { displayLabelForFacetValue, type FacetGroupName, type FacetGroupViewModel } from "@/lib/inventory/filter";

export interface FacetSidebarProps {
  groups: FacetGroupViewModel[];
  isGroupOpen: (group: FacetGroupName) => boolean;
  onToggleGroupOpen: (group: FacetGroupName) => void;
  onToggleValue: (group: FacetGroupName, value: string) => void;
  onClearAll: () => void;
  hasFilters: boolean;
}

/**
 * Desktop-only facet sidebar (tab-inventory.md §2: "Mobile: sidebar hidden —
 * facets not reachable — accepted prototype gap"). Collapsible groups, live
 * counts against the current filtered set, checkbox rows per prototype.
 */
export function FacetSidebar({
  groups,
  isGroupOpen,
  onToggleGroupOpen,
  onToggleValue,
  onClearAll,
  hasFilters,
}: FacetSidebarProps) {
  return (
    <aside className="hidden w-[250px] flex-none overflow-y-auto border-r border-charcoal px-3.5 py-4 lg:block">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[11px] tracking-[0.08em] text-smoke uppercase">Filters</span>
        {hasFilters && (
          <button
            type="button"
            onClick={onClearAll}
            className="cursor-pointer text-xs text-smark-orange hover:underline"
          >
            Clear all
          </button>
        )}
      </div>
      {groups.map((group) => {
        const open = isGroupOpen(group.name);
        return (
          <div key={group.name} className="border-t border-border-faint">
            <button
              type="button"
              onClick={() => onToggleGroupOpen(group.name)}
              aria-expanded={open}
              className="flex w-full cursor-pointer items-center justify-between px-1 py-2.5 text-left"
            >
              <span className="text-[13px] text-snow">{group.name}</span>
              <span
                aria-hidden
                className={cn(
                  "text-[10px] text-faint transition-transform",
                  open ? "rotate-90" : "rotate-0",
                )}
              >
                ▶
              </span>
            </button>
            {open && (
              <div className="flex flex-col gap-px pb-2">
                {group.values.map((v) => (
                  <label
                    key={v.value}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-border-hairline"
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={v.selected}
                      onChange={() => onToggleValue(group.name, v.value)}
                    />
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-4 flex-none items-center justify-center rounded border",
                        v.selected ? "border-smark-orange bg-smark-orange" : "border-graphite",
                      )}
                    >
                      {v.selected && <span className="text-[11px] leading-none font-medium text-obsidian">✓</span>}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[13px]",
                        v.selected ? "text-snow" : "text-silver-mist",
                      )}
                    >
                      {displayLabelForFacetValue(group.name, v.value)}
                    </span>
                    <span className="flex-none font-mono text-[11px] text-faint">{v.count}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}
