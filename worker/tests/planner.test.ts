/**
 * worker/tests/planner.test.ts — the deterministic mock master planner
 * (selected whenever `ANTHROPIC_API_KEY` is absent) and the defensive
 * reconciliation pass every real/mock plan goes through before it's trusted.
 */

import { expect, test } from "bun:test";
import { mockMasterPlan, reconcilePlanWithLines } from "../src/planner";
import type { DistributorDescriptor, WorkerBomLine, WorkerRunConfig } from "../../types/worker";

const DISTRIBUTORS: DistributorDescriptor[] = [
  { id: "d1", name: "Digikey", apiType: "rest", rank: 1, enabled: true },
  { id: "d2", name: "LCSC", apiType: "browse", rank: 2, enabled: true },
  { id: "d3", name: "Unikey", apiType: "browse", rank: 3, enabled: false },
];

function config(lines: WorkerBomLine[]): WorkerRunConfig {
  return {
    runId: "r1",
    bomId: "b1",
    aliasedProjectLabel: "PROJ-03",
    distributorSequence: DISTRIBUTORS,
    overallPriorities: "",
    rulesDigest: "",
    rulesDigestVersion: 1,
    orderingLadder: ["mpn", "lcsc", "value", "package", "status", "qty", "cost"],
    concurrencyPreset: "balanced",
    lines,
    rupeeCeiling: 100,
  };
}

function line(overrides: Partial<WorkerBomLine>): WorkerBomLine {
  return {
    bomLineId: "L1",
    refDesignators: null,
    qty: 1,
    value: null,
    packageName: null,
    voltage: null,
    mpn: null,
    manufacturer: null,
    lcscPn: null,
    priorityNote: null,
    ...overrides,
  };
}

test("every line is accounted for exactly once — never both searched and skipped, never omitted", () => {
  const cfg = config([line({ bomLineId: "A" }), line({ bomLineId: "B" }), line({ bomLineId: "C" })]);
  const plan = mockMasterPlan(cfg);
  const reconciled = reconcilePlanWithLines(plan, cfg);

  const searchIds = reconciled.searches.map((s) => s.bomLineId);
  const skipIds = reconciled.skip.map((s) => s.bomLineId);
  expect(new Set([...searchIds, ...skipIds])).toEqual(new Set(["A", "B", "C"]));
  expect(searchIds.filter((id) => skipIds.includes(id)).length).toBe(0);
});

test("a DNP line is skipped, never searched — and its skip survives reconciliation", () => {
  const plan = reconcilePlanWithLines(
    mockMasterPlan(config([line({ bomLineId: "A", dnp: true, qty: 0 }), line({ bomLineId: "B", mpn: "X1" })])),
    config([line({ bomLineId: "A", dnp: true, qty: 0 }), line({ bomLineId: "B", mpn: "X1" })]),
  );
  expect(plan.skip.map((s) => s.bomLineId)).toEqual(["A"]);
  expect(plan.skip[0]?.reason).toContain("DNP");
  expect(plan.searches.map((s) => s.bomLineId)).toEqual(["B"]);
});

test("a line whose priority note flags 'already_stocked' is skipped, not searched", () => {
  const cfg = config([line({ bomLineId: "A", priorityNote: "already_stocked — over 500 in stock" })]);
  const plan = reconcilePlanWithLines(mockMasterPlan(cfg), cfg);
  expect(plan.skip.map((s) => s.bomLineId)).toEqual(["A"]);
  expect(plan.searches).toEqual([]);
});

test("an LCSC-PN-only line (no MPN) routes to LCSC only — ladder rung 2", () => {
  const cfg = config([line({ bomLineId: "A", lcscPn: "C14663", mpn: null })]);
  const plan = reconcilePlanWithLines(mockMasterPlan(cfg), cfg);
  expect(plan.searches[0]?.distributorOrder).toEqual(["LCSC"]);
});

test("a full-MPN line uses the full enabled distributor sequence in rank order", () => {
  const cfg = config([line({ bomLineId: "A", mpn: "ABC123" })]);
  const plan = reconcilePlanWithLines(mockMasterPlan(cfg), cfg);
  expect(plan.searches[0]?.distributorOrder).toEqual(["Digikey", "LCSC"]); // Unikey disabled, excluded
});

test("reconcilePlanWithLines fills in a sane default for a line the model's plan silently dropped", () => {
  const cfg = config([line({ bomLineId: "A" }), line({ bomLineId: "B" })]);
  const incompletePlan = { searches: [{ bomLineId: "A", distributorOrder: ["Digikey"], notes: null, ruleHit: null }], skip: [], narration: "" };
  const reconciled = reconcilePlanWithLines(incompletePlan, cfg);
  const ids = reconciled.searches.map((s) => s.bomLineId);
  expect(ids).toContain("A");
  expect(ids).toContain("B"); // never silently vanishes
});

test("every planned search carries a usable searchTerm — MPN first, else LCSC, else value+package", () => {
  const plan = mockMasterPlan(
    config([
      line({ bomLineId: "A", mpn: "STM32H743ZIT6" }),
      line({ bomLineId: "B", mpn: null, lcscPn: "C14663" }),
      line({ bomLineId: "C", mpn: null, lcscPn: null, value: "0.1uF", packageName: "0603" }),
    ]),
  );
  const terms = new Map(plan.searches.map((s) => [s.bomLineId, s.searchTerm]));
  expect(terms.get("A")).toBe("STM32H743ZIT6");
  expect(terms.get("B")).toBe("C14663");
  expect(terms.get("C")).toBe("0.1uF 0603");
});

test("reconcilePlanWithLines backfills a searchTerm the model omitted or blanked", () => {
  const cfg = config([line({ bomLineId: "A", mpn: "ABC123" })]);
  const plan = reconcilePlanWithLines(
    { searches: [{ bomLineId: "A", distributorOrder: ["Digikey"], searchTerm: "  ", notes: null, ruleHit: null }], skip: [], narration: "" },
    cfg,
  );
  expect(plan.searches[0]?.searchTerm).toBe("ABC123");
});

test("narration follows the 'Planned N searches · dispatched N item agents.' shape", () => {
  const cfg = config([line({ bomLineId: "A" }), line({ bomLineId: "B" })]);
  const plan = reconcilePlanWithLines(mockMasterPlan(cfg), cfg);
  expect(plan.narration).toBe("Planned 2 searches · dispatched 2 item agents.");
});
