/**
 * worker/tests/browser-limit.test.ts — the GLOBAL browser semaphore
 * (`withGlobalBrowserLimit`, env BROWSER_MAX_CONCURRENCY): every browse
 * search across all runs/sites shares ONE Chromium box, so the box-wide cap
 * — not the per-site caps — is what bounds peak pages on a 2 GB server.
 */

import { expect, test } from "bun:test";
import { withGlobalBrowserLimit, type BrowserDriver, type BrowserSearchQuery } from "../src/browser-driver";

function query(siteName: string): BrowserSearchQuery {
  return { siteName, mpn: "X", lcscPn: null, value: null, packageName: null, searchTerm: "X" };
}

/** A fake driver that records peak concurrency and resolves when told to. */
function instrumentedDriver(holdMs: number) {
  let inFlight = 0;
  let peak = 0;
  const driver: BrowserDriver = {
    name: "fake",
    async searchPart() {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      inFlight -= 1;
      return [];
    },
  };
  return { driver, peak: () => peak };
}

test("peak concurrency never exceeds the cap, across different sites, and all searches complete", async () => {
  const { driver, peak } = instrumentedDriver(10);
  const limited = withGlobalBrowserLimit(driver, 2);

  // 9 searches across 3 "sites" — per-site caps would allow 3+3+3 at once;
  // the GLOBAL cap must still hold the box at 2.
  const sites = ["LCSC", "Unikey", "SomeNewSite"];
  await Promise.all(Array.from({ length: 9 }, (_, i) => limited.searchPart(query(sites[i % 3]!))));

  expect(peak()).toBeLessThanOrEqual(2);
});

test("a slot is released even when a search throws — the queue keeps draining", async () => {
  let calls = 0;
  const failing: BrowserDriver = {
    name: "failing",
    async searchPart() {
      calls += 1;
      throw new Error("boom");
    },
  };
  const limited = withGlobalBrowserLimit(failing, 1);

  await expect(limited.searchPart(query("LCSC"))).rejects.toThrow("boom");
  await expect(limited.searchPart(query("LCSC"))).rejects.toThrow("boom"); // would hang forever if the slot leaked
  expect(calls).toBe(2);
});

test("a cap below 1 is clamped to 1, not 0 (0 would deadlock every search)", async () => {
  const { driver } = instrumentedDriver(1);
  const limited = withGlobalBrowserLimit(driver, 0);
  await limited.searchPart(query("LCSC")); // completes ⇒ not deadlocked
  expect(limited.name).toContain("global cap 1");
});
