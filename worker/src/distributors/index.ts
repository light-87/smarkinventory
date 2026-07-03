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
    });
    return listings.map(
      (listing): DistributorListing => ({
        distributorName: this.name,
        title: listing.title,
        // Browser scraping doesn't reliably separate out a structured MPN/
        // package from page text — matcher-lite treats a null package as
        // "not a verified match" (mandatory rung), which is the SAFE default
        // here until a site-specific scraper extracts it explicitly.
        mpn: null,
        packageName: query.packageName, // best-effort: assume the searched package, not a scraped one
        price: listing.price,
        currency: listing.currency,
        qtyBreaks: listing.price !== null ? [{ qty: 1, unitPrice: listing.price }] : [],
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

  if (descriptor.apiType === "browse" && browserDriver) {
    return new BrowserBackedDistributorClient(descriptor.name, browserDriver);
  }

  // "browse" with no driver configured, or api_type "none" — mock.
  return new MockDistributorClient(descriptor.name, descriptor.apiType);
}

export { isRestClientImplemented };
