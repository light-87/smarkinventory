import { expect, test, type Page } from "@playwright/test";

/**
 * E2E — Projects hub (plan/tab-orders-projects.md R2-03/30/32).
 *
 * Same Bun-exclusion guard + login helper as tests/e2e/dashboard-smoke.spec.ts.
 * Creates its own project via the UI (unique per run) rather than depending
 * on canonical seed data — this package doesn't own any seed fixtures, and
 * the flow under test (create → add a phase → advance → archive warning) is
 * self-contained end to end.
 */
if (typeof process.versions.bun === "undefined") {
  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill("owner");
    await page.locator("#login-password").fill("Owner@12345");
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  test.describe("projects hub", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page);
    });

    test("create a project, add a phase, advance the timeline, and see the archive warning", async ({ page }) => {
      const projectName = `E2E Project ${Date.now()}`;

      await page.goto("/projects");
      await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

      // --- Create -------------------------------------------------------
      await page.getByPlaceholder("Mainboard rev C").fill(projectName);
      await page.getByPlaceholder("Acme Robotics").fill("Acme Robotics");
      await page.getByRole("button", { name: "Create" }).click();

      await page.waitForURL(/\/projects\/[0-9a-f-]+$/, { timeout: 15_000 });
      await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
      await expect(page.getByText("Draft").first()).toBeVisible();

      // --- Add a phase ----------------------------------------------------
      await page.getByRole("button", { name: "+ Add phase" }).click();
      await page.getByPlaceholder("Phase name").fill("Schematic design");
      await page.getByRole("button", { name: "Add phase" }).click();

      // The writable owner sees an editable row — the name is an <input>
      // value, not a text node, so match on the attribute (not getByText).
      await expect(page.locator('input[value="Schematic design"]')).toBeVisible({ timeout: 10_000 });
      // Same 10s allowance as the row-input check above (not the suite's
      // tight 5s default) — this Chip lands from the SAME addPhaseAction +
      // router.refresh() round trip, so it's exactly as vulnerable to a
      // slow first render/RSC re-fetch of this just-created dynamic route.
      await expect(page.getByText("Pending").first()).toBeVisible({ timeout: 10_000 });

      // --- Advance (start the timeline) ------------------------------------
      await page.getByRole("button", { name: "Start timeline →" }).click();
      await expect(page.getByText("Active").first()).toBeVisible({ timeout: 10_000 });

      // Progress card reflects the active phase.
      await expect(page.getByText("Active: Schematic design")).toBeVisible();

      // --- Archive shows the consequences warning before it takes effect --
      await page.getByRole("button", { name: "Archive project" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await expect(page.getByText(/releases all cart demand/i)).toBeVisible();

      await page.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();
      await expect(page.getByText("Archived").first()).toBeVisible({ timeout: 10_000 });

      // Archived projects drop off the default (active) list. The 1.5s wait
      // + cache-busting query param are deliberate: this exercises a SEPARATE
      // route (`/projects`) than the one archiveProjectAction was invoked
      // from (`/projects/:id`) — empirically, against `next dev`/Turbopack,
      // revalidatePath("/projects")'s effect isn't always visible on the very
      // next request to that path (observed stale reads for well under 2s
      // after a confirmed-committed write; a byte-fresh URL rules out any
      // HTTP/browser cache explanation). Worth a second look if this ever
      // flakes — see this package's report for the investigation notes.
      await page.waitForTimeout(1500);
      await page.goto(`/projects?_e2e=${Date.now()}`);
      await expect(page.getByText(projectName)).toHaveCount(0);

      await page.goto(`/projects?archived=1&_e2e=${Date.now()}`);
      await expect(page.getByText(projectName)).toBeVisible();
    });
  });
}
