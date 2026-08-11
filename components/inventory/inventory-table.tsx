"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
/**
 * Rows put into the DOM before the reader has scrolled anywhere.
 *
 * The unfiltered catalog is 1,745 parts and every row is ~10 cells, so
 * rendering the lot is ~17,000 elements built on the main thread before the
 * page can respond — the client's "takes too long to load anything"
 * (2026-08-11). Nothing below the fold is worth that: the rest is appended as
 * it is scrolled towards, which is invisible in use and takes first paint back
 * to a fixed, small cost no matter how big the catalog grows.
 */
const INITIAL_ROWS = 60;
const ROWS_PER_STEP = 120;
/** How close to the bottom counts as "about to need more rows". */
const GROW_MARGIN_PX = 800;
/** How long a row click stays ignored after "Show more" moved the page under the cursor. */
const GROW_CLICK_GUARD_MS = 600;

/** Nearest ancestor that actually scrolls — the element whose scroll position drives growth. */
function scrollParentOf(node: HTMLElement | null): HTMLElement | null {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el;
  }
  return null;
}

export function InventoryTable({ parts, selectedCategories }: InventoryTableProps) {
  const router = useRouter();
  const columns = useMemo(() => visibleColumns(parts, selectedCategories), [parts, selectedCategories]);
  const minWidth = useMemo(() => minWidthFor(columns), [columns]);

  const [renderCount, setRenderCount] = useState(INITIAL_ROWS);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  /**
   * When "Show more" last inserted rows.
   *
   * Pressing it drops 120 rows in ABOVE the button, so the button leaps down a
   * few thousand pixels and a part row lands exactly where the cursor still is.
   * A second click — and people do click twice when they think the first didn't
   * take — then opens a part they never chose. Row clicks are ignored for a
   * moment afterwards so the pointer can't be ambushed by content that moved
   * under it. Scroll-driven growth needs no guard: it appends below, nothing
   * shifts beneath the cursor.
   */
  const grewAtRef = useRef(0);
  const growBy = (step: number) => {
    grewAtRef.current = performance.now();
    setRenderCount((current) => Math.min(current + step, parts.length));
  };

  // A new filter or search term is a new list — start from the top again,
  // otherwise narrowing to 3 parts would still be carrying a 900-row window.
  // Adjusted during render rather than in an effect (the React-recommended
  // shape for "reset state when a prop changes"): an effect would paint the
  // long window once and then immediately re-render.
  const [renderedFor, setRenderedFor] = useState(parts);
  if (renderedFor !== parts) {
    setRenderedFor(parts);
    setRenderCount(INITIAL_ROWS);
  }

  useEffect(() => {
    if (renderCount >= parts.length) return;
    const scroller = scrollParentOf(sentinelRef.current);
    if (!scroller) return;

    // Grown from the scroll position rather than an IntersectionObserver: the
    // observer never delivers in a background tab, and a list that silently
    // refuses to grow past 60 is worse than one that grows a fraction early.
    // The margin means the next slice lands before the bottom is reached.
    const onScroll = () => {
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - GROW_MARGIN_PX) {
        setRenderCount((current) => Math.min(current + ROWS_PER_STEP, parts.length));
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [renderCount, parts.length]);

  const visibleParts = renderCount >= parts.length ? parts : parts.slice(0, renderCount);

  return (
    <>
    <TableShell minWidth={minWidth}>
      <TableHead>
        <Tr>
          {columns.map((column, index) => (
            <Th key={column.id} align={column.align} className={index === 0 ? STICKY_HEAD_CLASS : undefined}>
              {column.label}
            </Th>
          ))}
        </Tr>
      </TableHead>
      <TableBody>
        {visibleParts.map((part) => (
          <Tr
            key={part.id}
            interactive
            className="group"
            onClick={() => {
              if (performance.now() - grewAtRef.current < GROW_CLICK_GUARD_MS) return;
              router.push(`/inventory?pid=${encodeURIComponent(part.internal_pid)}`);
            }}
          >
            {columns.map((column) => (
              <Cell key={column.id} column={column} part={part} />
            ))}
          </Tr>
        ))}
      </TableBody>
    </TableShell>
    {/* Outside the horizontal scroller, so it stays put while the grid scrolls. */}
    <div ref={sentinelRef} aria-hidden className="h-px" />
    {renderCount < parts.length && (
      // Pinned to the bottom of the scroller, NOT parked after the last row.
      //
      // A button that sits below the rows cannot be clicked: scrolling far
      // enough to reach it is exactly what appends the next slice, which shoves
      // it another few thousand pixels down. It runs away from the pointer, and
      // the click lands on whichever part row took its place. Sticky, it stays
      // under the cursor and holds still.
      //
      // Scrolling is the ordinary way to see more, so this offers only the one
      // thing scrolling cannot do — jump to the whole list at once. It also
      // guarantees a way forward when the list is too short to scroll at all.
      <div
        role="status"
        className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-border-divider bg-surface/95 px-3.5 py-2.5 backdrop-blur-sm"
      >
        <span className="text-caption text-smoke">
          Showing {formatNumber(renderCount)} of {formatNumber(parts.length)} — scroll for more
        </span>
        <button
          type="button"
          onClick={() => growBy(parts.length)}
          className="cursor-pointer rounded-full border border-border-divider px-3 py-1 text-caption text-silver-mist transition-colors hover:bg-surface-raised hover:text-snow"
        >
          Show all {formatNumber(parts.length)}
        </button>
      </div>
    )}
    </>
  );
}

/**
 * The first column stays put while the rest scrolls sideways.
 *
 * The grid is wider than a laptop (client report, 2026-08-11: "Many things are
 * clipped on a smaller desktop or laptop"), so reading a package or a quantity
 * means scrolling right — and without this, the PID that says WHICH part you
 * are reading scrolls away first. `z-[3]` puts the header's own corner cell
 * above the sticky body cells and the sticky header row (`z-[2]`) both.
 *
 * The background is repeated on the cell because a sticky cell paints over the
 * columns passing underneath it: transparent would let them show through.
 */
const STICKY_HEAD_CLASS = "sticky left-0 z-[3] bg-canvas";
const STICKY_CELL_CLASS = "sticky left-0 z-[1] bg-surface group-hover:bg-ash";

function Cell({ column, part }: { column: InventoryColumn; part: InventoryPart }) {
  switch (column.render) {
    case "pid":
      return (
        <Td mono className={cn("border-l-2", TICK_CLASS[part.stockState], STICKY_CELL_CLASS)}>
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
