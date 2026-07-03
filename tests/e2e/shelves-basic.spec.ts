import { expect, test } from "@playwright/test";

/**
 * Shelves E2E — smoke coverage runnable today (auth guard only).
 *
 * `app/(app)/layout.tsx` (auth-shell) redirects any unauthenticated `(app)`
 * request to `/login` — this is the one behavior of the Shelves route that's
 * testable without a signed-in session or seeded fixtures. The fuller flow
 * (rack renders shelves/boxes, low dots, box detail QR + Print Big-Box label
 * queueing, and the guided audit walk incl. a real variance) needs seeded
 * `smark_shelves`/`smark_big_boxes`/`smark_stock_locations` rows + a logged-in
 * role client per plan/TESTING.md §4 — add those specs once fixtures land
 * (see this package's report for what's still missing).
 *
 * Same bun-guard as tests/e2e/smoke.spec.ts: `bun test` also globs
 * `*.spec.ts`, so this file must refuse to run under the Bun runtime.
 */
if (typeof process.versions.bun === "undefined") {
  test.describe("shelves — auth guard", () => {
    test("unauthenticated visit to the rack view redirects to /login", async ({ page }) => {
      await page.goto("/shelves");
      // The auth-shell redirect appends `?next=<original path>` so the login
      // form can bounce back after sign-in — match that instead of anchoring
      // right after `/login` (which rejected the real, correct redirect).
      await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    });

    test("unauthenticated visit to a box detail route redirects to /login", async ({ page }) => {
      await page.goto("/shelves/00000000-0000-0000-0000-000000000000");
      await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    });
  });
}
