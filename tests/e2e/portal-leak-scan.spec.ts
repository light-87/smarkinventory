import { expect, test } from "@playwright/test";
import { seedPortalDemoProject, type PortalDemoProject } from "./portal-fixtures";

/**
 * Leak-scan E2E — FEATURES.md §16 "every R2 change maps to tests" +
 * plan/tab-client-portal.md's own close ("Never shown: costs/prices,
 * inventory, team hours, internal notes, other projects"). Fetches the
 * portal page for a seeded demo project (one shared update/document, one
 * deliberately UNSHARED update/document carrying an obvious ₹ figure and a
 * stock-quantity mention — tests/e2e/portal-fixtures.ts) and asserts none of
 * that ever reaches the rendered page text, regardless of how the component
 * tree changes over time.
 *
 * Same bun-exclusion guard as every other e2e spec here — Playwright runs
 * under Node, not Bun.
 */
if (typeof process.versions.bun === "undefined") {
  test.describe("client portal — leak scan", () => {
    let demo: PortalDemoProject;

    test.beforeAll(async () => {
      demo = await seedPortalDemoProject();
    });

    test.afterAll(async () => {
      await demo.cleanup();
    });

    test("no ₹, price, or on-hand quantity strings anywhere on the page", async ({ page }) => {
      await page.goto(`/p/${demo.token}`);
      const text = await page.locator("body").innerText();

      expect(text).not.toContain("₹");
      expect(text).not.toMatch(/\bRs\.?\s?\d/i);
      expect(text).not.toContain("48,250");
      expect(text).not.toContain("320 units");
      expect(text).not.toContain("Internal cost note");
      expect(text).not.toContain("Internal BOM pricing");

      // Sanity check the scan actually looked at real content, not a blank/errored page.
      expect(text).toContain("Acme Control Panel");
    });

    test("raw HTML also carries none of the hidden document's URL or the unshared activity id", async ({ page }) => {
      await page.goto(`/p/${demo.token}`);
      const html = await page.content();
      expect(html).not.toContain("internal-pricing.xlsx");
    });
  });
}
