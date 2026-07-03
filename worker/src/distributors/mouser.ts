/**
 * worker/src/distributors/mouser.ts — Mouser REST client (single API key),
 * record/replay-wrapped. Same "no live key ever exercised" caveat as
 * digikey.ts applies — see that file's header.
 */

import type { WorkerEnv } from "../env";
import { withRecordReplay } from "./record-replay";
import type { DistributorClient, DistributorListing, DistributorSearchQuery } from "./types";

const SEARCH_URL = "https://api.mouser.com/api/v1/search/keyword";

interface MouserPriceBreak {
  Quantity: number;
  Price: string; // e.g. "$0.0512"
}

interface MouserPart {
  ManufacturerPartNumber?: string;
  Manufacturer?: string;
  Description?: string;
  LifecycleStatus?: string;
  ProductDetailUrl?: string;
  AvailabilityInStock?: string; // e.g. "12,345"
  PriceBreaks?: MouserPriceBreak[];
  ProductAttributes?: Array<{ AttributeName: string; AttributeValue: string }>;
}

interface MouserSearchResponse {
  SearchResults?: { Parts?: MouserPart[] };
}

function parsePrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const numeric = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
  return Number.isNaN(numeric) ? null : numeric;
}

function parseStock(raw: string | undefined): number | null {
  if (!raw) return null;
  const numeric = Number.parseInt(raw.replace(/[^0-9]/g, ""), 10);
  return Number.isNaN(numeric) ? null : numeric;
}

function partStatusFrom(status: string | undefined): DistributorListing["partStatus"] {
  const normalized = (status ?? "").toLowerCase();
  if (normalized.includes("nrnd") || normalized.includes("not recommended")) return "nrnd";
  if (normalized.includes("obsolete") || normalized.includes("eol")) return "eol";
  if (normalized.includes("active") || normalized === "") return "active";
  return null;
}

function packageFrom(part: MouserPart): string | null {
  const attr = part.ProductAttributes?.find((a) => /package|case/i.test(a.AttributeName));
  return attr?.AttributeValue ?? null;
}

function parseListing(part: MouserPart): DistributorListing {
  const breaks = part.PriceBreaks ?? [];
  const first = breaks[0];
  return {
    distributorName: "Mouser",
    title: part.Description ?? part.ManufacturerPartNumber ?? "",
    mpn: part.ManufacturerPartNumber ?? null,
    packageName: packageFrom(part),
    price: parsePrice(first?.Price),
    currency: "USD",
    qtyBreaks: breaks.map((b) => ({ qty: b.Quantity, unitPrice: parsePrice(b.Price) ?? 0 })),
    stockQty: parseStock(part.AvailabilityInStock),
    partStatus: partStatusFrom(part.LifecycleStatus),
    orderLink: part.ProductDetailUrl ?? null,
    raw: part,
  };
}

export class MouserClient implements DistributorClient {
  readonly name = "Mouser";
  readonly apiType = "rest" as const;

  constructor(private readonly apiKey: string | null) {}

  private async liveSearch(query: DistributorSearchQuery): Promise<DistributorListing[]> {
    if (!this.apiKey) throw new Error("mouser: liveSearch called with no API key — should never happen in replay mode");
    const keyword = query.mpn ?? [query.value, query.packageName].filter(Boolean).join(" ");
    const response = await fetch(`${SEARCH_URL}?apiKey=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ SearchByKeywordRequest: { keyword, records: 10, startingRecord: 0 } }),
    });
    if (!response.ok) {
      throw new Error(`mouser: search failed: HTTP ${response.status}`);
    }
    const json = (await response.json()) as MouserSearchResponse;
    return (json.SearchResults?.Parts ?? []).map(parseListing);
  }

  async search(query: DistributorSearchQuery): Promise<DistributorListing[]> {
    const mode = this.apiKey ? "record" : "replay";
    const key = `mpn:${query.mpn ?? ""}|lcsc:${query.lcscPn ?? ""}|value:${query.value ?? ""}|pkg:${query.packageName ?? ""}`;
    return withRecordReplay(key, { distributorName: this.name, mode }, () => this.liveSearch(query));
  }
}

export function createMouserClient(env: Pick<WorkerEnv, "mouserApiKey">): MouserClient {
  return new MouserClient(env.mouserApiKey);
}
