import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * E2E — BOM upload → reconcile (plan/tab-orders-projects.md §2/§5 R2-03,
 * plan/TESTING.md "upload TMCS fixture → reconcile shows split").
 *
 * Same bun-vs-Playwright self-exclusion guard as tests/e2e/smoke.spec.ts —
 * `bun test` also globs `*.spec.ts`, so this file no-ops there and only
 * really runs via `bunx playwright test`.
 *
 * projects-hub (a parallel package, docs/OWNERSHIP.md) owns the "New
 * project" UI and hadn't landed it yet when this suite was written, so the
 * fixture project is seeded directly via the service-role client (same
 * client factory shape as tests/helpers/supabase.ts, inlined rather than
 * imported — that module pulls in `bun:test`, which doesn't exist under
 * Playwright's Node runtime). Idempotent: looks the project up by name
 * first so reruns don't pile up duplicates.
 */
if (typeof process.versions.bun === "undefined") {
  const FIXTURE_PROJECT_NAME = "SmarkStock E2E — BOM upload";
  const TMCS_FIXTURE_PATH = resolve(__dirname, "../fixtures/TMCS_96x32_Matrix_V1.2.xlsx");

  function serviceClient() {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (!url || !key) {
      throw new Error(
        "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set for the Playwright process — run `bunx playwright test` (see docs/DEV.md).",
      );
    }
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async function ensureFixtureProject(): Promise<string> {
    const supabase = serviceClient();
    const existing = await supabase.from("smark_projects").select("id").eq("name", FIXTURE_PROJECT_NAME).maybeSingle();
    if (existing.data?.id) return existing.data.id as string;

    const created = await supabase
      .from("smark_projects")
      .insert({ name: FIXTURE_PROJECT_NAME, client: "E2E fixture" })
      .select("id")
      .single();
    if (created.error || !created.data) {
      throw new Error(`Could not seed the fixture project: ${created.error?.message ?? "no row returned"}`);
    }
    return created.data.id as string;
  }

  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill("owner");
    await page.locator("#login-password").fill("Owner@12345");
    await page.getByRole("button", { name: /log in/i }).click();
    // Same generous timeout as tests/e2e/dashboard-smoke.spec.ts — the first
    // request after a cold `next dev` boot compiles on demand.
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  test.describe("BOMs — no session", () => {
    test("visiting a project's BOM list while signed out redirects to /login", async ({ page }) => {
      const response = await page.goto("/projects/00000000-0000-0000-0000-000000000000/boms");
      expect(response?.ok(), "the route responds 2xx even signed out").toBeTruthy();
      await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    });

    test("visiting the new-BOM page while signed out redirects to /login", async ({ page }) => {
      await page.goto("/projects/00000000-0000-0000-0000-000000000000/boms/new");
      await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    });
  });

  test.describe("BOMs — upload → reconcile [owner]", () => {
    test("uploading the real TMCS fixture parses all 122 lines and reconcile shows an in-stock/to-order split", async ({
      page,
    }) => {
      const projectId = await ensureFixtureProject();

      await loginAsOwner(page);
      await page.goto(`/projects/${projectId}/boms/new`);

      const bomName = `TMCS upload ${Date.now()}`;
      await page.getByPlaceholder("Mainboard v1.2").fill(bomName);
      await page.locator('input[type="file"]').setInputFiles(TMCS_FIXTURE_PATH);
      await page.getByRole("button", { name: /upload.*reconcile/i }).click();

      await page.waitForURL(new RegExp(`/projects/${projectId}/boms/[0-9a-f-]+$`), { timeout: 20_000 });

      // Stat trio: 122 lines (tests/unit/import-bom.test.ts's verified count for this real
      // fixture), split into in-stock/to-order — the seeded demo catalog carries none of
      // TMCS's real parts, so at minimum "to order" must account for the bulk of them.
      const linesCard = page.locator(".rounded-2xl", { hasText: "Lines" }).first();
      const linesValue = Number((await linesCard.locator("div").first().innerText()).replace(/,/g, ""));
      expect(linesValue).toBe(122);

      const toOrderCard = page.locator(".rounded-2xl", { hasText: "To order" }).first();
      const toOrderValue = Number((await toOrderCard.locator("div").first().innerText()).replace(/,/g, ""));
      expect(toOrderValue).toBeGreaterThan(0);

      await expect(page.getByText(bomName)).toBeVisible();
      // "Set up ordering →" now links straight into the Ordering Workspace
      // (bom-pipeline's WF-3 half) — was a disabled placeholder button pre-WF-3.
      const setUpOrderingLink = page.getByRole("link", { name: /set up ordering/i });
      await expect(setUpOrderingLink).toBeVisible();
      await expect(setUpOrderingLink).toHaveAttribute("href", new RegExp(`/projects/${projectId}/ordering/[0-9a-f-]+$`));
    });
  });

  test.describe("BOMs — Create in-app [R2-19]", () => {
    test.fixme(
      "creating a BOM in-app with a custom column saves the column structure as the company template and reconciles",
      async () => {},
    );
  });
}
