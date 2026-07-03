/**
 * lib/orders/receipt-map.ts — pure "extracted receipt line → order line"
 * matcher for the "Extract prices" confirm dialog (plan/tab-on-order.md §3-C
 * · FEATURES.md §5.12: "fuzzy match by MPN/desc via lib/matcher where
 * possible; unmatched rows shown for manual mapping").
 *
 * No I/O — same split as lib/matcher/index.ts (pure core, unit-testable
 * without a database), reusing that module's normalizers/similarity scorer
 * rather than re-implementing a second ladder. This is NOT lib/matcher's
 * catalog ladder, though: `matchPart` resolves a structured descriptor
 * (mpn/lcsc/value/package) against `smark_parts`; a receipt line is a single
 * free-text `desc` string ("STM32F103C8T6", "0603 4.7k 1% resistor") that
 * has to be matched against this ORDER's own lines instead. Two-step:
 *
 *  1. `groupOrderLines` — collapses sibling `smark_order_lines` rows that
 *     came from the SAME cart line back into one group. Checkout
 *     (lib/orders/checkout.ts `splitQtyAcrossDemand`) fans one cart item out
 *     into one order_line PER project sharing demand on it — all of them
 *     carry the same `cart_item_id` and the same part/price, so a receipt
 *     line naming that part must update ALL of them, not just one.
 *  2. `mapReceiptLinesToOrderGroups` — for each extracted line, scores every
 *     group: an exact/substring MPN hit (via lib/matcher's `normalizeMpn`)
 *     wins outright (confidence 100); otherwise a fuzzy score from
 *     `valueSimilarity` against the group's mpn/value/package/PID text,
 *     kept only above `FUZZY_MATCH_THRESHOLD`. Candidates are assigned
 *     greedily, highest score first, each extracted line and each group
 *     used at most once — ties resolve in extraction order (`Array.sort` is
 *     stable in every JS engine this runs on). Anything left over comes back
 *     with `groupKey: null` — the confirm dialog shows it "Unmatched" for
 *     the user to map (or skip) by hand, never silently dropped or guessed.
 */

import { normalizeMpn as normalizeMpnKey, valueSimilarity } from "@/lib/matcher";
import type { ReceiptExtractLine } from "@/lib/ai";

/* ────────────────────────────────────────────────────────────────────────────
 * Grouping — collapse a checkout split back into one line per cart item
 * ──────────────────────────────────────────────────────────────────────────── */

/** The subset of `OrderLineView` (lib/orders/queries.ts) this module needs — kept decoupled so it stays pure/dependency-free. */
export interface ReceiptOrderLineInput {
  orderLineId: string;
  cartItemId: string | null;
  mpn: string | null;
  lcscPn: string | null;
  value: string | null;
  package: string | null;
  internalPid: string | null;
  qtyOrdered: number;
  unitPrice: number | null;
}

export interface OrderLineGroup {
  /** `cartItemId` when present; else a synthetic key from the single order_line's own id (a line with no cart_item_id can't have siblings to collapse anyway). */
  groupKey: string;
  cartItemId: string | null;
  orderLineIds: string[];
  mpn: string | null;
  lcscPn: string | null;
  value: string | null;
  package: string | null;
  internalPid: string | null;
  /** Summed across every line in the group. */
  qtyOrdered: number;
  /** Uniform across the group (checkout stamps the same `unit_price` onto every split line) — the first line's value. */
  unitPrice: number | null;
}

/** Collapses sibling split lines (same `cartItemId`) into one matchable group — see module doc. */
export function groupOrderLines(lines: readonly ReceiptOrderLineInput[]): OrderLineGroup[] {
  const groups = new Map<string, OrderLineGroup>();

  for (const line of lines) {
    const key = line.cartItemId ?? `line:${line.orderLineId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.orderLineIds.push(line.orderLineId);
      existing.qtyOrdered += line.qtyOrdered;
      continue;
    }
    groups.set(key, {
      groupKey: key,
      cartItemId: line.cartItemId,
      orderLineIds: [line.orderLineId],
      mpn: line.mpn,
      lcscPn: line.lcscPn,
      value: line.value,
      package: line.package,
      internalPid: line.internalPid,
      qtyOrdered: line.qtyOrdered,
      unitPrice: line.unitPrice,
    });
  }

  return Array.from(groups.values());
}

/* ────────────────────────────────────────────────────────────────────────────
 * Matching — extracted receipt line → order line group
 * ──────────────────────────────────────────────────────────────────────────── */

export type ReceiptMatchMethod = "mpn" | "fuzzy";

export interface ReceiptLineMapping {
  extractedIndex: number;
  desc: string;
  qty: number;
  unitPrice: number;
  /** Null = unmatched — the confirm dialog shows this row for manual mapping (never guessed/auto-applied). */
  groupKey: string | null;
  matchMethod: ReceiptMatchMethod | null;
  /** 0–100; 0 when unmatched. */
  confidence: number;
}

/** Below this, a fuzzy desc/descriptor score doesn't count as a match at all — same "don't misfire" stance as lib/matcher's `DEFAULT_MIN_VALUE_SIMILARITY`. */
export const FUZZY_MATCH_THRESHOLD = 55;

/** A per-token match counts once `valueSimilarity` clears this — high enough that "4.7k" won't falsely claim "47k", loose enough that "4.7k"/"4700"/"4k7" (lib/matcher's SI-prefix-aware parse) all count as the same token. */
const TOKEN_MATCH_THRESHOLD = 0.85;

/** Word-ish splitter — keeps component-value punctuation (`.`/`%`) inside a token instead of splitting on it, so "4.7k" and "1%" survive as one token each. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.%]+/i)
    .filter(Boolean);
}

/**
 * Free-text description scoring: rather than diffing two whole sentences
 * (a receipt line and a joined "mpn value package pid" string) character by
 * character — word order and boilerplate ("resistor", "capacitor", qty
 * units) would tank a naive whole-string similarity even for an obvious
 * match — this scores what fraction of the ORDER LINE's identifying tokens
 * (its mpn/value/package/PID, each already a terse token) show up anywhere
 * in the receipt line's tokens, per-token via `valueSimilarity` so
 * "4.7k"/"4700"/"4k7" all count as the same value. 0 when the group has no
 * identifying tokens at all.
 */
function descriptorMatchScore(desc: string, group: OrderLineGroup): number {
  const descriptorTokens = [group.mpn, group.value, group.package, group.internalPid]
    .filter((v): v is string => Boolean(v))
    .flatMap(tokenize);
  if (descriptorTokens.length === 0) return 0;

  const descTokens = tokenize(desc);
  if (descTokens.length === 0) return 0;

  let matched = 0;
  for (const descriptorToken of descriptorTokens) {
    const hit = descTokens.some((token) => valueSimilarity(token, descriptorToken) >= TOKEN_MATCH_THRESHOLD);
    if (hit) matched += 1;
  }
  return matched / descriptorTokens.length;
}

/** Exact/substring MPN hit, either direction (handles the extracted desc being JUST the MPN, or the MPN embedded in a longer line). Confidence is always 100 — same as lib/matcher's keyed rungs. */
function mpnMatchScore(desc: string, group: OrderLineGroup): number | null {
  const groupMpn = normalizeMpnKey(group.mpn);
  const descKey = normalizeMpnKey(desc);
  if (!groupMpn || !descKey) return null;
  return descKey.includes(groupMpn) || groupMpn.includes(descKey) ? 100 : null;
}

interface Candidate {
  extractedIndex: number;
  groupKey: string;
  score: number;
  method: ReceiptMatchMethod;
}

/**
 * Maps every extracted line to at most one order-line group (and vice
 * versa) — see module doc for the two-pass score-then-greedily-assign
 * algorithm. Pure; no I/O.
 */
export function mapReceiptLinesToOrderGroups(
  extracted: readonly ReceiptExtractLine[],
  groups: readonly OrderLineGroup[],
): ReceiptLineMapping[] {
  const candidates: Candidate[] = [];

  extracted.forEach((line, extractedIndex) => {
    for (const group of groups) {
      const mpnScore = mpnMatchScore(line.desc, group);
      if (mpnScore !== null) {
        candidates.push({ extractedIndex, groupKey: group.groupKey, score: mpnScore, method: "mpn" });
        continue;
      }
      const fuzzyScore = Math.round(descriptorMatchScore(line.desc, group) * 100);
      if (fuzzyScore >= FUZZY_MATCH_THRESHOLD) {
        candidates.push({ extractedIndex, groupKey: group.groupKey, score: fuzzyScore, method: "fuzzy" });
      }
    }
  });

  // Highest score first; stable sort keeps ties in extraction/group order.
  candidates.sort((a, b) => b.score - a.score);

  const usedExtracted = new Set<number>();
  const usedGroups = new Set<string>();
  const assigned = new Map<number, Candidate>();

  for (const candidate of candidates) {
    if (usedExtracted.has(candidate.extractedIndex) || usedGroups.has(candidate.groupKey)) continue;
    usedExtracted.add(candidate.extractedIndex);
    usedGroups.add(candidate.groupKey);
    assigned.set(candidate.extractedIndex, candidate);
  }

  return extracted.map((line, extractedIndex) => {
    const hit = assigned.get(extractedIndex);
    return {
      extractedIndex,
      desc: line.desc,
      qty: line.qty,
      unitPrice: line.unit_price,
      groupKey: hit?.groupKey ?? null,
      matchMethod: hit?.method ?? null,
      confidence: hit?.score ?? 0,
    };
  });
}
