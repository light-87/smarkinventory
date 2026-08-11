/**
 * lib/inventory/canonical-package.ts — one physical package, one facet option.
 *
 * Split out of `filter.ts` so `facet-registry.ts` can use it without the two
 * modules importing each other (filter.ts reads the registry).
 *
 * The client's sheet writes the same package several ways, and untreated each
 * spelling became its own checkbox — so ticking "0603 (1608 Metric)" (157 parts)
 * silently missed the 13 filed under "603", and SMA was split four ways across
 * "SMA", "SMA (DO-214AC)", "SMA(DO-214AC)" and "SMA(DO241AC)". 31 sizes were
 * split like this. A filter that quietly hides matching stock is worse than no
 * filter.
 *
 * Deliberately a pure function of one string, not of the catalog: the value ends
 * up in the URL, so it must not shift when the data changes. A recognised
 * imperial chip size becomes its bare code ("0603"); everything else keeps its
 * own text with any parenthetical restatement removed. Case-only variants
 * ("8x16mm" vs "8X16mm") are left alone — folding case would turn LCSC-style
 * names into mush for the sake of one pair.
 */

import { packageKey } from "@/lib/matcher";

export function canonicalPackage(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;

  const key = packageKey(raw);
  if (/^\d{4}$/.test(key)) return key;

  const stripped = raw.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
  return stripped === "" ? raw.trim() : stripped;
}
