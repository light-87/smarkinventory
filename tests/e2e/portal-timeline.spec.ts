import { expect, test } from "@playwright/test";
import {
  seedPortalArchivedProject,
  seedPortalDemoProject,
  seedPortalEmptyProject,
  type PortalDemoProject,
} from "./portal-fixtures";

/**
 * Client portal E2E — plan/tab-client-portal.md + FEATURES.md §17.
 *
 * Same bun-exclusion guard as tests/e2e/dashboard-smoke.spec.ts (Playwright
 * runs specs under Node; `@supabase/supabase-js` + this guard both assume
 * that). Playwright's own project matrix (playwright.config.ts) already runs
 * this file against BOTH `desktop-1280` and `mobile-360` — the "renders at
 * 360px" requirement (plan/tab-client-portal.md) doesn't need a separate
 * spec, just assertions that hold at both.
 */
if (typeof process.versions.bun === "undefined") {
  test.describe("client portal", () => {
    let demo: PortalDemoProject;

    test.beforeAll(async () => {
      demo = await seedPortalDemoProject();
    });

    test.afterAll(async () => {
      await demo.cleanup();
    });

    test("renders header, phase timeline (all row kinds), progress, updates and documents — no horizontal scroll", async ({ page }) => {
      const response = await page.goto(`/p/${demo.token}`);
      expect(response?.ok(), "/p/:token responds 2xx").toBeTruthy();

      await expect(page.getByRole("heading", { name: "Acme Control Panel" })).toBeVisible();
      await expect(page.getByText("In progress")).toBeVisible();

      // Phase timeline: done phase, active ("Current") phase, parallel + buffer
      // row-kind chips, footnote rendered as a footnote (not a dated row).
      await expect(page.getByText("Schematic Design + Review")).toBeVisible();
      // `.first()`: the seeded shared update's body text ("PCB layout is
      // underway...") also case-insensitively matches this locator alongside
      // the timeline row's own "PCB Layout" heading — either hit proves the
      // phase name rendered, so disambiguating further isn't the point here.
      await expect(page.getByText("PCB Layout").first()).toBeVisible();
      await expect(page.getByText("Current", { exact: true })).toBeVisible();
      // exact: true — "Parallel"/"Buffer" also substring-match the seeded
      // rows' own duration_text ("Running parallel with layout", "5 days" —
      // Playwright's getByText is case-insensitive substring by default).
      await expect(page.getByText("Parallel", { exact: true })).toBeVisible();
      await expect(page.getByText("Buffer", { exact: true })).toBeVisible();
      await expect(page.getByText("Enclosure not included in this quote.")).toBeVisible();

      // Progress + on-track ("Progress" also substring-matches the status
      // chip's "In progress" text, hence exact: true).
      await expect(page.getByText("Progress", { exact: true })).toBeVisible();

      // Updates feed: only the explicitly-shared note, never the hidden one.
      await expect(page.getByText("Layout kicked off")).toBeVisible();
      await expect(page.getByText("Internal cost note")).toHaveCount(0);

      // Documents: only the shared one.
      await expect(page.getByText("Enclosure drawing v2.pdf")).toBeVisible();
      await expect(page.getByText("Internal BOM pricing.xlsx")).toHaveCount(0);

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });

    test("comment posts and lands back in the Updates feed", async ({ page }) => {
      await page.goto(`/p/${demo.token}`);

      await page.getByPlaceholder("e.g. Ramesh").fill("Priya from Acme");
      await page.getByPlaceholder("Ask a question or share feedback…").fill("Can we get an update on the enclosure?");
      await page.getByRole("button", { name: "Send" }).click();

      await expect(page.getByText("Sent — thank you!")).toBeVisible();
      await expect(page.getByText("Can we get an update on the enclosure?")).toBeVisible();
      await expect(page.getByText("You", { exact: true }).first()).toBeVisible();
    });

    test("empty project renders 'nothing shared yet' states instead of erroring", async ({ page }) => {
      const empty = await seedPortalEmptyProject();
      try {
        const response = await page.goto(`/p/${empty.token}`);
        expect(response?.ok()).toBeTruthy();
        await expect(page.getByText("No timeline has been shared yet.")).toBeVisible();
        await expect(page.getByText("No updates yet")).toBeVisible();
        await expect(page.getByText("No documents yet")).toBeVisible();
      } finally {
        await empty.cleanup();
      }
    });

    test("unknown token 404s", async ({ page }) => {
      const response = await page.goto("/p/this-token-does-not-exist");
      expect(response?.status()).toBe(404);
      await expect(page.getByText("This link isn't available")).toBeVisible();
    });

    test("archived project's token 404s the same way as an unknown one", async ({ page }) => {
      const archived = await seedPortalArchivedProject();
      try {
        const response = await page.goto(`/p/${archived.token}`);
        expect(response?.status()).toBe(404);
        await expect(page.getByText("This link isn't available")).toBeVisible();
      } finally {
        await archived.cleanup();
      }
    });
  });
}
