import { expect, test, type Page } from "@playwright/test";

/**
 * Dashboard E2E smoke (plan/tab-dashboard.md).
 *
 * auth-shell's `middleware.ts` now gates every non-public route (including
 * `/dashboard`) — an anonymous visit is 302-redirected to `/login` before
 * this page ever renders, so this suite logs in first (same seeded `owner`
 * dev user + pattern as tests/e2e/scan-basic.spec.ts) and then asserts the
 * page a) never 500s / crashes even when a section's own Supabase query
 * fails (each section catches its own error — see
 * `app/(app)/dashboard/page.tsx`'s `loadSection`), b) renders its section
 * chrome, and c) never grows a horizontal scrollbar at the 360px mobile
 * breakpoint (FEATURES.md §18 hard rule). Same bun-exclusion guard as
 * tests/e2e/smoke.spec.ts — run via `bunx playwright test`, not `bun test`.
 */
if (typeof process.versions.bun === "undefined") {
  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill("owner");
    await page.locator("#login-password").fill("Owner@12345");
    await page.getByRole("button", { name: /log in/i }).click();
    // Dashboard is the heaviest first hit in the whole suite (stats +
    // recent movements + agent activity + usage-by-project, each its own
    // Supabase round trip) — against `next dev`'s Turbopack, the FIRST
    // request to /dashboard after a cold `webServer` boot compiles the
    // route on demand and has been observed to take 15-18s locally, before
    // any of this suite's own assertions run. 15s was too tight and flaked
    // the whole suite on a cold server; 25s leaves headroom under this
    // file's 30s per-test timeout (playwright.config.ts) while still
    // failing fast on a genuinely broken login (which errors immediately
    // rather than hanging).
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  test.describe("dashboard smoke", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page);
    });

    test("boots and renders its section chrome", async ({ page }) => {
      const response = await page.goto("/dashboard");
      expect(response?.ok(), "/dashboard responds 2xx").toBeTruthy();

      await expect(page.getByText("Recent movements")).toBeVisible();
      await expect(page.getByText("Agent activity")).toBeVisible();
      await expect(page.getByText("Usage by project")).toBeVisible();
    });

    test("no horizontal scroll at the mobile breakpoint", async ({ page }) => {
      await page.goto("/dashboard");
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  });
}
