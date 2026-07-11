/**
 * tests/unit/desktop-transform.test.ts — the desktop runner's objective-rung
 * guard (desktop/runner/transform.ts): distributor names map to run ids, MPN
 * match and the MANDATORY package rung are recomputed in CODE from the
 * line's own data (an agent's "recommended" claim never bypasses them), and
 * malformed/unknown entries degrade to warnings, not crashes.
 */

import { describe, expect, test } from "bun:test";
import { AgentResultsFileSchema, transformResults } from "@/desktop/runner/transform";
import type { WorkerRunConfig } from "@/types/worker";

const LINE_ID = "11111111-1111-4111-8111-111111111111";
const DIST_LCSC = "22222222-2222-4222-8222-222222222222";
const DIST_DK = "33333333-3333-4333-8333-333333333333";

function config(): WorkerRunConfig {
  return {
    runId: "44444444-4444-4444-8444-444444444444",
    bomId: "55555555-5555-4555-8555-555555555555",
    aliasedProjectLabel: "PROJ-01",
    distributorSequence: [
      { id: DIST_LCSC, name: "LCSC", apiType: "browse", rank: 1, enabled: true },
      { id: DIST_DK, name: "Digikey", apiType: "rest", rank: 2, enabled: true },
    ],
    overallPriorities: "",
    rulesDigest: "",
    rulesDigestVersion: 0,
    orderingLadder: ["mpn", "lcsc", "value", "package", "status", "qty", "cost"],
    concurrencyPreset: "balanced",
    lines: [
      {
        bomLineId: LINE_ID,
        lineNo: 3,
        refDesignators: "C3",
        qty: 5,
        value: "0.1uF/100V",
        footprint: "C0805",
        packageName: "0805",
        voltage: "100V",
        mpn: "GCM21BR72A104KA37L",
        manufacturer: null,
        lcscPn: null,
        dnp: false,
        description: null,
        partLink: null,
        extra: null,
        priorityNote: null,
      },
    ],
    inStockLines: [],
    rupeeCeiling: 0,
  };
}

function file(candidates: unknown[]) {
  return AgentResultsFileSchema.parse({
    complete: true,
    lines: { [LINE_ID]: { searchTerm: "GCM21BR72A104KA37L", notes: null, skipped: null, candidates } },
  });
}

describe("desktop transform — objective rungs recomputed in code", () => {
  test("exact MPN + matching package from a known distributor maps cleanly", () => {
    const { payload, warnings } = transformResults(config(), file([
      { distributor: "LCSC", mpn: "GCM21BR72A104KA37L", package: "0805", stock: 27150, price: 0.0313, currency: "USD", url: "https://www.lcsc.com/product-detail/C85866.html", recommended: true, why: "cheapest exact" },
    ]));
    expect(warnings).toEqual([]);
    expect(payload.results.length).toBe(1);
    const r = payload.results[0]!;
    expect(r["distributorId"]).toBe(DIST_LCSC);
    expect(r["mpnMatch"]).toBe("exact");
    expect(r["packageMatch"]).toBe(true);
    expect(r["isRecommended"]).toBe(true);
  });

  test("agent-claimed recommendation with a WRONG package is flagged, and package rung fails in code", () => {
    const { payload, warnings } = transformResults(config(), file([
      { distributor: "Digikey", mpn: "GCM21BR72A104KA37L", package: "0603", price: 0.1, recommended: true, why: "wrong pkg" },
    ]));
    const r = payload.results[0]!;
    expect(r["packageMatch"]).toBe(false); // code decided, not the agent
    expect(r["confidence"]).toBe(40); // flagged-low confidence
    expect(warnings.some((w) => w.includes("mandatory package rung"))).toBe(true);
  });

  test("unknown distributor and unknown line are dropped with warnings; second 'recommended' is demoted", () => {
    const parsed = AgentResultsFileSchema.parse({
      complete: true,
      lines: {
        [LINE_ID]: {
          searchTerm: "x", notes: null, skipped: null,
          candidates: [
            { distributor: "AliExpress", mpn: "FAKE", package: "0805", recommended: true },
            { distributor: "LCSC", mpn: "GCM21BR72A104KA37L", package: "0805", recommended: true },
            { distributor: "Digikey", mpn: "GCM21BR72A104KA37L", package: "0805", recommended: true },
          ],
        },
        "99999999-9999-4999-8999-999999999999": { searchTerm: null, notes: null, skipped: null, candidates: [] },
      },
    });
    const { payload, warnings } = transformResults(config(), parsed);
    expect(payload.results.length).toBe(2); // AliExpress dropped
    expect(payload.results.filter((r) => r["isRecommended"]).length).toBe(1); // only the first kept
    expect(warnings.some((w) => w.includes("AliExpress"))).toBe(true);
    expect(warnings.some((w) => w.includes("unknown line"))).toBe(true);
  });

  test("a non-recommended candidate's null why is accepted (only the recommended pick must explain itself)", () => {
    const parsed = AgentResultsFileSchema.parse({
      complete: true,
      lines: {
        [LINE_ID]: {
          searchTerm: "GCM21BR72A104KA37L", notes: null, skipped: null,
          candidates: [
            { distributor: "LCSC", mpn: "GCM21BR72A104KA37L", package: "0805", price: 0.0313, recommended: true, why: "cheapest exact" },
            { distributor: "Digikey", mpn: "GCM21BR72A104KA37L", package: "0805", price: 0.19, recommended: false, why: null },
          ],
        },
      },
    });
    const { payload } = transformResults(config(), parsed);
    const runnerUp = payload.results.find((r) => r["distributorId"] === DIST_DK)!;
    expect(runnerUp["isRecommended"]).toBe(false);
    expect(runnerUp["why"]).toBe(""); // null why on a non-winner falls back to empty, not a thrown error
  });

  test("skipped lines land in masterPlan.skip, not in results", () => {
    const parsed = AgentResultsFileSchema.parse({
      complete: true,
      lines: { [LINE_ID]: { searchTerm: null, notes: null, skipped: "DNP", candidates: [] } },
    });
    const { payload } = transformResults(config(), parsed);
    expect(payload.results.length).toBe(0);
    expect(payload.masterPlan.skip).toEqual([{ bomLineId: LINE_ID, reason: "DNP", ruleHit: null }]);
  });
});
