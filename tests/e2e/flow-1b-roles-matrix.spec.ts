import { expect, test, type Page } from "@playwright/test";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { TABLES } from "@/types/db";

/**
 * E2E FLOW-1b — roles matrix, deepened (plan/TESTING.md §3.1). Extends
 * tests/e2e/flow-1-auth-roles.spec.ts rather than duplicating it:
 * flow-1-auth-roles.spec.ts spot-checks the login form + owner-full/employee-
 * hidden-Settings-and-AI-Memory cases. This file adds what that one doesn't
 * cover:
 *   1. The EXACT nav surface per role (every item, not a spot-check) across
 *      BOTH breakpoints — desktop rail groups (Overview/Operate/Projects/
 *      Team + footer) and mobile bottom-bar + "More" sheet contents — for
 *      all THREE roles (owner/employee/accountant; flow-1-auth-roles.spec.ts
 *      never exercises accountant at all).
 *   2. "Employee cannot approve AI-memory rules" the FULL way FEATURES.md §2
 *      demands: "enforced twice" — UI hidden (nav absent + route 404s, a
 *      deeper check than flow-1's) AND the underlying RLS policy on
 *      `smark_learned_rules` denies the write even when attempted directly
 *      against the database as the employee (migration 0004: owner-only
 *      SELECT/INSERT/UPDATE/DELETE). A Server Action can't be invoked
 *      directly from a Bun/Playwright process (lib/supabase/server.ts's
 *      `createClient()` needs `next/headers`' request-scoped `cookies()`,
 *      which only exists inside a real Next.js request) — RLS is the actual,
 *      final backstop the Server Action's own `canApproveRules` check sits in
 *      front of, so exercising RLS directly is the most faithful way to
 *      prove "attempted via the app and denied" from outside the framework.
 *
 * Same bun-exclusion guard + login-helper convention as every other spec in
 * this directory (see tests/e2e/dashboard-smoke.spec.ts's header).
 */
if (typeof process.versions.bun === "undefined") {
  /**
   * Anon + role-scoped clients, INLINED rather than imported from
   * `tests/helpers/supabase.ts`: that module unconditionally imports
   * `describe` from `bun:test` at the top level (for its `describeWithDb`
   * helper), which crashes module resolution entirely under
   * `bunx playwright test` (Playwright's own spec loader, not `bun test` —
   * `bun:test` is only resolvable under Bun's own test runner). Same
   * anon-client + `signInWithPassword` logic as that module's
   * `createRoleClient`, just without the poisoned import.
   */
  function createAnonClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
    return createSupabaseClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async function createRoleClient(username: string, password: string) {
    const client = createAnonClient();
    const { error } = await client.auth.signInWithPassword({
      email: `${username}@smark.internal`,
      password,
    });
    if (error) throw new Error(`test sign-in failed for "${username}": ${error.message}`);
    return client;
  }

  async function loginAs(page: Page, username: string, password: string): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  const CREDS = {
    owner: { username: "owner", password: "Owner@12345" },
    employee: { username: "employee", password: "Employee@12345" },
    accountant: { username: "accountant", password: "Accountant@12345" },
  } as const;

  /** Exact rail-order label list per role — FEATURES.md §2 matrix, `hidden` dropped. */
  const EXPECTED_VISIBLE = {
    owner: [
      "Dashboard",
      "Inventory",
      "Shelves",
      "Scan",
      "Bulk takeout",
      "Receive",
      "Projects",
      "Cart",
      "Daily Reports",
      "Expenses",
      "AI Memory",
      "Settings",
    ],
    employee: ["Dashboard", "Inventory", "Shelves", "Scan", "Bulk takeout", "Receive", "Projects", "Cart", "Daily Reports"],
    accountant: [
      "Dashboard",
      "Inventory",
      "Shelves",
      "Scan",
      "Bulk takeout",
      "Receive",
      "Projects",
      "Cart",
      "Daily Reports",
      "Expenses",
    ],
  } as const;

  const EXPECTED_HIDDEN = {
    owner: [] as string[],
    employee: ["Expenses", "AI Memory", "Settings"],
    accountant: ["AI Memory", "Settings"],
  } as const;

  const MOBILE_PRIMARY = ["Dashboard", "Inventory", "Scan", "Projects"];
  const RAIL_GROUP_LABELS = ["Overview", "Operate", "Projects", "Team"];

  test.describe("flow-1b: roles matrix (deepened nav surface)", () => {
    for (const role of ["owner", "employee", "accountant"] as const) {
      test(`${role}: exact nav surface matches FEATURES.md §2 — every visible item present, every hidden item absent`, async (
        { page },
        testInfo,
      ) => {
        const creds = CREDS[role];
        await loginAs(page, creds.username, creds.password);

        if (testInfo.project.name === "desktop-1280") {
          await test.step("desktop rail: every group header renders, every expected item is a visible link, every hidden item is absent", async () => {
            for (const groupLabel of RAIL_GROUP_LABELS) {
              // `.first()` — components/shell/app-shell.tsx renders BOTH the
              // desktop Rail (`hidden md:flex`) and the mobile BottomBar
              // (`md:hidden`) unconditionally in the DOM at every viewport,
              // toggling only via CSS media queries. "Projects" is both a
              // rail GROUP label (lib/nav.ts NAV_GROUP_LABELS) and a nav ITEM
              // label rendered by both Rail and BottomBar, so an unscoped
              // exact-text match resolves to 3 elements. Rail renders before
              // BottomBar in app-shell.tsx's JSX and the group-header <div>
              // renders before its items' <RailLink>s, so `.first()`
              // deterministically lands on the intended group-header div.
              await expect(page.getByText(groupLabel, { exact: true }).first()).toBeVisible();
            }
            for (const label of EXPECTED_VISIBLE[role]) {
              await expect(page.getByRole("link", { name: label, exact: true }).first()).toBeVisible();
            }
            for (const label of EXPECTED_HIDDEN[role]) {
              await expect(page.getByRole("link", { name: label, exact: true })).toHaveCount(0);
            }
          });
        } else {
          await test.step("mobile: bottom bar has the 4 fixed primary items; More sheet lists exactly the rest; hidden items never appear anywhere", async () => {
            for (const label of MOBILE_PRIMARY) {
              await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
            }
            // Hidden items must be absent even before opening More (nothing leaks onto the bottom bar).
            for (const label of EXPECTED_HIDDEN[role]) {
              await expect(page.getByRole("link", { name: label, exact: true })).toHaveCount(0);
            }

            await page.getByRole("button", { name: /^more$/i }).click();

            const moreExpected = EXPECTED_VISIBLE[role].filter((label) => !MOBILE_PRIMARY.includes(label));
            for (const label of moreExpected) {
              await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
            }
            for (const label of EXPECTED_HIDDEN[role]) {
              await expect(page.getByRole("link", { name: label, exact: true })).toHaveCount(0);
            }
          });
        }
      });
    }

    test("employee cannot approve AI-memory rules: nav absent, /ai-memory 404s, and the underlying RLS write is denied even attempted directly", async ({
      page,
    }) => {
      await loginAs(page, "employee", "Employee@12345");

      await test.step("UI: no AI Memory link anywhere, direct route 404s", async () => {
        await expect(page.getByRole("link", { name: "AI Memory", exact: true })).toHaveCount(0);
        const response = await page.goto("/ai-memory");
        expect(response?.status()).toBe(404);
      });

      await test.step("RLS: an employee-scoped client cannot flip a suggested rule to active", async () => {
        const service = createServiceClient();
        const { data: inserted, error: insertErr } = await service
          .from(TABLES.learned_rules)
          .insert({
            scope: "global",
            rule_type: "price_source_note",
            value: { text: "E2E flow-1b: employee-approval RLS probe" },
            status: "suggested",
          })
          .select("id")
          .single();
        expect(insertErr).toBeNull();
        const ruleId = (inserted as { id: string } | null)?.id;
        expect(ruleId).toBeTruthy();
        if (!ruleId) return;

        try {
          const employeeClient = await createRoleClient("employee", "Employee@12345");
          // No assertion on the call's own return value: RLS silently
          // excludes rows the policy denies (no error, zero rows affected) —
          // the DB state check below is the real proof the write had no effect.
          await employeeClient.from(TABLES.learned_rules).update({ status: "active" }).eq("id", ruleId).eq("status", "suggested");

          const { data: after, error: readErr } = await service
            .from(TABLES.learned_rules)
            .select("status")
            .eq("id", ruleId)
            .single();
          expect(readErr).toBeNull();
          expect((after as { status: string } | null)?.status).toBe("suggested");
        } finally {
          await service.from(TABLES.learned_rules).delete().eq("id", ruleId);
        }
      });
    });
  });
}
