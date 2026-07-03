/**
 * worker/tests/matcher-lite.test.ts — the objective ladder checks
 * (FEATURES.md §7 rungs 4–7) item-agent.ts relies on. Package match is the
 * mandatory-rung invariant this suite anchors — see also
 * tests/invariants/package-mandatory.test.ts (app-side, a different shape
 * of the same rule against the internal catalog).
 */

import { expect, test } from "bun:test";
import { evaluateMpnMatch, evaluatePackageMatch, pickRecommended } from "../src/matcher-lite";
import type { DistributorListing } from "../src/distributors/types";
import type { WorkerBomLine } from "../../types/worker";

function line(overrides: Partial<WorkerBomLine> = {}): WorkerBomLine {
  return {
    bomLineId: "L1",
    refDesignators: "C1",
    qty: 10,
    value: "0.1uF",
    packageName: "C0603",
    voltage: null,
    mpn: "CL10B104MB8NNNC",
    manufacturer: "Samsung",
    lcscPn: "C14663",
    priorityNote: null,
    ...overrides,
  };
}

function listing(overrides: Partial<DistributorListing> = {}): DistributorListing {
  return {
    distributorName: "Digikey",
    title: "test listing",
    mpn: "CL10B104MB8NNNC",
    packageName: "C0603",
    price: 1,
    currency: "INR",
    qtyBreaks: [],
    stockQty: 1000,
    partStatus: "active",
    orderLink: null,
    raw: null,
    ...overrides,
  };
}

test("package match is mandatory — missing package data on either side is NEVER a match", () => {
  expect(evaluatePackageMatch(null, "C0603")).toBe(false);
  expect(evaluatePackageMatch("C0603", null)).toBe(false);
  expect(evaluatePackageMatch(null, null)).toBe(false);
});

test("package match normalizes separators/case but never substitutes a different package", () => {
  expect(evaluatePackageMatch("C0603", "c-0603")).toBe(true);
  expect(evaluatePackageMatch("C0603", "C0805")).toBe(false);
});

test("MPN match: exact / approx / none", () => {
  expect(evaluateMpnMatch("ABC123", "ABC123")).toBe("exact");
  expect(evaluateMpnMatch("ABC123", "ABC123-REEL")).toBe("approx");
  expect(evaluateMpnMatch("ABC123", "XYZ999")).toBe("none");
  expect(evaluateMpnMatch(null, "ABC123")).toBe("none");
});

test("pickRecommended refuses every listing when none matches the mandatory package rung", () => {
  const result = pickRecommended(line(), [listing({ packageName: "C0805" })], 10);
  expect(result.best).toBeNull();
  expect(result.confidence).toBe(0);
  expect(result.why).toMatch(/mandatory/i);
});

test("pickRecommended prefers exact MPN + active status over an approx/nrnd alternative", () => {
  const exact = listing({ distributorName: "Digikey", mpn: "CL10B104MB8NNNC", partStatus: "active" });
  const approx = listing({ distributorName: "Mouser", mpn: "CL10B104MB8NNNC-T", partStatus: "nrnd" });
  const result = pickRecommended(line(), [approx, exact], 10);
  expect(result.best?.distributorName).toBe("Digikey");
});

test("pickRecommended breaks ties deterministically by first-in-sequence order", () => {
  const a = listing({ distributorName: "Digikey" });
  const b = listing({ distributorName: "Mouser" });
  const result = pickRecommended(line(), [a, b], 10);
  expect(result.best?.distributorName).toBe("Digikey"); // first candidate, identical scores
});

test("pickRecommended breaks an exact score tie by price (rung 7) — cheaper KNOWN price wins over sequence order", () => {
  const pricier = listing({ distributorName: "Digikey", price: 5 });
  const cheaper = listing({ distributorName: "Mouser", price: 2 });
  // Pricier listed FIRST — a pure sequence-order fallback would wrongly pick it.
  const result = pickRecommended(line(), [pricier, cheaper], 10);
  expect(result.best?.distributorName).toBe("Mouser");
  expect(result.best?.price).toBe(2);
});

test("pickRecommended's price tiebreak never treats an unknown price as cheaper — falls back to sequence order", () => {
  const first = listing({ distributorName: "Digikey", price: null });
  const second = listing({ distributorName: "Mouser", price: null });
  const result = pickRecommended(line(), [first, second], 10);
  expect(result.best?.distributorName).toBe("Digikey");
});

test("pickRecommended flags (not disqualifies) a listing whose stock is below the needed quantity", () => {
  const short = listing({ stockQty: 2 });
  const result = pickRecommended(line({ qty: 100 }), [short], 100);
  expect(result.best).not.toBeNull();
  expect(result.why).toMatch(/below the needed/);
});
