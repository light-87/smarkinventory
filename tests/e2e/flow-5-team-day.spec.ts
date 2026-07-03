import { expect, test, type Page } from "@playwright/test";
import { createServiceClient } from "@/lib/supabase/server";
import { todayDateOnly } from "@/lib/daily/compute";
import { TABLES } from "@/types/db";

/**
 * E2E FLOW-5 — team day (plan/TESTING.md §3.5): "employee check-in → switch
 * project → check-out → Daily Report shows attendance + the movement they
 * made; owner sees team + expenses section; employee does NOT see expenses."
 *
 * This is the CHAINED, cross-surface version of the flow — it deliberately
 * goes further than the single-surface specs that already exist (tests/e2e/
 * daily-basic.spec.ts owns the isolated Daily Reports checks; tests/e2e/
 * scan-basic.spec.ts owns the isolated Scan checks): clock in → pick a
 * project → record a REAL stock movement via Scan take-out → clock out →
 * log manual hours → confirm all three (attendance + hours + the movement)
 * land together on the SAME Daily Report, then confirm the owner's view of
 * that same day reflects it while the employee's own view never grows an
 * Expenses section. One test, `test.step`-chunked, so a failure anywhere in
 * the chain still reports which leg broke.
 *
 * Dedicated per-viewport employee identity (NOT the shared seeded
 * "employee" user): playwright.config.ts runs desktop-1280 and mobile-360
 * TRULY in parallel (`fullyParallel: true`, `workers: 2`), and this flow
 * clocks in/out + logs hours — both keyed by `(user_id, work_date)`. Two
 * concurrent runs sharing ONE employee identity fight over the exact same
 * attendance/time-entry rows (observed while writing this: a "Clock in"
 * button stuck disabled, a dropped hours submission, doubled movement
 * lines). A throwaway employee-role user scoped to THIS viewport project
 * (same create-or-reuse admin-API shape as scripts/seed-dev-users.ts) gives
 * each project its own isolated state instead — the owner's cross-view login
 * stays the shared seeded "owner" (safe: it only READS today's team roster
 * here, never writes).
 *
 * Same bun-exclusion guard as every other spec here (see
 * tests/e2e/dashboard-smoke.spec.ts's header) — only runs under
 * `bunx playwright test`.
 */
if (typeof process.versions.bun === "undefined") {
  const SEEDED_PID = "SMK-000101"; // canonical fixture, ~2900 units across 2 locations (tests/fixtures/canonical-seed-data.ts) — safe to take 1 out.

  async function loginAs(page: Page, username: string, password: string): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  async function closeAnyOpenDialog(page: Page): Promise<void> {
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByRole("button", { name: "Close" }).first().click();
    }
  }

  test.describe("flow-5: team day", () => {
    test("employee clocks in on a project, makes a scan take-out movement, clocks out and logs hours — the Daily Report reflects all three, and the owner sees the team+expenses view the employee never does", async (
      { page, browser },
      testInfo,
    ) => {
      // Generous — this is a long chained flow across 2 logins/contexts and
      // several route compiles (/daily, /scan), same allowance as sibling
      // heavy specs. This number has already been raised once before (60_000
      // -> 120_000, see git history) for exactly this reason and STILL blew
      // through under a later full-suite verify run — the failure mode is
      // identical each time: `locator.click` sits waiting on the Scan
      // "Take out" button (no `actionTimeout` is configured in
      // playwright.config.ts, so a click's actionability wait is bounded
      // only by this per-test timeout, not a smaller one of its own), and
      // /daily + /scan's first compile plus two logins under this suite's
      // documented cold-Turbopack-compile contention (playwright.config.ts's
      // own header — workers are pinned at 2 specifically because of it, so
      // raising concurrency isn't the fix) can eat the whole budget before
      // that click ever gets its turn. Matching
      // tests/e2e/flow-3-ordering-pipeline.spec.ts's 240_000 instead of
      // tests/e2e/ordering-run-review.spec.ts's 120_000 this time — flow-3's
      // chain is if anything heavier (more steps, more route compiles) and
      // 240_000 has held for it.
      test.setTimeout(240_000);
      const service = createServiceClient();

      // ── dedicated employee identity for THIS viewport project — see file
      // header. Same create-or-reuse shape as scripts/seed-dev-users.ts:
      // try create, and on failure (already exists from a previous run)
      // look it up and reset its password so login always succeeds.
      const employeeUsername = `e2e-employee-${testInfo.project.name}`;
      const employeePassword = "Employee@12345";
      const employeeDisplayName = `Priya E2E (${testInfo.project.name})`;
      const employeeEmail = `${employeeUsername}@smark.internal`;

      const createdUser = await service.auth.admin.createUser({
        email: employeeEmail,
        password: employeePassword,
        email_confirm: true,
      });
      let employeeId = createdUser.data?.user?.id;
      if (createdUser.error || !employeeId) {
        const list = await service.auth.admin.listUsers();
        const existing = list.data?.users.find((u) => u.email === employeeEmail);
        employeeId = existing?.id;
        if (employeeId) {
          await service.auth.admin.updateUserById(employeeId, { password: employeePassword, email_confirm: true });
        }
      }
      expect(employeeId, `could not create or find the dedicated e2e employee user "${employeeUsername}"`).toBeTruthy();

      const profileUpsert = await service.from(TABLES.app_users).upsert(
        { id: employeeId!, username: employeeUsername, display_name: employeeDisplayName, role: "employee", active: true },
        { onConflict: "id" },
      );
      expect(profileUpsert.error, profileUpsert.error?.message).toBeNull();

      // ── clean slate for today's row — same convention as
      // tests/e2e/daily-basic.spec.ts (a stale "day complete" row from an
      // earlier run renders neither Clock in nor Clock out button). Idempotent
      // re-runs of this same spec/project only now — the dedicated identity
      // above already rules out the sibling viewport project as a cause.
      const workDate = todayDateOnly();
      await service.from(TABLES.attendance).delete().eq("user_id", employeeId!).eq("work_date", workDate);
      await service.from(TABLES.time_entries).delete().eq("user_id", employeeId!).eq("work_date", workDate);

      await loginAs(page, employeeUsername, employeePassword);

      let workingOnProject = "";

      await test.step("clock in and select a working-on project", async () => {
        await page.goto("/daily");
        const workingOnSelect = page.getByLabel("Working on");
        await expect(workingOnSelect).toBeVisible({ timeout: 10_000 });

        const optionLabels = await workingOnSelect.locator("option").allTextContents();
        // index 0 is the "No project" placeholder (attendance-section.tsx) — the first REAL project follows it.
        const firstProject = optionLabels[1];
        test.skip(!firstProject, "no active project available to select as 'working on' — needs at least one non-archived project");
        workingOnProject = firstProject ?? "";
        await workingOnSelect.selectOption({ label: workingOnProject });

        await page.getByRole("button", { name: "Clock in" }).click();
        await expect(page.getByText("Present").first()).toBeVisible({ timeout: 10_000 });
      });

      await test.step("make a movement: Scan take-out on a seeded part", async () => {
        await page.goto("/scan");
        const scanInput = page.getByRole("textbox", { name: "Scan or type a code", exact: true });
        await scanInput.fill(SEEDED_PID);
        await scanInput.press("Enter");

        // Scoped to `<main>` (components/shell/app-shell.tsx mounts
        // `<ToastViewport>` as a SIBLING of `<main>`, not inside it) —
        // `resolveScanCode`'s own "no match" toast text is `No match for
        // "${code}"`, which also contains SEEDED_PID, so an unscoped
        // `page.getByText(SEEDED_PID)` is satisfied by that toast just as
        // easily as by the real part card, masking a genuine "part not
        // found" as a false-positive pass right before the next line hangs
        // for the rest of the test's budget waiting on a "Take out" button
        // that will never exist. Root cause of that "not found" (bug
        // regression, not this assertion): the canonical demo dataset wasn't
        // guaranteed seeded before this spec ran — see
        // tests/e2e/global-setup.ts.
        await expect(page.locator("main").getByText(SEEDED_PID).first()).toBeVisible({ timeout: 10_000 });
        await page.getByRole("button", { name: "Take out" }).click();
        await expect(page.getByText(new RegExp(`Took out 1 × ${SEEDED_PID}`))).toBeVisible({ timeout: 10_000 });
      });

      await test.step("clock out — the hours prompt appears — log manual hours", async () => {
        await page.goto("/daily");
        await page.getByRole("button", { name: "Clock out" }).click();

        const dialog = page.getByRole("dialog");
        // 20s (not this file's usual 10s): clockOutAction is a real DB round
        // trip (attendance update + hours-needed check) and this suite runs
        // against a single shared `next dev` process under real concurrent
        // load from the rest of the E2E matrix — observed slower than the
        // usual allowance under that contention.
        await expect(dialog).toBeVisible({ timeout: 20_000 });

        await dialog.getByPlaceholder("e.g. 6.5").fill("3.5");
        await dialog.getByRole("button", { name: "Add hours" }).click();
        await expect(page.getByText(/^Logged 3\.5h for /)).toBeVisible({ timeout: 10_000 });

        await closeAnyOpenDialog(page);
      });

      await test.step("Daily Report (self) shows the attendance, the hours, and the movement — but no Team table or Expenses section", async () => {
        await page.goto("/daily");

        await expect(page.getByText("Day complete")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("3.5h logged")).toBeVisible();
        if (workingOnProject) {
          await expect(page.getByText(new RegExp(`working on ${workingOnProject}`))).toBeVisible();
        }
        // The movement — verb wording aside, this is the exact qty × PID
        // pairing the take-out just wrote (lib/daily/compute.ts
        // formatMovementLine). The employee's OWN Daily Report is
        // actor-scoped (lib/daily/queries.ts getMovementsForRange takes an
        // `actorId` filter; FEATURES §2 "Daily Reports: employee self only"),
        // so this dedicated user's page never shows the SIBLING viewport
        // project's movement. `.first()` guards a different, harmless case:
        // this file doesn't undo its own take-out, so a same-day RE-RUN of
        // this exact spec/project adds another identical line for this same
        // dedicated user — either match proves today's take-out landed.
        await expect(page.getByText(new RegExp(`1 × ${SEEDED_PID}`)).first()).toBeVisible({ timeout: 10_000 });

        await expect(page.getByText(/^Team —/)).toHaveCount(0);
        await expect(page.getByText("Expenses today")).toHaveCount(0);
      });

      await test.step("owner's Daily Report for the same day shows the team table (with this employee's row) and the Expenses section", async () => {
        const ownerContext = await browser.newContext();
        try {
          const ownerPage = await ownerContext.newPage();
          await loginAs(ownerPage, "owner", "Owner@12345");
          await ownerPage.goto("/daily");

          await expect(ownerPage.getByText(/^Team —/)).toBeVisible({ timeout: 10_000 });
          await expect(ownerPage.getByText("Expenses today")).toBeVisible();

          // Owner sees EVERYONE's row (not actor-scoped) — the per-project
          // display name picks out THIS run's dedicated user unambiguously
          // among the real seeded "employee" and the sibling project's own
          // dedicated user, all of whom may appear in today's roster.
          const employeeRowLocator = ownerPage.locator("tr", { hasText: employeeDisplayName });
          await expect(employeeRowLocator).toBeVisible({ timeout: 10_000 });
          await expect(employeeRowLocator).toContainText("Present");
          await expect(employeeRowLocator).toContainText("3.5");
        } finally {
          await ownerContext.close();
        }
      });
    });
  });
}
