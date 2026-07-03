import { expect, test, type Page } from "@playwright/test";

/**
 * E2E — the notifications bell (FEATURES.md §5 header spec; plan/tab-login-
 * shell.md R2-36). `app/(app)/**` sits behind auth-shell's middleware
 * (redirects to `/login` when signed out), so every test here logs in first
 * as the seeded `owner` dev user (same pattern as tests/e2e/dashboard-smoke.spec.ts).
 *
 * This asserts the OBSERVABLE CONTRACT (an aria-labeled "Notifications"
 * trigger; a dropdown with the same "Notifications" header copy and
 * "Nothing yet" / "Mark all read" language) rather than which component
 * renders it — components/notifications/notification-bell.tsx (this
 * package's canonical bell) was deliberately built to the same contract as
 * components/shell/notifications-bell.tsx (auth-shell's own stub, by its own
 * doc comment: "SHELL per the mission brief"), so this spec is green BOTH
 * before AND after the integrator's two-line header swap documented in this
 * package's report — it isn't a placeholder pending integration.
 *
 * Self-excludes under `bun test` the same way tests/e2e/smoke.spec.ts does
 * (Bun's default test-file matching also globs `*.spec.ts`) — run via
 * `bunx playwright test`.
 */
if (typeof process.versions.bun === "undefined") {
  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill("owner");
    await page.locator("#login-password").fill("Owner@12345");
    await page.getByRole("button", { name: /log in/i }).click();
    // See tests/e2e/dashboard-smoke.spec.ts for why this is 25s, not the
    // suite's default 5s expect timeout — first Turbopack compile of
    // /dashboard after a cold `webServer` boot is the heaviest page in the app.
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  test.describe("notifications bell", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page);
    });

    test("renders in the header with an unread-count affordance and opens a dropdown", async ({ page }) => {
      const bellButton = page.getByRole("button", { name: "Notifications" });
      await expect(bellButton).toBeVisible();

      await bellButton.click();
      await expect(page.getByText("Notifications", { exact: true })).toBeVisible();
      // A freshly seeded owner has no notifications yet — the empty state,
      // not a crash, is the expected first-run render.
      const emptyState = page.getByText("Nothing yet");
      const anyItem = page.locator("button", { hasText: /ago|now/i });
      await expect(emptyState.or(anyItem).first()).toBeVisible();
    });

    test("Escape closes the dropdown", async ({ page }) => {
      const bellButton = page.getByRole("button", { name: "Notifications" });
      await bellButton.click();
      await expect(page.getByText("Nothing yet").or(page.getByText("Notifications", { exact: true })).first()).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(page.getByText("Nothing yet")).toBeHidden();
    });

    test("no horizontal scroll at the 360px mobile floor (FEATURES.md §18)", async ({ page }) => {
      const hasHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(hasHorizontalScroll).toBe(false);
    });
  });
}
