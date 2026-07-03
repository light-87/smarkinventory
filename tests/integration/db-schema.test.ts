import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, describeWithDb } from "../helpers/supabase";
import { createTestActor, createTestBox, createTestPart } from "../invariants/fixtures";
import { TABLES, VIEWS } from "@/types/db";

/**
 * DB layer beyond RLS — plan/TESTING.md §2: "migrations apply cleanly;
 * FK/unique constraints; triggers/views".
 * Canonical shapes: plan/SCHEMA.md (tables §0–7, views §8, sync table at end).
 *
 * Runs against the LOCAL stack after `supabase db reset` (the reset itself is
 * the "migrations apply cleanly" gate — CI fails the job if it errors).
 * Fully converted to real, DB-backed tests (service-role client throughout —
 * this file is about schema-level guarantees, not role permissions; RLS is
 * tests/integration/rls-matrix.test.ts's job). Clients/fixtures are built
 * inside `beforeAll`, never at describe-body top level — Bun still executes
 * a skipped describe's callback body to collect its tests, so building them
 * eagerly would throw on a machine with no local stack even when
 * `describeWithDb` resolves to `describe.skip` (same pattern as
 * tests/invariants/*.test.ts and tests/integration/rls-matrix.test.ts).
 */

/** Any seeded distributor id (supabase/seed.sql always seeds the baseline five). */
async function fetchDistributorId(service: SupabaseClient): Promise<string> {
  const { data, error } = await service.from("smark_distributors").select("id").eq("name", "Digikey").single();
  if (error || !data) {
    throw new Error(`schema fixture: seeded distributor "Digikey" not found — check supabase/seed.sql (${error?.message ?? "no row"}).`);
  }
  return (data as { id: string }).id;
}

describeWithDb("migrations & constraints", () => {
  let service: SupabaseClient;

  beforeAll(() => {
    service = createServiceClient();
  });

  test("supabase db reset applies all migrations + seed without error (every smark_ table is queryable)", async () => {
    for (const table of Object.values(TABLES)) {
      const { error } = await service.from(table).select("id", { count: "exact", head: true });
      expect(error).toBeNull();
    }
  });

  test("all tables carry uuid PK id, created_at default now(), updated_at (SCHEMA.md conventions)", async () => {
    for (const table of Object.values(TABLES)) {
      const { data, error } = await service.from(table).select("id, created_at, updated_at").limit(1);
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    }

    // Concrete shape check against an always-seeded row (supabase/seed.sql).
    const { data: rule } = await service
      .from(TABLES.ordering_rules)
      .select("id, created_at, updated_at")
      .eq("key", "package")
      .single();
    const row = rule as { id: string; created_at: string; updated_at: string | null };
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(new Date(row.created_at).toString()).not.toBe("Invalid Date");
    expect(row.updated_at).toBeNull(); // never updated since seed
  });

  test("UNIQUE: smark_boms (project_id, name) — BOM name unique per project [R2-03]", async () => {
    const { data: project } = await service
      .from(TABLES.projects)
      .insert({ name: `Schema UNIQUE Project ${randomUUID().slice(0, 8)}` })
      .select("id")
      .single();
    const projectId = (project as { id: string }).id;
    const { data: project2 } = await service
      .from(TABLES.projects)
      .insert({ name: `Schema UNIQUE Project2 ${randomUUID().slice(0, 8)}` })
      .select("id")
      .single();
    const project2Id = (project2 as { id: string }).id;
    const bomName = "Duplicate BOM Name";

    const { error: firstErr } = await service.from(TABLES.boms).insert({ project_id: projectId, name: bomName });
    expect(firstErr).toBeNull();

    const { error: dupErr } = await service.from(TABLES.boms).insert({ project_id: projectId, name: bomName });
    expect(dupErr).not.toBeNull();
    expect(dupErr?.code).toBe("23505");

    // Same name under a DIFFERENT project is fine — uniqueness is per-project.
    const { error: otherProjectErr } = await service.from(TABLES.boms).insert({ project_id: project2Id, name: bomName });
    expect(otherProjectErr).toBeNull();

    await service.from(TABLES.projects).delete().in("id", [projectId, project2Id]); // cascades boms
  });

  test("UNIQUE: smark_orders.po_number — website order number [R2-12/Q-06]", async () => {
    const distributorId = await fetchDistributorId(service);
    const po = `SCHEMA-PO-${randomUUID().slice(0, 8)}`;

    const { error: firstErr } = await service.from(TABLES.orders).insert({ distributor_id: distributorId, po_number: po });
    expect(firstErr).toBeNull();

    const { error: dupErr } = await service.from(TABLES.orders).insert({ distributor_id: distributorId, po_number: po });
    expect(dupErr).not.toBeNull();
    expect(dupErr?.code).toBe("23505");

    await service.from(TABLES.orders).delete().eq("po_number", po);
  });

  test("UNIQUE: smark_attendance (user_id, work_date)", async () => {
    const actor = await createTestActor(service, "employee");
    const workDate = "2031-05-01";

    const { error: firstErr } = await service.from(TABLES.attendance).insert({ user_id: actor.id, work_date: workDate });
    expect(firstErr).toBeNull();

    const { error: dupErr } = await service.from(TABLES.attendance).insert({ user_id: actor.id, work_date: workDate });
    expect(dupErr).not.toBeNull();
    expect(dupErr?.code).toBe("23505");

    await service.from(TABLES.attendance).delete().eq("user_id", actor.id).eq("work_date", workDate);
    await actor.cleanup();
  });

  test("UNIQUE: smark_project_members (project_id, user_id)", async () => {
    const actor = await createTestActor(service, "employee");
    const { data: project } = await service
      .from(TABLES.projects)
      .insert({ name: `Schema Members Project ${randomUUID().slice(0, 8)}` })
      .select("id")
      .single();
    const projectId = (project as { id: string }).id;

    const { error: firstErr } = await service.from(TABLES.project_members).insert({ project_id: projectId, user_id: actor.id });
    expect(firstErr).toBeNull();

    const { error: dupErr } = await service.from(TABLES.project_members).insert({ project_id: projectId, user_id: actor.id });
    expect(dupErr).not.toBeNull();
    expect(dupErr?.code).toBe("23505");

    await service.from(TABLES.project_members).delete().eq("project_id", projectId);
    await service.from(TABLES.projects).delete().eq("id", projectId);
    await actor.cleanup();
  });

  test("UNIQUE: smark_projects.share_token and smark_ai_aliases.alias", async () => {
    const token = `SCHEMA-TOKEN-${randomUUID()}`;
    const { data: p1 } = await service
      .from(TABLES.projects)
      .insert({ name: "Share Token A", share_token: token })
      .select("id")
      .single();
    const { error: dupTokenErr } = await service.from(TABLES.projects).insert({ name: "Share Token B", share_token: token });
    expect(dupTokenErr).not.toBeNull();
    expect(dupTokenErr?.code).toBe("23505");
    await service.from(TABLES.projects).delete().eq("id", (p1 as { id: string }).id);

    const alias = `SCHEMA-ALIAS-${randomUUID().slice(0, 8)}`;
    const { error: firstAliasErr } = await service
      .from(TABLES.ai_aliases)
      .insert({ entity_type: "project", entity_id: randomUUID(), alias });
    expect(firstAliasErr).toBeNull();
    const { error: dupAliasErr } = await service
      .from(TABLES.ai_aliases)
      .insert({ entity_type: "project", entity_id: randomUUID(), alias });
    expect(dupAliasErr).not.toBeNull();
    expect(dupAliasErr?.code).toBe("23505");

    await service.from(TABLES.ai_aliases).delete().eq("alias", alias);
  });

  test("CHECK: smark_app_users.role IN (owner, employee, accountant)", async () => {
    const { data: authUser } = await service.auth.admin.createUser({
      email: `schema-check-role-${randomUUID().slice(0, 8)}@smark.internal`,
      password: "Whatever-Pass-1!",
      email_confirm: true,
    });
    const userId = (authUser as { user: { id: string } }).user.id;

    const { error } = await service
      .from(TABLES.app_users)
      .insert({ id: userId, username: `schema-bad-role-${userId.slice(0, 8)}`, role: "manager", active: true });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");

    await service.auth.admin.deleteUser(userId);
  });

  test("FK: actor/created_by/started_by/uploaded_by/placed_by → smark_app_users.id [R2-01]", async () => {
    const bogusUserId = randomUUID();
    const box = await createTestBox(service);
    const part = await createTestPart(service);
    const { data: project } = await service
      .from(TABLES.projects)
      .insert({ name: `FK Test Project ${randomUUID().slice(0, 8)}` })
      .select("id")
      .single();
    const projectId = (project as { id: string }).id;
    const { data: bom } = await service
      .from(TABLES.boms)
      .insert({ project_id: projectId, name: `FK Test BOM ${randomUUID().slice(0, 8)}` })
      .select("id")
      .single();
    const bomId = (bom as { id: string }).id;
    const distributorId = await fetchDistributorId(service);

    const { error: movementErr } = await service
      .from(TABLES.movements)
      .insert({ part_id: part.id, big_box_id: box.boxId, delta_qty: 1, reason: "adjust", actor: bogusUserId });
    expect(movementErr).not.toBeNull();
    expect(movementErr?.code).toBe("23503");

    const { error: bomUploadedByErr } = await service
      .from(TABLES.boms)
      .insert({ project_id: projectId, name: `FK Test BOM2 ${randomUUID().slice(0, 8)}`, uploaded_by: bogusUserId });
    expect(bomUploadedByErr).not.toBeNull();
    expect(bomUploadedByErr?.code).toBe("23503");

    const { error: runErr } = await service
      .from(TABLES.agent_runs)
      .insert({ bom_id: bomId, fanout_width: 1, depth_per_item: 1, per_site_cap: 1, started_by: bogusUserId });
    expect(runErr).not.toBeNull();
    expect(runErr?.code).toBe("23503");

    const { error: orderErr } = await service
      .from(TABLES.orders)
      .insert({ distributor_id: distributorId, po_number: `FK-PO-${randomUUID().slice(0, 8)}`, placed_by: bogusUserId });
    expect(orderErr).not.toBeNull();
    expect(orderErr?.code).toBe("23503");

    const { error: createdByErr } = await service
      .from(TABLES.projects)
      .insert({ name: `FK Test Project bad created_by ${randomUUID().slice(0, 8)}`, created_by: bogusUserId });
    expect(createdByErr).not.toBeNull();
    expect(createdByErr?.code).toBe("23503");

    await service.from(TABLES.projects).delete().eq("id", projectId); // cascades bom
    await part.cleanup();
    await box.cleanup();
  });

  test("deactivate-not-delete: deleting a smark_app_users row with history is rejected (FK restrict)", async () => {
    const actor = await createTestActor(service, "employee");
    const box = await createTestBox(service);
    const part = await createTestPart(service);
    const { data: movement } = await service
      .from(TABLES.movements)
      .insert({ part_id: part.id, big_box_id: box.boxId, delta_qty: 1, reason: "adjust", actor: actor.id })
      .select("id")
      .single();

    const { error: deleteErr } = await service.from(TABLES.app_users).delete().eq("id", actor.id);
    expect(deleteErr).not.toBeNull();
    expect(deleteErr?.code).toBe("23503");

    // The correct path is deactivate, not delete.
    const { error: deactivateErr } = await service.from(TABLES.app_users).update({ active: false }).eq("id", actor.id);
    expect(deactivateErr).toBeNull();

    await service.from(TABLES.movements).delete().eq("id", (movement as { id: string }).id);
    await part.cleanup();
    await box.cleanup();
    await actor.cleanup(); // now safe — no more referencing rows
  });
});

describeWithDb("views (plan/SCHEMA.md §8)", () => {
  let service: SupabaseClient;

  beforeAll(() => {
    service = createServiceClient();
  });

  describe("v_part_demand [R2-10 · Q-05 FINAL]", () => {
    test(
      "demand = Σ(line qty × bom.build_qty) over matched lines of active, reconciled BOMs [R2-27] — canonical fixture: 500 avail / 400+200 demanded → shortfall 100",
      async () => {
        const part = await createTestPart(service);
        const box = await createTestBox(service);
        await service.from(TABLES.stock_locations).insert({ part_id: part.id, big_box_id: box.boxId, qty: 500 });

        const { data: projectA } = await service
          .from(TABLES.projects)
          .insert({ name: `Demand Project A ${randomUUID().slice(0, 8)}` })
          .select("id")
          .single();
        const { data: projectB } = await service
          .from(TABLES.projects)
          .insert({ name: `Demand Project B ${randomUUID().slice(0, 8)}` })
          .select("id")
          .single();
        const projectAId = (projectA as { id: string }).id;
        const projectBId = (projectB as { id: string }).id;

        const { data: bomA } = await service
          .from(TABLES.boms)
          .insert({ project_id: projectAId, name: "BOM A", build_qty: 1 })
          .select("id")
          .single();
        const { data: bomB } = await service
          .from(TABLES.boms)
          .insert({ project_id: projectBId, name: "BOM B", build_qty: 1 })
          .select("id")
          .single();

        await service.from(TABLES.bom_lines).insert({ bom_id: (bomA as { id: string }).id, qty: 400, matched_part_id: part.id, dnp: false });
        await service.from(TABLES.bom_lines).insert({ bom_id: (bomB as { id: string }).id, qty: 200, matched_part_id: part.id, dnp: false });

        const { data: demandRow, error } = await service.from(VIEWS.part_demand).select("*").eq("part_id", part.id).single();
        expect(error).toBeNull();
        const row = demandRow as { demand: number; available: number; shortfall: number; breakdown: Array<Record<string, unknown>> };
        expect(row.demand).toBe(600);
        expect(row.available).toBe(500);
        expect(row.shortfall).toBe(100);
        expect(row.breakdown).toHaveLength(2);
        const qtys = (row.breakdown.map((b) => b.qty) as number[]).sort((a, b) => a - b);
        expect(qtys).toEqual([200, 400]);

        await service.from(TABLES.projects).delete().in("id", [projectAId, projectBId]); // cascades boms + bom_lines
        await part.cleanup();
        await box.cleanup();
      },
    );

    test("excludes BOMs of archived projects (archive releases demand) [R2-32]", async () => {
      const part = await createTestPart(service);
      const box = await createTestBox(service);
      await service.from(TABLES.stock_locations).insert({ part_id: part.id, big_box_id: box.boxId, qty: 500 });

      const { data: project } = await service
        .from(TABLES.projects)
        .insert({ name: `Archive Demand Project ${randomUUID().slice(0, 8)}` })
        .select("id")
        .single();
      const projectId = (project as { id: string }).id;
      const { data: bom } = await service
        .from(TABLES.boms)
        .insert({ project_id: projectId, name: "Archive BOM", build_qty: 1 })
        .select("id")
        .single();
      await service.from(TABLES.bom_lines).insert({ bom_id: (bom as { id: string }).id, qty: 700, matched_part_id: part.id, dnp: false });

      const { data: before } = await service.from(VIEWS.part_demand).select("demand, shortfall").eq("part_id", part.id).single();
      expect((before as { demand: number }).demand).toBe(700);
      expect((before as { shortfall: number }).shortfall).toBe(200);

      await service.from(TABLES.projects).update({ archived_at: new Date().toISOString() }).eq("id", projectId);

      // INNER JOIN throughout the view — an archived project's demand isn't
      // zeroed, it disappears: no row at all for a part with zero demand.
      const { data: afterRows } = await service.from(VIEWS.part_demand).select("demand").eq("part_id", part.id);
      expect(afterRows).toEqual([]);

      await service.from(TABLES.projects).delete().eq("id", projectId);
      await part.cleanup();
      await box.cleanup();
    });

    test("shortfall = GREATEST(demand − available, 0), available = smark_parts.total_qty", async () => {
      const part = await createTestPart(service);
      const box = await createTestBox(service);
      const { data: loc } = await service
        .from(TABLES.stock_locations)
        .insert({ part_id: part.id, big_box_id: box.boxId, qty: 50 })
        .select("id")
        .single();
      const locId = (loc as { id: string }).id;

      const { data: project } = await service
        .from(TABLES.projects)
        .insert({ name: `Shortfall Project ${randomUUID().slice(0, 8)}` })
        .select("id")
        .single();
      const projectId = (project as { id: string }).id;
      const { data: bom } = await service
        .from(TABLES.boms)
        .insert({ project_id: projectId, name: "Shortfall BOM", build_qty: 1 })
        .select("id")
        .single();
      await service.from(TABLES.bom_lines).insert({ bom_id: (bom as { id: string }).id, qty: 80, matched_part_id: part.id, dnp: false });

      // demand(80) > available(50) → positive shortfall.
      const { data: short } = await service
        .from(VIEWS.part_demand)
        .select("demand, available, shortfall")
        .eq("part_id", part.id)
        .single();
      expect(short).toEqual({ demand: 80, available: 50, shortfall: 30 });

      // Bump stock above demand → shortfall clamps to 0, never negative.
      await service.from(TABLES.stock_locations).update({ qty: 200 }).eq("id", locId);
      const { data: covered } = await service
        .from(VIEWS.part_demand)
        .select("demand, available, shortfall")
        .eq("part_id", part.id)
        .single();
      expect(covered).toEqual({ demand: 80, available: 200, shortfall: 0 });

      await service.from(TABLES.projects).delete().eq("id", projectId);
      await part.cleanup();
      await box.cleanup();
    });

    test("per-project demand breakdown matches seeded BOMs (matched, non-DNP, qty>0 lines only)", async () => {
      const part = await createTestPart(service);
      const box = await createTestBox(service);
      await service.from(TABLES.stock_locations).insert({ part_id: part.id, big_box_id: box.boxId, qty: 1000 });

      const { data: project } = await service
        .from(TABLES.projects)
        .insert({ name: `Breakdown Project ${randomUUID().slice(0, 8)}` })
        .select("id")
        .single();
      const projectId = (project as { id: string }).id;
      const { data: bom } = await service
        .from(TABLES.boms)
        .insert({ project_id: projectId, name: "Breakdown BOM", build_qty: 3 })
        .select("id")
        .single();
      const bomId = (bom as { id: string }).id;

      const { data: countedLine } = await service
        .from(TABLES.bom_lines)
        .insert({ bom_id: bomId, qty: 10, matched_part_id: part.id, dnp: false })
        .select("id")
        .single();
      await service.from(TABLES.bom_lines).insert({ bom_id: bomId, qty: 999, matched_part_id: part.id, dnp: true }); // DNP — excluded
      await service.from(TABLES.bom_lines).insert({ bom_id: bomId, qty: 0, matched_part_id: part.id, dnp: false }); // qty=0 — excluded
      await service.from(TABLES.bom_lines).insert({ bom_id: bomId, qty: 500 }); // unmatched — excluded

      const { data: row } = await service.from(VIEWS.part_demand).select("demand, breakdown").eq("part_id", part.id).single();
      const parsed = row as { demand: number; breakdown: Array<Record<string, unknown>> };
      expect(parsed.demand).toBe(30); // 10 * build_qty(3)
      expect(parsed.breakdown).toHaveLength(1);
      expect(parsed.breakdown[0]).toEqual({
        project_id: projectId,
        bom_id: bomId,
        bom_line_id: (countedLine as { id: string }).id,
        qty: 30,
      });

      await service.from(TABLES.projects).delete().eq("id", projectId);
      await part.cleanup();
      await box.cleanup();
    });
  });

  describe("v_daily_activity [R2-07]", () => {
    test(
      "unions movements ∪ part events ∪ run starts/finishes ∪ cart adds ∪ orders ∪ arrivals per (actor, day)",
      async () => {
        const actor = await createTestActor(service, "owner");
        const box = await createTestBox(service);
        const part = await createTestPart(service);
        const distributorId = await fetchDistributorId(service);
        const testDate = "2031-06-01";
        const ts = `${testDate}T10:00:00Z`;

        const { data: project } = await service
          .from(TABLES.projects)
          .insert({ name: `Daily Activity Project ${randomUUID().slice(0, 8)}` })
          .select("id")
          .single();
        const projectId = (project as { id: string }).id;
        const { data: bom } = await service
          .from(TABLES.boms)
          .insert({ project_id: projectId, name: "Daily Activity BOM" })
          .select("id")
          .single();
        const bomId = (bom as { id: string }).id;

        await service
          .from(TABLES.movements)
          .insert({ part_id: part.id, big_box_id: box.boxId, delta_qty: 5, reason: "adjust", actor: actor.id, created_at: ts });
        await service
          .from(TABLES.part_events)
          .insert({ part_id: part.id, event_type: "note", actor: actor.id, occurred_at: ts, created_at: ts });
        const { data: run } = await service
          .from(TABLES.agent_runs)
          .insert({ bom_id: bomId, fanout_width: 1, depth_per_item: 1, per_site_cap: 1, status: "done", started_by: actor.id, created_at: ts })
          .select("id")
          .single();
        const runId = (run as { id: string }).id;
        await service
          .from(TABLES.cart_items)
          .insert({ part_id: part.id, source: "manual", qty_to_order: 1, created_by: actor.id, created_at: ts });
        const { data: order } = await service
          .from(TABLES.orders)
          .insert({ distributor_id: distributorId, po_number: `DAILY-PO-${randomUUID().slice(0, 8)}`, placed_by: actor.id, placed_at: ts })
          .select("id")
          .single();
        const orderId = (order as { id: string }).id;
        await service
          .from(TABLES.order_lines)
          .insert({ order_id: orderId, part_id: part.id, project_id: projectId, qty_ordered: 5, line_status: "arrived", arrived_qty: 5, arrived_at: ts });
        await service
          .from(TABLES.attendance)
          .insert({ user_id: actor.id, work_date: testDate, check_in: ts, check_out: `${testDate}T18:00:00Z` });
        await service
          .from(TABLES.time_entries)
          .insert({ project_id: projectId, user_id: actor.id, work_date: testDate, hours: 4, entered_by: actor.id, created_at: ts });

        const { data: rows, error } = await service
          .from(VIEWS.daily_activity)
          .select("kind, actor, work_date")
          .eq("work_date", testDate)
          .eq("actor", actor.id);
        expect(error).toBeNull();
        const kinds = new Set((rows as Array<{ kind: string }>).map((r) => r.kind));
        // arrival's `actor` column is always null in the view (order_lines
        // carries no actor — see v_daily_activity's own comment), so it never
        // matches the `.eq("actor", actor.id)` filter above; checked separately.
        for (const expected of ["movement", "part_event", "run_started", "run_finished", "cart_add", "order_placed", "attendance", "time_entry"]) {
          expect(kinds.has(expected)).toBe(true);
        }
        // attendance appears twice — one row for check-in, one for check-out.
        expect((rows as Array<{ kind: string }>).filter((r) => r.kind === "attendance")).toHaveLength(2);

        const { data: arrivalRows } = await service.from(VIEWS.daily_activity).select("kind").eq("kind", "arrival").eq("order_id", orderId);
        expect(arrivalRows).toHaveLength(1);

        await service.from(TABLES.order_lines).delete().eq("order_id", orderId);
        await service.from(TABLES.orders).delete().eq("id", orderId);
        await service.from(TABLES.cart_items).delete().eq("part_id", part.id);
        await service.from(TABLES.agent_runs).delete().eq("id", runId);
        await service.from(TABLES.attendance).delete().eq("user_id", actor.id).eq("work_date", testDate);
        await service.from(TABLES.time_entries).delete().eq("user_id", actor.id).eq("work_date", testDate);
        await service.from(TABLES.projects).delete().eq("id", projectId); // cascades bom
        await part.cleanup();
        await box.cleanup();
        await actor.cleanup();
      },
    );

    test("joins attendance + time entries per person; read-only (no write path)", async () => {
      const actorA = await createTestActor(service, "employee");
      const actorB = await createTestActor(service, "employee");
      const workDate = "2031-06-02";

      await service.from(TABLES.attendance).insert({ user_id: actorA.id, work_date: workDate, check_in: `${workDate}T09:00:00Z` });
      await service.from(TABLES.attendance).insert({ user_id: actorB.id, work_date: workDate, check_in: `${workDate}T09:30:00Z` });

      const { data: rowsA } = await service
        .from(VIEWS.daily_activity)
        .select("actor")
        .eq("work_date", workDate)
        .eq("kind", "attendance")
        .eq("actor", actorA.id);
      expect(rowsA).toHaveLength(1);

      const { data: rowsB } = await service
        .from(VIEWS.daily_activity)
        .select("actor")
        .eq("work_date", workDate)
        .eq("kind", "attendance")
        .eq("actor", actorB.id);
      expect(rowsB).toHaveLength(1);

      // Read-only: the view itself rejects DML outright (no INSTEAD OF trigger).
      const { error: insertErr } = await service.from(VIEWS.daily_activity).insert({ kind: "movement", work_date: workDate });
      expect(insertErr).not.toBeNull();

      await service.from(TABLES.attendance).delete().eq("user_id", actorA.id).eq("work_date", workDate);
      await service.from(TABLES.attendance).delete().eq("user_id", actorB.id).eq("work_date", workDate);
      await actorA.cleanup();
      await actorB.cleanup();
    });
  });

  describe("v_expense_rollups [R2-21]", () => {
    test("monthly/quarterly/yearly sums by type, category, account, project equal seeded sums", async () => {
      const { data: account } = await service
        .from(TABLES.expense_accounts)
        .insert({ name: `Rollup Acct ${randomUUID().slice(0, 8)}`, account_type: "cash" })
        .select("id")
        .single();
      const accountId = (account as { id: string }).id;
      const entryDate = "2031-07-15";
      const amounts = [100, 250, 75.5];
      const ids: string[] = [];
      for (const amount of amounts) {
        const { data } = await service
          .from(TABLES.expenses)
          .insert({ entry_type: "expense", amount, entry_date: entryDate, category: "Tools", account_id: accountId, is_draft: false })
          .select("id")
          .single();
        ids.push((data as { id: string }).id);
      }
      const expectedTotal = amounts.reduce((sum, a) => sum + a, 0);

      const { data: monthRow } = await service
        .from(VIEWS.expense_rollups)
        .select("total, entry_count")
        .eq("bucket", "month")
        .eq("period", "2031-07")
        .eq("entry_type", "expense")
        .eq("category", "Tools")
        .eq("account_id", accountId)
        .single();
      expect(Number((monthRow as { total: number }).total)).toBeCloseTo(expectedTotal, 2);
      expect((monthRow as { entry_count: number }).entry_count).toBe(3);

      const { data: quarterRow } = await service
        .from(VIEWS.expense_rollups)
        .select("total, entry_count")
        .eq("bucket", "quarter")
        .eq("period", "2031-Q3")
        .eq("entry_type", "expense")
        .eq("category", "Tools")
        .eq("account_id", accountId)
        .single();
      expect(Number((quarterRow as { total: number }).total)).toBeCloseTo(expectedTotal, 2);
      expect((quarterRow as { entry_count: number }).entry_count).toBe(3);

      const { data: yearRow } = await service
        .from(VIEWS.expense_rollups)
        .select("total, entry_count")
        .eq("bucket", "year")
        .eq("period", "2031")
        .eq("entry_type", "expense")
        .eq("category", "Tools")
        .eq("account_id", accountId)
        .single();
      expect(Number((yearRow as { total: number }).total)).toBeCloseTo(expectedTotal, 2);
      expect((yearRow as { entry_count: number }).entry_count).toBe(3);

      await service.from(TABLES.expenses).delete().in("id", ids);
      await service.from(TABLES.expense_accounts).delete().eq("id", accountId);
    });

    test("draft expenses (is_draft=true) and soft-deleted rows excluded from rollups", async () => {
      const { data: account } = await service
        .from(TABLES.expense_accounts)
        .insert({ name: `Rollup Excl Acct ${randomUUID().slice(0, 8)}`, account_type: "cash" })
        .select("id")
        .single();
      const accountId = (account as { id: string }).id;
      const entryDate = "2031-08-10";

      const { data: confirmedA } = await service
        .from(TABLES.expenses)
        .insert({ entry_type: "expense", amount: 100, entry_date: entryDate, category: "Rent", account_id: accountId, is_draft: false })
        .select("id")
        .single();
      const { data: confirmedB } = await service
        .from(TABLES.expenses)
        .insert({ entry_type: "expense", amount: 50, entry_date: entryDate, category: "Rent", account_id: accountId, is_draft: false })
        .select("id")
        .single();
      const { data: draftRow } = await service
        .from(TABLES.expenses)
        .insert({ entry_type: "expense", amount: 9999, entry_date: entryDate, category: "Rent", account_id: accountId, is_draft: true })
        .select("id")
        .single();
      const { data: softDeletedRow } = await service
        .from(TABLES.expenses)
        .insert({ entry_type: "expense", amount: 8888, entry_date: entryDate, category: "Rent", account_id: accountId, is_draft: false })
        .select("id")
        .single();
      await service.from(TABLES.expenses).update({ deleted_at: new Date().toISOString() }).eq("id", (softDeletedRow as { id: string }).id);

      const { data: monthRow } = await service
        .from(VIEWS.expense_rollups)
        .select("total, entry_count")
        .eq("bucket", "month")
        .eq("period", "2031-08")
        .eq("entry_type", "expense")
        .eq("category", "Rent")
        .eq("account_id", accountId)
        .single();
      expect(Number((monthRow as { total: number }).total)).toBe(150);
      expect((monthRow as { entry_count: number }).entry_count).toBe(2);

      await service.from(TABLES.expenses).delete().in("id", [
        (confirmedA as { id: string }).id,
        (confirmedB as { id: string }).id,
        (draftRow as { id: string }).id,
        (softDeletedRow as { id: string }).id,
      ]);
      await service.from(TABLES.expense_accounts).delete().eq("id", accountId);
    });
  });
});

describeWithDb("denormalized sync points (SCHEMA.md 'keep in sync' table)", () => {
  let service: SupabaseClient;

  beforeAll(() => {
    service = createServiceClient();
  });

  test("smark_parts.total_qty recomputes on every movement/receive/adjust (trigger)", async () => {
    const part = await createTestPart(service);
    const box = await createTestBox(service);

    const { data: loc } = await service
      .from(TABLES.stock_locations)
      .insert({ part_id: part.id, big_box_id: box.boxId, qty: 20 })
      .select("id")
      .single();
    const locId = (loc as { id: string }).id;
    const { data: afterInsert } = await service.from(TABLES.parts).select("total_qty").eq("id", part.id).single();
    expect((afterInsert as { total_qty: number }).total_qty).toBe(20);

    await service.from(TABLES.stock_locations).update({ qty: 35 }).eq("id", locId);
    const { data: afterUpdate } = await service.from(TABLES.parts).select("total_qty").eq("id", part.id).single();
    expect((afterUpdate as { total_qty: number }).total_qty).toBe(35);

    await service.from(TABLES.stock_locations).delete().eq("id", locId);
    const { data: afterDelete } = await service.from(TABLES.parts).select("total_qty").eq("id", part.id).single();
    expect((afterDelete as { total_qty: number }).total_qty).toBe(0);

    await part.cleanup();
    await box.cleanup();
  });

  test.todo(
    "BOM sourcing_status follows its latest agent run; project card status derives from its BOMs [R2-03]",
    () => {
      // Not testable at the DB-schema layer yet. SCHEMA.md documents this as
      // an APPLICATION-level sync point ("run persist / mark-ordered" writes
      // sourcing_status; project status is a query-time derivation — "no
      // stored column needed") — there is no DB trigger or view computing
      // either value today. smark_boms.sourcing_status is a plain,
      // freely-settable column; nothing at the schema layer ties it to
      // smark_agent_runs. Convert once the run-persist/mark-ordered write
      // path (ordering-pipeline package) lands and this becomes an
      // application-level integration test, or once a DB view computing
      // project/BOM status is added.
    },
  );
});
