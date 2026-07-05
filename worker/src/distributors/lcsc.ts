/**
 * worker/src/distributors/lcsc.ts — LCSC via the FREE, keyless jlcsearch
 * community API (https://jlcsearch.tscircuit.com — LCSC/JLCPCB share one
 * parts library), with the verified browser scraper as fallback.
 *
 * Verified live 2026-07-05 (F-011):
 *   - exact MPN / C-code lookups return structured stock, package, price —
 *     no browser, no Akamai IP-blocking (works from the datacenter box too);
 *   - but it has ZERO fuzzy matching (a near-miss MPN returns []), while
 *     LCSC's own site search DOES surface sister parts — so on zero hits
 *     this client falls back to the browser scraper when one is configured.
 *
 * Same Phase-0 discipline as the browser path: a LIVE network call only
 * happens behind ALLOW_LIVE_BROWSER=1 (FEATURES §0 gates "live distributor
 * calls", not just browsers). Tests/e2e never construct this client — the
 * factory only routes LCSC here when a browser driver is configured, which
 * mock/e2e setups never do.
 */

import type { DistributorClient, DistributorListing, DistributorSearchQuery } from "./types";

const JLCSEARCH_URL = "https://jlcsearch.tscircuit.com/api/search";
/** Community-run API — its docs ask for ~0.5s between calls. */
const COURTESY_DELAY_MS = 500;

interface JlcComponent {
  lcsc: number;
  mfr?: string;
  package?: string;
  description?: string;
  stock?: number;
  price?: number;
  is_basic?: boolean;
  is_preferred?: boolean;
}

function toListing(component: JlcComponent): DistributorListing {
  const lcscCode = `C${component.lcsc}`;
  return {
    distributorName: "LCSC",
    title: component.description?.trim() || `${component.mfr ?? lcscCode} (${lcscCode})`,
    mpn: component.mfr ?? null,
    packageName: component.package?.trim() || null,
    price: typeof component.price === "number" && Number.isFinite(component.price) ? component.price : null,
    currency: "USD",
    qtyBreaks:
      typeof component.price === "number" && Number.isFinite(component.price)
        ? [{ qty: 1, unitPrice: component.price }]
        : [],
    stockQty: typeof component.stock === "number" && Number.isFinite(component.stock) ? component.stock : null,
    partStatus: null,
    orderLink: `https://www.lcsc.com/product-detail/${lcscCode}.html`,
    raw: { source: "jlcsearch", lcscCode, ...component },
  };
}

export class LcscJlcSearchClient implements DistributorClient {
  readonly name = "LCSC";
  readonly apiType = "browse" as const; // LCSC stays 'browse' in smark_distributors; this client is an implementation upgrade

  private lastCallAt = 0;

  /**
   * `fallback` is the browser-scraper-backed client (or null) — consulted
   * ONLY when jlcsearch returns zero components or errors, because the
   * site's own search finds sister/near-miss parts the API cannot.
   */
  constructor(
    private readonly fallback: DistributorClient | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async courtesyPause(): Promise<void> {
    const wait = this.lastCallAt + COURTESY_DELAY_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastCallAt = Date.now();
  }

  async search(query: DistributorSearchQuery): Promise<DistributorListing[]> {
    if (process.env.ALLOW_LIVE_BROWSER !== "1") {
      throw new Error(
        "LcscJlcSearchClient: live distributor calls are Phase-0 gated (FEATURES §0) — set ALLOW_LIVE_BROWSER=1 only in a supervised live session.",
      );
    }

    const keyword =
      query.searchTerm?.trim() ||
      query.mpn ||
      query.lcscPn ||
      [query.value, query.packageName].filter(Boolean).join(" ");
    if (!keyword) return [];

    try {
      await this.courtesyPause();
      const url = `${JLCSEARCH_URL}?q=${encodeURIComponent(keyword)}&limit=10&full=true`;
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`jlcsearch: HTTP ${response.status}`);
      const json = (await response.json()) as { components?: JlcComponent[] };
      const listings = (json.components ?? []).map(toListing);
      if (listings.length > 0) {
        console.log(`[lcsc] jlcsearch "${keyword}": ${listings.length} listing(s)`);
        return listings;
      }
      console.log(`[lcsc] jlcsearch "${keyword}": 0 — ${this.fallback ? "falling back to site scrape" : "no fallback configured"}`);
    } catch (error) {
      console.warn(
        `[lcsc] jlcsearch "${keyword}" failed (${error instanceof Error ? error.message : String(error)}) — ${
          this.fallback ? "falling back to site scrape" : "no fallback configured"
        }`,
      );
    }

    return this.fallback ? this.fallback.search(query) : [];
  }
}
