"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import {
  displayLabelForFacetValue,
  type FacetGroupName,
  type FacetGroupViewModel,
  type FacetValueCount,
} from "@/lib/inventory/filter";

export interface FacetSidebarProps {
  groups: FacetGroupViewModel[];
  isGroupOpen: (group: FacetGroupName) => boolean;
  onToggleGroupOpen: (group: FacetGroupName) => void;
  onToggleValue: (group: FacetGroupName, value: string) => void;
  onClearAll: () => void;
  hasFilters: boolean;
}

/** How many options a group shows before collapsing the rest behind "show all". */
const VISIBLE_LIMIT = 8;

/** Above this many options, the group gets its own search box. */
const SEARCHABLE_FROM = 12;

/**
 * Groups that always show every option. Category is how people actually enter
 * the catalog — you pick the kind of part first and narrow from there — so
 * hiding two thirds of it behind "Show 20 more" puts a click in front of the
 * one decision the sidebar exists to serve. It is also bounded and slow-moving
 * (28 values, one per category the importer maps), unlike Package's 315.
 */
const UNCAPPED_GROUPS: ReadonlySet<FacetGroupName> = new Set<FacetGroupName>(["Category"]);

/**
 * Desktop-only facet sidebar (tab-inventory.md §2: "Mobile: sidebar hidden —
 * facets not reachable — accepted prototype gap"). Collapsible groups, live
 * counts against the current filtered set, checkbox rows per prototype.
 *
 * Groups arrive ranked by count from `buildFacetGroups`, and most render only
 * their first few options. The real catalog has 315 distinct packages with most
 * appearing exactly once, so an uncapped list buries "0805" (211 parts) under
 * hundreds of one-off strings and makes the sidebar scroll for pages. Long
 * groups also get a search box, which is the only practical way to reach a
 * specific value in a list that long. `UNCAPPED_GROUPS` opts a group out of the
 * cap while keeping its search box.
 *
 * A selected option is always rendered even if it falls outside the visible
 * slice or the current search, so a filter you applied can never become
 * invisible while still being in force.
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
        <span className="text-[13px] tracking-[0.08em] text-smoke uppercase">Filters</span>
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
      {groups.map((group) => (
        <FacetGroup
          key={group.name}
          group={group}
          open={isGroupOpen(group.name)}
          onToggleOpen={() => onToggleGroupOpen(group.name)}
          onToggleValue={(value) => onToggleValue(group.name, value)}
        />
      ))}
    </aside>
  );
}

interface FacetGroupProps {
  group: FacetGroupViewModel;
  open: boolean;
  onToggleOpen: () => void;
  onToggleValue: (value: string) => void;
}

function FacetGroup({ group, open, onToggleOpen, onToggleValue }: FacetGroupProps) {
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");

  const searchable = group.values.length >= SEARCHABLE_FROM;
  const capped = !UNCAPPED_GROUPS.has(group.name);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matching = term
      ? group.values.filter(
          (v) => v.selected || displayLabelForFacetValue(group.name, v.value).toLowerCase().includes(term),
        )
      : group.values;

    if (!capped || showAll || matching.length <= VISIBLE_LIMIT) return { rows: matching, hidden: 0 };

    // Keep every selected option on screen even when it ranks below the cut.
    const head = matching.slice(0, VISIBLE_LIMIT);
    const selectedBelow = matching.slice(VISIBLE_LIMIT).filter((v) => v.selected);
    return { rows: [...head, ...selectedBelow], hidden: matching.length - head.length - selectedBelow.length };
  }, [group.values, group.name, query, showAll, capped]);

  return (
    <div className="border-t border-border-faint">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between px-1 py-2.5 text-left"
      >
        <span className="text-[15px] text-snow">{group.name}</span>
        <span aria-hidden className={cn("text-[12px] text-faint transition-transform", open ? "rotate-90" : "rotate-0")}>
          ▶
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-px pb-2">
          {searchable && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${group.name.toLowerCase()}…`}
              aria-label={`Search ${group.name} options`}
              className="mb-1 w-full rounded-lg border border-charcoal bg-transparent px-2 py-1.5 text-[14px] text-snow placeholder:text-faint focus:border-graphite focus:outline-none"
            />
          )}

          {visible.rows.map((v) => (
            <FacetRow key={v.value} group={group.name} value={v} onToggle={() => onToggleValue(v.value)} />
          ))}

          {visible.rows.length === 0 && <p className="px-1.5 py-1.5 text-[14px] text-faint">No match.</p>}

          {visible.hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="cursor-pointer px-1.5 py-1.5 text-left text-[14px] text-smark-orange hover:underline"
            >
              Show {visible.hidden} more
            </button>
          )}
          {capped && showAll && group.values.length > VISIBLE_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="cursor-pointer px-1.5 py-1.5 text-left text-[14px] text-smoke hover:underline"
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FacetRow({
  group,
  value,
  onToggle,
}: {
  group: FacetGroupName;
  value: FacetValueCount;
  onToggle: () => void;
}) {
  const label = displayLabelForFacetValue(group, value.value);
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-border-hairline">
      <input type="checkbox" className="sr-only" checked={value.selected} onChange={onToggle} />
      <span
        aria-hidden
        className={cn(
          "flex size-4 flex-none items-center justify-center rounded border",
          value.selected ? "border-smark-orange bg-smark-orange" : "border-graphite",
        )}
      >
        {value.selected && <span className="text-[13px] leading-none font-medium text-obsidian">✓</span>}
      </span>
      <span
        title={label}
        className={cn("min-w-0 flex-1 truncate text-[15px]", value.selected ? "text-snow" : "text-silver-mist")}
      >
        {label}
      </span>
      <span className="flex-none font-mono text-[13px] text-faint">{value.count}</span>
    </label>
  );
}
