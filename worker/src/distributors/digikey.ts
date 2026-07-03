/**
 * worker/src/distributors/digikey.ts — Digikey REST client (OAuth2 client-
 * credentials), record/replay-wrapped.
 *
 * BEST-EFFORT integration: NO live Digikey credentials exist anywhere in
 * this build (build brief), so the request shapes below (OAuth2 token
 * endpoint, Product Information v4 keyword-search endpoint) are written
 * from documented public API shape and have never been exercised against
 * the live service. `docs/spike-browser-worker.md` flags this explicitly —
 * verify field names against Digikey's current API reference in a
 * supervised session before the first live run, and adjust `parseListing`
 * to match whatever the real payload actually looks like.
 */

import type { WorkerEnv } from "../env";
import { withRecordReplay } from "./record-replay";
import type { DistributorClient, DistributorListing, DistributorSearchQuery } from "./types";

const TOKEN_URL = "https://api.digikey.com/v1/oauth2/token";
const SEARCH_URL = "https://api.digikey.com/products/v4/search/keyword";

interface DigikeyToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

interface DigikeyProduct {
  ManufacturerProductNumber?: string;
  Description?: { ProductDescription?: string };
  ProductStatus?: { Status?: string };
  ProductUrl?: string;
  QuantityAvailable?: number;
  StandardPricing?: Array<{ BreakQuantity: number; UnitPrice: number }>;
  Parameters?: Array<{ ParameterText: string; ValueText: string }>;
}

interface DigikeySearchResponse {
  Products?: DigikeyProduct[];
}

function partStatusFrom(status: string | undefined): DistributorListing["partStatus"] {
  const normalized = (status ?? "").toLowerCase();
  if (normalized.includes("not recommended") || normalized.includes("nrnd")) return "nrnd";
  if (normalized.includes("obsolete") || normalized.includes("discontinued") || normalized.includes("eol")) return "eol";
  if (normalized.includes("active")) return "active";
  return null;
}

function packageFrom(product: DigikeyProduct): string | null {
  const pkg = product.Parameters?.find((p) => /package|case/i.test(p.ParameterText));
  return pkg?.ValueText ?? null;
}

function parseListing(product: DigikeyProduct): DistributorListing {
  const breaks = product.StandardPricing ?? [];
  const first = breaks[0];
  return {
    distributorName: "Digikey",
    title: product.Description?.ProductDescription ?? product.ManufacturerProductNumber ?? "",
    mpn: product.ManufacturerProductNumber ?? null,
    packageName: packageFrom(product),
    price: first ? first.UnitPrice : null,
    currency: "USD",
    qtyBreaks: breaks.map((b) => ({ qty: b.BreakQuantity, unitPrice: b.UnitPrice })),
    stockQty: product.QuantityAvailable ?? null,
    partStatus: partStatusFrom(product.ProductStatus?.Status),
    orderLink: product.ProductUrl ?? null,
    raw: product,
  };
}

export class DigikeyClient implements DistributorClient {
  readonly name = "Digikey";
  readonly apiType = "rest" as const;

  private token: DigikeyToken | null = null;

  constructor(
    private readonly clientId: string | null,
    private readonly clientSecret: string | null,
  ) {}

  private get hasCredentials(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 5_000) return this.token.accessToken;
    if (!this.clientId || !this.clientSecret) {
      throw new Error("digikey: getAccessToken called with no credentials — should never happen in replay mode");
    }
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!response.ok) {
      throw new Error(`digikey: OAuth2 token request failed: HTTP ${response.status}`);
    }
    const json = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return this.token.accessToken;
  }

  private async liveSearch(query: DistributorSearchQuery): Promise<DistributorListing[]> {
    const keyword = query.mpn ?? [query.value, query.packageName].filter(Boolean).join(" ");
    const accessToken = await this.getAccessToken();
    const response = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-DIGIKEY-Client-Id": this.clientId ?? "",
        "content-type": "application/json",
      },
      body: JSON.stringify({ Keywords: keyword, RecordCount: 10, Filters: { MinimumQuantityAvailable: query.qty } }),
    });
    if (!response.ok) {
      throw new Error(`digikey: search failed: HTTP ${response.status}`);
    }
    const json = (await response.json()) as DigikeySearchResponse;
    return (json.Products ?? []).map(parseListing);
  }

  async search(query: DistributorSearchQuery): Promise<DistributorListing[]> {
    const mode = this.hasCredentials ? "record" : "replay";
    const key = `mpn:${query.mpn ?? ""}|lcsc:${query.lcscPn ?? ""}|value:${query.value ?? ""}|pkg:${query.packageName ?? ""}`;
    return withRecordReplay(key, { distributorName: this.name, mode }, () => this.liveSearch(query));
  }
}

export function createDigikeyClient(env: Pick<WorkerEnv, "digikeyClientId" | "digikeyClientSecret">): DigikeyClient {
  return new DigikeyClient(env.digikeyClientId, env.digikeyClientSecret);
}
