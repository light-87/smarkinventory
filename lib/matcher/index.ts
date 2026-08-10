/**
 * lib/matcher/index.ts — THE catalog matcher (FEATURES.md §7 · CROSS-FEATURE R2-31).
 *
 * One pure, deterministic function decides whether a part descriptor (a BOM
 * line, a bulk-takeout scan/paste line, or a new-part draft on Receive)
 * refers to an EXISTING `smark_parts` row. Three consumers, one matcher
 * ("one matcher, three consumers" — CROSS-FEATURE R2-31):
 *   - Projects → BOM reconcile        (plan/tab-orders-projects.md)
 *   - Bulk takeout line resolution    (plan/tab-bulk-pick.md)
 *   - Receive duplicate-part guard    (plan/tab-receive.md, R2-31:
 *     "Looks like SMK-000101 — top up instead?")
 *
 * Ladder (SCHEMA.md §3 "Reconcile: MPN → LCSC PN → value+package(+voltage)
 * fuzzy"; FEATURES.md §7 rungs 1–4. Rungs 5–7 of §7 — status/qty/cost — rank
 * DISTRIBUTOR search results in the agent pipeline, a different concern from
 * catalog identity matching, and are out of scope here; part_status is only
 * consulted as a tie-breaker below):
 *
 *   1. MPN     — exact (normalized) → known equivalents
 *   2. LCSC PN — exact (normalized); "C-number strong key" (FEATURES §15)
 *   3. Value + Package (+ Voltage) — fuzzy. PACKAGE IS MANDATORY here
 *      (CROSS-FEATURE A3: "Package match is mandatory... a change may add
 *      rules but not make package optional") — a candidate can only surface
 *      at this rung if its `packageKey` equals the input's; value (and
 *      voltage, when both sides have it) then scores how close a match it is,
 *      with `smark_parts.part_status` (Active > NRND > EOL) breaking ties.
 *
 *      How strict rung 3 is depends on the caller. Receive's duplicate guard
 *      and bulk takeout keep the default `DEFAULT_MIN_VALUE_SIMILARITY`,
 *      because a near-miss shown to a human is useful there. Reconcile passes
 *      `minValueSimilarity: 1` + `requireUnambiguous: true` — see
 *      `lib/bom/reconcile.ts` for why a 0.87-scoring resistor is not a match.
 *
 * The FIRST rung that finds a candidate wins — later rungs never override
 * an earlier hit, but earlier rungs that come up empty fall through to the
 * next one. That single rule correctly handles all three BOM-line
 * archetypes from the Phase-0 spike (§0: full-MPN / LCSC-PN-only /
 * value+package-only) with no special-casing by the caller.
 *
 * Pure & side-effect free: no I/O, no Supabase client. Callers fetch
 * `catalog` (typically `smark_parts`, or a category/value-prefiltered slice
 * for very large catalogs) and pass it in.
 */

import type { PartStatus } from "@/types/db";

/* ────────────────────────────────────────────────────────────────────────────
 * Public types
 * ──────────────────────────────────────────────────────────────────────────── */

/** The descriptor being resolved — a BOM line, a scan/paste line, a new-part draft. */
export interface MatchInput {
  mpn?: string | null;
  lcsc_pn?: string | null;
  value?: string | null;
  package?: string | null;
  voltage?: string | null;
}

/**
 * Minimal shape a catalog entry must have. Any `smark_parts` row (`PartRow`
 * from `types/db.ts`) satisfies this structurally — pass the table straight
 * through, no mapping needed.
 */
export interface MatchCatalogEntry {
  id: string;
  mpn?: string | null;
  lcsc_pn?: string | null;
  value?: string | null;
  package?: string | null;
  voltage?: string | null;
  part_status?: PartStatus | null;
}

export type MatchMethod = "mpn" | "lcsc" | "value_pkg";

export interface MatchResult<TPart extends MatchCatalogEntry> {
  part: TPart;
  method: MatchMethod;
  /** 0–100. Exact keyed rungs (mpn/lcsc) are 100; the fuzzy rung tops out lower — see MATCH_CONFIDENCE. */
  confidence: number;
}

/**
 * Direct manufacturer-part-number equivalents ("known equivalents", rung 1),
 * e.g. a second-source MPN for the same physical part. Undirected pairs —
 * both orderings match. Empty by default: SmarkStock has no equivalents
 * table yet (`smark_learned_rules.rule_type` doesn't model this — SCHEMA.md
 * §5), so this is a forward-looking hook a caller can populate from
 * wherever that data ends up living, without changing this module's shape.
 */
export type MpnEquivalentPair = readonly [string, string];

export interface MatcherOptions {
  equivalents?: readonly MpnEquivalentPair[];
  /**
   * Minimum blended similarity (0–1) for the value+package rung to count as
   * a match at all. Below this, `matchPart` returns `null` (unresolved) —
   * the caller creates/orders a new part instead of misfiring a match.
   * Default `DEFAULT_MIN_VALUE_SIMILARITY`.
   */
  minValueSimilarity?: number;
  /**
   * Reject the value+package rung when more than one catalog row ties for
   * best. Off by default: a duplicate-guard prompt showing one of several
   * near-identical parts is still useful to a human ("looks like SMK-000101 —
   * top up instead?"). Reconcile turns it ON, because silently picking one of
   * two 0Ω 0402 rows would attribute a BOM line's demand to an arbitrary half
   * of the stock.
   */
  requireUnambiguous?: boolean;
}

/** Confidence stamped per rung — exported so callers/tests never hardcode magic numbers. */
export const MATCH_CONFIDENCE = {
  mpnExact: 100,
  mpnEquivalent: 92,
  lcscExact: 100,
  /** Ceiling for the fuzzy rung — a value+package hit is never "exact"-grade. */
  valuePackageMax: 88,
} as const;

export const DEFAULT_MIN_VALUE_SIMILARITY = 0.6;

/* ────────────────────────────────────────────────────────────────────────────
 * Normalization helpers (exported — unit-tested individually, reusable by
 * Settings' ordering-rule previews, the receipt-extraction confirm step, etc.)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Uppercase, strip everything but letters/digits — a formatting-proof MPN key. */
export function normalizeMpn(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Uppercase, strip non-alphanumerics; bare digit strings get a leading `C`
 * ("25804" → "C25804") since the LCSC C-number is the strong key
 * (FEATURES §15) and users/scanners sometimes drop the prefix.
 */
export function normalizeLcsc(raw: string | null | undefined): string {
  const stripped = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (stripped !== "" && /^\d+$/.test(stripped)) return `C${stripped}`;
  return stripped;
}

/** Uppercase, strip separators — "SOT-23" / "sot_23" / "SOT 23" all equal. */
export function normalizePackage(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Imperial chip sizes. A 3/4-digit code only reduces to a size if it is one of these. */
const IMPERIAL_CHIP_SIZES = new Set([
  "0201", "0402", "0603", "0805", "1206", "1210", "1218",
  "1411", "1806", "1812", "2010", "2512", "2920",
]);

/**
 * Reduces a package/footprint to a comparable key, bridging the two vocabularies
 * that describe the same physical thing:
 *
 *   catalog (from the client's stock sheet) : "0603 (1608 Metric)"
 *   BOM     (KiCad export, stored raw)      : "SMARKKicadLib:R0603"
 *
 * `normalizePackage` alone turns those into "06031608METRIC" and
 * "SMARKKICADLIBR0603", which can never be equal — so before this existed the
 * value+package rung matched literally nothing between a real BOM and the real
 * catalog, whatever the threshold.
 *
 * Reduction, in order: drop a library prefix (`Lib:` before the last colon),
 * drop a parenthetical (the metric restatement), drop a leading component
 * letter, then accept the result only if it is a known imperial chip size.
 * A 3-digit code is padded ("603" → "0603"), the same leading-zero repair
 * `lib/import/stocklist.ts` already applies to this client's sheets.
 *
 * Anything not recognisable as a chip size falls through to `normalizePackage`,
 * so SOT-23-6, SMA and one-off strings behave exactly as they did.
 */
export function packageKey(raw: string | null | undefined): string {
  if (!raw) return "";

  const afterPrefix = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
  const withoutParenthetical = afterPrefix.replace(/\(.*?\)/g, "");
  const compact = withoutParenthetical.replace(/[^A-Za-z0-9]/g, "");

  // Optional component letter (C/R/L/D/Q/F/U) in front of the size: "C0805" → "0805".
  const sized = /^[CRLDQFU]?(\d{3,4})$/i.exec(compact);
  if (sized) {
    const digits = sized[1]!;
    const padded = digits.length === 3 ? `0${digits}` : digits;
    if (IMPERIAL_CHIP_SIZES.has(padded)) return padded;
  }

  return normalizePackage(withoutParenthetical);
}

const MICRO_PATTERN = /[µμ]/g;
const OHM_WORD_PATTERN = /ohms?/gi;
const OHM_SYMBOL_PATTERN = /Ω/g;

/**
 * Symbol-normalizes a value/voltage token WITHOUT touching case or
 * collapsing SI prefixes — feeds both the literal-equality fast path and
 * the numeric parser below.
 */
function canonicalizeToken(raw: string): string {
  return raw
    .trim()
    .replace(MICRO_PATTERN, "u")
    .replace(OHM_SYMBOL_PATTERN, "")
    .replace(OHM_WORD_PATTERN, "")
    .replace(/\s+/g, "");
}

/**
 * SI/engineering prefix → multiplier. `m` (milli) and `M` (mega) are
 * deliberately case-SENSITIVE (the one place case carries meaning);
 * everything else is not.
 */
function prefixMultiplier(letter: string): number | null {
  switch (letter) {
    case "p":
    case "P":
      return 1e-12;
    case "n":
    case "N":
      return 1e-9;
    case "u":
    case "U":
      return 1e-6;
    case "m":
      return 1e-3;
    case "k":
    case "K":
      return 1e3;
    case "M":
      return 1e6;
    case "g":
    case "G":
      return 1e9;
    case "t":
    case "T":
      return 1e12;
    case "r":
    case "R":
      return 1; // ohms base unit, e.g. "4R7" / "10R"
    default:
      return null;
  }
}

/**
 * Parses a component value/voltage token to a plain number, understanding:
 *  - trailing SI prefix + unit noise: "4.7k" / "4.7kΩ" / "100nF" / "50V"
 *  - the resistor/cap "letter substitutes for the decimal point" notation:
 *    "4R7" → 4.7, "1K2" → 1200, "4n7" → 4.7 × 10⁻⁹
 * Returns `null` when the token isn't numeric-shaped at all (e.g. "DNP").
 * Exported for reuse and direct unit testing of the notation edge cases.
 */
export function parseComponentValue(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const token = canonicalizeToken(raw);
  if (token === "") return null;

  // "4R7" / "1K2" / "4n7" — a unit letter standing in for the decimal point.
  const substitution = /^(\d+)([A-Za-z])(\d+)$/.exec(token);
  if (substitution) {
    const [, intPart, letter, fracPart] = substitution as unknown as [string, string, string, string];
    const multiplier = prefixMultiplier(letter);
    if (multiplier !== null) {
      return Number.parseFloat(`${intPart}.${fracPart}`) * multiplier;
    }
  }

  // "4.7k" / "100n" / "50V" / "220" — number + optional prefix + unit noise.
  const standard = /^(\d+(?:\.\d+)?)([A-Za-z]*)$/.exec(token);
  if (standard) {
    const [, digits, suffix] = standard as unknown as [string, string, string];
    const base = Number.parseFloat(digits);
    if (suffix === "") return base;
    const multiplier = prefixMultiplier(suffix[0]!);
    return multiplier === null ? base : base * multiplier;
  }

  return null;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Classic O(n·m)-time, O(min(n,m))-space edit distance. */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(
        Math.min(
          current[j - 1]! + 1, // insertion
          previous[j]! + 1, // deletion
          previous[j - 1]! + cost, // substitution
        ),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** Normalized Levenshtein similarity (1 = identical, 0 = nothing in common). */
function editSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return clamp01(1 - levenshteinDistance(a, b) / maxLen);
}

/**
 * 0–1 similarity between two value/voltage tokens. Order of attack:
 *   1. Canonical string equality (symbols normalized, case-folded) → 1.
 *   2. Both sides numeric-parseable → relative-error closeness (so "4.7k",
 *      "4k7" and "4700" all compare as identical).
 *   3. Otherwise → normalized Levenshtein similarity on the canonical
 *      strings (covers free-text values like "Ferrite Bead").
 * Missing input on either side → 0 (nothing to compare).
 */
export function valueSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const canonA = canonicalizeToken(a).toLowerCase();
  const canonB = canonicalizeToken(b).toLowerCase();
  if (canonA === "" || canonB === "") return 0;
  if (canonA === canonB) return 1;

  const numA = parseComponentValue(a);
  const numB = parseComponentValue(b);
  if (numA !== null && numB !== null) {
    const scale = Math.max(Math.abs(numA), Math.abs(numB), Number.EPSILON);
    const relativeError = Math.abs(numA - numB) / scale;
    // Snap float noise to exact equality — e.g. 0.1e-6 (from "0.1uF") and
    // 100e-9 (from "100nF") are the same value but not bit-identical floats.
    if (relativeError < 1e-9) return 1;
    return clamp01(1 - relativeError);
  }

  return editSimilarity(canonA, canonB);
}

/** Active > NRND > EOL — tie-break only (SCHEMA §7 standard ladder rung 5). */
function partStatusRank(status: PartStatus | null | undefined): number {
  switch (status) {
    case "active":
      return 0;
    case "nrnd":
      return 1;
    case "eol":
      return 2;
    default:
      return 3;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ladder rungs
 * ──────────────────────────────────────────────────────────────────────────── */

function buildEquivalenceMap(pairs: readonly MpnEquivalentPair[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  for (const [rawA, rawB] of pairs) {
    const a = normalizeMpn(rawA);
    const b = normalizeMpn(rawB);
    if (a === "" || b === "") continue;
    link(a, b);
    link(b, a);
  }
  return map;
}

function matchByMpn<TPart extends MatchCatalogEntry>(
  input: MatchInput,
  catalog: readonly TPart[],
  options: MatcherOptions,
): MatchResult<TPart> | null {
  const target = normalizeMpn(input.mpn);
  if (target === "") return null;

  const exact = catalog.find((part) => normalizeMpn(part.mpn) === target);
  if (exact) return { part: exact, method: "mpn", confidence: MATCH_CONFIDENCE.mpnExact };

  if (options.equivalents?.length) {
    const equivalents = buildEquivalenceMap(options.equivalents);
    const known = equivalents.get(target);
    if (known?.size) {
      const viaEquivalent = catalog.find((part) => known.has(normalizeMpn(part.mpn)));
      if (viaEquivalent) {
        return { part: viaEquivalent, method: "mpn", confidence: MATCH_CONFIDENCE.mpnEquivalent };
      }
    }
  }

  return null;
}

function matchByLcsc<TPart extends MatchCatalogEntry>(
  input: MatchInput,
  catalog: readonly TPart[],
): MatchResult<TPart> | null {
  const target = normalizeLcsc(input.lcsc_pn);
  if (target === "") return null;

  const exact = catalog.find((part) => normalizeLcsc(part.lcsc_pn) === target);
  return exact ? { part: exact, method: "lcsc", confidence: MATCH_CONFIDENCE.lcscExact } : null;
}

function matchByValuePackage<TPart extends MatchCatalogEntry>(
  input: MatchInput,
  catalog: readonly TPart[],
  options: MatcherOptions,
): MatchResult<TPart> | null {
  // `packageKey`, not `normalizePackage`: the catalog and the BOMs describe the
  // same chip size in two different vocabularies (see packageKey's doc).
  const targetPackage = packageKey(input.package);
  // Package is MANDATORY at this rung (CROSS-FEATURE A3) — no package, no fuzzy match.
  if (targetPackage === "" || !input.value?.trim()) return null;

  const threshold = options.minValueSimilarity ?? DEFAULT_MIN_VALUE_SIMILARITY;
  let best: { part: TPart; score: number } | null = null;
  // Counts only candidates that TIE the best score on an equal status rank —
  // i.e. ones the tie-breaker below genuinely cannot separate.
  let tiedWithBest = 0;

  // Plain for-of (not .forEach/.reduce) so ties resolve deterministically:
  // a candidate only replaces `best` on a STRICT improvement, so of several
  // equally-good matches the first one encountered in `catalog` order wins.
  for (const part of catalog) {
    if (packageKey(part.package) !== targetPackage) continue;

    const valueScore = valueSimilarity(input.value, part.value);
    if (valueScore <= 0) continue;

    const bothHaveVoltage = Boolean(input.voltage?.trim() && part.voltage?.trim());
    const score = bothHaveVoltage
      ? valueScore * 0.8 + valueSimilarity(input.voltage, part.voltage) * 0.2
      : valueScore;

    if (!best || score > best.score) {
      best = { part, score };
      tiedWithBest = 1;
      continue;
    }
    if (score < best.score) continue;

    // Same score: status breaks the tie, and only a genuinely inseparable
    // candidate counts toward ambiguity.
    const rank = partStatusRank(part.part_status);
    const bestRank = partStatusRank(best.part.part_status);
    if (rank < bestRank) {
      best = { part, score };
      tiedWithBest = 1;
    } else if (rank === bestRank) {
      tiedWithBest += 1;
    }
  }

  if (!best || best.score < threshold) return null;
  if (options.requireUnambiguous && tiedWithBest > 1) return null;
  const confidence = Math.round(clamp01(best.score) * MATCH_CONFIDENCE.valuePackageMax);
  return { part: best.part, method: "value_pkg", confidence };
}

/* ────────────────────────────────────────────────────────────────────────────
 * The one matcher
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Resolves a part descriptor against the catalog via the standard ladder.
 * Returns `null` when nothing clears the bar — the BOM line is
 * `unresolved`, the takeout line can't be found, or Receive proceeds as a
 * genuinely new part (no duplicate-guard prompt).
 */
export function matchPart<TPart extends MatchCatalogEntry>(
  input: MatchInput,
  catalog: readonly TPart[],
  options: MatcherOptions = {},
): MatchResult<TPart> | null {
  return (
    matchByMpn(input, catalog, options) ?? matchByLcsc(input, catalog) ?? matchByValuePackage(input, catalog, options)
  );
}
