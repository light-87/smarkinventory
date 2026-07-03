/**
 * lib/import/existing-parts.ts — shared "what's already in the catalog?"
 * lookup for the import scripts (`scripts/import-stocklist.ts`,
 * `scripts/seed-canonical-demo.ts`). Both need the same thing: read every
 * `smark_parts` identity column once, then match incoming rows against it
 * by normalized MPN → normalized LCSC PN — the SAME normalizers
 * `lib/matcher` uses for reconcile/duplicate-guard, so "this part already
 * exists" never disagrees between import time and everywhere else.
 *
 * Server-only (takes an already-constructed Supabase client — never
 * constructs one itself, so it stays usable from both a service-role script
 * context and, in principle, a server action).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeLcsc, normalizeMpn } from "@/lib/matcher";

const SELECT_PAGE_SIZE = 1000;

export interface ExistingPartIdentity {
  id: string;
  internal_pid: string;
  mpn: string | null;
  lcsc_pn: string | null;
}

/** Fetches every `smark_parts` row's identity columns, paginating past PostgREST's default page size. */
export async function fetchExistingPartIdentities(
  supabase: SupabaseClient,
  extraColumns: string[] = [],
): Promise<Record<string, unknown>[]> {
  const columns = ["id", "internal_pid", "mpn", "lcsc_pn", ...extraColumns].join(", ");
  const all: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from("smark_parts").select(columns).range(from, from + SELECT_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read existing smark_parts: ${error.message}`);
    all.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < SELECT_PAGE_SIZE) break;
    from += SELECT_PAGE_SIZE;
  }
  return all;
}

export interface IdentityMaps<T extends ExistingPartIdentity> {
  byMpn: Map<string, T>;
  byLcsc: Map<string, T>;
}

/** Indexes rows by normalized MPN and normalized LCSC PN for O(1) identity lookups. */
export function buildIdentityMaps<T extends ExistingPartIdentity>(rows: T[]): IdentityMaps<T> {
  const byMpn = new Map<string, T>();
  const byLcsc = new Map<string, T>();
  for (const row of rows) {
    if (row.mpn) byMpn.set(normalizeMpn(row.mpn), row);
    if (row.lcsc_pn) byLcsc.set(normalizeLcsc(row.lcsc_pn), row);
  }
  return { byMpn, byLcsc };
}

/** The first existing row matching by MPN, else by LCSC PN — the standard fallback order (FEATURES §14/§7). */
export function findByIdentity<T extends ExistingPartIdentity>(
  maps: IdentityMaps<T>,
  mpn: string | null,
  lcsc: string | null,
): T | undefined {
  const mpnKey = mpn ? normalizeMpn(mpn) : null;
  const lcscKey = lcsc ? normalizeLcsc(lcsc) : null;
  return (mpnKey ? maps.byMpn.get(mpnKey) : undefined) ?? (lcscKey ? maps.byLcsc.get(lcscKey) : undefined);
}
