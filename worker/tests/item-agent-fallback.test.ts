/**
 * worker/tests/item-agent-fallback.test.ts — the not-found fallback ladder
 * (user decision 2026-07-05): the tier's `depthPerItem` caps how many
 * distributors are searched for PRICE COMPARISON, but when that walk finds
 * NOTHING the agent must keep walking the REST of the master's order —
 * REST APIs first, browse sites last — and only report "not found" after
 * the whole ladder came up empty.
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

function listing(distributorName: string): DistributorListing {
  return {
    distributorName,
    title: "test part",
    mpn: "TEST-MPN-1",
    packageName: "0805",
    price: 1,
    currency: "USD",
    qtyBreaks: [{ qty: 1, unitPrice: 1 }],
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
    depthPerItem: 2,
    clients,
    distributorIds,
    siteSemaphore: createSiteSemaphore(),
    rulesDigest: "",
    env: { anthropicApiKey: null, claudeModelItem: "mock" },
  };
}

test("zero results within depth → keeps walking the ladder and stops at the first hit", async () => {
  const searched: string[] = [];
  const result = await runItemAgent(
    makeOptions(searched, {
      A: [], // within depth
      B: [], // within depth (depthPerItem = 2)
      C: [], // fallback rung 1 — still nothing
      D: [listing("D")], // fallback rung 2 — HIT, walk stops here
      E: [listing("E")], // must never be searched
    }),
  );

  expect(searched).toEqual(["A", "B", "C", "D"]);
  expect(result.outcome.results.length).toBe(1);
  expect(result.outcome.results[0]!.distributorName).toBe("D");
});

test("results within depth → NO fallback walk (depth caps price comparison)", async () => {
  const searched: string[] = [];
  const result = await runItemAgent(
    makeOptions(searched, {
      A: [listing("A")],
      B: [listing("B")],
      C: [listing("C")], // beyond depth — not searched when depth already found options
    }),
  );

  expect(searched).toEqual(["A", "B"]);
  expect(result.outcome.results.length).toBe(2);
});

test("nothing anywhere → empty results after the WHOLE ladder was searched", async () => {
  const searched: string[] = [];
  const result = await runItemAgent(makeOptions(searched, { A: [], B: [], C: [], D: [] }));

  expect(searched).toEqual(["A", "B", "C", "D"]);
  expect(result.outcome.results).toEqual([]);
});
