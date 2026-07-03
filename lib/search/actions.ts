"use server";

/**
 * lib/search/actions.ts — the server-action boundary the client palette
 * (components/search/command-palette.tsx) calls on every debounced
 * keystroke. Mirrors the shape of `components/shell/actions.ts`'s
 * `resolveScanCode` (that file is auth-shell's private stub backing the
 * header's plain scan-or-type field — not imported from here; this package
 * builds its OWN version per the mission brief, which additionally falls
 * through to the full four-section palette search).
 *
 * Scan-code resolve-first (plan/tab-login-shell.md R2-34: "scan codes keep
 * resolving as before"): reuses `resolveScanCode` from `lib/scan` (the scan
 * package's read-only-exported resolution helper — see docs/OWNERSHIP.md's
 * cross-package-import table; this pairing isn't pre-listed there, the
 * mission brief calls it out explicitly, flagged for the integrator to add
 * to that table too). Uses the caller's own per-request session
 * (`lib/supabase/server`'s `createClient()`) — never the service role — so
 * an accountant gets the same read-only resolution/search everyone else does.
 */

import { createClient } from "@/lib/supabase/server";
import { resolveScanCode, type ScanResolution } from "@/lib/scan";
import { looksLikeScanCode, searchPalette, type PaletteResults } from "./queries";

export type PaletteSearchResult =
  | { kind: "scan-match"; resolution: ScanResolution }
  | { kind: "results"; results: PaletteResults };

/**
 * Scan-code shape short-circuits straight to a part/box resolution — no
 * section queries run in that case at all (mutually exclusive, not merged).
 * Anything else (including a scan-shaped code that doesn't actually resolve
 * to anything) falls through to the four-section palette search.
 */
export async function runPaletteSearch(rawQuery: string): Promise<PaletteSearchResult> {
  const supabase = await createClient();
  const query = rawQuery.trim();

  if (looksLikeScanCode(query)) {
    const resolution = await resolveScanCode(supabase, query);
    if (resolution) return { kind: "scan-match", resolution };
  }

  const results = await searchPalette(supabase, query);
  return { kind: "results", results };
}
