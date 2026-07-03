import { expect, test, type Page } from "@playwright/test";

/**
 * Expenses E2E — role gating (plan/tab-expenses.md, FEATURES.md §2 /
 * lib/auth/roles.ts ROLE_MATRIX): owner and accountant both get `full`
 * access to Expenses (the client amendment — accountant is the one place
 * besides owner that WRITES); employee gets `hidden` — the nav link doesn't
 * render AND the route itself 404s for a direct hit (each hidden page's own
 * `canSee` guard). Same bun-guard + login-helper convention as
 * tests/e2e/dashboard-smoke.spec.ts.
 */
if (typeof process.versions.bun === "undefined") {
  async function login(page: Page, username: string, password: string): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 25_000 });
  }

  test.describe("expenses: role gating", () => {
    test("employee: Expenses is absent from the nav AND the direct route 404s", async ({ page }) => {
      await login(page, "employee", "Employee@12345");

      await expect(page.getByRole("link", { name: /expenses/i })).toHaveCount(0);

      const response = await page.goto("/expenses");
      expect(response?.status()).toBe(404);
    });

    test("employee: /settings/expense-accounts also 404s", async ({ page }) => {
      await login(page, "employee", "Employee@12345");
      const response = await page.goto("/settings/expense-accounts");
      expect(response?.status()).toBe(404);
    });

    test("accountant: Expenses is visible in the nav, the route loads, and Add entry is available (read+WRITE)", async ({
      page,
    }) => {
      await login(page, "accountant", "Accountant@12345");

      // Expenses isn't one of the bottom bar's 4 fixed mobile slots
      // (lib/nav.ts MOBILE_PRIMARY_IDS) — at the 360px breakpoint it only
      // renders inside the "More" sheet, which is closed by default. The
      // desktop rail (where this button doesn't exist) lists every visible
      // surface directly, so this is a no-op there.
      const moreButton = page.getByRole("button", { name: "More" });
      if (await moreButton.isVisible().catch(() => false)) {
        await moreButton.click();
      }

      await expect(page.getByRole("link", { name: /expenses/i }).first()).toBeVisible({ timeout: 10_000 });

      const response = await page.goto("/expenses");
      expect(response?.ok()).toBeTruthy();
      await expect(page.getByRole("button", { name: "+ Add entry" })).toBeVisible();
    });

    test("accountant: /settings/expense-accounts is owner-only, so it 404s for the accountant too", async ({ page }) => {
      await login(page, "accountant", "Accountant@12345");
      const response = await page.goto("/settings/expense-accounts");
      expect(response?.status()).toBe(404);
    });

    test("owner: Expenses loads and /settings/expense-accounts is reachable", async ({ page }) => {
      await login(page, "owner", "Owner@12345");

      const expensesResponse = await page.goto("/expenses");
      expect(expensesResponse?.ok()).toBeTruthy();

      const accountsResponse = await page.goto("/settings/expense-accounts");
      expect(accountsResponse?.ok()).toBeTruthy();
      await expect(page.getByRole("heading", { name: "Expense accounts" })).toBeVisible();
    });
  });
}
