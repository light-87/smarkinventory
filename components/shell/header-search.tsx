"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { CameraScanner } from "@/components/scan/camera-scanner";
import { CameraIcon } from "@/components/scan/icons";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { classifyScanCode, resolveScanCode } from "@/lib/scan";
import { boxHref, partHref } from "@/lib/search";

/**
 * components/shell/header-search.tsx — the camera-scan entry point that sits
 * next to search-notifications' CommandPalette in the header row
 * (components/shell/header.tsx). Kept as its own auth-shell file rather than
 * an edit inside components/search/** — docs/OWNERSHIP.md's search-notifications
 * seam is explicit ("neither package edits the other's files"), so this
 * reaches only into `lib/scan`'s own read-only exports (resolveScanCode/
 * classifyScanCode — the scan package's, freely reusable anywhere) for the
 * resolve-first behaviour, the same one CommandPalette's own
 * `runPaletteSearch` layers on top of for the typed/pasted case.
 *
 * `partHref`/`boxHref` are imported from `lib/search` (read-only pure URL
 * builders — not an edit) so a scanned code lands on the exact same
 * destination the palette's own scan-match row already uses, rather than a
 * second, possibly-drifting copy of that routing convention. This specific
 * pairing isn't yet in OWNERSHIP.md's cross-package-import table (mirroring
 * `lib/search/actions.ts`'s own note about its lib/scan import) — flagged
 * for the integrator to add.
 *
 * A detected code that resolves to a part/box navigates straight there (the
 * dominant case — a physical barcode's decoded payload IS a code, not fuzzy
 * search text). A code that doesn't resolve surfaces a toast pointing at
 * Ctrl-K rather than reaching into CommandPalette's internal state to open
 * it prefilled — that would require a controlled-query prop CommandPalette
 * doesn't expose today, i.e. an edit on search-notifications' side.
 */
export function HeaderCameraScan() {
  const router = useRouter();
  const { push: pushToast } = useToast();
  const [open, setOpen] = useState(false);

  const handleDetect = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (classifyScanCode(trimmed) === "empty") return;
      void (async () => {
        const supabase = createClient();
        const resolution = await resolveScanCode(supabase, trimmed);
        if (!resolution) {
          pushToast({ msg: `No match for "${trimmed}" — try Ctrl-K search` });
          return;
        }
        setOpen(false);
        router.push(resolution.type === "part" ? partHref(resolution.data.part.internal_pid) : boxHref(resolution.data.box.id));
      })();
    },
    [router, pushToast],
  );

  return (
    <>
      <button
        type="button"
        aria-label="Scan with camera"
        onClick={() => setOpen(true)}
        className="flex min-h-11 min-w-11 flex-none items-center justify-center rounded-full border border-charcoal text-smoke transition-colors hover:border-slate hover:text-snow"
      >
        <span aria-hidden className="size-4 [&_svg]:size-full">
          <CameraIcon />
        </span>
      </button>
      <CameraScanner open={open} onClose={() => setOpen(false)} onDetect={handleDetect} title="Scan a code" />
    </>
  );
}
