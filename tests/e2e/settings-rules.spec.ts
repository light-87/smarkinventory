import { expect, test, type Page } from "@playwright/test";

/**
 * Settings → Standard search rules E2E (plan/tab-settings.md §2/§5,
 * FEATURES.md §7). The spec's own wording ("owner adds a custom rule →
 * appears in workspace rules card") refers to the Ordering workspace's
 * read-only mirror of this list — that surface is bom-pipeline's
 * `app/(app)/projects/[projectId]/ordering/**`, not built yet in this repo
 * (see notes-for-integrator in this package's handoff). This spec covers the
 * buildable half end-to-end: adding a rule here persists to
 * `smark_ordering_rules` and reappears on reload, which is exactly what that
 * future workspace card would read from once it exists.
 */
if (typeof process.versions.bun === "undefined") {
  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill("owner");
    await page.locator("#login-password").fill("Owner@12345");
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 25_000 });
  }

  test.describe("settings: standard search rules", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page);
    });

    test("the Package rung is pinned — no remove control, just a required badge", async ({ page }) => {
      await page.goto("/settings");

      const packageRow = page.locator("div", { hasText: "Package — mandatory, never substitutable" }).last();
      await expect(packageRow.getByText("required")).toBeVisible();
      await expect(packageRow.getByRole("button", { name: "Remove" })).toHaveCount(0);
    });

    test("owner adds a custom rule — it persists and reappears after reload", async ({ page }) => {
      const label = `Prefer RoHS-compliant parts ${Date.now()}`;

      await page.goto("/settings");
      await page.getByPlaceholder(/add a search rule/i).fill(label);
      await page.getByRole("button", { name: "Add rule" }).click();

      await expect(page.getByText(label)).toBeVisible({ timeout: 10_000 });

      await page.reload();
      await expect(page.getByText(label)).toBeVisible();

      // Clean up so repeated runs don't pile up custom rules forever.
      const row = page.locator("div", { hasText: label }).last();
      await row.getByText("Remove").click();
      await expect(page.getByText(label)).toHaveCount(0);
    });
  });
}
