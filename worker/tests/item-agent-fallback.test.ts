/**
 * worker/tests/item-agent-fallback.test.ts — the FULL-ladder search
 * (user decisions 2026-07-05, F-009 → F-010): every distributor in the
 * master's order is searched for every line — REST APIs and browse sites
 * alike — and ALL hits accumulate so the pick/Sonnet judge see the complete
 * market. "Not found" therefore means the entire ladder came up empty.
 * depthPerItem no longer truncates the walk (best result first; cost tuning
 * is a later, deliberate step).
 */

import { expect, test } from "bun:test";
import { runItemAgent } from "../src/item-agent";
import { createSiteSemaphore } from "../src/caps";
import type { DistributorClient, DistributorListing } from "../src/distributors/types";
import type { PlannedSearch, WorkerBomLine } from "../../types/worker";

function line(): WorkerBomLine {
  return {
    bomLineId: "line-1",
    lineNo: 1,
    refDesignators: "C1",
    qty: 10,
    value: "100nF",
    footprint: "C0805",
    packageName: "0805",
    voltage: null,
    mpn: "TEST-MPN-1",
    manufacturer: null,
    lcscPn: null,
    dnp: false,
    description: null,
    partLink: null,
    extra: null,
    priorityNote: null,
  };
}

function listing(distributorName: string, price = 1): DistributorListing {
  return {
    distributorName,
    title: "test part",
    mpn: "TEST-MPN-1",
    packageName: "0805",
    price,
    currency: "USD",
    qtyBreaks: [{ qty: 1, unitPrice: price }],
    stockQty: 100,
    partStatus: "active",
    orderLink: "https://example.invalid/p",
    raw: null,
  };
}

/** A client that records being searched and returns a fixed result set. */
function fakeClient(name: string, results: DistributorListing[], searched: string[]): DistributorClient {
  return {
    name,
    apiType: "rest",
    async search() {
      searched.push(name);
      return results;
    },
  } as DistributorClient;
}

function makeOptions(searched: string[], clientResults: Record<string, DistributorListing[]>) {
  const order = Object.keys(clientResults);
  const clients = new Map(order.map((n) => [n, fakeClient(n, clientResults[n]!, searched)]));
  const distributorIds = new Map(order.map((n, i) => [n, `dist-${i}`]));
  const plannedSearch: PlannedSearch = {
    bomLineId: "line-1",
    distributorOrder: order,
    searchTerm: "TEST-MPN-1",
    notes: null,
    ruleHit: null,
  };
  return {
    line: line(),
    plannedSearch,
    depthPerItem: 2, // deliberately SMALLER than the ladder — must not truncate anything
    clients,
    distributorIds,
    siteSemaphore: createSiteSemaphore(),
    rulesDigest: "",
    env: { anthropicApiKey: null, claudeModelItem: "mock" },
  };
}

test("EVERY distributor in the ladder is searched, regardless of depthPerItem, and all hits accumulate", async () => {
  const searched: string[] = [];
  const result = await runItemAgent(
    makeOptions(searched, {
      A: [listing("A", 2)],
      B: [],
      C: [listing("C", 1)], // beyond the old depth cap of 2 — must STILL be searched
      D: [listing("D", 3)],
    }),
  );

  expect(searched).toEqual(["A", "B", "C", "D"]);
  expect(result.outcome.results.map((r) => r.distributorName).sort()).toEqual(["A", "C", "D"]);
  // The complete market means the cheapest package-matched exact hit wins.
  expect(result.outcome.results.find((r) => r.isRecommended)?.distributorName).toBe("C");
});

test("nothing anywhere → empty results only after the WHOLE ladder was searched", async () => {
  const searched: string[] = [];
  const result = await runItemAgent(makeOptions(searched, { A: [], B: [], C: [], D: [] }));

  expect(searched).toEqual(["A", "B", "C", "D"]);
  expect(result.outcome.results).toEqual([]);
});

test("an unknown/disabled distributor in the order is skipped without failing the line", async () => {
  const searched: string[] = [];
  const options = makeOptions(searched, { A: [], B: [listing("B")] });
  options.plannedSearch.distributorOrder = ["A", "Ghost", "B"]; // "Ghost" has no client
  const result = await runItemAgent(options);

  expect(searched).toEqual(["A", "B"]);
  expect(result.outcome.results.length).toBe(1);
});
