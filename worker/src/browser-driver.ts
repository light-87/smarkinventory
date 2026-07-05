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
  /**
   * Structured fields a site-specific scraper managed to extract (the LCSC
   * results table exposes all of these — verified against the live site
   * 2026-07-05, F-008). Absent/null on generic best-effort scrapes; the
   * distributor adapter falls back to its old conservative defaults.
   */
  mpn?: string | null;
  lcscPn?: string | null;
  packageName?: string | null;
  manufacturer?: string | null;
  qtyBreaks?: { qty: number; unitPrice: number }[];
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
/**
 * A realistic desktop-Chrome identity for the scraping context. LCSC sits
 * behind Akamai, which serves "Access Denied" to the default Playwright
 * HeadlessChrome user agent (verified live 2026-07-05, F-008) — with this UA
 * the full results table renders. Note Akamai ALSO blocks well-known
 * datacenter IP ranges outright (the Hetzner browserless box gets denied
 * regardless of UA), so LCSC browsing must run from a residential/office IP
 * until a proxy is in place.
 */
const SCRAPE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class PlaywrightDriver implements BrowserDriver {
  readonly name = "PlaywrightDriver";

  /**
   * ONE browser connection + ONE browser context per worker process,
   * established lazily and REUSED across searches — connect/launch-per-search
   * was both slow and, against a small remote Chromium box, a resource churn
   * multiplier. The context carries the realistic UA above (a bare
   * `browser.newPage()` would use the blocked HeadlessChrome identity).
   * Reset to null on any search failure so the next search reconnects cleanly
   * (a dropped CDP websocket otherwise poisons every call after it).
   */
  private contextPromise: Promise<ScrapableContext> | null = null;

  constructor(private readonly wsEndpoint: string | null = null) {}

  private launches = 0;

  private async ensureContext(): Promise<ScrapableContext> {
    if (!this.contextPromise) {
      this.contextPromise = (async () => {
        // Dynamic import behind the ambient shim — see class doc above.
        const { chromium } = await import("playwright");
        const browser = this.wsEndpoint
          ? await chromium.connectOverCDP(this.wsEndpoint)
          : await chromium.launch({ headless: true });
        this.launches += 1;
        const n = this.launches;
        console.log(`[browser] ${this.wsEndpoint ? "connected" : "launched"} browser #${n}`);
        (browser as { on?: (event: string, fn: () => void) => void }).on?.("disconnected", () => {
          console.warn(`[browser] browser #${n} DISCONNECTED`);
          this.contextPromise = null; // a dead browser must never serve the next search
        });
        return (await browser.newContext({
          userAgent: SCRAPE_USER_AGENT,
          viewport: { width: 1366, height: 900 },
          locale: "en-US",
          extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
        })) as ScrapableContext;
      })();
    }
    try {
      return await this.contextPromise;
    } catch (error) {
      this.contextPromise = null; // failed connect must not be cached
      throw error;
    }
  }

  async searchPart(query: BrowserSearchQuery): Promise<BrowserSearchListing[]> {
    assertLiveBrowsingAllowed(this.name);

    const keyword =
      query.searchTerm?.trim() ||
      query.mpn ||
      query.lcscPn ||
      [query.value, query.packageName].filter(Boolean).join(" ");
    const searchUrl = buildSearchUrl(query.siteName, keyword);
    if (!searchUrl) {
      // A browse-typed distributor this driver has no URL pattern for
      // (e.g. Digikey mis-seeded as "browse" instead of "rest") — treat as
      // "no listings found" so the line's OTHER distributors still get their
      // shot, rather than failing the whole item agent. Checked BEFORE any
      // browser work so an unknown site never launches Chromium.
      console.warn(`[browser] no search URL pattern for browse site "${query.siteName}" — returning 0 listings`);
      return [];
    }

    const context = await this.ensureContext();
    const page = (await context.newPage()) as ScrapablePage;
    console.log(`[browser] → ${query.siteName} "${keyword}"`);
    try {
      if (query.siteName === "LCSC") {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
        // LCSC is a client-rendered SPA — wait for actual product rows; a
        // zero-result search never renders them, so a timeout here just
        // means "no listings", not an error.
        await page.waitForSelector("tr[id^=productId]", { timeout: 15_000 }).catch(() => undefined);
        const listings = await scrapeLcscListings(page);
        console.log(`[browser] ← LCSC "${keyword}": ${listings.length} listing(s)`);
        return listings;
      }
      // Generic best-effort path for other browse sites. A site that never
      // finishes loading (unikeyic.com hangs indefinitely — verified live
      // 2026-07-05) is "no listings", not a lane failure: 15s is generous
      // for a search page's domcontentloaded.
      try {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Timeout")) {
          console.warn(`[browser] ← ${query.siteName} "${keyword}": navigation timeout — treating as 0 listings`);
          return [];
        }
        throw error;
      }
      // Human-pacing per FEATURES §15, then a loose structural scrape.
      await page.waitForTimeout(1500);
      const listings = await scrapeListings(page, query.siteName);
      console.log(`[browser] ← ${query.siteName} "${keyword}": ${listings.length} listing(s)`);
      return listings;
    } catch (error) {
      // Assume the connection may be poisoned — drop it; next search reconnects.
      this.contextPromise = null;
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

function buildSearchUrl(siteName: string, keyword: string): string | null {
  const encoded = encodeURIComponent(keyword);
  if (siteName === "LCSC") return `https://www.lcsc.com/search?q=${encoded}`;
  if (siteName === "Unikey") return `https://www.unikeyic.com/search?q=${encoded}`;
  return null; // unknown browse site — searchPart treats this as "no listings", not an error
}

// Minimal structural types for the few Playwright methods used above — kept
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
  goto(url: string, opts: { waitUntil: string; timeout?: number }): Promise<unknown>;
  waitForSelector(selector: string, opts: { timeout?: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  close(): Promise<void>;
}

interface ScrapableContext {
  newPage(): Promise<unknown>;
}

/**
 * LCSC results-table scraper — selectors verified against the live site
 * (2026-07-05, F-008): each product is a `tr[id^=productId]`; the row's
 * product-detail link filename is the LCSC part number (C85866.html); the
 * MPN cell contains "MPN LCSCPN" together; availability reads "27,150 In
 * Stock"; the pricing cell holds qty-break pairs "500+ $0.0273"; the cell
 * right after the description holds the package ("0805"). Cell positions
 * shift with column config, so parsing anchors on CONTENT patterns
 * (the C-number, "In Stock", "$" pairs), not fixed indices.
 */
async function scrapeLcscListings(page: ScrapablePage): Promise<BrowserSearchListing[]> {
  const rows = await page.$$eval("tr[id^=productId]", (elements) =>
    elements.map((tr) => {
      const cells = Array.from(tr.children)
        .filter((el) => el.tagName === "TD")
        .map((td) => ((td as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim());
      const detail = tr.querySelector("a[href*='/product-detail/']") as HTMLAnchorElement | null;
      return { cells, href: detail?.href?.split("?")[0] ?? "" };
    }),
  );

  const listings: BrowserSearchListing[] = [];
  for (const row of rows) {
    const lcscPn = /\/(C\d+)\.html$/.exec(row.href)?.[1] ?? null;

    // The MPN cell is the one that also carries the LCSC PN token.
    const mpnCellIdx = lcscPn ? row.cells.findIndex((c) => c.includes(lcscPn)) : -1;
    const mpn =
      mpnCellIdx >= 0 && lcscPn
        ? row.cells[mpnCellIdx]!.replace(lcscPn, "").trim() || null
        : null;
    const manufacturer = mpnCellIdx >= 0 ? (row.cells[mpnCellIdx + 1]?.trim() || null) : null;

    const stockCell = row.cells.find((c) => /In Stock/i.test(c)) ?? "";
    const stockQty = parseStockText(stockCell);

    // Qty breaks: every "500+ $0.0273" pair in the row (the pricing cell).
    const qtyBreaks: { qty: number; unitPrice: number }[] = [];
    const priceCell = row.cells.find((c) => /\d\+\s*\$\d/.test(c)) ?? "";
    for (const m of priceCell.matchAll(/([\d,]+)\+\s*\$([\d.]+)/g)) {
      const qty = Number.parseInt(m[1]!.replace(/,/g, ""), 10);
      const unitPrice = Number.parseFloat(m[2]!);
      if (Number.isFinite(qty) && Number.isFinite(unitPrice)) qtyBreaks.push({ qty, unitPrice });
    }

    // Description = longest cell that carries no price/stock text (LCSC's is
    // a full sentence, e.g. "10uF ±10% X7R 75V 1210 Ceramic Capacitors
    // RoHS" — the pricing cell is often longer, so "$"-bearing cells are
    // excluded, not just outscored); package = the cell right after it.
    let descIdx = -1;
    for (let i = 0; i < row.cells.length; i += 1) {
      const cell = row.cells[i]!;
      if (i === mpnCellIdx || cell.includes("$") || /In Stock/i.test(cell)) continue;
      if (descIdx === -1 || cell.length > row.cells[descIdx]!.length) descIdx = i;
    }
    const description = descIdx >= 0 ? row.cells[descIdx]! : "";
    const packageName = descIdx >= 0 ? (row.cells[descIdx + 1]?.trim() || null) : null;

    listings.push({
      title: description || mpn || lcscPn || "LCSC listing",
      price: qtyBreaks[0]?.unitPrice ?? null,
      currency: "USD",
      stockQty,
      url: row.href,
      raw: { siteName: "LCSC", cells: row.cells, href: row.href },
      mpn,
      lcscPn,
      packageName,
      manufacturer,
      qtyBreaks,
    });
  }
  return listings;
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
