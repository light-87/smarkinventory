/**
 * worker/tests/lcsc-client.test.ts — the hybrid LCSC client (F-011):
 * jlcsearch REST first (keyless), verified browser scraper only as the
 * zero-result/error fallback, everything behind the Phase-0 live gate.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { LcscJlcSearchClient } from "../src/distributors/lcsc";
import type { DistributorClient, DistributorListing, DistributorSearchQuery } from "../src/distributors/types";

const QUERY: DistributorSearchQuery = {
  mpn: "GCM21BR72A104KA37L",
  lcscPn: null,
  value: "0.1uF/100V",
  packageName: "0805",
  searchTerm: "GCM21BR72A104KA37L",
  qty: 5,
};

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

function fallbackClient(listings: DistributorListing[], calls: DistributorSearchQuery[]): DistributorClient {
  return {
    name: "LCSC",
    apiType: "browse",
    async search(query) {
      calls.push(query);
      return listings;
    },
  } as DistributorClient;
}

let originalGate: string | undefined;
beforeEach(() => {
  originalGate = process.env.ALLOW_LIVE_BROWSER;
  process.env.ALLOW_LIVE_BROWSER = "1";
});
afterEach(() => {
  if (originalGate === undefined) delete process.env.ALLOW_LIVE_BROWSER;
  else process.env.ALLOW_LIVE_BROWSER = originalGate;
});

test("maps a jlcsearch hit to a full listing (C-code link, package, stock, price) without touching the fallback", async () => {
  const fallbackCalls: DistributorSearchQuery[] = [];
  const client = new LcscJlcSearchClient(
    fallbackClient([], fallbackCalls),
    fakeFetch({ components: [{ lcsc: 85866, mfr: "GCM21BR72A104KA37L", package: "0805", stock: 201594, price: 0.0151 }] }),
  );

  const listings = await client.search(QUERY);
  expect(fallbackCalls.length).toBe(0);
  expect(listings.length).toBe(1);
  const l = listings[0]!;
  expect(l.mpn).toBe("GCM21BR72A104KA37L");
  expect(l.packageName).toBe("0805");
  expect(l.stockQty).toBe(201594);
  expect(l.price).toBeCloseTo(0.0151);
  expect(l.orderLink).toBe("https://www.lcsc.com/product-detail/C85866.html");
});

test("zero jlcsearch hits → falls back to the scraper", async () => {
  const fallbackCalls: DistributorSearchQuery[] = [];
  const scraped: DistributorListing = {
    distributorName: "LCSC",
    title: "sister part",
    mpn: "CGA6P1X7R1N106KT0Y0E",
    packageName: "1210",
    price: 0.7,
    currency: "USD",
    qtyBreaks: [{ qty: 1, unitPrice: 0.7 }],
    stockQty: 10,
    partStatus: null,
    orderLink: "https://www.lcsc.com/product-detail/C2179334.html",
    raw: null,
  };
  const client = new LcscJlcSearchClient(fallbackClient([scraped], fallbackCalls), fakeFetch({ components: [] }));

  const listings = await client.search(QUERY);
  expect(fallbackCalls.length).toBe(1);
  expect(listings).toEqual([scraped]);
});

test("jlcsearch HTTP error → falls back instead of failing the lane; no fallback → empty", async () => {
  const fallbackCalls: DistributorSearchQuery[] = [];
  const withFallback = new LcscJlcSearchClient(fallbackClient([], fallbackCalls), fakeFetch({}, 503));
  expect(await withFallback.search(QUERY)).toEqual([]);
  expect(fallbackCalls.length).toBe(1);

  const withoutFallback = new LcscJlcSearchClient(null, fakeFetch({}, 503));
  expect(await withoutFallback.search(QUERY)).toEqual([]);
});

test("Phase-0 gate closed → throws before any network call", async () => {
  process.env.ALLOW_LIVE_BROWSER = "0";
  const client = new LcscJlcSearchClient(null, (async () => {
    throw new Error("network must never be reached with the gate closed");
  }) as unknown as typeof fetch);
  await expect(client.search(QUERY)).rejects.toThrow("Phase-0 gated");
});
