"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CameraScanner } from "@/components/scan/camera-scanner";
import { CameraIcon } from "@/components/scan/icons";
import { Chip } from "@/components/ui/chip";
import {
  bomHref,
  boxHref,
  isEmptyPaletteResults,
  orderHref,
  partHref,
  projectHref,
  runPaletteSearch,
  type PaletteResults,
} from "@/lib/search";

/**
 * components/shell/header-search.tsx — the camera-scan entry point that sits
 * next to search-notifications' CommandPalette in the header row
 * (components/shell/header.tsx). Kept as its own auth-shell file rather than
 * an edit inside components/search/** — docs/OWNERSHIP.md's search-notifications
 * seam is explicit ("neither package edits the other's files").
 *
 * onDetect runs the field's EXACT existing resolve logic by calling
 * `runPaletteSearch` (lib/search/actions.ts) directly — the very same server
 * action CommandPalette's own Enter/debounced-search path calls, not a
 * reimplementation of it. A scan-code match routes straight to the part/box
 * (`partHref`/`boxHref`, so the destination matches the palette's own
 * scan-match row exactly); anything else renders the same four-section
 * results (Parts/Projects/BOMs/Orders) the palette would show for that text,
 * in a compact panel local to this file. `lib/search`'s exports used here are
 * all pure/read-only (hrefs, the search action, its result types) — not an
 * edit — but this pairing isn't yet in OWNERSHIP.md's cross-package-import
 * table (mirroring `lib/search/actions.ts`'s own note about its lib/scan
 * import) — flagged for the integrator to add.
 */

interface ResultRow {
  key: string;
  href: string;
  type: string;
  label: string;
  meta: string | null;
}

function flattenResults(results: PaletteResults): ResultRow[] {
  return [
    ...results.parts.map((p) => ({
      key: `part-${p.id}`,
      href: partHref(p.internal_pid),
      type: "Part",
      label: p.internal_pid,
      meta: [p.mpn, p.value, p.package].filter(Boolean).join(" · ") || null,
    })),
    ...results.projects.map((p) => ({
      key: `project-${p.id}`,
      href: projectHref(p.id),
      type: "Project",
      label: p.name,
      meta: p.client,
    })),
    ...results.boms.map((b) => ({
      key: `bom-${b.id}`,
      href: bomHref(b.project_id, b.id),
      type: "BOM",
      label: b.name,
      meta: b.project_name ? `in ${b.project_name}` : null,
    })),
    ...results.orders.map((o) => ({
      key: `order-${o.id}`,
      href: orderHref(o.id),
      type: "Order",
      label: o.po_number,
      meta: o.distributor_name,
    })),
  ];
}

export function HeaderCameraScan() {
  const router = useRouter();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PaletteResults | null>(null);

  const closeResults = useCallback(() => {
    setResults(null);
    setQuery("");
  }, []);

  const handleDetect = useCallback((code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    void (async () => {
      const outcome = await runPaletteSearch(trimmed);
      if (outcome.kind === "scan-match") {
        const resolution = outcome.resolution;
        router.push(
          resolution.type === "part" ? partHref(resolution.data.part.internal_pid) : boxHref(resolution.data.box.id),
        );
        return;
      }
      setQuery(trimmed);
      setResults(outcome.results);
    })();
  }, [router]);

  const rows = results ? flattenResults(results) : [];

  return (
    <>
      <button
        type="button"
        aria-label="Scan with camera"
        onClick={() => setCameraOpen(true)}
        className="flex min-h-11 min-w-11 flex-none items-center justify-center rounded-full border border-charcoal text-smoke transition-colors hover:border-slate hover:text-snow"
      >
        <span aria-hidden className="size-4 [&_svg]:size-full">
          <CameraIcon />
        </span>
      </button>

      <CameraScanner open={cameraOpen} onClose={() => setCameraOpen(false)} onDetect={handleDetect} title="Scan a code" />

      {results && createPortal(
        <>
          <div aria-hidden onClick={closeResults} className="animate-fade-in fixed inset-0 z-[70] bg-[#1d2130]/40" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Scan results"
            className="fixed inset-x-4 top-[10vh] z-[71] mx-auto max-w-[480px] overflow-hidden rounded-2xl border border-charcoal bg-surface-raised shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-charcoal px-4 py-3">
              <span className="min-w-0 flex-1 truncate text-[15px] text-smoke">
                Results for <span className="font-mono text-snow">{query}</span>
              </span>
              <button
                type="button"
                aria-label="Close results"
                onClick={closeResults}
                className="flex-none text-[13px] text-faint hover:text-smoke"
              >
                Close
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {isEmptyPaletteResults(results) ? (
                <p className="px-3 py-6 text-center text-[15px] text-smoke">No matches for &ldquo;{query}&rdquo;</p>
              ) : (
                rows.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => {
                      router.push(row.href);
                      closeResults();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-ash/60"
                  >
                    <Chip tone="neutral" size="sm" className="flex-none">
                      {row.type}
                    </Chip>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] text-snow">{row.label}</span>
                      {row.meta && <span className="block truncate text-[14px] text-smoke">{row.meta}</span>}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
