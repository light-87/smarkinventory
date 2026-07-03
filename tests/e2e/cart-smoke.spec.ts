import { expect, test, type Page } from "@playwright/test";

/**
 * E2E — Cart surface smoke (plan/tab-on-order.md · FEATURES.md §5.12 ·
 * plan/TESTING.md §3 E2E-3).
 *
 * Same Bun-vs-Playwright self-exclusion guard as tests/e2e/smoke.spec.ts:
 * `bun test` globs `*.spec.ts` too, so this file no-ops under the Bun
 * runtime and only really runs via `bunx playwright test`.
 *
 * The canonical demo seed (scripts/seed-canonical-demo.ts) deliberately
 * doesn't guarantee fixed part PIDs (falls back when its intended
 * `SMK-0001NN` range is taken) and seeds no projects/BOMs/orders at all —
 * bom-pipeline/projects-hub own creating those. So the deeper interactive
 * flows (manual-add search → add, checkout → PO number → confirm, mark
 * arrived → Receive hand-off) are `test.fixme()` here, same convention
 * tests/e2e/receive-receive.spec.ts uses for its own not-yet-fixture-backed
 * flows — this file's real (non-fixme) coverage is chrome/access, mirroring
 * tests/e2e/dashboard-smoke.spec.ts.
 */
if (typeof process.versions.bun === "undefined") {
  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill("owner");
    await page.locator("#login-password").fill("Owner@12345");
    await page.getByRole("button", { name: /log in/i }).click();
    // Same cold-Turbopack-compile headroom as tests/e2e/dashboard-smoke.spec.ts.
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  test.describe("Cart — no session", () => {
    test("visiting /cart while signed out redirects to /login, not a crash", async ({ page }) => {
      const response = await page.goto("/cart");
      expect(response?.ok(), "/cart responds 2xx even signed out").toBeTruthy();
      await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    });
  });

  test.describe("Cart — chrome", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page);
    });

    test("boots and renders its three sections (Cart / Ordered / Arrived)", async ({ page }) => {
      const response = await page.goto("/cart");
      expect(response?.ok(), "/cart responds 2xx").toBeTruthy();

      await expect(page.getByRole("heading", { name: "Cart" })).toBeVisible();
      await expect(page.getByRole("radio", { name: /^Cart \(\d+\)$/ })).toBeVisible();
      await expect(page.getByRole("radio", { name: /^Ordered \(\d+\)$/ })).toBeVisible();
      await expect(page.getByRole("radio", { name: /^Arrived \(\d+\)$/ })).toBeVisible();
    });

    test("switching to Ordered/Arrived never crashes even with nothing placed yet", async ({ page }) => {
      await page.goto("/cart");
      await page.getByRole("radio", { name: /^Ordered \(\d+\)$/ }).click();
      await expect(page.getByText(/nothing on order/i)).toBeVisible();

      await page.getByRole("radio", { name: /^Arrived \(\d+\)$/ }).click();
      await expect(page.getByText(/nothing arrived yet/i)).toBeVisible();
    });

    test("no horizontal scroll at the mobile breakpoint", async ({ page }) => {
      await page.goto("/cart");
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  });

  test.describe("Cart — manual add [E2E-3]", () => {
    test.fixme("searching an existing part and adding a qty creates an open cart line with that qty", async () => {});
    test.fixme("adding a part already in the cart bumps its qty instead of creating a second line", async () => {});
  });

  test.describe("Cart — smart shortfall [E2E-3, client's permanent example]", () => {
    test.fixme(
      "a part with 500 in stock demanded 400+200 across two active project BOMs shows an auto cart line of exactly 100",
      async () => {},
    );
    test.fixme("dismissing an auto-shortfall line removes it from the open list until the shortfall grows", async () => {});
  });

  test.describe("Cart — checkout [E2E-3, Q-06]", () => {
    test.fixme("selecting lines groups them by distributor at checkout, one PO-number field per group", async () => {});
    test.fixme("confirming with a PO number places the order and moves its lines out of the open cart", async () => {});
    test.fixme("a distributor group left without a PO number stays in the cart after confirming the others", async () => {});
  });

  test.describe("Cart — Ordered/Arrived [E2E-3]", () => {
    test.fixme("marking a line arrived moves it from Ordered to Arrived without affecting sibling lines' status", async () => {});
    test.fixme("the Arrived tab links to Receive's put-away queue when a line hasn't been put away yet", async () => {});
    test.fixme("uploading a receipt on a placed order shows the 'Receipt attached' chip", async () => {});
  });
}
