import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * E2E FLOW-7 — PWA installability + offline scan queue (plan/TESTING.md §3.7:
 * "app installable, shell cached, scan queues a movement offline → syncs.").
 *
 * Same Bun-vs-Playwright self-exclusion guard as tests/e2e/smoke.spec.ts —
 * `bun test` also globs `*.spec.ts`, so this file no-ops there and only runs
 * via `bunx playwright test`. Playwright applies this spec to BOTH viewport
 * projects (playwright.config.ts) automatically.
 *
 * Fixture: this suite does its own tiny service-role lookup (mirrors
 * tests/e2e/ordering-run-review.spec.ts's inlined `serviceClient()`, not
 * tests/helpers/supabase.ts — that file imports `bun:test`, which only
 * resolves under Bun's own runtime, not the Node runtime Playwright specs run
 * under) to seed a DEDICATED part+stock-location for the offline take-out
 * (not the widely-shared `SMK-000101` family other specs' e2e/unit fixtures
 * also read-write concurrently — an earlier version of this test used that
 * PID and flaked under the full suite's concurrency: another spec's
 * take-out could drain it to 0 between "queue offline" and "sync online",
 * so the deferred write failed for real (insufficient stock) and got
 * DROPPED — not synced — which still clears the queue/banner exactly like a
 * genuine sync would, silently invalidating the "it became a real movement"
 * assertion below). A part only this test ever touches, seeded with a huge
 * qty buffer, can't be starved that way.
 */
if (typeof process.versions.bun === "undefined") {
  const OWNER_USERNAME = process.env.E2E_OWNER_USERNAME ?? "owner";
  const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "Owner@12345";

  // lib/scan/offline-queue.ts's STORAGE_KEY — not exported, so this mirrors
  // the exact literal (also asserted directly in tests/unit/scan-offline-queue.test.ts).
  const OFFLINE_QUEUE_STORAGE_KEY = "smarkstock.scan.offlineMovements.v1";

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

  /**
   * Idempotent (looked up by its fixed `internal_pid` first, same convention
   * as tests/e2e/cart-smoke.spec.ts's `ensureReceiptFixtureOrder`) —
   * exclusively owned by this test, so reruns/concurrency never contend for
   * its stock the way the shared canonical family does.
   */
  async function ensureOfflineQueueFixturePart(
    supabase: ReturnType<typeof serviceClient>,
  ): Promise<{ id: string; internalPid: string }> {
    const internalPid = "E2E-OFFLINE-QUEUE-0001";

    const existing = await supabase.from("smark_parts").select("id").eq("internal_pid", internalPid).maybeSingle();
    if (existing.error) throw new Error(`fixture part lookup failed: ${existing.error.message}`);
    if (existing.data?.id) return { id: existing.data.id as string, internalPid };

    const anyBox = await supabase.from("smark_big_boxes").select("id").limit(1).maybeSingle();
    if (anyBox.error || !anyBox.data) {
      throw new Error(`no smark_big_boxes row to hang the fixture location off of: ${anyBox.error?.message ?? "no rows — run the canonical seed"}`);
    }

    const part = await supabase
      .from("smark_parts")
      .insert({ internal_pid: internalPid, description: "tests/e2e/flow-7-pwa-offline.spec.ts fixture — do not use elsewhere" })
      .select("id")
      .single();
    if (part.error || !part.data) throw new Error(`could not seed the fixture part: ${part.error?.message ?? "no row returned"}`);

    // Huge qty buffer — this test only ever takes out 1 at a time, but the
    // whole point of a dedicated part is that nothing else touches it either.
    const location = await supabase
      .from("smark_stock_locations")
      .insert({ part_id: part.data.id, big_box_id: anyBox.data.id, qty: 100_000 });
    if (location.error) throw new Error(`could not seed the fixture stock location: ${location.error.message}`);

    return { id: part.data.id as string, internalPid };
  }

  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill(OWNER_USERNAME);
    await page.locator("#login-password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: /log in/i }).click();
    // Same cold-Turbopack-compile headroom as tests/e2e/dashboard-smoke.spec.ts.
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  test.describe("flow-7: PWA manifest + service worker", () => {
    test("manifest.json is served with the required installability fields", async ({ page }) => {
      const response = await page.request.get("/manifest.json");
      expect(response.ok(), "/manifest.json responds 2xx").toBeTruthy();

      const manifest = await response.json();
      expect(manifest.name).toBe("SmarkStock");
      expect(manifest.short_name).toBe("SmarkStock");
      expect(manifest.start_url).toBe("/dashboard");
      expect(manifest.display).toBe("standalone");
      expect(typeof manifest.background_color).toBe("string");
      expect(typeof manifest.theme_color).toBe("string");

      expect(Array.isArray(manifest.icons)).toBe(true);
      expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
      for (const icon of manifest.icons as Array<Record<string, unknown>>) {
        expect(typeof icon.src).toBe("string");
        expect(typeof icon.sizes).toBe("string");
        expect(icon.type).toBe("image/png");
      }
      // At least one maskable/any icon at 192 and one at 512 (installability floor).
      const sizes = (manifest.icons as Array<{ sizes: string }>).map((i) => i.sizes);
      expect(sizes).toContain("192x192");
      expect(sizes).toContain("512x512");
    });

    test("the public /login document links the manifest (installability, not just a servable file)", async ({ page }) => {
      const response = await page.goto("/login");
      expect(response?.ok(), "/login responds 2xx").toBeTruthy();

      const manifestHref = await page.evaluate(
        () => document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null,
      );
      expect(manifestHref).toBe("/manifest.json");
    });

    test("a service worker registers and activates (public /login mount)", async ({ page }) => {
      await page.goto("/login");

      const scriptURL = await page.evaluate(async () => {
        if (!("serviceWorker" in navigator)) return null;
        const registration = await navigator.serviceWorker.ready.catch(() => null);
        return registration?.active?.scriptURL ?? null;
      });

      expect(scriptURL, "a service worker registered and reached the 'active' state").toBeTruthy();
      expect(scriptURL).toContain("/sw.js");
    });
  });

  test.describe("flow-7: offline scan take-out queues locally and syncs on reconnect", () => {
    test("go offline → take out 1 → queued banner + localStorage entry; go online → syncs into a real movement", async ({
      page,
      context,
    }) => {
      test.setTimeout(45_000);
      const supabase = serviceClient();

      // Seeded/looked-up strictly ONLINE — before this test ever flips the
      // browser context offline.
      const part = await ensureOfflineQueueFixturePart(supabase);

      await loginAsOwner(page);

      await page.goto("/scan");
      const codeInput = page.getByRole("textbox", { name: "Scan or type a code", exact: true });
      await codeInput.fill(part.internalPid);
      await codeInput.press("Enter");

      const takeOutButton = page.getByRole("button", { name: "Take out", exact: true });
      await expect(takeOutButton).toBeVisible({ timeout: 10_000 });

      // Baseline of this part's existing movement ids, captured strictly
      // ONLINE before anything is queued — deliberately NOT a `created_at`
      // wall-clock cutoff (`gte("created_at", <host Date.now()>)`): this
      // Playwright process runs on the Windows host while local Supabase's
      // Postgres runs inside the WSL2/Docker VM, and that VM's clock has
      // been observed to drift both ahead of and behind the host's by up to
      // ~30s (WSL2 clock skew after host sleep/resume is a known issue) —
      // a real synced movement's `created_at` landed *before* a
      // same-run host-clock `sinceIso` and failed this assertion even though
      // the sync had genuinely succeeded. Diffing against a captured id set
      // sidesteps cross-clock comparison entirely.
      const baseline = await supabase
        .from("smark_movements")
        .select("id")
        .eq("part_id", part.id)
        .eq("reason", "adjust");
      if (baseline.error) throw new Error(`baseline movements lookup failed: ${baseline.error.message}`);
      const baselineIds = new Set((baseline.data ?? []).map((m) => m.id as string));

      // ── go offline, take out 1 — the write fails as a network error and
      // gets queued locally instead of crashing or silently dropping ───────
      await context.setOffline(true);
      await takeOutButton.click();

      await expect(page.getByText("1 queued — will sync")).toBeVisible({ timeout: 10_000 });

      const queuedRaw = await page.evaluate(
        (key) => window.localStorage.getItem(key),
        OFFLINE_QUEUE_STORAGE_KEY,
      );
      expect(queuedRaw, "offline queue localStorage entry exists").toBeTruthy();
      const queued = JSON.parse(queuedRaw ?? "[]") as Array<{ input: { partId: string; deltaQty: number } }>;
      expect(queued).toHaveLength(1);
      expect(queued[0]?.input.partId).toBe(part.id);
      expect(queued[0]?.input.deltaQty).toBe(-1);

      // ── back online — `hooks/use-scanner.ts`'s `online` listener syncs
      // automatically, no user action required ─────────────────────────────
      await context.setOffline(false);

      await expect(page.getByText("1 queued — will sync")).toBeHidden({ timeout: 15_000 });

      const queuedAfterSync = await page.evaluate(
        (key) => window.localStorage.getItem(key),
        OFFLINE_QUEUE_STORAGE_KEY,
      );
      expect(JSON.parse(queuedAfterSync ?? "[]")).toHaveLength(0);

      // ── the queued take-out really landed as a movement, not just a UI
      // state change — asserted straight against the DB. A NEW row (id not
      // in the pre-offline baseline) rather than a time-bounded query — see
      // the baseline comment above for why. ───────────────────────────────
      const { data: movements, error: movementsError } = await supabase
        .from("smark_movements")
        .select("id, delta_qty, reason")
        .eq("part_id", part.id)
        .eq("reason", "adjust");
      if (movementsError) throw new Error(`movements lookup failed: ${movementsError.message}`);
      const newMovements = (movements ?? []).filter((m) => !baselineIds.has(m.id));
      expect(
        newMovements.some((m) => m.delta_qty === -1),
        "a NEW -1 qty 'adjust' movement was recorded for the seeded part after the queue synced",
      ).toBe(true);
    });
  });
}
