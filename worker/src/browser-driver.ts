/**
 * worker/src/browser-driver.ts — the swappable `BrowserDriver` interface for
 * the LCSC/Unikey/added-site search path (FEATURES.md §0/§4).
 *
 * ⚠️ PHASE-0 GATE: FEATURES.md §0 is explicit — "Phase 0 spike GATES live
 * browsing — code-complete only, NO live distributor calls" until the spike
 * (docs/spike-browser-worker.md) measures a real go/no-go. Every driver
 * below enforces that as CODE, not just convention: none of them will
 * actually navigate anywhere unless `ALLOW_LIVE_BROWSER=1` is set AND
 * `BROWSER_DRIVER` selects them — a belt-and-suspenders gate on top of "CI
 * simply never sets those env vars", because the build brief calls this out
 * as a hard rule, not a soft default.
 */

const LIVE_BROWSER_GATE_ENV = "ALLOW_LIVE_BROWSER";

function assertLiveBrowsingAllowed(driverName: string): void {
  if (process.env[LIVE_BROWSER_GATE_ENV] !== "1") {
    throw new Error(
      `${driverName}: live browsing is Phase-0 gated (FEATURES.md §0 — "GATES live browsing"). ` +
        `Set ${LIVE_BROWSER_GATE_ENV}=1 only inside the supervised spike session described in ` +
        `docs/spike-browser-worker.md; it must never be set in CI or normal operation before the ` +
        `spike's go/no-go line is filled in.`,
    );
  }
}

export interface BrowserSearchQuery {
  siteName: string; // "LCSC" | "Unikey" | a Settings-added browse site
  mpn: string | null;
  lcscPn: string | null;
  value: string | null;
  packageName: string | null;
  /** Master-authored exact query (PlannedSearch.searchTerm) — wins over the driver's own derivation. */
  searchTerm?: string | null;
}

export interface BrowserSearchListing {
  title: string;
  price: number | null;
  currency: string;
  stockQty: number | null;
  url: string;
  raw: unknown;
}

export interface BrowserDriver {
  readonly name: string;
  searchPart(query: BrowserSearchQuery): Promise<BrowserSearchListing[]>;
}

class NotImplementedDriver implements BrowserDriver {
  constructor(readonly name: string) {}

  async searchPart(): Promise<BrowserSearchListing[]> {
    throw new Error(
      `${this.name}: not implemented — Phase-0 spike (FEATURES.md §0) evaluates computer-use/Browserbase ` +
        `AFTER the API-first REST distributors + Playwright baseline are measured. See docs/spike-browser-worker.md.`,
    );
  }
}

/** Anthropic computer-use — primary candidate per FEATURES.md §0; stubbed pending the spike's go/no-go. */
export class ComputerUseDriver extends NotImplementedDriver {
  constructor() {
    super("ComputerUseDriver");
  }
}

/** Browserbase — alternate candidate; stubbed pending the spike's go/no-go. */
export class BrowserbaseDriver extends NotImplementedDriver {
  constructor() {
    super("BrowserbaseDriver");
  }
}

/**
 * Playwright — code-complete (it will actually run once the gate above is
 * open), but NEVER invoked in tests/CI (nothing in this repo sets
 * `BROWSER_DRIVER=playwright` or `ALLOW_LIVE_BROWSER=1`). Uses a dynamic
 * `import("playwright")` behind an ambient `declare module` shim
 * (worker/src/types/playwright-shim.d.ts) so `tsc --noEmit` stays clean
 * without the `playwright` package being installed anywhere in this repo —
 * only a deliberate live run (with `playwright` added to
 * worker/package.json and `bun install`ed) ever actually resolves the
 * import. Selector logic below is a reasonable LCSC/Unikey search-page
 * shape from public knowledge, NOT verified against the live site — the
 * spike's supervised session is where that gets corrected.
 *
 * When `wsEndpoint` is set (from `PLAYWRIGHT_WS_ENDPOINT`, e.g. a remote
 * Hetzner Chromium box), connects to it via `connectOverCDP` instead of
 * launching a local browser — same Phase-0 gate applies either way.
 */
export class PlaywrightDriver implements BrowserDriver {
  readonly name = "PlaywrightDriver";

  /**
   * ONE browser connection per worker process, established lazily and REUSED
   * across searches — connect/launch-per-search was both slow and, against a
   * small remote Chromium box, a resource churn multiplier. Reset to null on
   * any search failure so the next search reconnects cleanly (a dropped CDP
   * websocket otherwise poisons every call after it).
   */
  private browserPromise: Promise<{ newPage(): Promise<unknown>; close(): Promise<void> }> | null = null;

  constructor(private readonly wsEndpoint: string | null = null) {}

  private async ensureBrowser(): Promise<{ newPage(): Promise<unknown>; close(): Promise<void> }> {
    if (!this.browserPromise) {
      this.browserPromise = (async () => {
        // Dynamic import behind the ambient shim — see class doc above.
        const { chromium } = await import("playwright");
        return this.wsEndpoint
          ? await chromium.connectOverCDP(this.wsEndpoint)
          : await chromium.launch({ headless: true });
      })();
    }
    try {
      return await this.browserPromise;
    } catch (error) {
      this.browserPromise = null; // failed connect must not be cached
      throw error;
    }
  }

  async searchPart(query: BrowserSearchQuery): Promise<BrowserSearchListing[]> {
    assertLiveBrowsingAllowed(this.name);

    const browser = await this.ensureBrowser();
    // Minimal structural page type — real types come with the installed package.
    const page = (await browser.newPage()) as ScrapablePage & {
      goto(url: string, opts: { waitUntil: string }): Promise<unknown>;
      waitForTimeout(ms: number): Promise<void>;
      close(): Promise<void>;
    };
    try {
      const keyword =
        query.searchTerm?.trim() ||
        query.mpn ||
        query.lcscPn ||
        [query.value, query.packageName].filter(Boolean).join(" ");
      const searchUrl = buildSearchUrl(query.siteName, keyword);
      await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
      // Human-pacing per FEATURES §15 ("human pacing" on browser-only sites) —
      // a fixed small delay, not a scraping-defeating randomized one.
      await page.waitForTimeout(1500);
      return await scrapeListings(page, query.siteName);
    } catch (error) {
      // Assume the connection may be poisoned — drop it; next search reconnects.
      this.browserPromise = null;
      throw error;
    } finally {
      // Close only the PAGE — the shared browser connection stays up. For a
      // connectOverCDP browser this frees the remote tab immediately.
      await page.close().catch(() => undefined);
    }
  }
}

/**
 * Wraps a driver with the GLOBAL browser semaphore (env
 * `BROWSER_MAX_CONCURRENCY`, default 2): every browse search — any run, any
 * site — must acquire a slot before touching Chromium. Per-site caps bound
 * each distributor; THIS bounds the one shared browser box (a 2 GB server
 * holds ~2–4 heavy distributor pages). A 100-line BOM drains in waves of N.
 */
export function withGlobalBrowserLimit(driver: BrowserDriver, maxConcurrent: number): BrowserDriver {
  const limit = Math.max(1, maxConcurrent);
  let inFlight = 0;
  const waiters: Array<() => void> = [];

  const acquire = async (): Promise<() => void> => {
    // Loop, don't assume: a caller that arrives between a release and this
    // waiter waking could have taken the freed slot already.
    while (inFlight >= limit) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    inFlight += 1;
    return () => {
      inFlight -= 1;
      waiters.shift()?.();
    };
  };

  return {
    name: `${driver.name} (global cap ${limit})`,
    async searchPart(query: BrowserSearchQuery): Promise<BrowserSearchListing[]> {
      const release = await acquire();
      try {
        return await driver.searchPart(query);
      } finally {
        release();
      }
    },
  };
}

function buildSearchUrl(siteName: string, keyword: string): string {
  const encoded = encodeURIComponent(keyword);
  if (siteName === "LCSC") return `https://www.lcsc.com/search?q=${encoded}`;
  if (siteName === "Unikey") return `https://www.unikeyic.com/search?q=${encoded}`;
  throw new Error(`buildSearchUrl: no known search URL pattern for browse-only site "${siteName}"`);
}

// Minimal structural type for the one Playwright method used above — kept
// local (not imported from the `playwright` package's types) so this file
// type-checks whether or not `playwright` is installed.
//
// NOTE: `$$eval` is Playwright's own page-query API (query all matches of a
// CSS selector, then run a callback against them inside the browser page) —
// it is unrelated to JavaScript's global `eval()`; no arbitrary/untrusted
// string is ever executed as code here, the callback is a fixed function
// literal defined below, not dynamic data.
interface ScrapablePage {
  $$eval<T>(selector: string, fn: (elements: Element[]) => T): Promise<T>;
}

async function scrapeListings(page: ScrapablePage, siteName: string): Promise<BrowserSearchListing[]> {
  // Selector strategy is intentionally generic/best-effort — real markup
  // must be confirmed in the supervised spike session (docs/
  // spike-browser-worker.md) before this is trusted for a live run.
  const rows = await page.$$eval(".search-result-row, .product-item", (elements) =>
    elements.map((el) => ({
      title: el.querySelector(".title, .product-name")?.textContent?.trim() ?? "",
      priceText: el.querySelector(".price")?.textContent?.trim() ?? "",
      stockText: el.querySelector(".stock, .in-stock")?.textContent?.trim() ?? "",
      url: (el.querySelector("a") as HTMLAnchorElement | null)?.href ?? "",
    })),
  );

  return rows.map((row) => ({
    title: row.title,
    price: parsePriceText(row.priceText),
    currency: "USD",
    stockQty: parseStockText(row.stockText),
    url: row.url,
    raw: { siteName, ...row },
  }));
}

function parsePriceText(text: string): number | null {
  const numeric = Number.parseFloat(text.replace(/[^0-9.]/g, ""));
  return Number.isNaN(numeric) ? null : numeric;
}

function parseStockText(text: string): number | null {
  const numeric = Number.parseInt(text.replace(/[^0-9]/g, ""), 10);
  return Number.isNaN(numeric) ? null : numeric;
}

export function createBrowserDriver(
  kind: "computeruse" | "playwright" | "browserbase" | null,
  playwrightWsEndpoint: string | null = null,
): BrowserDriver {
  switch (kind) {
    case "computeruse":
      return new ComputerUseDriver();
    case "playwright":
      return new PlaywrightDriver(playwrightWsEndpoint);
    case "browserbase":
      return new BrowserbaseDriver();
    default:
      // No driver configured — anything routed here should have been
      // resolved to MockDistributorClient by distributors/index.ts instead.
      return new NotImplementedDriver("(unconfigured BrowserDriver)");
  }
}
