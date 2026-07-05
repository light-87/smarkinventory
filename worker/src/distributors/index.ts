/**
 * worker/src/distributors/index.ts — resolves a `DistributorDescriptor`
 * (name + api_type, from the run config) to the `DistributorClient` that
 * actually knows how to search it.
 */

import type { DistributorDescriptor } from "../../../types/worker";
import type { BrowserDriver } from "../browser-driver";
import type { WorkerEnv } from "../env";
import { createDigikeyClient } from "./digikey";
import { createElement14Client } from "./element14";
import { createMouserClient } from "./mouser";
import { MockDistributorClient } from "./mock";
import type { DistributorClient, DistributorListing, DistributorSearchQuery } from "./types";

/** Adapts a `BrowserDriver` (title/price/stock/url) onto the richer `DistributorClient` shape. */
class BrowserBackedDistributorClient implements DistributorClient {
  readonly apiType = "browse" as const;

  constructor(
    readonly name: string,
    private readonly driver: BrowserDriver,
  ) {}

  async search(query: DistributorSearchQuery): Promise<DistributorListing[]> {
    const listings = await this.driver.searchPart({
      siteName: this.name,
      mpn: query.mpn,
      lcscPn: query.lcscPn,
      value: query.value,
      packageName: query.packageName,
      searchTerm: query.searchTerm ?? null,
    });
    return listings.map(
      (listing): DistributorListing => ({
        distributorName: this.name,
        title: listing.title,
        // Site-specific scrapers (LCSC — F-008) extract a real MPN/package
        // per row; the generic scrape leaves them unset, falling back to the
        // old conservative defaults (null MPN = "not a verified match" on
        // that rung; assume the searched package, not a scraped one).
        mpn: listing.mpn ?? null,
        packageName: listing.packageName ?? query.packageName,
        price: listing.price,
        currency: listing.currency,
        qtyBreaks:
          listing.qtyBreaks && listing.qtyBreaks.length > 0
            ? listing.qtyBreaks
            : listing.price !== null
              ? [{ qty: 1, unitPrice: listing.price }]
              : [],
        stockQty: listing.stockQty,
        partStatus: null,
        orderLink: listing.url,
        raw: listing.raw,
      }),
    );
  }
}

function isRestClientImplemented(name: string): boolean {
  return name === "Digikey" || name === "Mouser" || name === "element14";
}

/**
 * `env` + an already-constructed `BrowserDriver` are both optional — pass
 * `browserDriver: null` (or omit it) for any caller (planner-less tests,
 * the spike harness in mock-only mode) that never touches the browse path.
 */
export function createDistributorClient(
  descriptor: Pick<DistributorDescriptor, "name" | "apiType">,
  env: Pick<WorkerEnv, "digikeyClientId" | "digikeyClientSecret" | "mouserApiKey" | "element14ApiKey">,
  browserDriver: BrowserDriver | null,
): DistributorClient {
  if (descriptor.apiType === "rest") {
    if (descriptor.name === "Digikey") return createDigikeyClient(env);
    if (descriptor.name === "Mouser") return createMouserClient(env);
    if (descriptor.name === "element14") return createElement14Client(env);
    // A Settings-added REST distributor without a dedicated client yet —
    // deterministic mock keeps the pipeline exercisable end-to-end; a real
    // client is a follow-up, not a blocker (notes-for-integrator).
    return new MockDistributorClient(descriptor.name, "rest");
  }

  // LCSC deliberately stays on the browser scraper ALONE (F-011 reverted by
  // user decision): the free jlcsearch API disagreed with lcsc.com's own
  // displayed stock (201k vs 27k for the same part) and only carries one
  // price point — for ordering decisions, the numbers on the page a human
  // would buy from are the source of truth, and the scraper reads exactly
  // those (real stock, full qty-break ladder, sister-part fuzzy matches).
  if (descriptor.apiType === "browse" && browserDriver) {
    return new BrowserBackedDistributorClient(descriptor.name, browserDriver);
  }

  // "browse" with no driver configured, or api_type "none" — mock.
  return new MockDistributorClient(descriptor.name, descriptor.apiType);
}

export { isRestClientImplemented };
