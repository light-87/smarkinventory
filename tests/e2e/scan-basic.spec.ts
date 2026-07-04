import { expect, test, type Page } from "@playwright/test";

/**
 * E2E — /scan surface smoke (plan/tab-scan.md, FEATURES.md §5.5).
 * Runs on both `playwright.config.ts` projects (desktop-1280 + mobile-360).
 *
 * `app/(app)/scan` sits behind `auth-shell`'s middleware (redirects to
 * `/login` when signed out), so every test here logs in first as the
 * seeded `owner` dev user (`scripts/seed-dev-users.ts` — role: owner has
 * full access to Scan per FEATURES.md §2). Self-excludes under `bun test`
 * the same way tests/e2e/smoke.spec.ts does — Bun's default test-file
 * matching also globs `*.spec.ts`.
 */
if (typeof process.versions.bun === "undefined") {
  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill("owner");
    await page.locator("#login-password").fill("Owner@12345");
    await page.getByRole("button", { name: /log in/i }).click();
    // Login redirects through /dashboard before landing wherever this test
    // actually navigates next — against `next dev`'s Turbopack, the FIRST
    // request to /dashboard after a cold `webServer` boot compiles the
    // route on demand and has been observed to take 15-18s locally. 15s was
    // too tight and flaked this whole suite on a cold server; 25s leaves
    // headroom under this file's 30s per-test timeout (playwright.config.ts)
    // while still failing fast on a genuinely broken login (which errors
    // immediately rather than hanging).
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  test.describe("scan", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page);
    });

    test("renders the scanner zone with an autofocused code input", async ({ page }) => {
      const response = await page.goto("/scan");
      expect(response?.ok(), "/scan responds 2xx").toBeTruthy();

      // Scoped by aria-label, not just placeholder — the shared header also
      // has a "Scan or type a code…" field (components/search/, FEATURES §5),
      // and this page's own scanner-zone input carries a distinct aria-label.
      const input = page.getByRole("textbox", { name: "Scan or type a code", exact: true });
      await expect(input).toBeVisible();
      await expect(input).toBeFocused();

      // Scoped to `<main>` (components/shell/app-shell.tsx mounts `<Header>`
      // as a SIBLING of `<main>`, not inside it) — the header also grew its
      // own "Scan with camera" button (components/shell/header-search.tsx),
      // which an unscoped /camera/i also matches, alongside this page's own
      // ScannerZone "Camera" button.
      await expect(page.locator("main").getByRole("button", { name: /camera/i })).toBeVisible();
    });

    test("an unresolved code shows a 'No match' toast instead of crashing the page", async ({ page }) => {
      await page.goto("/scan");
      // Scoped by aria-label, not just placeholder — the shared header also
      // has a "Scan or type a code…" field (components/search/, FEATURES §5),
      // and this page's own scanner-zone input carries a distinct aria-label.
      const input = page.getByRole("textbox", { name: "Scan or type a code", exact: true });
      await input.fill("DOES-NOT-EXIST-999");
      await input.press("Enter");

      await expect(page.getByText(/No match for/i)).toBeVisible();
    });

    test("no horizontal scroll at the 360px mobile floor (FEATURES.md §18)", async ({ page }) => {
      await page.goto("/scan");
      const hasHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(hasHorizontalScroll).toBe(false);
    });
  });
}
