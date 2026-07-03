import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * E2E — THE ordering pipeline flow (plan/tab-ordering-workspace.md,
 * plan/tab-agent-run.md, plan/tab-order-review.md; FEATURES.md §6): seeded
 * BOM → Ordering Workspace → "Run ordering →" (worker drains in mock mode,
 * no live keys) → Agent Run console → Order Review → Add to cart → Cart
 * shows the line. Runs against BOTH viewport projects automatically
 * (playwright.config.ts applies every spec to `desktop-1280` + `mobile-360`).
 *
 * Same Bun-vs-Playwright self-exclusion guard as tests/e2e/smoke.spec.ts —
 * `bun test` also globs `*.spec.ts`, so this file no-ops there and only
 * really runs via `bunx playwright test`.
 *
 * Mock-mode determinism (types/worker.ts, worker/src/distributors/mock.ts):
 * the fixture BOM's `distributor_sequence` is seeded directly to enable
 * ONLY "LCSC" (a "browse"-type distributor with no BrowserDriver configured
 * in the drain script — worker/src/distributors/index.ts resolves that
 * straight to `MockDistributorClient`, never a real network call). Digikey/
 * Mouser/element14 stay disabled so a job never reaches their REST clients,
 * which would throw in replay mode with no recorded fixture
 * (worker/src/distributors/record-replay.ts) — this is deliberate, not an
 * oversight: those clients are best-effort/untested (FEATURES.md build brief
 * "NO LIVE KEYS EXIST").
 *
 * projects-hub (a parallel package) owns "New project" UI, and bom-pipeline
 * owns BOM creation — this suite seeds its fixture directly via the
 * service-role client (same inlined-factory pattern as
 * tests/e2e/bom-upload.spec.ts / tests/e2e/cart-smoke.spec.ts; `tests/
 * helpers/supabase.ts` isn't imported here because it pulls in `bun:test`,
 * which doesn't exist under Playwright's own Node runtime). A FRESH BOM is
 * created every run (timestamped name) rather than reused, so repeated local
 * runs never accumulate stale sourcing state on one BOM — CI always starts
 * from a clean `supabase db reset` anyway.
 */
if (typeof process.versions.bun === "undefined") {
  const FIXTURE_PROJECT_NAME = "SmarkStock E2E — Ordering run+review";
  const FIXTURE_REF = "R1";

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

  interface Fixture {
    projectId: string;
    bomId: string;
    bomName: string;
    mpn: string;
  }

  async function ensureFixture(): Promise<Fixture> {
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
    // ONLY "LCSC" enabled — see module doc's mock-determinism note.
    const distributorSequence = distributors.data.map((d) => ({ distributor_id: d.id as string, enabled: (d.name as string) === "LCSC" }));
    if (!distributorSequence.some((d) => d.enabled)) {
      throw new Error('"LCSC" isn\'t seeded (supabase/seed.sql) — the fixture needs it for a mock-safe distributor sequence.');
    }

    // Playwright applies every spec to BOTH viewport projects (playwright.config.ts),
    // which can run this exact test concurrently on separate workers against
    // the SAME local Supabase stack. A per-run-unique tag (not just
    // `Date.now()` on the BOM name) keeps the two concurrent invocations from
    // ever resolving to the SAME aggregated `smark_cart_items` row by MPN
    // (lib/runs/cart.ts matches never-catalogued lines by `descriptor.mpn`) —
    // that row carries a SINGLE mutable `chosen_result_id` pointer, so two
    // concurrent adds racing for it would make whichever one loses look like
    // it was never added when its review page re-reads the DB.
    const runTag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const bomName = `Ordering E2E ${runTag}`;
    const mpn = `E2ETEST-ORDR-${runTag}`;

    const bom = await supabase
      .from("smark_boms")
      .insert({ project_id: projectId, name: bomName, build_qty: 1, distributor_sequence: distributorSequence })
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
      mpn,
      dnp: false,
      match_state: "to_order",
    });
    if (line.error) throw new Error(`could not seed the fixture BOM line: ${line.error.message}`);

    return { projectId, bomId, bomName, mpn };
  }

  /**
   * Synchronously ticks the worker's own poll loop (scripts/e2e-drain-agent-
   * runs.ts, imports worker/index.ts directly) so the run just enqueued via
   * the UI reaches a terminal status before this test keeps going — mirrors
   * tests/e2e/global-setup.ts's `execFileSync("bun", ["run", ...])` pattern.
   */
  function drainAgentRuns(): void {
    const repoRoot = path.resolve(__dirname, "..", "..");
    execFileSync("bun", ["run", "scripts/e2e-drain-agent-runs.ts"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: true,
      timeout: 30_000,
    });
  }

  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill("owner");
    await page.locator("#login-password").fill("Owner@12345");
    await page.getByRole("button", { name: /log in/i }).click();
    // Same generous cold-Turbopack-compile headroom as tests/e2e/dashboard-smoke.spec.ts.
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  test.describe("Ordering → Run → Review [E2E, owner]", () => {
    test("seeded BOM → workspace → mock run completes → review → add to cart → cart shows the line", async ({ page }) => {
      // Generous budget: this flow first-touch-compiles three routes
      // (ordering workspace, run console, review) AND blocks on the worker
      // drain script — well beyond the suite's shared 30s default.
      test.setTimeout(120_000);

      const fixture = await ensureFixture();

      await loginAsOwner(page);

      // ── 1. Ordering Workspace ──────────────────────────────────────────
      await page.goto(`/projects/${fixture.projectId}/ordering/${fixture.bomId}`);
      await expect(page.getByRole("heading", { name: fixture.bomName })).toBeVisible();
      await expect(page.getByText("Distributor sequence")).toBeVisible();
      await expect(page.getByText("Priorities", { exact: true })).toBeVisible();
      await expect(page.getByText("AI Memory added as context")).toBeVisible();
      await expect(page.getByText("Standard search rules")).toBeVisible();
      await expect(page.getByText(/dry-run estimate/i)).toBeVisible();

      const runOrderingButton = page.getByRole("button", { name: /run ordering/i });
      await expect(runOrderingButton).toBeEnabled();
      await runOrderingButton.click();

      // ── 2. Agent Run console (navigated to on successful enqueue) ──────
      await page.waitForURL(new RegExp(`/projects/${fixture.projectId}/runs/[0-9a-f-]+$`), { timeout: 20_000 });
      await expect(page.getByText("Master agent")).toBeVisible();

      // Drain the worker's poll loop synchronously — mock mode (no live
      // keys), so this settles the run deterministically in a few ticks.
      drainAgentRuns();

      await page.reload();
      const reviewButton = page.getByRole("button", { name: /review results/i });
      await expect(reviewButton).toBeVisible({ timeout: 15_000 });
      await reviewButton.click();

      // ── 3. Order Review (persisted, R2-08) ─────────────────────────────
      await page.waitForURL(new RegExp(`/projects/${fixture.projectId}/runs/[0-9a-f-]+/review$`), { timeout: 20_000 });

      const lineCard = page.locator(".rounded-2xl", { hasText: FIXTURE_REF }).first();
      await expect(lineCard).toBeVisible();
      await expect(lineCard.getByText("Recommended", { exact: true })).toBeVisible();
      await expect(lineCard.getByText("Confidence")).toBeVisible();
      await expect(lineCard.getByText(/^AI ·/)).toBeVisible();

      await lineCard.getByRole("button", { name: /add to cart/i }).click();
      await expect(lineCard.getByText(/added to cart|already in cart/i)).toBeVisible();
      await expect(page.getByText(/added to cart: 1 item/i)).toBeVisible();

      // ── 4. Cart shows the line ──────────────────────────────────────────
      // Scoped to the fixture's own card (by its unique mpn) — the shared
      // local/CI DB can carry OTHER "From review" cart lines from unrelated
      // runs, so a page-wide text search isn't strict-mode-safe here.
      await page.goto("/cart");
      const cartLineCard = page.locator(".rounded-2xl", { hasText: fixture.mpn }).first();
      await expect(cartLineCard).toBeVisible();
      await expect(cartLineCard.getByText("From review")).toBeVisible();
    });
  });
}
