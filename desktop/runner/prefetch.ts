/**
 * desktop/runner/prefetch.ts — REST pre-fetch for the desktop agent session.
 * Distributor APIs are CODE, not agent work: free, instant, exact — the
 * Claude session then spends its effort on browsing (LCSC/Unikey/gaps) and
 * judging, not API plumbing. Field mappings follow the LIVE payload shapes
 * verified in F-013 (2026-07-05): DigiKey v4 pricing nests in
 * ProductVariations; element14 stock = `inv`, the in.element14.com store
 * prices in INR, and its free tier 403s under rapid calls (paced + retried
 * once here). Keys are optional — a missing key just skips that API.
 */

import type { WorkerBomLine } from "../../types/worker";

export interface RestCandidate {
  source: "DigiKey" | "Mouser" | "element14";
  mpn: string | null;
  title: string;
  packageText: string | null;
  stock: number | null;
  currency: "USD" | "INR";
  price: number | null;
  breaks: Array<{ qty: number; unitPrice: number }>;
  status: string | null;
  url: string | null;
}

export function keywordOf(line: WorkerBomLine): string {
  if (line.mpn) return line.mpn;
  return [line.value?.replace("/", " "), line.packageName].filter(Boolean).join(" ") || (line.refDesignators ?? "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let dkToken: string | null = null;
async function digikeyToken(clientId: string, clientSecret: string): Promise<string> {
  if (dkToken) return dkToken;
  const res = await fetch("https://api.digikey.com/v1/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error(`digikey token HTTP ${res.status}`);
  const json = (await res.json()) as { access_token: string };
  dkToken = json.access_token;
  setTimeout(() => (dkToken = null), 9 * 60 * 1000).unref?.();
  return dkToken;
}

interface DkProduct {
  ManufacturerProductNumber?: string;
  Description?: { ProductDescription?: string };
  ProductStatus?: { Status?: string };
  ProductUrl?: string;
  UnitPrice?: number;
  QuantityAvailable?: number;
  Parameters?: Array<{ ParameterText?: string; ValueText?: string }>;
  ProductVariations?: Array<{
    PackageType?: { Name?: string };
    StandardPricing?: Array<{ BreakQuantity: number; UnitPrice: number }>;
  }>;
}

async function digikey(keyword: string): Promise<RestCandidate[]> {
  const id = process.env.DIGIKEY_CLIENT_ID, secret = process.env.DIGIKEY_CLIENT_SECRET;
  if (!id || !secret) return [];
  const res = await fetch("https://api.digikey.com/products/v4/search/keyword", {
    method: "POST",
    headers: { Authorization: `Bearer ${await digikeyToken(id, secret)}`, "X-DIGIKEY-Client-Id": id, "content-type": "application/json" },
    body: JSON.stringify({ Keywords: keyword, Limit: 5, Offset: 0 }),
  });
  if (!res.ok) throw new Error(`digikey HTTP ${res.status}`);
  const json = (await res.json()) as { Products?: DkProduct[] };
  return (json.Products ?? []).map((p): RestCandidate => {
    const variations = p.ProductVariations ?? [];
    const variation = variations.find((v) => /cut tape/i.test(v.PackageType?.Name ?? "")) ?? variations[0];
    const breaks = (variation?.StandardPricing ?? []).map((b) => ({ qty: b.BreakQuantity, unitPrice: b.UnitPrice }));
    return {
      source: "DigiKey",
      mpn: p.ManufacturerProductNumber ?? null,
      title: p.Description?.ProductDescription ?? "",
      packageText: (p.Parameters ?? []).find((x) => /package|case/i.test(x.ParameterText ?? ""))?.ValueText ?? null,
      stock: p.QuantityAvailable ?? null,
      currency: "USD",
      price: breaks[0]?.unitPrice ?? p.UnitPrice ?? null,
      breaks: breaks.slice(0, 4),
      status: p.ProductStatus?.Status ?? null,
      url: p.ProductUrl ?? null,
    };
  });
}

async function mouser(keyword: string): Promise<RestCandidate[]> {
  const key = process.env.MOUSER_API_KEY;
  if (!key) return [];
  const res = await fetch(`https://api.mouser.com/api/v1/search/keyword?apiKey=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ SearchByKeywordRequest: { keyword, records: 5, startingRecord: 0 } }),
  });
  if (!res.ok) throw new Error(`mouser HTTP ${res.status}`);
  interface MouserPart {
    ManufacturerPartNumber?: string;
    Description?: string;
    LifecycleStatus?: string | null;
    ProductDetailUrl?: string;
    AvailabilityInStock?: string;
    PriceBreaks?: Array<{ Quantity: number; Price: string }>;
    ProductAttributes?: Array<{ AttributeName?: string; AttributeValue?: string }>;
  }
  const json = (await res.json()) as { Errors?: Array<{ Message?: string }>; SearchResults?: { Parts?: MouserPart[] } };
  if (json.Errors && json.Errors.length > 0) throw new Error(`mouser: ${json.Errors[0]?.Message ?? "api error"}`);
  return (json.SearchResults?.Parts ?? []).map((p): RestCandidate => {
    const breaks = (p.PriceBreaks ?? []).map((b) => ({ qty: b.Quantity, unitPrice: Number.parseFloat(String(b.Price).replace(/[^0-9.]/g, "")) }));
    return {
      source: "Mouser",
      mpn: p.ManufacturerPartNumber ?? null,
      title: p.Description ?? "",
      packageText: (p.ProductAttributes ?? []).find((a) => /package|case/i.test(a.AttributeName ?? ""))?.AttributeValue ?? null,
      stock: Number.parseInt(String(p.AvailabilityInStock ?? "").replace(/[^0-9]/g, ""), 10) || null,
      currency: "USD",
      price: breaks[0]?.unitPrice ?? null,
      breaks: breaks.slice(0, 4),
      status: p.LifecycleStatus ?? null,
      url: p.ProductDetailUrl ?? null,
    };
  });
}

async function element14(keyword: string, isMpn: boolean, retry = true): Promise<RestCandidate[]> {
  const key = process.env.ELEMENT14_API_KEY;
  if (!key) return [];
  const params = new URLSearchParams({
    term: isMpn ? `manuPartNum:${keyword}` : `any:${keyword}`,
    "storeInfo.id": "in.element14.com",
    "callInfo.responseDataFormat": "JSON",
    "callInfo.apiKey": key,
    "resultsSettings.offset": "0",
    "resultsSettings.numberOfResults": "5",
    "resultsSettings.responseGroup": "large",
  });
  const res = await fetch(`https://api.element14.com/catalog/products?${params.toString()}`);
  if (res.status === 403 && retry) {
    await sleep(2500); // free tier rate limit — one paced retry (F-013)
    return element14(keyword, isMpn, false);
  }
  if (!res.ok) throw new Error(`element14 HTTP ${res.status}`);
  interface E14Product {
    sku?: string;
    displayName?: string;
    productStatus?: string;
    translatedManufacturerPartNumber?: string;
    inv?: number;
    prices?: Array<{ from: number; to: number; cost: number }>;
    attributes?: Array<{ attributeLabel?: string; attributeValue?: string }>;
  }
  const json = (await res.json()) as Record<string, { products?: E14Product[] }>;
  const retKey = Object.keys(json).find((k) => /Return/i.test(k));
  return ((retKey ? json[retKey]?.products : []) ?? []).map((p): RestCandidate => {
    const breaks = (p.prices ?? []).map((b) => ({ qty: b.from, unitPrice: b.cost }));
    return {
      source: "element14",
      mpn: p.translatedManufacturerPartNumber ?? null,
      title: p.displayName ?? "",
      packageText: (p.attributes ?? []).find((a) => /package|case/i.test(a.attributeLabel ?? ""))?.attributeValue ?? null,
      stock: typeof p.inv === "number" ? p.inv : null,
      currency: "INR",
      price: breaks[0]?.unitPrice ?? null,
      breaks: breaks.slice(0, 4),
      status: p.productStatus ?? null,
      url: p.sku ? `https://in.element14.com/-/-/-/dp/${p.sku}` : null,
    };
  });
}

export interface PrefetchLine {
  bomLineId: string;
  keyword: string;
  candidates: RestCandidate[];
  errors: string[];
}

interface RestSource {
  /** Canonical distributor name — matched case-insensitively against config.distributorSequence[].name. */
  name: string;
  fetch: (keyword: string, line: WorkerBomLine) => Promise<RestCandidate[]>;
}

/**
 * The only distributors with a REST API to pre-fetch. LCSC and Unikey are
 * browse-only (no API) and never appear here — for a run enabling only those,
 * prefetch has nothing to do and is skipped entirely (see run.ts). Public so
 * the runner can tell "REST distributor" from "browse-only" when it decides
 * whether to prefetch at all.
 */
export const REST_SOURCES: readonly RestSource[] = [
  { name: "DigiKey", fetch: (keyword) => digikey(keyword) },
  { name: "Mouser", fetch: (keyword) => mouser(keyword) },
  { name: "element14", fetch: (keyword, line) => element14(keyword, Boolean(line.mpn)) },
];

/** True when at least one of the run's enabled distributors is a REST-API one worth pre-fetching. */
export function hasRestDistributor(enabledNames: Iterable<string>): boolean {
  const enabled = new Set(Array.from(enabledNames, (n) => n.toLowerCase()));
  return REST_SOURCES.some((s) => enabled.has(s.name.toLowerCase()));
}

/**
 * Pre-fetch REST candidates for every line — but ONLY from the distributors
 * the run actually enabled (`enabledNames`, matched case-insensitively). This
 * is the fix for the "I set LCSC only but it prefetches DigiKey/Mouser/
 * element14 anyway (and reports 0 results)" report: a browse-only run now hits
 * no APIs at all, and a REST-subset run only hits the ones it asked for.
 */
export async function prefetchAll(
  lines: WorkerBomLine[],
  enabledNames: Iterable<string>,
  onProgress?: (done: number, total: number) => void,
): Promise<PrefetchLine[]> {
  const enabled = new Set(Array.from(enabledNames, (n) => n.toLowerCase()));
  const sources = REST_SOURCES.filter((s) => enabled.has(s.name.toLowerCase()));

  // No enabled REST distributor → nothing to fetch. Return empty candidates
  // immediately instead of sleeping through every line for zero API calls.
  if (sources.length === 0) {
    return lines.map((line) => ({ bomLineId: line.bomLineId, keyword: keywordOf(line), candidates: [], errors: [] }));
  }

  const out: PrefetchLine[] = [];
  for (const [i, line] of lines.entries()) {
    const keyword = keywordOf(line);
    const candidates: RestCandidate[] = [];
    const errors: string[] = [];
    for (const source of sources) {
      try {
        candidates.push(...(await source.fetch(keyword, line)));
      } catch (e) {
        errors.push(`${source.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      await sleep(400);
    }
    out.push({ bomLineId: line.bomLineId, keyword, candidates, errors });
    onProgress?.(i + 1, lines.length);
    await sleep(800); // Mouser free tier: stay well under 30 calls/min
  }
  return out;
}
