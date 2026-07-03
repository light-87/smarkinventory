import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAnonClient, createRoleClient, createServiceClient, describeWithDb } from "../helpers/supabase";

/**
 * RLS matrix as executable spec — plan/TESTING.md §2 "DB / RLS" layer.
 * Canonical matrix: FEATURES.md §2 + plan/SCHEMA.md "RLS matrix — FINAL [Q-01]".
 *
 * Runs against the LOCAL Supabase stack (CI: supabase db reset; dev: bunx
 * supabase start). One client per role via tests/helpers/supabase.ts
 * `createRoleClient`, asserting allow AND deny per cell — UI hiding is never
 * the enforcement (FEATURES.md §2: "enforced twice").
 *
 * Fully converted to real, DB-backed tests. The client-portal block below
 * converted first and stays the template for client construction, seeding,
 * and assertion style: clients/fixtures are built inside `beforeAll`, never
 * at describe-body top level — Bun still executes a skipped describe's
 * callback body to collect its tests, so building them eagerly would throw
 * on a machine with no local stack even when `describeWithDb` resolves to
 * `describe.skip` (same pattern as tests/invariants/*.test.ts and
 * tests/integration/receive-core.test.ts).
 */

/** Looks up a seeded role user's smark_app_users.id by username (scripts/seed-dev-users.ts). */
async function fetchUserId(service: SupabaseClient, username: string): Promise<string> {
  const { data, error } = await service.from("smark_app_users").select("id").eq("username", username).single();
  if (error || !data) {
    throw new Error(
      `rls fixture: seeded user "${username}" not found — run \`bun run scripts/seed-dev-users.ts\` against the local stack first (${error?.message ?? "no row"}).`,
    );
  }
  return (data as { id: string }).id;
}

/** Any seeded distributor id (supabase/seed.sql always seeds the baseline five). */
async function fetchDistributorId(service: SupabaseClient): Promise<string> {
  const { data, error } = await service.from("smark_distributors").select("id").eq("name", "Digikey").single();
  if (error || !data) {
    throw new Error(`rls fixture: seeded distributor "Digikey" not found — check supabase/seed.sql (${error?.message ?? "no row"}).`);
  }
  return (data as { id: string }).id;
}

interface EphemeralUser {
  id: string;
  username: string;
  password: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a throwaway auth user + smark_app_users profile for tests that need
 * a SECOND distinct actor of a given role beyond the three fixed seeded
 * logins (owner/employee/accountant) — e.g. "others'" attendance rows, the
 * deactivated-user cell. Mirrors scripts/seed-dev-users.ts's create shape and
 * tests/invariants/fixtures.ts's createTestActor, but additionally returns
 * username/password so the caller can sign in as this user via
 * createRoleClient (createTestActor exposes neither).
 */
async function createEphemeralUser(
  service: SupabaseClient,
  role: "owner" | "employee" | "accountant",
): Promise<EphemeralUser> {
  const username = `rlstest-${role}-${randomUUID().slice(0, 8)}`;
  const password = "RlsTest-Pass-1!";
  const { data, error } = await service.auth.admin.createUser({
    email: `${username}@smark.internal`,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`rls fixture: createEphemeralUser auth create failed: ${error?.message}`);
  const id = data.user.id;

  const { error: profileError } = await service
    .from("smark_app_users")
    .insert({ id, username, display_name: `RLS test ${role}`, role, active: true });
  if (profileError) {
    await service.auth.admin.deleteUser(id);
    throw new Error(`rls fixture: createEphemeralUser profile insert failed: ${profileError.message}`);
  }

  return {
    id,
    username,
    password,
    cleanup: async () => {
      await service.from("smark_app_users").delete().eq("id", id);
      await service.auth.admin.deleteUser(id);
    },
  };
}

/** Asserts a write was rejected by an RLS policy specifically (SQLSTATE 42501), not some other failure. */
function expectRlsDenied(error: { message?: string; code?: string } | null): void {
  expect(error).not.toBeNull();
  expect(error?.code ?? "").toBe("42501");
}

describe("RLS matrix [R2-01 · Q-01 FINAL]", () => {
  describeWithDb("owner", () => {
    let service: SupabaseClient;
    let owner: SupabaseClient;

    beforeAll(async () => {
      service = createServiceClient();
      owner = await createRoleClient("owner", "Owner@12345");
    });

    test("owner: full read+write on every smark_ table", async () => {
      // Representative sample across the operational bucket (FEATURES.md §2
      // row 1) — full CRUD, not literally all ~33 tables (same sampling
      // style already used by tests/invariants/*.test.ts). smark_app_users,
      // smark_learned_rules, and the Settings tables get their own dedicated
      // cells below.
      const suffix = randomUUID().slice(0, 8);
      const { data: shelf, error: shelfInsertErr } = await owner
        .from("smark_shelves")
        .insert({ code: `OWN-${suffix}` })
        .select("id")
        .single();
      expect(shelfInsertErr).toBeNull();
      const shelfId = (shelf as { id: string }).id;

      const { error: shelfUpdateErr } = await owner
        .from("smark_shelves")
        .update({ name: "updated by owner" })
        .eq("id", shelfId);
      expect(shelfUpdateErr).toBeNull();

      const { data: reread, error: selectErr } = await owner
        .from("smark_shelves")
        .select("name")
        .eq("id", shelfId)
        .single();
      expect(selectErr).toBeNull();
      expect((reread as { name: string }).name).toBe("updated by owner");

      const { error: shelfDeleteErr } = await owner.from("smark_shelves").delete().eq("id", shelfId);
      expect(shelfDeleteErr).toBeNull();

      const { data: gone } = await owner.from("smark_shelves").select("id").eq("id", shelfId);
      expect(gone).toEqual([]);
    });

    test("owner: can INSERT/UPDATE smark_app_users (create, deactivate)", async () => {
      const { data: authUser, error: createErr } = await service.auth.admin.createUser({
        email: `rls-owner-creates-${randomUUID().slice(0, 8)}@smark.internal`,
        password: "Whatever-Pass-1!",
        email_confirm: true,
      });
      expect(createErr).toBeNull();
      const newUserId = (authUser as { user: { id: string } }).user.id;

      const { error: insertErr } = await owner.from("smark_app_users").insert({
        id: newUserId,
        username: `rls-owner-creates-${newUserId.slice(0, 8)}`,
        display_name: "Owner-created user",
        role: "employee",
        active: true,
      });
      expect(insertErr).toBeNull();

      const { error: deactivateErr } = await owner
        .from("smark_app_users")
        .update({ active: false })
        .eq("id", newUserId);
      expect(deactivateErr).toBeNull();

      const { data: reread } = await service.from("smark_app_users").select("active").eq("id", newUserId).single();
      expect((reread as { active: boolean }).active).toBe(false);

      await service.from("smark_app_users").delete().eq("id", newUserId);
      await service.auth.admin.deleteUser(newUserId);
    });

    test("owner: can approve/retire smark_learned_rules and bump smark_learned_rules_doc", async () => {
      const { data: rule, error: insertErr } = await owner
        .from("smark_learned_rules")
        .insert({ scope: "global", rule_type: "prefer_distributor", value: { note: "rls owner test" }, status: "suggested" })
        .select("id")
        .single();
      expect(insertErr).toBeNull();
      const ruleId = (rule as { id: string }).id;

      const { error: approveErr } = await owner.from("smark_learned_rules").update({ status: "active" }).eq("id", ruleId);
      expect(approveErr).toBeNull();

      const { error: retireErr } = await owner.from("smark_learned_rules").update({ status: "retired" }).eq("id", ruleId);
      expect(retireErr).toBeNull();

      const { data: reread } = await owner.from("smark_learned_rules").select("status").eq("id", ruleId).single();
      expect((reread as { status: string }).status).toBe("retired");

      const version = 100_000 + Math.floor(Math.random() * 900_000);
      const { error: docErr } = await owner
        .from("smark_learned_rules_doc")
        .insert({ version, content: "rls owner test digest", change_summary: "rls test" });
      expect(docErr).toBeNull();

      await owner.from("smark_learned_rules_doc").delete().eq("version", version);
      await owner.from("smark_learned_rules").delete().eq("id", ruleId);
    });

    test("owner: can write Settings tables (ordering_rules, distributors, expense_accounts)", async () => {
      const suffix = randomUUID().slice(0, 8);

      const { data: rule, error: ruleErr } = await owner
        .from("smark_ordering_rules")
        .insert({ key: "custom", enabled: true, mandatory: false, rank: 999, params: { text: "rls owner rule" } })
        .select("id")
        .single();
      expect(ruleErr).toBeNull();
      const ruleId = (rule as { id: string }).id;
      const { error: ruleUpdateErr } = await owner.from("smark_ordering_rules").update({ enabled: false }).eq("id", ruleId);
      expect(ruleUpdateErr).toBeNull();
      const { error: ruleDeleteErr } = await owner.from("smark_ordering_rules").delete().eq("id", ruleId);
      expect(ruleDeleteErr).toBeNull();

      const { data: dist, error: distErr } = await owner
        .from("smark_distributors")
        .insert({ name: `RLS Dist ${suffix}`, api_type: "none" })
        .select("id")
        .single();
      expect(distErr).toBeNull();
      const distId = (dist as { id: string }).id;
      const { error: distUpdateErr } = await owner.from("smark_distributors").update({ active: false }).eq("id", distId);
      expect(distUpdateErr).toBeNull();
      const { error: distDeleteErr } = await owner.from("smark_distributors").delete().eq("id", distId);
      expect(distDeleteErr).toBeNull();

      const { data: acct, error: acctErr } = await owner
        .from("smark_expense_accounts")
        .insert({ name: `RLS Acct ${suffix}`, account_type: "cash" })
        .select("id")
        .single();
      expect(acctErr).toBeNull();
      const acctId = (acct as { id: string }).id;
      const { error: acctUpdateErr } = await owner.from("smark_expense_accounts").update({ active: false }).eq("id", acctId);
      expect(acctUpdateErr).toBeNull();
      const { error: acctDeleteErr } = await owner.from("smark_expense_accounts").delete().eq("id", acctId);
      expect(acctDeleteErr).toBeNull();
    });
  });

  describeWithDb("employee", () => {
    let service: SupabaseClient;
    let employee: SupabaseClient;
    let employeeId: string;

    beforeAll(async () => {
      service = createServiceClient();
      employee = await createRoleClient("employee", "Employee@12345");
      employeeId = await fetchUserId(service, "employee");
    });

    test(
      "employee: read+write operational tables (parts, stock_locations, movements, boms, runs, cart, feedback, activities)",
      async () => {
        const suffix = randomUUID().slice(0, 8);
        const ids: Record<string, string> = {};

        const { data: shelf, error: shelfErr } = await employee
          .from("smark_shelves")
          .insert({ code: `EMP-${suffix}` })
          .select("id")
          .single();
        expect(shelfErr).toBeNull();
        ids.shelf = (shelf as { id: string }).id;

        const { data: box, error: boxErr } = await employee
          .from("smark_big_boxes")
          .insert({ shelf_id: ids.shelf, name: `EMP-BOX-${suffix}` })
          .select("id")
          .single();
        expect(boxErr).toBeNull();
        ids.box = (box as { id: string }).id;

        const { data: part, error: partErr } = await employee
          .from("smark_parts")
          .insert({ internal_pid: `EMP-PID-${suffix}` })
          .select("id")
          .single();
        expect(partErr).toBeNull();
        ids.part = (part as { id: string }).id;

        const { data: loc, error: locErr } = await employee
          .from("smark_stock_locations")
          .insert({ part_id: ids.part, big_box_id: ids.box, qty: 10 })
          .select("id")
          .single();
        expect(locErr).toBeNull();
        ids.loc = (loc as { id: string }).id;

        const { data: movement, error: moveErr } = await employee
          .from("smark_movements")
          .insert({ part_id: ids.part, big_box_id: ids.box, delta_qty: 10, reason: "receive", actor: employeeId })
          .select("id")
          .single();
        expect(moveErr).toBeNull();
        ids.movement = (movement as { id: string }).id;

        const { data: project, error: projErr } = await employee
          .from("smark_projects")
          .insert({ name: `EMP Project ${suffix}` })
          .select("id")
          .single();
        expect(projErr).toBeNull();
        ids.project = (project as { id: string }).id;

        const { data: bom, error: bomErr } = await employee
          .from("smark_boms")
          .insert({ project_id: ids.project, name: `EMP BOM ${suffix}` })
          .select("id")
          .single();
        expect(bomErr).toBeNull();
        ids.bom = (bom as { id: string }).id;

        const { data: run, error: runErr } = await employee
          .from("smark_agent_runs")
          .insert({ bom_id: ids.bom, fanout_width: 1, depth_per_item: 1, per_site_cap: 1 })
          .select("id")
          .single();
        expect(runErr).toBeNull();
        ids.run = (run as { id: string }).id;

        const { data: cartItem, error: cartErr } = await employee
          .from("smark_cart_items")
          .insert({ part_id: ids.part, source: "manual", qty_to_order: 5 })
          .select("id")
          .single();
        expect(cartErr).toBeNull();
        ids.cart = (cartItem as { id: string }).id;

        const { data: feedback, error: feedbackErr } = await employee
          .from("smark_agent_feedback")
          .insert({ run_id: ids.run, comment: "employee feedback" })
          .select("id")
          .single();
        expect(feedbackErr).toBeNull();
        ids.feedback = (feedback as { id: string }).id;

        const { data: activity, error: activityErr } = await employee
          .from("smark_project_activities")
          .insert({ project_id: ids.project, type: "note", title: "employee note" })
          .select("id")
          .single();
        expect(activityErr).toBeNull();
        ids.activity = (activity as { id: string }).id;

        // Read-back proves SELECT, not just INSERT.
        const { data: reread, error: rereadErr } = await employee.from("smark_parts").select("id").eq("id", ids.part).single();
        expect(rereadErr).toBeNull();
        expect((reread as { id: string }).id).toBe(ids.part);

        // FK-safe teardown order (service role bypasses RLS).
        await service.from("smark_agent_feedback").delete().eq("id", ids.feedback);
        await service.from("smark_agent_runs").delete().eq("id", ids.run);
        await service.from("smark_cart_items").delete().eq("id", ids.cart);
        await service.from("smark_movements").delete().eq("id", ids.movement);
        await service.from("smark_stock_locations").delete().eq("id", ids.loc);
        await service.from("smark_project_activities").delete().eq("id", ids.activity);
        await service.from("smark_boms").delete().eq("id", ids.bom);
        await service.from("smark_projects").delete().eq("id", ids.project);
        await service.from("smark_parts").delete().eq("id", ids.part);
        await service.from("smark_big_boxes").delete().eq("id", ids.box);
        await service.from("smark_shelves").delete().eq("id", ids.shelf);
      },
    );

    test("employee: can write OWN attendance + time entries only (auth.uid() = user_id)", async () => {
      const { data: project } = await service
        .from("smark_projects")
        .insert({ name: `EMP Time Project ${randomUUID().slice(0, 8)}` })
        .select("id")
        .single();
      const projectId = (project as { id: string }).id;
      const workDate = "2031-04-01";

      const { error: attendanceErr } = await employee
        .from("smark_attendance")
        .insert({ user_id: employeeId, work_date: workDate, check_in: new Date().toISOString() });
      expect(attendanceErr).toBeNull();

      const { error: timeErr } = await employee
        .from("smark_time_entries")
        .insert({ project_id: projectId, user_id: employeeId, work_date: workDate, hours: 3, entered_by: employeeId });
      expect(timeErr).toBeNull();

      await service.from("smark_attendance").delete().eq("user_id", employeeId).eq("work_date", workDate);
      await service.from("smark_time_entries").delete().eq("user_id", employeeId).eq("work_date", workDate);
      await service.from("smark_projects").delete().eq("id", projectId);
    });

    test("employee: DENIED read of others' attendance/time entries (Daily Reports self-only)", async () => {
      const other = await createEphemeralUser(service, "employee");
      const { data: project } = await service
        .from("smark_projects")
        .insert({ name: `EMP Others Project ${randomUUID().slice(0, 8)}` })
        .select("id")
        .single();
      const projectId = (project as { id: string }).id;
      const workDate = "2031-04-02";

      await service
        .from("smark_attendance")
        .insert({ user_id: other.id, work_date: workDate, check_in: new Date().toISOString() });
      await service
        .from("smark_time_entries")
        .insert({ project_id: projectId, user_id: other.id, work_date: workDate, hours: 4, entered_by: other.id });

      const { data: attendanceRows, error: attendanceErr } = await employee
        .from("smark_attendance")
        .select("id")
        .eq("user_id", other.id);
      expect(attendanceErr).toBeNull();
      expect(attendanceRows).toEqual([]);

      const { data: timeRows, error: timeErr } = await employee
        .from("smark_time_entries")
        .select("id")
        .eq("user_id", other.id);
      expect(timeErr).toBeNull();
      expect(timeRows).toEqual([]);

      await service.from("smark_attendance").delete().eq("user_id", other.id).eq("work_date", workDate);
      await service.from("smark_time_entries").delete().eq("user_id", other.id).eq("work_date", workDate);
      await service.from("smark_projects").delete().eq("id", projectId);
      await other.cleanup();
    });

    test("employee: DENIED SELECT on smark_expenses and v_expense_rollups (hidden, not read-only)", async () => {
      const { data: expense } = await service
        .from("smark_expenses")
        .insert({ entry_type: "expense", amount: 111, entry_date: "2026-01-05", category: "Other", is_draft: true })
        .select("id")
        .single();
      const expenseId = (expense as { id: string }).id;

      const { data: rows, error: selectErr } = await employee.from("smark_expenses").select("id");
      expect(selectErr).toBeNull();
      expect(rows).toEqual([]);

      const { data: rollupRows, error: rollupErr } = await employee.from("v_expense_rollups").select("*");
      expect(rollupErr).toBeNull();
      expect(rollupRows).toEqual([]);

      const { error: insertErr } = await employee
        .from("smark_expenses")
        .insert({ entry_type: "expense", amount: 50, entry_date: "2026-01-05", category: "Other", is_draft: true });
      expectRlsDenied(insertErr);

      await service.from("smark_expenses").delete().eq("id", expenseId);
    });

    test(
      "employee: DENIED writes to Settings tables (ordering_rules, distributors, expense_accounts, app_users)",
      async () => {
        const { error: rulesErr } = await employee
          .from("smark_ordering_rules")
          .insert({ key: "custom", enabled: true, mandatory: false, rank: 998 });
        expectRlsDenied(rulesErr);

        const { error: distErr } = await employee
          .from("smark_distributors")
          .insert({ name: `EMP Dist ${randomUUID().slice(0, 8)}`, api_type: "none" });
        expectRlsDenied(distErr);

        const { error: acctErr } = await employee
          .from("smark_expense_accounts")
          .insert({ name: `EMP Acct ${randomUUID().slice(0, 8)}`, account_type: "cash" });
        expectRlsDenied(acctErr);

        const { data: authUser } = await service.auth.admin.createUser({
          email: `emp-cannot-create-${randomUUID().slice(0, 8)}@smark.internal`,
          password: "Whatever-Pass-1!",
          email_confirm: true,
        });
        const newUserId = (authUser as { user: { id: string } }).user.id;
        const { error: userErr } = await employee
          .from("smark_app_users")
          .insert({ id: newUserId, username: `emp-cannot-create-${newUserId.slice(0, 8)}`, role: "employee", active: true });
        expectRlsDenied(userErr);

        await service.auth.admin.deleteUser(newUserId);
      },
    );

    test("employee: DENIED approving smark_learned_rules (UPDATE status suggested→active rejected)", async () => {
      const { data: rule } = await service
        .from("smark_learned_rules")
        .insert({
          scope: "global",
          rule_type: "prefer_distributor",
          value: { note: "employee denial test" },
          status: "suggested",
        })
        .select("id")
        .single();
      const ruleId = (rule as { id: string }).id;

      const { data: selectRows, error: selectErr } = await employee
        .from("smark_learned_rules")
        .select("id")
        .eq("id", ruleId);
      expect(selectErr).toBeNull();
      expect(selectRows).toEqual([]);

      // No matching row under employee's RLS visibility → the owner-only
      // USING clause filters it out before UPDATE can act: 0 rows affected,
      // not an error.
      const { data: updateRows } = await employee
        .from("smark_learned_rules")
        .update({ status: "active" })
        .eq("id", ruleId)
        .select("id");
      expect(updateRows).toEqual([]);

      const { data: reread } = await service.from("smark_learned_rules").select("status").eq("id", ruleId).single();
      expect((reread as { status: string }).status).toBe("suggested");

      await service.from("smark_learned_rules").delete().eq("id", ruleId);
    });

    test("employee: DENIED user management (INSERT/UPDATE smark_app_users)", async () => {
      const { data: before } = await service.from("smark_app_users").select("display_name").eq("id", employeeId).single();

      // owner-only UPDATE policy — even editing their OWN row is denied; the
      // USING clause filters it to 0 rows rather than raising an error.
      const { data: updateRows } = await employee
        .from("smark_app_users")
        .update({ display_name: "Self-renamed by employee" })
        .eq("id", employeeId)
        .select("id");
      expect(updateRows).toEqual([]);

      const { data: after } = await service.from("smark_app_users").select("display_name").eq("id", employeeId).single();
      expect(after).toEqual(before);
    });
  });

  describeWithDb("accountant", () => {
    let service: SupabaseClient;
    let accountant: SupabaseClient;
    let accountantId: string;
    let distributorId: string;

    beforeAll(async () => {
      service = createServiceClient();
      accountant = await createRoleClient("accountant", "Accountant@12345");
      accountantId = await fetchUserId(service, "accountant");
      distributorId = await fetchDistributorId(service);
    });

    test(
      "accountant: read-only operational tables — SELECT allowed, INSERT/UPDATE/DELETE denied (parts, movements, boms, cart, orders)",
      async () => {
        const suffix = randomUUID().slice(0, 8);
        const { data: shelf } = await service.from("smark_shelves").insert({ code: `ACC-${suffix}` }).select("id").single();
        const shelfId = (shelf as { id: string }).id;
        const { data: bigBox } = await service
          .from("smark_big_boxes")
          .insert({ shelf_id: shelfId, name: `ACC-BOX-${suffix}` })
          .select("id")
          .single();
        const boxId = (bigBox as { id: string }).id;
        const { data: part } = await service
          .from("smark_parts")
          .insert({ internal_pid: `ACC-PID-${suffix}` })
          .select("id")
          .single();
        const partId = (part as { id: string }).id;
        const { data: project } = await service
          .from("smark_projects")
          .insert({ name: `ACC Project ${suffix}` })
          .select("id")
          .single();
        const projectId = (project as { id: string }).id;

        // SELECT allowed (read-only half of the cell).
        const { error: partsSelectErr } = await accountant.from("smark_parts").select("id").eq("id", partId);
        expect(partsSelectErr).toBeNull();
        const { error: bomsSelectErr } = await accountant.from("smark_boms").select("id").limit(1);
        expect(bomsSelectErr).toBeNull();
        const { error: cartSelectErr } = await accountant.from("smark_cart_items").select("id").limit(1);
        expect(cartSelectErr).toBeNull();
        const { error: ordersSelectErr } = await accountant.from("smark_orders").select("id").limit(1);
        expect(ordersSelectErr).toBeNull();

        // INSERT denied — WITH CHECK fails outright → a real error.
        const { error: partsInsertErr } = await accountant
          .from("smark_parts")
          .insert({ internal_pid: `ACC-DENY-${suffix}` });
        expectRlsDenied(partsInsertErr);

        const { error: moveErr } = await accountant
          .from("smark_movements")
          .insert({ part_id: partId, big_box_id: boxId, delta_qty: 1, reason: "adjust", actor: accountantId });
        expectRlsDenied(moveErr);

        const { error: bomErr } = await accountant
          .from("smark_boms")
          .insert({ project_id: projectId, name: `ACC BOM ${suffix}` });
        expectRlsDenied(bomErr);

        const { error: cartErr } = await accountant
          .from("smark_cart_items")
          .insert({ part_id: partId, source: "manual", qty_to_order: 1 });
        expectRlsDenied(cartErr);

        const { error: orderErr } = await accountant
          .from("smark_orders")
          .insert({ distributor_id: distributorId, po_number: `ACC-PO-${suffix}` });
        expectRlsDenied(orderErr);

        // UPDATE/DELETE denied — USING clause filters to 0 rows, no error.
        const { data: partsUpdateRows, error: partsUpdateErr } = await accountant
          .from("smark_parts")
          .update({ description: "accountant edit" })
          .eq("id", partId)
          .select("id");
        expect(partsUpdateErr).toBeNull();
        expect(partsUpdateRows).toEqual([]);

        const { data: partsDeleteRows, error: partsDeleteErr } = await accountant
          .from("smark_parts")
          .delete()
          .eq("id", partId)
          .select("id");
        expect(partsDeleteErr).toBeNull();
        expect(partsDeleteRows).toEqual([]);

        await service.from("smark_projects").delete().eq("id", projectId);
        await service.from("smark_parts").delete().eq("id", partId);
        await service.from("smark_big_boxes").delete().eq("id", boxId);
        await service.from("smark_shelves").delete().eq("id", shelfId);
      },
    );

    test("accountant: read + WRITE smark_expenses (Q-01 client amendment)", async () => {
      const { data: expense, error: insertErr } = await accountant
        .from("smark_expenses")
        .insert({ entry_type: "expense", amount: 250, entry_date: "2026-01-06", category: "Materials", is_draft: true })
        .select("id")
        .single();
      expect(insertErr).toBeNull();
      const expenseId = (expense as { id: string }).id;

      const { error: updateErr } = await accountant.from("smark_expenses").update({ amount: 300 }).eq("id", expenseId);
      expect(updateErr).toBeNull();

      const { data: reread, error: selectErr } = await accountant
        .from("smark_expenses")
        .select("amount")
        .eq("id", expenseId)
        .single();
      expect(selectErr).toBeNull();
      expect(Number((reread as { amount: number }).amount)).toBe(300);

      await service.from("smark_expenses").delete().eq("id", expenseId);
    });

    test("accountant: SELECT smark_expense_accounts allowed, writes denied (owner-only CRUD)", async () => {
      const { error: selectErr } = await accountant.from("smark_expense_accounts").select("id").limit(1);
      expect(selectErr).toBeNull();

      const { error: insertErr } = await accountant
        .from("smark_expense_accounts")
        .insert({ name: `ACC Acct ${randomUUID().slice(0, 8)}`, account_type: "cash" });
      expectRlsDenied(insertErr);
    });

    test("accountant: reads ALL attendance/time/daily data (read-all, write none)", async () => {
      const other = await createEphemeralUser(service, "employee");
      const { data: project } = await service
        .from("smark_projects")
        .insert({ name: `ACC Daily Project ${randomUUID().slice(0, 8)}` })
        .select("id")
        .single();
      const projectId = (project as { id: string }).id;
      const workDate = "2031-04-03";

      await service
        .from("smark_attendance")
        .insert({ user_id: other.id, work_date: workDate, check_in: new Date().toISOString() });
      await service
        .from("smark_time_entries")
        .insert({ project_id: projectId, user_id: other.id, work_date: workDate, hours: 5, entered_by: other.id });

      const { data: attendanceRows, error: attendanceErr } = await accountant
        .from("smark_attendance")
        .select("id")
        .eq("user_id", other.id);
      expect(attendanceErr).toBeNull();
      expect(attendanceRows).toHaveLength(1);

      const { data: timeRows, error: timeErr } = await accountant
        .from("smark_time_entries")
        .select("id")
        .eq("user_id", other.id);
      expect(timeErr).toBeNull();
      expect(timeRows).toHaveLength(1);

      const { error: writeErr } = await accountant
        .from("smark_attendance")
        .insert({ user_id: accountantId, work_date: "2031-04-04", check_in: new Date().toISOString() });
      expectRlsDenied(writeErr);

      await service.from("smark_attendance").delete().eq("user_id", other.id).eq("work_date", workDate);
      await service.from("smark_time_entries").delete().eq("user_id", other.id).eq("work_date", workDate);
      await service.from("smark_projects").delete().eq("id", projectId);
      await other.cleanup();
    });

    test("accountant: DENIED Settings tables and learned-rule approval", async () => {
      const { error: rulesErr } = await accountant
        .from("smark_ordering_rules")
        .insert({ key: "custom", enabled: true, mandatory: false, rank: 997 });
      expectRlsDenied(rulesErr);

      const { error: distErr } = await accountant
        .from("smark_distributors")
        .insert({ name: `ACC Dist ${randomUUID().slice(0, 8)}`, api_type: "none" });
      expectRlsDenied(distErr);

      const { data: rule } = await service
        .from("smark_learned_rules")
        .insert({
          scope: "global",
          rule_type: "prefer_distributor",
          value: { note: "accountant denial test" },
          status: "suggested",
        })
        .select("id")
        .single();
      const ruleId = (rule as { id: string }).id;

      const { data: selectRows, error: selectErr } = await accountant
        .from("smark_learned_rules")
        .select("id")
        .eq("id", ruleId);
      expect(selectErr).toBeNull();
      expect(selectRows).toEqual([]);

      const { data: updateRows } = await accountant
        .from("smark_learned_rules")
        .update({ status: "active" })
        .eq("id", ruleId)
        .select("id");
      expect(updateRows).toEqual([]);

      await service.from("smark_learned_rules").delete().eq("id", ruleId);
    });
  });

  describeWithDb("shared / structural", () => {
    let service: SupabaseClient;
    let owner: SupabaseClient;
    let employee: SupabaseClient;
    let accountant: SupabaseClient;
    let ownerId: string;
    let employeeId: string;

    beforeAll(async () => {
      service = createServiceClient();
      owner = await createRoleClient("owner", "Owner@12345");
      employee = await createRoleClient("employee", "Employee@12345");
      accountant = await createRoleClient("accountant", "Accountant@12345");
      ownerId = await fetchUserId(service, "owner");
      employeeId = await fetchUserId(service, "employee");
    });

    test("smark_app_users readable by every authenticated role (names render in history)", async () => {
      for (const client of [owner, employee, accountant]) {
        const { data, error } = await client.from("smark_app_users").select("id").limit(5);
        expect(error).toBeNull();
        expect((data as unknown[]).length).toBeGreaterThan(0);
      }
    });

    test("every mutation stamps the real user_id (created_by/actor = auth.uid(), not spoofable)", async () => {
      // DB-provable specifically where the schema pins an explicit
      // `auth.uid()` WITH CHECK — smark_attendance/smark_time_entries'
      // employee-insert policies (migration 0001). Every OTHER actor/
      // created_by column (smark_movements.actor, smark_boms.uploaded_by,
      // smark_parts.created_by, ...) is a plain FK with no auth.uid() CHECK;
      // "stamps the real user_id" for those is an application-layer
      // guarantee (server actions always pass session.user.id), not one RLS
      // enforces today. This test pins the half of the claim the schema
      // actually enforces — spoofing THOSE other columns isn't blocked by
      // RLS as written (documented in the teammate report, not a silent gap).
      const spoofDate = "2031-04-05";
      const { error: attendanceErr } = await employee
        .from("smark_attendance")
        .insert({ user_id: ownerId, work_date: spoofDate, check_in: new Date().toISOString() });
      expectRlsDenied(attendanceErr);

      const { data: project } = await service
        .from("smark_projects")
        .insert({ name: `Spoof Project ${randomUUID().slice(0, 8)}` })
        .select("id")
        .single();
      const projectId = (project as { id: string }).id;

      const { error: timeErr } = await employee
        .from("smark_time_entries")
        .insert({ project_id: projectId, user_id: ownerId, work_date: spoofDate, hours: 1, entered_by: employeeId });
      expectRlsDenied(timeErr);

      const { data: leaked } = await service
        .from("smark_attendance")
        .select("id")
        .eq("user_id", ownerId)
        .eq("work_date", spoofDate);
      expect(leaked).toEqual([]);

      await service.from("smark_projects").delete().eq("id", projectId);
    });

    test("deactivated user (active=false) is blocked from all reads/writes", async () => {
      const ephemeral = await createEphemeralUser(service, "employee");
      const client = await createRoleClient(ephemeral.username, ephemeral.password);

      const { data: markerPart } = await service
        .from("smark_parts")
        .insert({ internal_pid: `DEACT-MARKER-${randomUUID().slice(0, 8)}` })
        .select("id")
        .single();
      const markerId = (markerPart as { id: string }).id;

      // Sanity: active user reads the marker fine before deactivation.
      const { data: before, error: beforeErr } = await client.from("smark_parts").select("id").eq("id", markerId);
      expect(beforeErr).toBeNull();
      expect(before).toHaveLength(1);

      await service.from("smark_app_users").update({ active: false }).eq("id", ephemeral.id);

      // Same already-live session — smark_role() re-reads the table on every
      // call (not cached in the JWT), so deactivation blocks immediately
      // without needing a fresh login (migration 0001 comment on smark_role()).
      const { data: afterRows, error: afterErr } = await client.from("smark_parts").select("id").eq("id", markerId);
      expect(afterErr).toBeNull();
      expect(afterRows).toEqual([]);

      const { error: writeErr } = await client
        .from("smark_parts")
        .insert({ internal_pid: `DEACTIVATED-${randomUUID().slice(0, 8)}` });
      expectRlsDenied(writeErr);

      await service.from("smark_parts").delete().eq("id", markerId);
      await ephemeral.cleanup();
    });

    test("anonymous key: DENIED on all smark_ tables directly", async () => {
      const anon = createAnonClient();

      for (const table of ["smark_parts", "smark_app_users", "smark_projects", "smark_expenses"]) {
        const { error } = await anon.from(table).select("id").limit(1);
        expect(error).not.toBeNull();
      }

      const { error: insertErr } = await anon
        .from("smark_parts")
        .insert({ internal_pid: `ANON-${randomUUID().slice(0, 8)}` });
      expect(insertErr).not.toBeNull();
    });
  });

  describe("client portal (tokenized public surface, not a role) [R2-38]", () => {
    // Converted from test.todo — supabase/migrations/0006_portal_fns.sql (the
    // portal package's reserved migration) now exists. `service`/`anon` are
    // constructed inside `beforeAll`, not at describe-body top level — Bun
    // still executes a skipped describe's callback body to collect its
    // tests, so building clients eagerly here would throw on a machine with
    // no local stack even when describeWithDb resolves to describe.skip
    // (same pattern as tests/invariants/*.test.ts and
    // tests/integration/receive-core.test.ts).
    describeWithDb("reads: valid token, shared-only payload, invalid/archived token", () => {
      let service: SupabaseClient;
      let anon: SupabaseClient;
      let projectId: string;
      let token: string;

      beforeAll(async () => {
        service = createServiceClient();
        anon = createAnonClient();
        token = `rls-portal-${randomUUID()}`;

        const { data, error } = await service
          .from("smark_projects")
          .insert({ name: "RLS Portal Test Project", share_token: token })
          .select("id")
          .single();
        if (error || !data) throw new Error(`portal RLS fixture: project insert failed: ${error?.message}`);
        projectId = (data as { id: string }).id;

        const { error: phaseErr } = await service.from("smark_project_phases").insert([
          { project_id: projectId, sort_order: 1, name: "Phase A", row_kind: "phase", status: "done", start_date: "2026-01-01", end_date: "2026-01-05" },
          { project_id: projectId, sort_order: 2, name: "Phase B", row_kind: "phase", status: "active", start_date: "2026-01-06", end_date: "2026-01-10" },
        ]);
        if (phaseErr) throw new Error(`portal RLS fixture: phases insert failed: ${phaseErr.message}`);

        const { error: actErr } = await service.from("smark_project_activities").insert([
          { project_id: projectId, type: "note", title: "Shared update", body: "visible on the portal", shared_to_portal: true },
          { project_id: projectId, type: "note", title: "Hidden update", body: "internal only, ₹12,000", shared_to_portal: false },
        ]);
        if (actErr) throw new Error(`portal RLS fixture: activities insert failed: ${actErr.message}`);

        const { error: docErr } = await service.from("smark_project_documents").insert([
          { project_id: projectId, display_name: "Shared doc", file_url: "https://example.test/shared.pdf", shared_to_portal: true },
          { project_id: projectId, display_name: "Hidden doc", file_url: "https://example.test/hidden.pdf", shared_to_portal: false },
        ]);
        if (docErr) throw new Error(`portal RLS fixture: documents insert failed: ${docErr.message}`);
      });

      afterAll(async () => {
        if (!projectId) return;
        await service.from("smark_project_documents").delete().eq("project_id", projectId);
        await service.from("smark_project_activities").delete().eq("project_id", projectId);
        await service.from("smark_project_phases").delete().eq("project_id", projectId);
        await service.from("smark_projects").delete().eq("id", projectId);
      });

      test("portal security-definer fn returns ONLY name/status/phases/progress + explicitly-shared items for a valid share_token", async () => {
        const { data: projectData, error: projectErr } = await anon.rpc("portal_get_project", { p_token: token });
        expect(projectErr).toBeNull();
        const project = projectData as Record<string, unknown>;
        expect(project.name).toBe("RLS Portal Test Project");
        expect(Object.keys(project).sort()).toEqual(
          ["completed_at", "est_delivery_date", "est_start_date", "name", "phases", "project_id", "status", "timeline_note"].sort(),
        );
        const phases = project.phases as Array<Record<string, unknown>>;
        expect(phases).toHaveLength(2);
        for (const phase of phases) {
          expect(Object.keys(phase).sort()).toEqual(
            ["duration_text", "end_date", "id", "name", "notes", "row_kind", "sort_order", "status", "start_date", "version_label"].sort(),
          );
        }

        const { data: sharedData, error: sharedErr } = await anon.rpc("portal_get_shared", { p_token: token });
        expect(sharedErr).toBeNull();
        const shared = sharedData as { activities: Array<Record<string, unknown>>; documents: Array<Record<string, unknown>> };
        expect(shared.activities).toHaveLength(1);
        expect(shared.activities[0]?.title).toBe("Shared update");
        expect(shared.documents).toHaveLength(1);
        expect(shared.documents[0]?.display_name).toBe("Shared doc");
      });

      test("share_token grants ZERO direct table-level access (all raw selects denied)", async () => {
        const { error: projErr } = await anon.from("smark_projects").select("*").eq("id", projectId);
        expect(projErr).not.toBeNull();
        const { error: phaseErr } = await anon.from("smark_project_phases").select("*").eq("project_id", projectId);
        expect(phaseErr).not.toBeNull();
        const { error: actErr } = await anon.from("smark_project_activities").select("*").eq("project_id", projectId);
        expect(actErr).not.toBeNull();
        const { error: docErr } = await anon.from("smark_project_documents").select("*").eq("project_id", projectId);
        expect(docErr).not.toBeNull();
      });

      test("invalid or regenerated token resolves nothing (regenerate = revoke)", async () => {
        const { data: projectData, error: projectErr } = await anon.rpc("portal_get_project", { p_token: "no-such-token-ever" });
        expect(projectErr).toBeNull();
        expect(projectData).toBeNull();

        const { data: sharedData, error: sharedErr } = await anon.rpc("portal_get_shared", { p_token: "no-such-token-ever" });
        expect(sharedErr).toBeNull();
        expect(sharedData).toBeNull();
      });

      test("archived project's token stops resolving [R2-32]", async () => {
        await service.from("smark_projects").update({ archived_at: new Date().toISOString() }).eq("id", projectId);
        try {
          const { data } = await anon.rpc("portal_get_project", { p_token: token });
          expect(data).toBeNull();
        } finally {
          // Restore for any later test in this run that reuses `token`.
          await service.from("smark_projects").update({ archived_at: null }).eq("id", projectId);
        }
      });

      test("portal payload NEVER contains prices, inventory, hours, or internal notes (leak scan)", async () => {
        const { data: sharedData } = await anon.rpc("portal_get_shared", { p_token: token });
        const serialized = JSON.stringify(sharedData);
        expect(serialized).not.toContain("₹");
        expect(serialized).not.toContain("12,000");
        expect(serialized).not.toContain("Hidden update");
        expect(serialized).not.toContain("Hidden doc");
      });
    });

    describeWithDb("writes: comment insert + rate limit", () => {
      let service: SupabaseClient;
      let anon: SupabaseClient;
      let projectId: string;
      let token: string;

      beforeAll(async () => {
        service = createServiceClient();
        anon = createAnonClient();
        token = `rls-portal-comment-${randomUUID()}`;

        const { data, error } = await service
          .from("smark_projects")
          .insert({ name: "RLS Portal Comment Test", share_token: token })
          .select("id")
          .single();
        if (error || !data) throw new Error(`portal RLS fixture: project insert failed: ${error?.message}`);
        projectId = (data as { id: string }).id;
      });

      afterAll(async () => {
        if (!projectId) return;
        await service.from("smark_project_activities").delete().eq("project_id", projectId);
        await service.from("smark_projects").delete().eq("id", projectId);
      });

      test("portal comment INSERT lands as 'change' activity tagged from-portal; any other INSERT denied", async () => {
        const { data: rpcData, error: rpcErr } = await anon.rpc("portal_add_comment", {
          p_token: token,
          p_author_name: "Test Client",
          p_body: "Looks great, thanks!",
        });
        expect(rpcErr).toBeNull();
        expect((rpcData as { ok?: boolean } | null)?.ok).toBe(true);

        const { data: rows } = await service
          .from("smark_project_activities")
          .select("type, shared_to_portal, from_portal, created_by")
          .eq("project_id", projectId);
        expect(rows).toHaveLength(1);
        expect(rows?.[0]?.type).toBe("change");
        expect(rows?.[0]?.from_portal).toBe(true);
        expect(rows?.[0]?.shared_to_portal).toBe(true);
        expect(rows?.[0]?.created_by).toBeNull();

        const { error: directInsertErr } = await anon.from("smark_project_activities").insert({
          project_id: projectId,
          type: "change",
          body: "should be denied — no direct table access for anon",
        });
        expect(directInsertErr).not.toBeNull();
      });

      test("rate limit: more than 5 comments from one token within the hour are rejected", async () => {
        for (let i = 0; i < 4; i += 1) {
          const { error } = await anon.rpc("portal_add_comment", {
            p_token: token,
            p_author_name: "Test Client",
            p_body: `follow-up message ${i}`,
          });
          expect(error).toBeNull();
        }
        // 5 total have now landed (1 from the previous test + 4 here) — the 6th must be rejected.
        const { error: sixthErr } = await anon.rpc("portal_add_comment", {
          p_token: token,
          p_author_name: "Test Client",
          p_body: "one too many",
        });
        expect(sixthErr).not.toBeNull();
      });

      test("invalid token: comment INSERT rejected with no distinction from a valid-token rate-limit rejection", async () => {
        const { error } = await anon.rpc("portal_add_comment", {
          p_token: "no-such-token-ever",
          p_author_name: "Test Client",
          p_body: "hello?",
        });
        expect(error).not.toBeNull();
      });
    });
  });
});
