import { expect, test, type Page } from "@playwright/test";
import { createServiceClient } from "@/lib/supabase/server";
import { TABLES } from "@/types/db";

/**
 * E2E — Bulk takeout (plan/tab-bulk-pick.md · FEATURES.md §5.6).
 *
 * Same bun-vs-Playwright self-exclusion guard as tests/e2e/smoke.spec.ts:
 * `bun test` also globs `*.spec.ts`, so this file no-ops under the Bun
 * runtime and only really runs via `bunx playwright test`.
 *
 * Uses `createServiceClient` (from `@/lib/supabase/server`, NOT
 * `tests/helpers/supabase.ts` — that helper imports `bun:test`, which
 * doesn't exist under Playwright's plain-Node worker process) to seed
 * dedicated, disposable fixtures per describe block (own shelf/box/part,
 * own project/BOM) rather than mutating the shared canonical demo dataset
 * (tests/fixtures/canonical-seed-data.ts) that other packages' suites also
 * read — every fixture is torn down in `afterAll`. A random suffix (not just
 * `Date.now()`) keeps the two Playwright projects (desktop-1280/mobile-360,
 * which both run this file independently and in parallel per
 * playwright.config.ts) from ever colliding on a millisecond tie.
 */
if (typeof process.versions.bun === "undefined") {
  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill("owner");
    await page.locator("#login-password").fill("Owner@12345");
    await page.getByRole("button", { name: /log in/i }).click();
    // See tests/e2e/dashboard-smoke.spec.ts for why this is 25s, not 15s —
    // login always redirects through /dashboard first.
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  function uniqueTag(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  test.describe("Bulk takeout — no session", () => {
    test("visiting /bulk-takeout while signed out redirects to /login", async ({ page }) => {
      const response = await page.goto("/bulk-takeout");
      expect(response?.ok(), "/bulk-takeout responds 2xx even signed out").toBeTruthy();
      await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    });
  });

  test.describe("Bulk takeout — ad-hoc paste [E2E]", () => {
    const tag = uniqueTag();
    const mpn = `TEST-TAKEOUT-PASTE-${tag}`;
    let ownerId: string;
    let partId: string;
    let shelfId: string;
    let boxId: string;
    let locationId: string;

    test.beforeAll(async () => {
      const supabase = createServiceClient();
      const owner = await supabase.from(TABLES.app_users).select("id").eq("username", "owner").single();
      if (owner.error || !owner.data) throw new Error(`could not find seeded owner user: ${owner.error?.message}`);
      ownerId = owner.data.id as string;

      const shelf = await supabase
        .from(TABLES.shelves)
        .insert({ code: `TK${tag}`.slice(0, 12), name: "Bulk takeout E2E shelf", created_by: ownerId })
        .select("id")
        .single();
      if (shelf.error || !shelf.data) throw new Error(`seed shelf failed: ${shelf.error?.message}`);
      shelfId = shelf.data.id as string;

      const box = await supabase
        .from(TABLES.big_boxes)
        .insert({ shelf_id: shelfId, name: `Takeout E2E box ${tag}`, created_by: ownerId })
        .select("id")
        .single();
      if (box.error || !box.data) throw new Error(`seed box failed: ${box.error?.message}`);
      boxId = box.data.id as string;

      const part = await supabase
        .from(TABLES.parts)
        .insert({
          internal_pid: `SMKTEST-${tag}`,
          mpn,
          value: "4.7k",
          package: "0603",
          part_status: "active",
          currency: "INR",
          needs_review: false,
          created_by: ownerId,
        })
        .select("id")
        .single();
      if (part.error || !part.data) throw new Error(`seed part failed: ${part.error?.message}`);
      partId = part.data.id as string;

      const location = await supabase
        .from(TABLES.stock_locations)
        .insert({ part_id: partId, big_box_id: boxId, qty: 100, created_by: ownerId })
        .select("id")
        .single();
      if (location.error || !location.data) throw new Error(`seed location failed: ${location.error?.message}`);
      locationId = location.data.id as string;
    });

    test.afterAll(async () => {
      const supabase = createServiceClient();
      await supabase.from(TABLES.movements).delete().eq("part_id", partId);
      await supabase.from(TABLES.stock_locations).delete().eq("id", locationId);
      await supabase.from(TABLES.parts).delete().eq("id", partId);
      await supabase.from(TABLES.big_boxes).delete().eq("id", boxId);
      await supabase.from(TABLES.shelves).delete().eq("id", shelfId);
    });

    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page);
    });

    test("paste a BOM line, adjust ×N, check it off, finish — a bulk_pick movement is logged", async ({ page }) => {
      await page.goto("/bulk-takeout");

      await page.getByLabel("…or paste rows copied from a spreadsheet").fill(`Reference\tQty\tValue\tMPN\nR1\t2\t4.7k\t${mpn}`);
      await page.getByRole("button", { name: "Resolve pasted lines" }).click();

      await expect(page.getByText("Pasted BOM")).toBeVisible();
      await expect(page.getByText("0 of 1 picked")).toBeVisible();

      const row = page.locator("tr").filter({ hasText: "R1" });
      await expect(row).toContainText("2"); // default ×1 pick qty
      await expect(row).toContainText("Shelf");

      await page.getByLabel("Build multiplier").fill("3");
      await expect(row).toContainText("6"); // 2 × 3, recomputed with no server round trip

      await page.getByRole("button", { name: "Mark as picked" }).click();
      await expect(page.getByText("1 of 1 picked")).toBeVisible();

      await page.getByRole("button", { name: "Finish takeout" }).click();
      // finishTakeoutAction is a real server round trip (recordMovement's
      // read-modify-write per line) — the suite's tight 5s default has been
      // observed to be too little margin under load; 10s matches this
      // file's own login-helper convention for a genuine mutation + re-render.
      await expect(page.getByText(/movement.*logged/i)).toBeVisible({ timeout: 10_000 });

      const supabase = createServiceClient();
      const { data: movements, error } = await supabase
        .from(TABLES.movements)
        .select("*")
        .eq("part_id", partId)
        .eq("reason", "bulk_pick");
      expect(error).toBeNull();
      expect(movements).toHaveLength(1);
      expect(movements![0]).toMatchObject({ delta_qty: -6, bom_id: null, actor: ownerId });
    });
  });

  test.describe("Bulk takeout — pick a project BOM [R2-03/R2-27]", () => {
    const tag = uniqueTag();
    const mpn = `TEST-TAKEOUT-BOM-${tag}`;
    let ownerId: string;
    let partId: string;
    let shelfId: string;
    let boxId: string;
    let locationId: string;
    let projectId: string;
    let bomId: string;

    test.beforeAll(async () => {
      const supabase = createServiceClient();
      const owner = await supabase.from(TABLES.app_users).select("id").eq("username", "owner").single();
      if (owner.error || !owner.data) throw new Error(`could not find seeded owner user: ${owner.error?.message}`);
      ownerId = owner.data.id as string;

      const shelf = await supabase
        .from(TABLES.shelves)
        .insert({ code: `TB${tag}`.slice(0, 12), name: "Bulk takeout BOM E2E shelf", created_by: ownerId })
        .select("id")
        .single();
      if (shelf.error || !shelf.data) throw new Error(`seed shelf failed: ${shelf.error?.message}`);
      shelfId = shelf.data.id as string;

      const box = await supabase
        .from(TABLES.big_boxes)
        .insert({ shelf_id: shelfId, name: `Takeout BOM E2E box ${tag}`, created_by: ownerId })
        .select("id")
        .single();
      if (box.error || !box.data) throw new Error(`seed box failed: ${box.error?.message}`);
      boxId = box.data.id as string;

      const part = await supabase
        .from(TABLES.parts)
        .insert({
          internal_pid: `SMKTESTB-${tag}`,
          mpn,
          value: "10µF",
          package: "1206",
          part_status: "active",
          currency: "INR",
          needs_review: false,
          created_by: ownerId,
        })
        .select("id")
        .single();
      if (part.error || !part.data) throw new Error(`seed part failed: ${part.error?.message}`);
      partId = part.data.id as string;

      const location = await supabase
        .from(TABLES.stock_locations)
        .insert({ part_id: partId, big_box_id: boxId, qty: 100, created_by: ownerId })
        .select("id")
        .single();
      if (location.error || !location.data) throw new Error(`seed location failed: ${location.error?.message}`);
      locationId = location.data.id as string;

      const project = await supabase
        .from(TABLES.projects)
        .insert({ name: `Takeout E2E project ${tag}`, created_by: ownerId })
        .select("id")
        .single();
      if (project.error || !project.data) throw new Error(`seed project failed: ${project.error?.message}`);
      projectId = project.data.id as string;

      // build_qty = 3 — the ×N banner should prefill from THIS, not from 1.
      const bom = await supabase
        .from(TABLES.boms)
        .insert({ name: "Mainboard v1", project_id: projectId, build_qty: 3, line_count: 1, created_in_app: true, uploaded_by: ownerId })
        .select("id")
        .single();
      if (bom.error || !bom.data) throw new Error(`seed bom failed: ${bom.error?.message}`);
      bomId = bom.data.id as string;

      const line = await supabase
        .from(TABLES.bom_lines)
        .insert({ bom_id: bomId, line_no: 1, references: "C1,C2", qty: 2, value: "10µF", mpn, dnp: false });
      if (line.error) throw new Error(`seed bom line failed: ${line.error.message}`);
    });

    test.afterAll(async () => {
      const supabase = createServiceClient();
      await supabase.from(TABLES.movements).delete().eq("part_id", partId);
      await supabase.from(TABLES.bom_lines).delete().eq("bom_id", bomId);
      await supabase.from(TABLES.boms).delete().eq("id", bomId);
      await supabase.from(TABLES.projects).delete().eq("id", projectId);
      await supabase.from(TABLES.stock_locations).delete().eq("id", locationId);
      await supabase.from(TABLES.parts).delete().eq("id", partId);
      await supabase.from(TABLES.big_boxes).delete().eq("id", boxId);
      await supabase.from(TABLES.shelves).delete().eq("id", shelfId);
    });

    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page);
    });

    test("pick a project BOM → ×N banner prefills from build_qty → finish logs a bom-linked movement", async ({ page }) => {
      await page.goto("/bulk-takeout");

      await page.getByLabel("Project").selectOption({ label: `Takeout E2E project ${tag}` });
      await page.getByLabel("BOM").selectOption({ label: "Mainboard v1 · 1 lines · ×3" });
      await page.getByRole("button", { name: "Load this BOM" }).click();

      await expect(page.getByText(`Takeout E2E project ${tag} · Mainboard v1`)).toBeVisible();

      // build_qty = 3 prefills the banner — 2 × 3 = 6 without any manual adjustment.
      await expect(page.getByLabel("Build multiplier")).toHaveValue("3");
      const row = page.locator("tr").filter({ hasText: "C1,C2" });
      await expect(row).toContainText("6");

      await page.getByRole("button", { name: "Mark as picked" }).click();
      await page.getByRole("button", { name: "Finish takeout" }).click();
      // finishTakeoutAction is a real server round trip (recordMovement's
      // read-modify-write per line) — the suite's tight 5s default has been
      // observed to be too little margin under load; 10s matches this
      // file's own login-helper convention for a genuine mutation + re-render.
      await expect(page.getByText(/movement.*logged/i)).toBeVisible({ timeout: 10_000 });

      const supabase = createServiceClient();
      const { data: movements, error } = await supabase
        .from(TABLES.movements)
        .select("*")
        .eq("part_id", partId)
        .eq("reason", "bulk_pick");
      expect(error).toBeNull();
      expect(movements).toHaveLength(1);
      expect(movements![0]).toMatchObject({ delta_qty: -6, bom_id: bomId, actor: ownerId });
    });
  });
}
