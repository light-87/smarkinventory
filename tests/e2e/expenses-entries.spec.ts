import { expect, test, type Page } from "@playwright/test";

/**
 * Expenses E2E — entries (plan/tab-expenses.md R2-20). Same guard + login
 * pattern as tests/e2e/dashboard-smoke.spec.ts: `process.versions.bun`
 * excludes this file from a bare `bun test` (it only works under
 * `bunx playwright test`), and login waits generously for the first,
 * cold-compiled navigation.
 *
 * Owner flow only here — the role-gating assertions (employee hidden,
 * accountant full access) live in tests/e2e/expenses-access.spec.ts so a
 * failure in one concern doesn't mask the other.
 */
if (typeof process.versions.bun === "undefined") {
  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill("owner");
    await page.locator("#login-password").fill("Owner@12345");
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  test.describe("expenses: entries (owner)", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page);
    });

    test("boots, shows the tiles/chart chrome and the entries section", async ({ page }) => {
      const response = await page.goto("/expenses");
      expect(response?.ok(), "/expenses responds 2xx").toBeTruthy();

      await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();
      await expect(page.getByText("Income vs expense")).toBeVisible();
      await expect(page.getByText("By category")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Entries" })).toBeVisible();
    });

    test("owner adds an entry and it appears in the list", async ({ page }) => {
      const stamp = Date.now();

      // seed.sql intentionally seeds ZERO expense accounts (SCHEMA.md
      // [R2-28] — real client onboarding data) so this flow must be able to
      // stand one up itself rather than skip whenever a fresh reset has run.
      const accountName = `E2E Cash ${stamp}`;
      await page.goto("/settings/expense-accounts");
      await page.getByRole("button", { name: "+ Add account" }).click();
      await page.getByLabel("Name").fill(accountName);
      await page.getByRole("button", { name: "Add" }).click();
      await expect(page.getByText("Account added")).toBeVisible({ timeout: 10_000 });

      await page.goto("/expenses");
      await page.getByRole("button", { name: "+ Add entry" }).click();
      // `exact: true` — a non-exact match also catches the trigger button's
      // OWN "+ Add entry" label (a strict-mode violation: two elements
      // contain the substring "Add entry"), not just the drawer's heading.
      await expect(page.getByText("Add entry", { exact: true })).toBeVisible();

      await page.getByPlaceholder("0.00").fill("1234");
      await page.getByRole("radio", { name: "Materials" }).click();
      await page.locator("#expense-account").selectOption({ label: accountName });
      await page.getByPlaceholder("Distributor or person").fill(`E2E vendor ${stamp}`);
      await page.getByRole("button", { name: "Save" }).click();

      await expect(page.getByText("Entry added")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(`E2E vendor ${stamp}`)).toBeVisible({ timeout: 10_000 });
    });

    test("no horizontal scroll at the mobile breakpoint", async ({ page }) => {
      await page.goto("/expenses");
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  });
}
