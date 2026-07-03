import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { NAV_ITEMS, visibleMobilePrimaryItems } from "@/lib/nav";
import { seedPortalDemoProject } from "./portal-fixtures";

/**
 * E2E FLOW-8 — the mobile/a11y sweep (plan/TESTING.md §3.8: "360px no
 * horizontal scroll on every route; touch targets ≥44px; reduced-motion run
 * path.").
 *
 * Three independent concerns, three `test.describe` blocks below:
 *   1. No horizontal scroll at the 360px floor, on EVERY authed nav route
 *      (derived straight from `lib/nav.ts`'s `NAV_ITEMS` — a new surface
 *      added there joins this sweep automatically, no second list to keep in
 *      sync) plus `/login` and a client-portal page.
 *   2. ≥44px touch targets, spot-checked on the primary interactive flows
 *      (scan stepper + Take out/Add, a cart line's Remove control, the
 *      bottom bar, the More sheet).
 *   3. A `prefers-reduced-motion: reduce` pass through the mocked ordering
 *      pipeline — the run console must still reach a terminal state (Review
 *      results), not hang or crash, with OS-level motion reduction on.
 *
 * Same Bun-vs-Playwright self-exclusion guard as tests/e2e/smoke.spec.ts.
 * Sub-suites 1 and 2 are scoped to FEATURES.md §18's 360px floor (the thing
 * they're actually testing), so they self-skip on `desktop-1280` rather than
 * duplicating a check that isn't meaningful there. Sub-suite 3 is
 * viewport-agnostic and runs on both projects (like every other spec here).
 */
if (typeof process.versions.bun === "undefined") {
  const OWNER_USERNAME = process.env.E2E_OWNER_USERNAME ?? "owner";
  const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "Owner@12345";
  const SEEDED_PID = process.env.E2E_SEEDED_PID ?? "SMK-000101";

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

  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill(OWNER_USERNAME);
    await page.locator("#login-password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: /log in/i }).click();
    // Same cold-Turbopack-compile headroom as tests/e2e/dashboard-smoke.spec.ts
    // — several routes swept below (e.g. /ai-memory) have no other spec that
    // visits them first, so this run may hit their FIRST-ever compile.
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  async function assertNoHorizontalScroll(page: Page, label: string): Promise<void> {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    // +1: sub-pixel rounding tolerance, same convention as flow-1/flow-2's
    // own no-h-scroll assertions.
    expect(scrollWidth, `${label}: document.scrollWidth <= viewport width`).toBeLessThanOrEqual(clientWidth + 1);
  }

  /**
   * `locator.boundingBox()` is a one-shot read — no auto-retry/wait like an
   * `expect(...).toBeVisible()` assertion. Verified in a real full-suite run
   * (this suite's documented cold-Turbopack-compile contention,
   * playwright.config.ts's own header): an element can pass its own
   * `toBeVisible()` check and still hand back a `null` box a moment later —
   * observed on the bottom bar's "Inventory" link — because a box read
   * mid-hydration/mid-reflow lands in the gap between "in the a11y tree" and
   * "actually laid out". Polling the read itself (not just visibility first)
   * closes that gap; `toPass` retries the whole read+assert until a real,
   * non-null box shows up or the timeout elapses.
   */
  async function assertMin44(locator: Locator, label: string): Promise<void> {
    let box: { width: number; height: number } | null = null;
    await expect(async () => {
      box = await locator.boundingBox();
      expect(box, `${label}: element has a bounding box (visible + rendered)`).not.toBeNull();
    }).toPass({ timeout: 10_000 });
    expect(box!.width, `${label}: width >= 44px`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${label}: height >= 44px`).toBeGreaterThanOrEqual(44);
  }

  // Every nav surface, derived from lib/nav.ts — the single source of truth
  // the rail/bottom-bar/More-sheet already render from. Deduped defensively
  // (NAV_ITEMS hrefs are 1:1 today, but a future entry sharing a href
  // shouldn't double this sweep).
  const AUTHED_ROUTES = Array.from(new Set(NAV_ITEMS.map((item) => item.href)));

  test.describe("flow-8: no horizontal scroll at the 360px floor (FEATURES.md §18)", () => {
    test.beforeEach(async ({}, testInfo) => {
      test.skip(testInfo.project.name !== "mobile-360", "the 360px floor only applies to the mobile-360 project");
    });

    test("/login has no horizontal scroll", async ({ page }) => {
      const response = await page.goto("/login");
      expect(response?.ok(), "/login responds 2xx").toBeTruthy();
      await assertNoHorizontalScroll(page, "/login");
    });

    for (const href of AUTHED_ROUTES) {
      test(`${href} has no horizontal scroll`, async ({ page }) => {
        test.setTimeout(45_000); // generous — some of these routes (e.g. /ai-memory) may cold-compile here for the first time in the whole suite
        await loginAsOwner(page);
        const response = await page.goto(href);
        expect(response?.ok(), `${href} responds 2xx`).toBeTruthy();
        await assertNoHorizontalScroll(page, href);
      });
    }

    test("a client-portal page has no horizontal scroll", async ({ page }) => {
      const demo = await seedPortalDemoProject();
      try {
        const response = await page.goto(`/p/${demo.token}`);
        expect(response?.ok(), "/p/:token responds 2xx").toBeTruthy();
        await assertNoHorizontalScroll(page, `/p/${demo.token}`);
      } finally {
        await demo.cleanup();
      }
    });
  });

  test.describe("flow-8: touch targets >= 44px (spot check)", () => {
    test.beforeEach(async ({}, testInfo) => {
      test.skip(testInfo.project.name !== "mobile-360", "44px touch targets are a mobile-ergonomics concern (FEATURES.md §18)");
    });

    test("scan: quantity stepper + Take out/Add buttons are >=44px", async ({ page }) => {
      await loginAsOwner(page);
      await page.goto("/scan");

      const codeInput = page.getByRole("textbox", { name: "Scan or type a code", exact: true });
      await codeInput.fill(SEEDED_PID);
      await codeInput.press("Enter");

      const takeOutButton = page.getByRole("button", { name: "Take out", exact: true });
      await expect(takeOutButton).toBeVisible({ timeout: 10_000 });

      await assertMin44(takeOutButton, "Scan: Take out button");
      await assertMin44(page.getByRole("button", { name: "Add", exact: true }), "Scan: Add button");
      await assertMin44(page.getByRole("button", { name: "Decrease quantity" }), "Scan: decrease-qty stepper");
      await assertMin44(page.getByRole("button", { name: "Increase quantity" }), "Scan: increase-qty stepper");
    });

    test("cart: a line's Remove control is >=44px", async ({ page }) => {
      const supabase = serviceClient();
      const owner = await supabase.from("smark_app_users").select("id").eq("username", "owner").single();
      if (owner.error || !owner.data) throw new Error(`seeded "owner" app user not found: ${owner.error?.message ?? "no row"}`);

      const mpn = `E2E-A11Y-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const cartItem = await supabase
        .from("smark_cart_items")
        .insert({
          part_id: null,
          descriptor: { mpn },
          source: "manual",
          demand: [],
          qty_to_order: 3,
          status: "open",
          created_by: owner.data.id,
        })
        .select("id")
        .single();
      if (cartItem.error || !cartItem.data) throw new Error(`could not seed the a11y cart-line fixture: ${cartItem.error?.message ?? "no row"}`);

      try {
        await loginAsOwner(page);
        await page.goto("/cart");

        const lineCard = page.locator(".rounded-2xl", { hasText: mpn }).first();
        await expect(lineCard).toBeVisible({ timeout: 10_000 });

        const removeButton = lineCard.getByRole("button", { name: "Remove from cart" });
        await assertMin44(removeButton, "Cart line: Remove button");
      } finally {
        await supabase.from("smark_cart_items").delete().eq("id", cartItem.data.id);
      }
    });

    test("bottom bar: all 4 primary items + More are >=44px", async ({ page }) => {
      await loginAsOwner(page);
      await page.goto("/dashboard");
      // Wait for the bar to have actually painted post-navigation before
      // reading geometry off it — `assertMin44` itself polls the
      // `boundingBox()` read (see its own header comment) so a transient
      // mid-hydration `null` retries instead of failing the whole test.
      const moreButton = page.getByRole("button", { name: /^more$/i });
      await expect(moreButton).toBeVisible();

      // Owner sees all 4 primary slots (lib/auth/roles.ts ROLE_MATRIX: owner
      // full everywhere) — same items lib/nav.ts's BottomBar itself renders.
      for (const item of visibleMobilePrimaryItems("owner")) {
        const link = page.getByRole("link", { name: item.label, exact: true });
        await expect(link).toBeVisible();
        await assertMin44(link, `Bottom bar: ${item.label}`);
      }
      await assertMin44(moreButton, "Bottom bar: More button");
    });

    test("More sheet: every listed item is >=44px", async ({ page }) => {
      await loginAsOwner(page);
      await page.goto("/dashboard");
      await page.getByRole("button", { name: /^more$/i }).click();

      const sheet = page.getByRole("dialog", { name: "More" });
      await expect(sheet).toBeVisible();

      const links = sheet.getByRole("link");
      const count = await links.count();
      expect(count, "More sheet lists at least one item for the owner role").toBeGreaterThan(0);
      for (let i = 0; i < count; i += 1) {
        await assertMin44(links.nth(i), `More sheet item #${i}`);
      }
    });
  });

  test.describe("flow-8: reduced-motion pass through the ordering pipeline", () => {
    // Emulates the OS-level "reduce motion" accessibility setting for the
    // whole browser context — the run console (components/run/run-console-view.tsx)
    // has its own CSS spin/pulse animations; this proves they never become a
    // functional dependency (the console must still reach a terminal state).
    // `reducedMotion` isn't a top-level `use` field in this Playwright
    // version (1.61.1) — it only exists on `contextOptions`, which merges
    // underneath the project's own explicit fields (devices["Pixel 9"]'s
    // viewport/userAgent/etc. still win where they're set directly).
    test.use({ contextOptions: { reducedMotion: "reduce" } });

    const FIXTURE_PROJECT_NAME = "SmarkStock E2E — reduced-motion run";
    const FIXTURE_REF = "R1";

    function drainAgentRuns(): void {
      const repoRoot = path.resolve(__dirname, "..", "..");
      execFileSync("bun", ["run", "scripts/e2e-drain-agent-runs.ts"], {
        cwd: repoRoot,
        stdio: "inherit",
        shell: true,
        timeout: 30_000,
      });
    }

    /**
     * Minimal project+BOM+line fixture — enough to reach "Run ordering" and
     * drain it in mock mode. Deliberately its own fixture project (distinct
     * name from tests/e2e/ordering-run-review.spec.ts's) and a fresh
     * per-run-unique BOM/mpn tag, so this can run concurrently with that
     * suite (and with itself across both viewport projects) without
     * colliding. Only "LCSC" enabled in the distributor sequence — same
     * mock-determinism rationale as ordering-run-review.spec.ts's header
     * (a "browse"-type distributor resolves to MockDistributorClient with no
     * live network call; Digikey/Mouser/element14 stay disabled so a job
     * never reaches their untested REST clients in replay mode).
     */
    async function ensureReducedMotionRunFixture(): Promise<{ projectId: string; bomId: string }> {
      const supabase = serviceClient();

      const existingProject = await supabase.from("smark_projects").select("id").eq("name", FIXTURE_PROJECT_NAME).maybeSingle();
      if (existingProject.error) throw new Error(`fixture project lookup failed: ${existingProject.error.message}`);
      let projectId = existingProject.data?.id as string | undefined;
      if (!projectId) {
        const created = await supabase.from("smark_projects").insert({ name: FIXTURE_PROJECT_NAME, client: "E2E fixture" }).select("id").single();
        if (created.error || !created.data) throw new Error(`could not seed the fixture project: ${created.error?.message ?? "no row returned"}`);
        projectId = created.data.id as string;
      }

      const distributors = await supabase.from("smark_distributors").select("id, name");
      if (distributors.error || !distributors.data?.length) {
        throw new Error(`smark_distributors isn't seeded (supabase/seed.sql): ${distributors.error?.message ?? "no rows"}`);
      }
      const distributorSequence = distributors.data.map((d) => ({ distributor_id: d.id as string, enabled: (d.name as string) === "LCSC" }));
      if (!distributorSequence.some((d) => d.enabled)) {
        throw new Error('"LCSC" isn\'t seeded (supabase/seed.sql) — the fixture needs it for a mock-safe distributor sequence.');
      }

      const runTag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const bom = await supabase
        .from("smark_boms")
        .insert({ project_id: projectId, name: `Reduced-motion E2E ${runTag}`, build_qty: 1, distributor_sequence: distributorSequence })
        .select("id")
        .single();
      if (bom.error || !bom.data) throw new Error(`could not seed the fixture BOM: ${bom.error?.message ?? "no row returned"}`);
      const bomId = bom.data.id as string;

      const line = await supabase.from("smark_bom_lines").insert({
        bom_id: bomId,
        line_no: 1,
        references: FIXTURE_REF,
        qty: 25,
        value: "10k",
        footprint: "0603",
        mpn: `E2ETEST-RM-${runTag}`,
        dnp: false,
        match_state: "to_order",
      });
      if (line.error) throw new Error(`could not seed the fixture BOM line: ${line.error.message}`);

      return { projectId, bomId };
    }

    test("the run console still reaches Review results with prefers-reduced-motion on", async ({ page }) => {
      test.setTimeout(120_000); // three route compiles (ordering workspace, run console) + a synchronous worker drain

      const fixture = await ensureReducedMotionRunFixture();
      await loginAsOwner(page);

      await page.goto(`/projects/${fixture.projectId}/ordering/${fixture.bomId}`);
      const runOrderingButton = page.getByRole("button", { name: /run ordering/i });
      await expect(runOrderingButton).toBeEnabled({ timeout: 15_000 });
      await runOrderingButton.click();

      await page.waitForURL(new RegExp(`/projects/${fixture.projectId}/runs/[0-9a-f-]+$`), { timeout: 20_000 });
      await expect(page.getByText("Master agent")).toBeVisible();

      // Synchronously ticks the worker's own poll loop (mock mode, no live
      // keys) so the run reaches a terminal status deterministically.
      drainAgentRuns();

      await page.reload();
      const reviewButton = page.getByRole("button", { name: /review results/i });
      await expect(reviewButton, "the run console reached a terminal state under prefers-reduced-motion").toBeVisible({
        timeout: 15_000,
      });
    });
  });
}
