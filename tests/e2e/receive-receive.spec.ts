import { expect, test } from "@playwright/test";

/**
 * E2E — Receive surface (plan/tab-receive.md · plan/TESTING.md §3 E2E-1/E2E-2).
 *
 * Same Bun-vs-Playwright self-exclusion guard as tests/e2e/smoke.spec.ts:
 * `bun test` globs `*.spec.ts` too, so this file no-ops under the Bun runtime
 * and only really runs via `bunx playwright test`.
 *
 * The logged-in flows are `test.fixme()` (Playwright's "not yet runnable,
 * tracked" — there's no `test.todo()` in Playwright) until fixtures/seeds for
 * them land (plan/TESTING.md §4).
 *
 * "No session" coverage: auth-shell's `middleware.ts` now gates every
 * non-public route (including `/receive`) — a fully signed-out visit is
 * 302-redirected to `/login` before the Receive page ever renders, so it's
 * the redirect that's the "not a crash" outcome here, not the page's own
 * `EmptyState title="No access"` branch (`app/(app)/receive/page.tsx`) —
 * that branch is for a signed-IN user whose role fails `canSee(role,
 * "receive")", a different, not-yet-covered scenario.
 */
if (typeof process.versions.bun === "undefined") {
  test.describe("Receive — no session", () => {
    test("visiting /receive while signed out redirects to /login, not a crash", async ({ page }) => {
      const response = await page.goto("/receive");
      expect(response?.ok(), "/receive responds 2xx even signed out").toBeTruthy();
      await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    });
  });

  test.describe("Receive — New part [E2E-2]", () => {
    test.fixme("new part (with a custom field) saves, queues exactly one ESD label, and the print queue count increments", async () => {});
    test.fixme(
      "duplicate guard: saving a value+package match to an existing part shows 'Top up instead?' and switches tabs on one tap",
      async () => {},
    );
    test.fixme("'Create anyway' on the duplicate warning saves a second part flagged needs_review", async () => {});
  });

  test.describe("Receive — Top up existing [E2E-2]", () => {
    test.fixme(
      "scanning/typing an existing PID shows its identity + current qty, and Add to stock increases qty with NO new label",
      async () => {},
    );
    test.fixme("an unknown PID shows a clear 'not found' message", async () => {});
  });

  test.describe("Receive — Put away arrivals [E2E-3/E2E-4]", () => {
    test.fixme("empty state points at On-order's 'Mark arrived' when nothing is queued", async () => {});
    test.fixme("arrived lines group by PO; confirming an EXISTING-part line tops up with no reprint", async () => {});
    test.fixme(
      "confirming a NEW-part line creates the part, queues one label, and stamps last_unit_price from the order line",
      async () => {},
    );
  });

  test.describe("Receive — Print queue [R2-35]", () => {
    test.fixme("'Print sheet' renders a downloadable PDF and the queue count drops to 0", async () => {});
  });

  test.describe("Receive — Onboarding queue [FEATURES §14]", () => {
    test.fixme("a no-location imported part can be assigned to an existing box, clearing it from the queue", async () => {});
    test.fixme("assigning to a brand-new box name + shelf creates both and queues a big-box label", async () => {});
  });

  test.describe("Receive — 360px mobile", () => {
    test.fixme(
      "all three action cards, the print queue strip, and the onboarding queue render with no horizontal scroll at 360px",
      async () => {},
    );
  });
}
