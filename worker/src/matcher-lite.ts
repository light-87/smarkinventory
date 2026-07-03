/**
 * worker/src/matcher-lite.ts — the worker's OWN small, pure ladder-scoring
 * helpers for DISTRIBUTOR LISTINGS (FEATURES.md §7 rungs 4–7: package →
 * status → qty → cost).
 *
 * This is intentionally NOT `lib/matcher` (that package resolves a BOM
 * line/scan/draft against the INTERNAL `smark_parts` catalog — rungs 1–3,
 * a different shape of problem: "is this a part we already have?"). This
 * module scores an external, already-fetched DISTRIBUTOR LISTING against a
 * line's descriptor — "of the listings we found, which one is the right
 * buy?" `docs/OWNERSHIP.md` scopes `worker/**` to importing only
 * `../types/worker`, so duplicating these few, genuinely different, pure
 * functions here is the correct call, not drift — see `types/worker.ts`'s
 * file header for the same reasoning applied to DB row shapes.
 *
 * Rungs 1–3 (MPN/LCSC/value) are why a listing was FOUND at all (the
 * DistributorClient's own search already used the line's mpn/lcscPn/value as
 * its query) — this module's job starts at rung 4 (package, MANDATORY) and
 * continues through status/qty/cost to decide which of several found
 * listings is the best buy, and how confident that pick is.
 */

import type { MpnMatchQuality, PartLifecycleStatus, WorkerBomLine } from "../../types/worker";
import type { DistributorListing } from "./distributors/types";

export function normalizeMpn(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizePackage(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function evaluateMpnMatch(lineMpn: string | null, listingMpn: string | null): MpnMatchQuality {
  const a = normalizeMpn(lineMpn);
  const b = normalizeMpn(listingMpn);
  if (!a || !b) return "none";
  if (a === b) return "exact";
  if (a.includes(b) || b.includes(a)) return "approx";
  return "none";
}

/**
 * Rung 4 — MANDATORY, never substitutable (FEATURES §7/§8, CROSS-FEATURE
 * A3). No package data on EITHER side means "not a verified match", not
 * "assume it's fine" — callers must never treat a missing package as a pass.
 */
export function evaluatePackageMatch(linePackage: string | null, listingPackage: string | null): boolean {
  const a = normalizePackage(linePackage);
  const b = normalizePackage(listingPackage);
  if (!a || !b) return false;
  return a === b;
}

function statusRank(status: PartLifecycleStatus | null): number {
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

/** 0–100 confidence heuristic combining every rung this module owns (4–7). */
export function scoreListing(line: WorkerBomLine, listing: DistributorListing, neededQty: number): number {
  const mpnMatch = evaluateMpnMatch(line.mpn, listing.mpn);
  const packageMatch = evaluatePackageMatch(line.packageName, listing.packageName);

  if (!packageMatch) return 0; // mandatory rung failed — never a viable candidate

  let score = 60; // package matched — floor for a viable candidate
  if (mpnMatch === "exact") score += 25;
  else if (mpnMatch === "approx") score += 10;

  score += Math.max(0, 10 - statusRank(listing.partStatus) * 5); // active +10, nrnd +5, eol +0

  const stockOk = listing.stockQty === null || listing.stockQty >= neededQty;
  if (stockOk) score += 5;

  return Math.max(0, Math.min(100, score));
}

export interface RecommendationResult {
  best: DistributorListing | null;
  confidence: number;
  why: string;
}

/**
 * True when `candidatePrice` is a KNOWN price strictly lower than
 * `currentPrice` — a null price on either side never counts as "cheaper"
 * (an unknown cost can't be judged against a known one, and shouldn't
 * silently displace a listing whose cost IS known), so ties stay on the
 * sequence-order fallback when price data is missing on either side.
 */
function isKnownCheaper(candidatePrice: number | null, currentPrice: number | null): boolean {
  if (candidatePrice == null || currentPrice == null) return false;
  return candidatePrice < currentPrice;
}

/**
 * Picks the best listing across ALL distributors already searched for one
 * line, applying rungs 4–7 in order: package (mandatory) → status → qty →
 * cost. `scoreListing` folds rungs 4–6 into a single 0–100 number; an EXACT
 * score tie is then broken by rung 7 (lowest known price — report finding
 * #8: this used to fall straight to sequence order, so two listings tied on
 * package/MPN/status/qty resolved to whichever distributor happened to come
 * first, not the cheaper one). Only once price can't break the tie either
 * (equal, or unknown on either side) does whichever appears first in
 * `listings` (the caller's distributor-sequence order) win, matching
 * lib/matcher's "first rung/first candidate wins" determinism.
 */
export function pickRecommended(line: WorkerBomLine, listings: DistributorListing[], neededQty: number): RecommendationResult {
  const viable = listings.filter((l) => evaluatePackageMatch(line.packageName, l.packageName));
  if (viable.length === 0) {
    return {
      best: null,
      confidence: 0,
      why: line.packageName
        ? `No listing matched the required package (${line.packageName}) — package is a mandatory rung, never substitutable.`
        : "This line has no package recorded — package is a mandatory rung, so no listing can be verified.",
    };
  }

  let best: DistributorListing | null = null;
  let bestScore = -1;
  for (const listing of viable) {
    const score = scoreListing(line, listing, neededQty);
    if (score > bestScore) {
      best = listing;
      bestScore = score;
    } else if (score === bestScore && best && isKnownCheaper(listing.price, best.price)) {
      // Rung 7 tiebreaker — same score, strictly cheaper known price wins.
      best = listing;
    }
  }

  if (!best) {
    return { best: null, confidence: 0, why: "No viable candidate scored above zero." };
  }

  const mpnMatch = evaluateMpnMatch(line.mpn, best.mpn);
  const stockNote =
    best.stockQty !== null && best.stockQty < neededQty
      ? ` (stock ${best.stockQty} is below the needed ${neededQty} — flagged, not disqualified)`
      : "";
  const why =
    `${best.distributorName} recommended — package matches (${line.packageName ?? "n/a"}), ` +
    `MPN ${mpnMatch}, status ${best.partStatus ?? "unknown"}${stockNote}, price ₹${best.price ?? "n/a"}.`;

  return { best, confidence: bestScore, why };
}
