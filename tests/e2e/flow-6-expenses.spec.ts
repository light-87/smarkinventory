import { expect, test, type Page } from "@playwright/test";
import { createServiceClient } from "@/lib/supabase/server";
import { TABLES, type ExpenseCategory } from "@/types/db";

/**
 * E2E FLOW-6 — expenses (plan/TESTING.md §3.6): "owner adds expense entries
 * across two accounts + an income with project link → charts totals match
 * the seeded sums (assert rendered numbers) → project hub payments strip
 * shows the income → accountant can add/edit entries → employee gets
 * redirected away from /expenses."
 *
 * This is the CHAINED, cross-surface version of the flow — the single-
 * surface specs already own their isolated concerns (tests/e2e/
 * expenses-entries.spec.ts: owner add-entry chrome; tests/e2e/
 * expenses-access.spec.ts: the full role matrix incl. the employee 404).
 * This file instead walks the whole client's-example arc end to end in one
 * test, test.step-chunked so a failure anywhere in the chain still reports
 * which leg broke — same shape as tests/e2e/flow-5-team-day.spec.ts.
 *
 * Chart-isolation strategy: playwright.config.ts runs BOTH viewport
 * "projects" for every spec, TRULY in parallel (`fullyParallel: true`,
 * `workers: 2`) against the SAME shared local Supabase instance — so an
 * aggregate assertion ("this category's total this month") needs categories
 * that never overlap between the desktop-1280 and mobile-360 runs, or the
 * two runs' entries sum together and neither run's expected total holds.
 * `CATEGORIES` below hands each project a disjoint pair from the "Materials"-
 * free remainder of the enum (Materials is used elsewhere — lib/orders/
 * checkout.ts's draft-expense category, tests/e2e/expenses-entries.spec.ts —
 * everything else is unused by any other spec, grepped). The income entry is
 * linked to a brand-new project created in this same test, so its
 * Payments-strip total is inherently uncontaminated regardless of category
 * choice (scoped by project_id, always a fresh row).
 *
 * Cleanup: every account/project/entry this spec creates is named with a
 * "FLOW6 " prefix, hard-deleted (service-role, local/test-only Supabase) at
 * the START of every run — makes the seeded totals reproducible across
 * repeats AND keeps this spec's own footprint from growing unboundedly on a
 * long-lived local stack (an earlier version of this file never cleaned up
 * accounts/projects, and the accumulation was observed to push /expenses'
 * join-heavy query past this suite's default 30s per-test budget after a
 * few dozen iterations). Same hygiene motivation as flow-5's
 * attendance/time-entry cleanup. `test.setTimeout` below is the same kind of
 * generous allowance flow-3/flow-4/flow-8/ordering-run-review already use
 * for their own multi-login, multi-route-compile chains.
 *
 * Same bun-exclusion guard + login-helper convention as every other spec
 * here (see tests/e2e/dashboard-smoke.spec.ts's header) — only runs under
 * `bunx playwright test`.
 */
if (typeof process.versions.bun === "undefined") {
  async function loginAs(page: Page, username: string, password: string): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  async function addExpenseAccount(page: Page, name: string): Promise<void> {
    await page.goto("/settings/expense-accounts");
    await page.getByRole("button", { name: "+ Add account" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Add" }).click();
    // `.first()` — toasts auto-dismiss after ~3.2s (components/ui/toast.tsx),
    // so a second "Account added" from the next call can still be on screen
    // when this one appears; both say the same thing, so any match proves it.
    await expect(page.getByText("Account added").first()).toBeVisible({ timeout: 10_000 });
  }

  /** Disjoint category triple per viewport project — see file header. */
  const CATEGORIES: Record<string, { expense1: ExpenseCategory; expense2: ExpenseCategory; accountant: ExpenseCategory }> = {
    "desktop-1280": { expense1: "Utilities", expense2: "Rent", accountant: "Salaries" },
    "mobile-360": { expense1: "Tools", expense2: "Other", accountant: "Client payment" },
  };

  test.describe("flow-6: expenses", () => {
    test(
      "owner seeds two accounts + a project-linked income; chart totals and the payments strip reflect them; accountant can add/edit; employee stays blocked",
      async ({ page, browser }, testInfo) => {
        test.setTimeout(90_000);
        const cats = CATEGORIES[testInfo.project.name] ?? CATEGORIES["desktop-1280"]!;

        // ── clean slate: hard-delete every row this spec has EVER created
        // (matched by the "FLOW6 " prefix), oldest-dependent-first, so a
        // repeat run of THIS spec against the same local stack never
        // double-counts AND never accumulates unboundedly (see file header).
        // Service-role only, local/test Supabase — never how the app itself
        // deletes an entry (it soft-deletes).
        const service = createServiceClient();
        await service.from(TABLES.expenses).delete().ilike("vendor", "FLOW6 %");
        await service.from(TABLES.expense_accounts).delete().ilike("name", "FLOW6 %");
        await service.from(TABLES.projects).delete().ilike("name", "FLOW6 %");

        const stamp = Date.now();
        const accountA = `FLOW6 Cash ${stamp}`;
        const accountB = `FLOW6 Bank ${stamp}`;
        const projectName = `FLOW6 Client Job ${stamp}`;
        const vendorA = `FLOW6 Vendor A ${stamp}`;
        const vendorB = `FLOW6 Vendor B ${stamp}`;
        const incomeNote = `FLOW6 Income ${stamp}`;

        await loginAs(page, "owner", "Owner@12345");

        await test.step("owner stands up two fresh expense accounts", async () => {
          await addExpenseAccount(page, accountA);
          await addExpenseAccount(page, accountB);
        });

        let projectId = "";
        await test.step("owner creates a fresh project to link the income to", async () => {
          await page.goto("/projects");
          await page.getByPlaceholder("Mainboard rev C").fill(projectName);
          await page.getByPlaceholder("Acme Robotics").fill("FLOW6 Client Co");
          await page.getByRole("button", { name: "Create" }).click();

          await page.waitForURL(/\/projects\/[0-9a-f-]+$/, { timeout: 15_000 });
          projectId = new URL(page.url()).pathname.split("/").pop()!;
          await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
        });

        await test.step(`owner adds an expense entry against account A (${cats.expense1}, ₹4,200)`, async () => {
          await page.goto("/expenses");
          await page.getByRole("button", { name: "+ Add entry" }).click();
          const dialog = page.getByRole("dialog", { name: "Add entry" });
          await dialog.getByPlaceholder("0.00").fill("4200");
          await dialog.getByRole("radio", { name: cats.expense1 }).click();
          await dialog.locator("#expense-account").selectOption({ label: accountA });
          await dialog.getByPlaceholder("Distributor or person").fill(vendorA);
          await dialog.getByRole("button", { name: "Save" }).click();
          await expect(page.getByText("Entry added").first()).toBeVisible({ timeout: 10_000 });
        });

        await test.step(`owner adds an expense entry against account B (${cats.expense2}, ₹6,800)`, async () => {
          await page.getByRole("button", { name: "+ Add entry" }).click();
          const dialog = page.getByRole("dialog", { name: "Add entry" });
          await dialog.getByPlaceholder("0.00").fill("6800");
          await dialog.getByRole("radio", { name: cats.expense2 }).click();
          await dialog.locator("#expense-account").selectOption({ label: accountB });
          await dialog.getByPlaceholder("Distributor or person").fill(vendorB);
          await dialog.getByRole("button", { name: "Save" }).click();
          await expect(page.getByText("Entry added").first()).toBeVisible({ timeout: 10_000 });
        });

        await test.step("owner adds an income entry linked to the new project (₹15,000)", async () => {
          await page.getByRole("button", { name: "+ Add entry" }).click();
          const dialog = page.getByRole("dialog", { name: "Add entry" });
          await dialog.getByRole("radio", { name: "Income" }).click();
          await dialog.getByPlaceholder("0.00").fill("15000");
          await dialog.getByRole("radio", { name: "Client payment" }).click();
          await dialog.locator("#expense-account").selectOption({ label: accountA });
          await dialog.locator("#expense-project").selectOption({ label: projectName });
          await dialog.getByPlaceholder("Distributor or person").fill(incomeNote);
          await dialog.getByRole("button", { name: "Save" }).click();
          await expect(page.getByText("Entry added").first()).toBeVisible({ timeout: 10_000 });
        });

        await test.step("the entries ledger shows all three, correctly attributed", async () => {
          await expect(page.getByText(vendorA)).toBeVisible({ timeout: 10_000 });
          await expect(page.getByText(vendorB)).toBeVisible();
          await expect(page.getByText(incomeNote)).toBeVisible();
        });

        await test.step("the 'By category' chart totals match exactly what was seeded", async () => {
          // Scoped to the chart's own Card — category names also appear in
          // the entry table's Category column and the category filter's
          // <option> list on this same page, so an unscoped getByText is a
          // strict-mode violation. CardHeader's title span ("By category") is
          // two ancestors above the Card div itself (span → CardHeader div →
          // Card div — see components/ui/card.tsx). Assert the amount WITHIN
          // the category's own <li> (not just "present somewhere in the
          // card") — two DIFFERENT categories can legitimately land on the
          // same ₹ figure (e.g. both this run's ₹4,200 line and the other
          // viewport project's own ₹4,200 line, running concurrently against
          // the same shared local Supabase — see file header), so the row
          // pairing is the only unambiguous proof.
          const byCategoryCard = page.getByText("By category", { exact: true }).locator("..").locator("..");
          await expect(byCategoryCard.locator("li", { hasText: cats.expense1 })).toContainText("₹4,200", {
            timeout: 10_000,
          });
          await expect(byCategoryCard.locator("li", { hasText: cats.expense2 })).toContainText("₹6,800");
        });

        await test.step("the project hub payments strip shows exactly the linked income", async () => {
          await page.goto(`/projects/${projectId}`);
          await expect(page.getByText("Payments received")).toBeVisible({ timeout: 10_000 });
          // `.first()` — with exactly one payment on this brand-new project,
          // the strip's own header TOTAL and the single row's amount are the
          // same figure (both computed independently from the one row), so
          // this legitimately matches twice; either match proves the number.
          await expect(page.getByText("₹15,000.00").first()).toBeVisible();
          await expect(page.getByText(incomeNote)).toBeVisible();
        });

        await test.step("accountant can add a new entry AND edit an entry the owner created", async () => {
          const accountantContext = await browser.newContext();
          try {
            const accountantPage = await accountantContext.newPage();
            await loginAs(accountantPage, "accountant", "Accountant@12345");

            const accountantVendor = `FLOW6 Accountant ${stamp}`;
            await accountantPage.goto("/expenses");
            await expect(accountantPage.getByRole("button", { name: "+ Add entry" })).toBeVisible({ timeout: 10_000 });

            await accountantPage.getByRole("button", { name: "+ Add entry" }).click();
            const addDialog = accountantPage.getByRole("dialog", { name: "Add entry" });
            await addDialog.getByPlaceholder("0.00").fill("999");
            await addDialog.getByRole("radio", { name: cats.accountant }).click();
            await addDialog.locator("#expense-account").selectOption({ label: accountA });
            await addDialog.getByPlaceholder("Distributor or person").fill(accountantVendor);
            await addDialog.getByRole("button", { name: "Save" }).click();
            await expect(accountantPage.getByText("Entry added").first()).toBeVisible({ timeout: 10_000 });
            await expect(accountantPage.getByText(accountantVendor)).toBeVisible({ timeout: 10_000 });

            // Edit an entry the OWNER created — proves accountant write access
            // spans every entry, not just their own (Q-01: expenses is the one
            // area where accountant === owner, "full").
            const editedVendorA = `${vendorA} (accountant-edited)`;
            const ownerRow = accountantPage.locator("tr", { hasText: vendorA });
            await ownerRow.getByRole("button", { name: "Edit" }).click();
            const editDialog = accountantPage.getByRole("dialog", { name: "Edit entry" });
            await editDialog.getByPlaceholder("Distributor or person").fill(editedVendorA);
            await editDialog.getByRole("button", { name: "Save" }).click();
            await expect(accountantPage.getByText("Entry updated").first()).toBeVisible({ timeout: 10_000 });
            await expect(accountantPage.getByText(editedVendorA)).toBeVisible({ timeout: 10_000 });
          } finally {
            await accountantContext.close();
          }
        });

        await test.step("employee stays blocked from Expenses: nav absent, direct route 404s", async () => {
          const employeeContext = await browser.newContext();
          try {
            const employeePage = await employeeContext.newPage();
            await loginAs(employeePage, "employee", "Employee@12345");

            await expect(employeePage.getByRole("link", { name: /expenses/i })).toHaveCount(0);
            const response = await employeePage.goto("/expenses");
            expect(response?.status()).toBe(404);
          } finally {
            await employeeContext.close();
          }
        });
      },
    );
  });
}
