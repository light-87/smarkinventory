/**
 * worker/src/distributors/mock.ts — deterministic, network-free distributor
 * used by e2e (mocked agents stream results — plan/TESTING.md §3.3) and by
 * the Phase-0 spike harness before any live key/browser session exists.
 *
 * Deterministic by (distributor name × query) hash — same inputs always
 * produce the same price/stock/link, so Playwright snapshots and the spike
 * harness's hit-rate math stay stable across runs. A tiny hand-picked table
 * covers parts the rest of the app's fixtures/docs name explicitly (e.g.
 * `C14663` — AI Memory's baseline "already stocked, don't reorder <500"
 * example, plan/tab-ai-memory.md) so cross-surface demos/tests agree on a
 * fixed number instead of a hash-derived one for that specific part.
 */

import type { DistributorApiType } from "../../../types/worker";
import type { DistributorClient, DistributorListing, DistributorSearchQuery } from "./types";

function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

interface KnownPart {
  price: number;
  stockQty: number;
}

/** Named parts other docs/tests reference by exact value — see file header. */
const KNOWN_PARTS: Record<string, KnownPart> = {
  C14663: { price: 1.2, stockQty: 2568 }, // matches tab-agent-run.md's "2,568 in Box B-12" skip-buy example
  CL10B104MB8NNNC: { price: 1.2, stockQty: 2568 },
};

function lookupKnown(query: DistributorSearchQuery): KnownPart | null {
  if (query.lcscPn && KNOWN_PARTS[query.lcscPn]) return KNOWN_PARTS[query.lcscPn] ?? null;
  if (query.mpn && KNOWN_PARTS[query.mpn]) return KNOWN_PARTS[query.mpn] ?? null;
  return null;
}

export class MockDistributorClient implements DistributorClient {
  constructor(
    readonly name: string,
    readonly apiType: DistributorApiType,
  ) {}

  async search(query: DistributorSearchQuery): Promise<DistributorListing[]> {
    const label = query.mpn ?? query.lcscPn ?? query.value ?? "unspecified-part";
    const known = lookupKnown(query);
    const seed = hashString(`${this.name}|${label}|${query.packageName ?? ""}`);

    const price = known?.price ?? Number((0.01 + (seed % 500) / 100).toFixed(4));
    const stockQty = known?.stockQty ?? 50 + (seed % 4950);
    const unitPriceAt100 = Number((price * 0.85).toFixed(4));

    const listing: DistributorListing = {
      distributorName: this.name,
      title: `${label} (mock listing · ${this.name})`,
      mpn: query.mpn,
      packageName: query.packageName,
      price,
      currency: "INR",
      qtyBreaks: [
        { qty: 1, unitPrice: price },
        { qty: 100, unitPrice: unitPriceAt100 },
      ],
      stockQty,
      partStatus: "active",
      orderLink: `https://mock.invalid/${encodeURIComponent(this.name)}/${encodeURIComponent(label)}`,
      raw: { mock: true, distributor: this.name, query },
    };
    return [listing];
  }
}
