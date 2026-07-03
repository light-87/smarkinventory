/**
 * worker/src/distributors/element14.ts — element14/Premier Farnell REST
 * client (single API key + region), record/replay-wrapped. Same "no live
 * key ever exercised" caveat as digikey.ts applies — see that file's header.
 */

import type { WorkerEnv } from "../env";
import { withRecordReplay } from "./record-replay";
import type { DistributorClient, DistributorListing, DistributorSearchQuery } from "./types";

const SEARCH_URL = "https://api.element14.com/catalog/products";
const DEFAULT_STORE_ID = "in.element14.com";

interface Element14Product {
  translatedManufacturerPartNumber?: string;
  displayName?: string;
  lifecycleStatus?: string;
  productStatus?: string;
  sku?: string;
  prices?: Array<{ from: number; to: number; cost: number }>;
  stock?: { level?: number };
  productUrl?: string;
  attributes?: Array<{ attributeLabel: string; attributeValue: string }>;
}

interface Element14Response {
  manufacturerPartNumberSearchReturn?: { products?: Element14Product[] };
  keywordSearchReturn?: { products?: Element14Product[] };
}

function partStatusFrom(status: string | undefined): DistributorListing["partStatus"] {
  const normalized = (status ?? "").toLowerCase();
  if (normalized.includes("nrnd")) return "nrnd";
  if (normalized.includes("obsolete") || normalized.includes("eol") || normalized.includes("discontinued")) return "eol";
  if (normalized.includes("active") || normalized === "") return "active";
  return null;
}

function packageFrom(product: Element14Product): string | null {
  const attr = product.attributes?.find((a) => /package|case/i.test(a.attributeLabel));
  return attr?.attributeValue ?? null;
}

function parseListing(product: Element14Product): DistributorListing {
  const breaks = product.prices ?? [];
  const first = breaks[0];
  return {
    distributorName: "element14",
    title: product.displayName ?? product.translatedManufacturerPartNumber ?? "",
    mpn: product.translatedManufacturerPartNumber ?? null,
    packageName: packageFrom(product),
    price: first ? first.cost : null,
    currency: "INR",
    qtyBreaks: breaks.map((b) => ({ qty: b.from, unitPrice: b.cost })),
    stockQty: product.stock?.level ?? null,
    partStatus: partStatusFrom(product.lifecycleStatus ?? product.productStatus),
    orderLink: product.productUrl ?? null,
    raw: product,
  };
}

export class Element14Client implements DistributorClient {
  readonly name = "element14";
  readonly apiType = "rest" as const;

  constructor(
    private readonly apiKey: string | null,
    private readonly storeId: string = DEFAULT_STORE_ID,
  ) {}

  private async liveSearch(query: DistributorSearchQuery): Promise<DistributorListing[]> {
    if (!this.apiKey) throw new Error("element14: liveSearch called with no API key — should never happen in replay mode");
    const term = query.mpn
      ? `manuPartNum:${query.mpn}`
      : [query.value, query.packageName].filter(Boolean).join(" ");
    const params = new URLSearchParams({
      term,
      "storeInfo.id": this.storeId,
      "callInfo.responseDataFormat": "JSON",
      "callInfo.apiKey": this.apiKey,
      resultsSettings: JSON.stringify({ offset: 0, numberOfResults: 10 }),
    });
    const response = await fetch(`${SEARCH_URL}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`element14: search failed: HTTP ${response.status}`);
    }
    const json = (await response.json()) as Element14Response;
    const products =
      json.manufacturerPartNumberSearchReturn?.products ?? json.keywordSearchReturn?.products ?? [];
    return products.map(parseListing);
  }

  async search(query: DistributorSearchQuery): Promise<DistributorListing[]> {
    const mode = this.apiKey ? "record" : "replay";
    const key = `mpn:${query.mpn ?? ""}|lcsc:${query.lcscPn ?? ""}|value:${query.value ?? ""}|pkg:${query.packageName ?? ""}`;
    return withRecordReplay(key, { distributorName: this.name, mode }, () => this.liveSearch(query));
  }
}

export function createElement14Client(env: Pick<WorkerEnv, "element14ApiKey">): Element14Client {
  return new Element14Client(env.element14ApiKey);
}
