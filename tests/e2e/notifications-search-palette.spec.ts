import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * E2E — the Ctrl-K command palette (FEATURES.md §5 header spec; plan/tab-
 * login-shell.md R2-34: "Ctrl-K opens it anywhere... finds seeded
 * SMK-000101"). Named `notifications-*` alongside notifications-bell.spec.ts
 * per this package's mission brief ("tests/e2e/notifications-*.spec.ts").
 *
 * **Integration status:** the integrator has already swapped
 * components/shell/header.tsx's `<HeaderSearch />` stub for the real
 * `<CommandPalette />` (components/search/command-palette.tsx), so this
 * spec runs against the live Ctrl-K listener, not a placeholder.
 *
 * Self-excludes under `bun test` (Bun's default test-file matching also
 * globs `*.spec.ts`) — run via `bunx playwright test`.
 */
if (typeof process.versions.bun === "undefined") {
  /**
   * Root-cause fix for this spec's two "element not found" failures: unlike
   * the dev-role auth users (auto-reseeded every run by
   * tests/e2e/global-setup.ts), the canonical demo dataset
   * (scripts/seed-canonical-demo.ts — the SMK-000101 family, incl. the
   * seeded SMK-000503/ESP32-WROOM-32E row this spec's second test looks
   * for) is NOT wired into any automatic pre-suite step yet (see that
   * script's own header: "see this package's integrator report for how to
   * wire it into `supabase db reset` / CI"). A `supabase db reset` run
   * without a manual re-seed afterwards leaves every `smark_parts` table
   * empty, so both "finds seeded SMK-000101" and "lists section results"
   * failed on a genuinely correct palette — there was nothing seeded to
   * find. Idempotent (safe to call even when already seeded — see that
   * script's own header), so calling it unconditionally here before this
   * file's tests is safe. Flagged in this package's report for the
   * integrator to wire in globally so every other package's e2e specs that
   * assume this dataset exists (cart-smoke, takeout-bulk-pick, …) get the
   * same guarantee without each spec file re-implementing this.
   */
  test.beforeAll(() => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    // Same Windows `bun.cmd` shell-exec rationale as global-setup.ts.
    execFileSync("bun", ["run", "scripts/seed-canonical-demo.ts"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: true,
    });
  });

  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill("owner");
    await page.locator("#login-password").fill("Owner@12345");
    await page.getByRole("button", { name: /log in/i }).click();
    // See tests/e2e/dashboard-smoke.spec.ts for why this is 25s.
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  /**
   * CommandPalette's global `keydown` listener attaches from a `useEffect`
   * on mount — it (and the rest of the dashboard's client bundle) may not
   * have finished hydrating in the instant `loginAsOwner` returns (right
   * after the post-login redirect lands), especially under load. A single
   * `Control+K` press sent into that window is silently dropped (nothing
   * is listening yet), which read as "the palette never opens" even though
   * it opens reliably once hydration is done. Re-pressing on a short poll
   * — instead of a single press + a `toBeVisible` that inherits the
   * suite's tight 5s default — rides out that race without weakening what
   * the test actually asserts (the dialog opens on Ctrl-K).
   */
  async function openPalette(page: Page) {
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(async () => {
      if (await dialog.isVisible()) return;
      await page.keyboard.press("Control+K");
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    return dialog;
  }

  test.describe("Ctrl-K command palette", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page);
    });

    test("Ctrl-K opens the palette from anywhere and finds seeded SMK-000101", async ({ page }) => {
      const dialog = await openPalette(page);

      const input = dialog.getByPlaceholder(/search parts, projects, boms, orders/i);
      await input.fill("SMK-000101");

      // Exact PID shape short-circuits straight to a "jump to part" row
      // (no section list) — plan/tab-login-shell.md R2-34.
      await expect(dialog.getByText("Jump to part SMK-000101")).toBeVisible({ timeout: 10_000 });

      await page.keyboard.press("Enter");
      await page.waitForURL(/\/part\/SMK-000101/);
      await expect(page.getByText("SMK-000101").first()).toBeVisible();
    });

    test("Escape closes the palette without navigating", async ({ page }) => {
      const dialog = await openPalette(page);

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    });

    test("a free-text query lists section results rather than a scan-code jump", async ({ page }) => {
      const dialog = await openPalette(page);
      const input = dialog.getByPlaceholder(/search parts, projects, boms, orders/i);
      await input.fill("ESP32"); // seeded SMK-000503, tests/fixtures/canonical-seed-data.ts

      await expect(dialog.getByText("Parts", { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(dialog.getByText("Jump to part", { exact: false })).toHaveCount(0);
    });
  });
}
