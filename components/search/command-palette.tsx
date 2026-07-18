"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Chip } from "@/components/ui/chip";
import type { ScanResolution } from "@/lib/scan";
import {
  bomHref,
  boxHref,
  orderHref,
  partHref,
  projectHref,
  runPaletteSearch,
  type PaletteBomHit,
  type PaletteOrderHit,
  type PalettePartHit,
  type PaletteProjectHit,
  type PaletteResults,
} from "@/lib/search";
import { ArrowRightIcon, BomResultIcon, OrderResultIcon, PartResultIcon, ProjectResultIcon, ScanIcon, SearchIcon } from "./icons";

export interface CommandPaletteProps {
  /** Applied to the header-slot trigger's wrapper. */
  className?: string;
  /** Renders no visible trigger; the global Ctrl-K listener + modal still work. See this
   * package's report for when to use this vs. the default trigger. */
  hideTrigger?: boolean;
}

const DEBOUNCE_MS = 250;

interface FlatItem {
  key: string;
  href: string;
  sectionLabel?: string;
  content: ReactNode;
}

/**
 * components/search/command-palette.tsx — the Ctrl-K global command palette
 * (FEATURES.md §5 header spec; plan/tab-login-shell.md R2-34).
 *
 * Two ways in: (1) Ctrl-K / Cmd-K from anywhere in the app (global listener,
 * always attached regardless of `hideTrigger`), (2) clicking the header-slot
 * trigger this component also renders (unless `hideTrigger`). Scan-code
 * resolve-first: every keystroke's debounced search first tries an exact
 * PID/box-code resolution (`lib/scan`'s `resolveScanCode`, via
 * `lib/search/actions.ts`'s `runPaletteSearch`) and, on a hit, shows ONLY a
 * single "Jump to…" row — no section search runs in that case. Anything else
 * shows the four-section palette (Parts · Projects · BOMs · Orders).
 *
 * Rendered directly by `components/shell/header.tsx`'s search slot.
 */
export function CommandPalette({ className, hideTrigger = false }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scanMatch, setScanMatch] = useState<ScanResolution | null>(null);
  const [results, setResults] = useState<PaletteResults | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, startTransition] = useTransition();

  // Ctrl-K / Cmd-K opens the palette from anywhere — attached unconditionally,
  // independent of whether a visible trigger is rendered (`hideTrigger`).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    // `main` (id="app-scroll-region", components/shell/app-shell.tsx) is the
    // element that actually scrolls, not `document.body`.
    const scrollEl = document.getElementById("app-scroll-region") ?? document.body;
    const previousOverflow = scrollEl.style.overflow;
    scrollEl.style.overflow = "hidden";
    return () => {
      scrollEl.style.overflow = previousOverflow;
    };
  }, [open]);

  // Debounced search — a stale in-flight response (superseded by a later
  // keystroke) is dropped via the requestId check rather than applied. State
  // resets are wrapped in a named function (not called inline at the effect
  // body's top level) so a synchronous reset doesn't trip react-hooks'
  // set-state-in-effect rule.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();

    function clearSearch() {
      setScanMatch(null);
      setResults(null);
    }

    if (trimmed === "") {
      clearSearch();
      return;
    }
    const requestId = (requestIdRef.current += 1);
    const timer = setTimeout(() => {
      startTransition(async () => {
        const outcome = await runPaletteSearch(trimmed);
        if (requestIdRef.current !== requestId) return;
        if (outcome.kind === "scan-match") {
          setScanMatch(outcome.resolution);
          setResults(null);
        } else {
          setScanMatch(null);
          setResults(outcome.results);
        }
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open]);

  useEffect(() => {
    function resetActiveIndex() {
      setActiveIndex(0);
    }
    resetActiveIndex();
  }, [scanMatch, results]);

  function close() {
    setOpen(false);
    setQuery("");
    setScanMatch(null);
    setResults(null);
    setActiveIndex(0);
  }

  function activate(item: FlatItem) {
    router.push(item.href);
    close();
  }

  const flatItems = useMemo<FlatItem[]>(() => {
    if (scanMatch) {
      return [
        {
          key: "scan-match",
          href: hrefForScanMatch(scanMatch),
          sectionLabel: "Go to",
          content: <ScanMatchRow resolution={scanMatch} />,
        },
      ];
    }
    if (!results) return [];

    const items: FlatItem[] = [];
    results.parts.forEach((part, i) =>
      items.push({
        key: `part-${part.id}`,
        href: partHref(part.internal_pid),
        sectionLabel: i === 0 ? "Parts" : undefined,
        content: <PartRow part={part} />,
      }),
    );
    results.projects.forEach((project, i) =>
      items.push({
        key: `project-${project.id}`,
        href: projectHref(project.id),
        sectionLabel: i === 0 ? "Projects" : undefined,
        content: <ProjectRow project={project} />,
      }),
    );
    results.boms.forEach((bom, i) =>
      items.push({
        key: `bom-${bom.id}`,
        href: bomHref(bom.project_id, bom.id),
        sectionLabel: i === 0 ? "BOMs" : undefined,
        content: <BomRow bom={bom} />,
      }),
    );
    results.orders.forEach((order, i) =>
      items.push({
        key: `order-${order.id}`,
        href: orderHref(order.id),
        sectionLabel: i === 0 ? "Orders" : undefined,
        content: <OrderRow order={order} />,
      }),
    );
    return items;
  }, [scanMatch, results]);

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[activeIndex];
      if (item) activate(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  const trimmedQuery = query.trim();
  const showHint = trimmedQuery.length < 2 && !scanMatch;
  const showEmpty = !showHint && !scanMatch && results !== null && flatItems.length === 0 && !pending;

  return (
    <>
      {!hideTrigger && (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cn(
              "hidden h-10 min-w-0 items-center gap-2 rounded-lg border border-charcoal bg-surface-well px-3.5 text-left text-sm text-smoke transition-colors hover:border-slate md:flex",
              className,
            )}
          >
            <span aria-hidden className="size-4 flex-none [&_svg]:size-full">
              <SearchIcon />
            </span>
            <span className="min-w-0 flex-1 truncate">Search or scan…</span>
            <Chip tone="soft" size="sm" mono className="flex-none">
              Ctrl K
            </Chip>
          </button>

          <button
            type="button"
            aria-label="Search"
            onClick={() => setOpen(true)}
            className="flex min-h-11 min-w-11 flex-none items-center justify-center rounded-full border border-charcoal text-smoke md:hidden"
          >
            <span aria-hidden className="size-4 [&_svg]:size-full">
              <SearchIcon />
            </span>
          </button>
        </>
      )}

      {open && (
        <>
          <div aria-hidden onClick={close} className="animate-fade-in fixed inset-0 z-[70] bg-[#1d2130]/40" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="fixed inset-x-4 top-[10vh] z-[71] mx-auto max-w-[560px] overflow-hidden rounded-2xl border border-charcoal bg-surface-raised shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b border-charcoal px-4 py-3">
              <span aria-hidden className="size-[18px] flex-none text-smoke [&_svg]:size-full">
                <SearchIcon />
              </span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search parts, projects, BOMs, orders — or scan a code…"
                className="min-w-0 flex-1 bg-transparent text-sm text-snow caret-smark-orange outline-none placeholder:text-smoke"
              />
              <button
                type="button"
                aria-label="Close search"
                onClick={close}
                className="flex-none text-[13px] text-faint hover:text-smoke"
              >
                Esc
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-2">
              {showHint && (
                <p className="px-3 py-6 text-center text-[15px] text-smoke">
                  Type at least 2 characters — or scan/type a full PID or box code to jump straight there.
                </p>
              )}
              {pending && !showHint && flatItems.length === 0 && (
                <p className="px-3 py-6 text-center text-[15px] text-smoke">Searching…</p>
              )}
              {showEmpty && <p className="px-3 py-6 text-center text-[15px] text-smoke">No matches for “{trimmedQuery}”</p>}

              {flatItems.map((item, index) => (
                <Fragment key={item.key}>
                  {item.sectionLabel && (
                    <div className="px-3 pt-3 pb-1 text-[13px] tracking-[0.06em] text-smoke uppercase">{item.sectionLabel}</div>
                  )}
                  <button
                    type="button"
                    onClick={() => activate(item)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                      index === activeIndex ? "bg-ash" : "hover:bg-ash/60",
                    )}
                  >
                    {item.content}
                  </button>
                </Fragment>
              ))}
            </div>

            <div className="border-t border-charcoal px-4 py-2 text-[13px] text-faint">↑↓ Navigate · ↵ Open · Esc Close</div>
          </div>
        </>
      )}
    </>
  );
}

function hrefForScanMatch(resolution: ScanResolution): string {
  return resolution.type === "part" ? partHref(resolution.data.part.internal_pid) : boxHref(resolution.data.box.id);
}

function ScanMatchRow({ resolution }: { resolution: ScanResolution }) {
  const isPart = resolution.type === "part";
  const label = isPart ? `Jump to part ${resolution.data.part.internal_pid}` : `Jump to box ${resolution.data.box.name}`;
  const meta = isPart
    ? [resolution.data.part.mpn, resolution.data.part.value, resolution.data.part.package].filter(Boolean).join(" · ")
    : (resolution.data.shelf ? `Shelf ${resolution.data.shelf.code}` : null);

  return (
    <>
      <span aria-hidden className="size-4 flex-none text-smark-orange [&_svg]:size-full">
        <ScanIcon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[15px] text-snow">{label}</span>
        {meta && <span className="block truncate text-[14px] text-smoke">{meta}</span>}
      </span>
      <span aria-hidden className="size-4 flex-none text-smoke [&_svg]:size-full">
        <ArrowRightIcon />
      </span>
    </>
  );
}

function PartRow({ part }: { part: PalettePartHit }) {
  const meta = [part.mpn, part.value, part.package].filter(Boolean).join(" · ");
  return (
    <>
      <span aria-hidden className="size-4 flex-none text-smoke [&_svg]:size-full">
        <PartResultIcon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[15px] text-snow">{part.internal_pid}</span>
        {meta && <span className="block truncate text-[14px] text-smoke">{meta}</span>}
      </span>
      <Chip tone={part.total_qty > 0 ? "neutral" : "accent"} size="sm" mono className="flex-none">
        {part.total_qty}
      </Chip>
    </>
  );
}

function ProjectRow({ project }: { project: PaletteProjectHit }) {
  return (
    <>
      <span aria-hidden className="size-4 flex-none text-smoke [&_svg]:size-full">
        <ProjectResultIcon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] text-snow">{project.name}</span>
        {project.client && <span className="block truncate text-[14px] text-smoke">{project.client}</span>}
      </span>
      {project.archived_at && (
        <Chip tone="default" size="sm" className="flex-none">
          Archived
        </Chip>
      )}
    </>
  );
}

function BomRow({ bom }: { bom: PaletteBomHit }) {
  return (
    <>
      <span aria-hidden className="size-4 flex-none text-smoke [&_svg]:size-full">
        <BomResultIcon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] text-snow">{bom.name}</span>
        {bom.project_name && <span className="block truncate text-[14px] text-smoke">in {bom.project_name}</span>}
      </span>
    </>
  );
}

function OrderRow({ order }: { order: PaletteOrderHit }) {
  return (
    <>
      <span aria-hidden className="size-4 flex-none text-smoke [&_svg]:size-full">
        <OrderResultIcon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[15px] text-snow">{order.po_number}</span>
        {order.distributor_name && <span className="block truncate text-[14px] text-smoke">{order.distributor_name}</span>}
      </span>
      <Chip tone="neutral" size="sm" className="flex-none">
        {order.status}
      </Chip>
    </>
  );
}
