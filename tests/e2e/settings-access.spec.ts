import { expect, test, type Page } from "@playwright/test";

/**
 * Settings E2E — role gating (plan/tab-settings.md, FEATURES.md §2 /
 * lib/auth/roles.ts ROLE_MATRIX: "AI Memory approve · Settings · user
 * management" is owner-only — employee AND accountant get `hidden`). Same
 * bun-guard + login-helper convention as tests/e2e/dashboard-smoke.spec.ts /
 * tests/e2e/expenses-access.spec.ts.
 */
if (typeof process.versions.bun === "undefined") {
  async function login(page: Page, username: string, password: string): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 25_000 });
  }

  test.describe("settings: role gating", () => {
    test("employee: Settings is absent from the nav AND the direct route 404s", async ({ page }) => {
      await login(page, "employee", "Employee@12345");

      await expect(page.getByRole("link", { name: /^settings$/i })).toHaveCount(0);

      const response = await page.goto("/settings");
      expect(response?.status()).toBe(404);
    });

    test("accountant: Settings is also hidden and the direct route 404s", async ({ page }) => {
      await login(page, "accountant", "Accountant@12345");

      await expect(page.getByRole("link", { name: /^settings$/i })).toHaveCount(0);

      const response = await page.goto("/settings");
      expect(response?.status()).toBe(404);
    });

    test("owner: Settings loads with its section cards", async ({ page }) => {
      await login(page, "owner", "Owner@12345");

      const response = await page.goto("/settings");
      expect(response?.ok()).toBeTruthy();

      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
      await expect(page.getByText("Distributors & API keys")).toBeVisible();
      await expect(page.getByText("Standard search rules")).toBeVisible();
      await expect(page.getByText("Label size")).toBeVisible();
      await expect(page.getByText("Concurrency default")).toBeVisible();
    });

    test("no horizontal scroll at the mobile breakpoint", async ({ page }) => {
      await login(page, "owner", "Owner@12345");
      await page.goto("/settings");
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  });
}
