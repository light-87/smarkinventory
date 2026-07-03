import { expect, test, type Page } from "@playwright/test";
import { createServiceClient } from "@/lib/supabase/server";
import { todayDateOnly } from "@/lib/daily/compute";
import { TABLES } from "@/types/db";

/**
 * Daily Reports E2E (plan/tab-daily-reports.md R2-07). Same guard + login
 * pattern as tests/e2e/dashboard-smoke.spec.ts: auth-shell's middleware gates
 * every `(app)` route, so every suite logs in first; run via
 * `bunx playwright test`, not `bun test` (Playwright isn't a Bun test file).
 */
if (typeof process.versions.bun === "undefined") {
  async function loginAs(page: Page, username: string, password: string): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await page.getByRole("button", { name: /log in/i }).click();
    // First hit after a cold `next dev` boot compiles the route on demand —
    // same generous first-nav allowance as dashboard-smoke.spec.ts.
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  async function closeAnyOpenDrawer(page: Page): Promise<void> {
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible().catch(() => false)) {
      // log-hours-modal.tsx has TWO buttons named "Close" — the drawer
      // header's icon button (DrawerCloseButton, aria-label="Close") and a
      // plain-text footer button — both call the same `onClose`, so
      // `.first()` (not a bare, ambiguous match) is enough to dismiss it.
      await dialog.getByRole("button", { name: "Close" }).first().click();
    }
  }

  test.describe("daily reports — owner", () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, "owner", "Owner@12345");
    });

    test("boots and renders every section's chrome", async ({ page }) => {
      const response = await page.goto("/daily");
      expect(response?.ok(), "/daily responds 2xx").toBeTruthy();

      await expect(page.getByRole("heading", { name: "Daily Reports" })).toBeVisible();
      await expect(page.getByText("Attendance & work")).toBeVisible();
      await expect(page.getByText("Movements today")).toBeVisible();
      await expect(page.getByText("Ordering activity today")).toBeVisible();
      // Owner sees Expenses (FEATURES.md §2 "Daily Reports | all | self only | read all").
      await expect(page.getByText("Expenses today")).toBeVisible();
      await expect(page.getByText("Export")).toBeVisible();
    });

    test("owner sees the team roster (all people)", async ({ page }) => {
      await page.goto("/daily");
      await expect(page.getByText(/^Team —/)).toBeVisible();
    });

    test("no horizontal scroll at the mobile breakpoint", async ({ page }) => {
      await page.goto("/daily");
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });

    test("day-nav prev/next arrows move the date", async ({ page }) => {
      await page.goto("/daily?date=2026-07-15");
      await expect(page.getByText("15 Jul 2026")).toBeVisible();
      await page.getByRole("link", { name: "Previous day" }).click();
      await expect(page).toHaveURL(/date=2026-07-14/);
      await expect(page.getByText("14 Jul 2026")).toBeVisible();
    });
  });

  test.describe("daily reports — employee (self-only)", () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, "employee", "Employee@12345");
    });

    test("employee does NOT see the team roster or Expenses (FEATURES.md §2)", async ({ page }) => {
      await page.goto("/daily");
      await expect(page.getByText("Attendance & work")).toBeVisible();
      await expect(page.getByText(/^Team —/)).toHaveCount(0);
      await expect(page.getByText("Expenses today")).toHaveCount(0);
    });

    test("employee can clock in and clock out", async ({ page }) => {
      // Delete today's attendance/time-entry rows for "employee" up front
      // rather than trying to detect-and-settle whatever state a previous
      // run left behind: a stale "day complete" row (check_in AND check_out
      // already set, e.g. from an earlier run of THIS SAME test against a
      // DB that's never reset) renders NEITHER button — attendance-
      // section.tsx shows a "Day complete" chip instead — which a
      // "settle to clocked-in first" branch can't recover from since there's
      // no button to click at all. Starting from a guaranteed-clean
      // "not clocked in" row sidesteps every carried-over state at once.
      const supabase = createServiceClient();
      const employee = await supabase.from(TABLES.app_users).select("id").eq("username", "employee").single();
      if (employee.data?.id) {
        const workDate = todayDateOnly();
        await supabase.from(TABLES.attendance).delete().eq("user_id", employee.data.id).eq("work_date", workDate);
        await supabase.from(TABLES.time_entries).delete().eq("user_id", employee.data.id).eq("work_date", workDate);
      }

      await page.goto("/daily");

      const clockInButton = page.getByRole("button", { name: "Clock in" });
      const clockOutButton = page.getByRole("button", { name: "Clock out" });

      await expect(clockInButton).toBeVisible();
      await clockInButton.click();
      await expect(page.getByText("Present").first()).toBeVisible();

      await expect(clockOutButton).toBeVisible();
      await clockOutButton.click();
      // Nothing logged yet today → the "Log hours" prompt should appear.
      await expect(page.getByRole("dialog")).toBeVisible();
      await closeAnyOpenDrawer(page);
    });
  });
}
