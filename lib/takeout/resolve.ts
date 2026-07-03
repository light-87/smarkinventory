/**
 * lib/takeout/resolve.ts — pure resolution logic for Bulk takeout
 * (plan/tab-bulk-pick.md · FEATURES.md §7 standard search ladder).
 *
 * Two-step pipeline, both steps pure/no-I/O so they're directly unit
 * testable without a database:
 *   1. `matchAgainstCatalog` — runs every non-DNP, qty>0 line through
 *      `lib/matcher` (the SAME ladder BOM reconcile and the Receive
 *      duplicate guard use — CROSS-FEATURE "one matcher, three consumers").
 *   2. `buildResolvedLines` — turns each match into a table row: pick
 *      quantity (× build multiplier, R2-27), in-stock vs to-order, and the
 *      physical location chip.
 * `resolveTakeoutLines` composes both for callers (unit tests, the ad-hoc
 * server action) that already have the full catalog + location map in hand.
 */

import { matchPart, type MatchCatalogEntry, type MatchResult } from "@/lib/matcher";
import type { ResolvedTakeoutLine, TakeoutLocationLabel, TakeoutRawLine } from "./types";

/** Slim `smark_parts` projection the matcher + resolver need. */
export interface TakeoutCatalogPart extends MatchCatalogEntry {
  id: string;
  internal_pid: string;
  total_qty: number;
}

/** A `smark_stock_locations` row already joined out to shelf code + box name. */
export interface TakeoutLocationRow {
  id: string;
  partId: string;
  bigBoxId: string;
  qty: number;
  boxName: string;
  shelfCode: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Footprint → package (BOM lines never carry a clean `package` column)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Package names that are themselves an integral, hyphen/underscore-laced token (matched as a substring — these are distinctive enough that a false positive is very unlikely). */
const NAMED_PACKAGE_PATTERNS: readonly RegExp[] = [
  /SOT[-_]?23(?:[-_]?\d+)?/i,
  /SOIC[-_]?\d+/i,
  /TSSOP[-_]?\d+/i,
  /MSOP[-_]?\d+/i,
  /QFN[-_]?\d+/i,
  /LQFP[-_]?\d+/i,
  /DFN[-_]?\d+/i,
  /BGA[-_]?\d+/i,
  /DIP[-_]?\d+/i,
  /TO[-_]?\d+/i,
];

/** Bare metric package codes (KiCad convention: a standalone `_`-delimited token, e.g. `C_0603_1608Metric` — matched as an exact TOKEN, not a substring, so it never fires inside an unrelated number like a footprint's metric-equivalent suffix. */
const METRIC_PACKAGE_TOKENS = new Set(["0201", "0402", "0603", "0805", "1206", "1210", "1806", "1812", "2010", "2512"]);

/**
 * Best-effort package extraction from a raw KiCad-style footprint string
 * (`"Capacitor_SMD:C_0603_1608Metric"` → `"0603"`) — the matcher's
 * mandatory-package rung (lib/matcher rung 4, CROSS-FEATURE A3) needs
 * SOMETHING to compare before it can even attempt a value+package match, and
 * BOM lines only ever carry `footprint`, not a clean `package`. Deliberately
 * conservative: an unrecognized footprint returns `null` rather than feeding
 * the matcher a token that could never legitimately equal a catalog package
 * — `matchPart` then correctly falls through to "unresolved" instead of a
 * false positive.
 */
export function derivePackageFromFootprint(footprint: string | null | undefined): string | null {
  if (!footprint) return null;
  const afterLibraryPrefix = footprint.includes(":") ? footprint.slice(footprint.lastIndexOf(":") + 1) : footprint;

  for (const pattern of NAMED_PACKAGE_PATTERNS) {
    const match = pattern.exec(afterLibraryPrefix);
    if (match) return match[0];
  }

  const tokens = afterLibraryPrefix.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return tokens.find((token) => METRIC_PACKAGE_TOKENS.has(token)) ?? null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Location chip
 * ──────────────────────────────────────────────────────────────────────────── */

/** "Shelf B · Capacitors 0603" — same convention as Inventory/Part-detail's location chip. */
function formatLocationLabel(shelfCode: string, boxName: string): string {
  return `Shelf ${shelfCode} · ${boxName}`;
}

/** Draws down the biggest-qty home first when a part has more than one (the reel + working-box case). */
function pickBestLocation(locations: readonly TakeoutLocationRow[]): TakeoutLocationRow | null {
  if (locations.length === 0) return null;
  return locations.reduce((best, loc) => (loc.qty > best.qty ? loc : best), locations[0]!);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pick-quantity math [R2-27] — the ONE place `qty × build multiplier` happens,
 * reused by the initial server-side resolve AND the client's live ×N recompute.
 * ──────────────────────────────────────────────────────────────────────────── */

export function computePickQty(rawQty: number | null | undefined, multiplier: number): number {
  const safeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? Math.floor(multiplier) : 1;
  return Math.max(0, rawQty ?? 0) * safeMultiplier;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Step 1 — match
 * ──────────────────────────────────────────────────────────────────────────── */

export interface MatchedTakeoutLine {
  raw: TakeoutRawLine;
  hit: MatchResult<TakeoutCatalogPart> | null;
}

/**
 * Resolves every pickable line (not DNP, qty > 0 — DNP/zero-qty lines are
 * dropped entirely here: there's nothing to physically pick) against the
 * catalog. Pure, no I/O — pass in whatever catalog slice the caller already
 * fetched (lib/takeout/queries.ts at the real call site).
 */
export function matchAgainstCatalog(
  rawLines: readonly TakeoutRawLine[],
  catalog: readonly TakeoutCatalogPart[],
): MatchedTakeoutLine[] {
  return rawLines
    .filter((line) => !line.dnp && (line.qty ?? 0) > 0)
    .map((raw) => ({
      raw,
      hit: matchPart(
        { mpn: raw.mpn, lcsc_pn: raw.lcscPn, value: raw.value, package: derivePackageFromFootprint(raw.footprint) },
        catalog,
      ),
    }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Step 2 — pick quantity + location chip
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A line is only ever "in stock" (checkable, location chip) when it BOTH
 * matched a catalog part AND that part currently has qty > 0 somewhere — a
 * matched-but-empty part has nothing to pick and shows the same "To order →"
 * chip as an unmatched line (FEATURES.md §5.6 "orange chip for misses").
 */
export function buildResolvedLines(
  matched: readonly MatchedTakeoutLine[],
  multiplier: number,
  locationsByPartId: ReadonlyMap<string, readonly TakeoutLocationRow[]>,
): ResolvedTakeoutLine[] {
  return matched.map(({ raw, hit }, index) => {
    const pickQty = computePickQty(raw.qty, multiplier);
    const locations = hit ? (locationsByPartId.get(hit.part.id) ?? []) : [];
    const best = pickBestLocation(locations);
    const inStock = Boolean(hit) && Boolean(best) && best!.qty > 0;

    const location: TakeoutLocationLabel | null = inStock
      ? {
          locationId: best!.id,
          bigBoxId: best!.bigBoxId,
          partId: best!.partId,
          qty: best!.qty,
          label: formatLocationLabel(best!.shelfCode, best!.boxName),
        }
      : null;

    return {
      key: raw.lineNo !== null ? `line-${raw.lineNo}` : `idx-${index}`,
      lineNo: raw.lineNo,
      references: raw.references,
      rawQty: raw.qty ?? 0,
      pickQty,
      value: raw.value ?? hit?.part.value ?? null,
      matchState: inStock ? "in_stock" : "to_order",
      matchedPartId: hit?.part.id ?? null,
      matchedInternalPid: hit?.part.internal_pid ?? null,
      location,
    };
  });
}

/** Convenience one-shot composition of the two steps above. */
export function resolveTakeoutLines(
  rawLines: readonly TakeoutRawLine[],
  multiplier: number,
  catalog: readonly TakeoutCatalogPart[],
  locationsByPartId: ReadonlyMap<string, readonly TakeoutLocationRow[]>,
): ResolvedTakeoutLine[] {
  return buildResolvedLines(matchAgainstCatalog(rawLines, catalog), multiplier, locationsByPartId);
}
