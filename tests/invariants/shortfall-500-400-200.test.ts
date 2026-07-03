import { afterAll, beforeAll, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../helpers/supabase";
import { type TestActor, type TestBox, createTestActor, createTestBox, createTestPart, describeDb } from "./fixtures";
import { recomputeShortfallCartItems } from "@/lib/orders/demand";
import { TABLES, VIEWS, type CartItemRow, type PartDemandRow } from "@/types/db";

/**
 * INVARIANT — the client's permanent shortfall example (FEATURES.md §16:
 * "Client's own example is a permanent test: 500 avail / 400 + 200
 * demanded → auto cart line of exactly 100." · plan/TESTING.md §1 principle
 * 5 + §3 E2E-3 · CROSS-FEATURE.md R2-09/10/12). This file pins that exact
 * scenario plus the Q-05 lifecycle rules around it (recompute triggers,
 * dismissal-resurrect, archive release) so the canonical numbers can never
 * silently drift as the demand engine evolves.
 * Canonical shape: SCHEMA.md `v_part_demand` [R2-10 · Q-05 FINAL] — demand =
 * Σ(line qty × bom.build_qty) over matched lines in active, reconciled BOMs
 * of non-archived projects (per-project breakdown); available = total_qty;
 * shortfall = GREATEST(demand − available, 0). Shortfall > 0 with no open
 * auto line → insert `smark_cart_items` (source=auto_shortfall). Recompute
 * on: reconcile, BOM upload/archive, movements, build_qty change.
 * Applies at: unit (view/demand math — the primary home for this test),
 * API (reconcile route), E2E-3 ("shortfall example: 500/400/200 → exactly
 * 100 auto-line").
 *
 * DB-backed (`describeDb` — self-skips without a local Supabase stack, same
 * gate as tests/invariants/undo-pairing.test.ts). Each test builds its OWN
 * fresh part/2-project/2-BOM/2-line scenario off the canonical baseline
 * (500 avail, A needs 400, B needs 200) rather than chaining state across
 * tests — the build_qty/arrival/archive branches below are independent
 * mutations of that SAME baseline, not a single continuously-mutated story
 * (the exact numbers in each test's name only work out starting from the
 * untouched baseline). `recomputeShortfallCartItems` (lib/orders/demand.ts)
 * is exercised directly — it's the real function `app/(app)/cart/page.tsx`
 * calls on every load.
 */
describeDb("invariant: 500/400/200 → 100 shortfall (client's permanent example)", () => {
  let service: SupabaseClient;
  let actor: TestActor;
  let box: TestBox;

  beforeAll(async () => {
    service = createServiceClient();
    actor = await createTestActor(service, "owner");
    box = await createTestBox(service);
  });

  afterAll(async () => {
    await box.cleanup();
    await actor.cleanup();
  });

  function tag(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  interface Scenario {
    partId: string;
    projectAId: string;
    projectBId: string;
    bomAId: string;
    lineAId: string;
    cleanup: () => Promise<void>;
  }

  /** The canonical baseline: 500 available; Project A needs 400, Project B needs 200 (both build_qty=1). */
  async function buildCanonicalScenario(): Promise<Scenario> {
    const part = await createTestPart(service);
    const { error: locError } = await service
      .from(TABLES.stock_locations)
      .insert({ part_id: part.id, big_box_id: box.boxId, qty: 500, created_by: actor.id });
    if (locError) throw new Error(`scenario: stock location insert failed: ${locError.message}`);

    const suffix = tag();
    const { data: projectA, error: paError } = await service
      .from(TABLES.projects)
      .insert({ name: `ShortfallA-${suffix}`, created_by: actor.id })
      .select("id")
      .single();
    if (paError || !projectA) throw new Error(`scenario: project A insert failed: ${paError?.message}`);
    const { data: projectB, error: pbError } = await service
      .from(TABLES.projects)
      .insert({ name: `ShortfallB-${suffix}`, created_by: actor.id })
      .select("id")
      .single();
    if (pbError || !projectB) throw new Error(`scenario: project B insert failed: ${pbError?.message}`);

    const { data: bomA, error: baError } = await service
      .from(TABLES.boms)
      .insert({ project_id: projectA.id, name: "Mainboard", build_qty: 1, uploaded_by: actor.id })
      .select("id")
      .single();
    if (baError || !bomA) throw new Error(`scenario: BOM A insert failed: ${baError?.message}`);
    const { data: bomB, error: bbError } = await service
      .from(TABLES.boms)
      .insert({ project_id: projectB.id, name: "Mainboard", build_qty: 1, uploaded_by: actor.id })
      .select("id")
      .single();
    if (bbError || !bomB) throw new Error(`scenario: BOM B insert failed: ${bbError?.message}`);

    const { data: lineA, error: laError } = await service
      .from(TABLES.bom_lines)
      .insert({ bom_id: bomA.id, qty: 400, matched_part_id: part.id, dnp: false })
      .select("id")
      .single();
    if (laError || !lineA) throw new Error(`scenario: line A insert failed: ${laError?.message}`);
    const { error: lbError } = await service
      .from(TABLES.bom_lines)
      .insert({ bom_id: bomB.id, qty: 200, matched_part_id: part.id, dnp: false });
    if (lbError) throw new Error(`scenario: line B insert failed: ${lbError.message}`);

    return {
      partId: part.id,
      projectAId: projectA.id,
      projectBId: projectB.id,
      bomAId: bomA.id,
      lineAId: lineA.id,
      cleanup: async () => {
        await service.from(TABLES.cart_items).delete().eq("part_id", part.id);
        await service.from(TABLES.projects).delete().eq("id", projectA.id); // cascades bomA + lineA
        await service.from(TABLES.projects).delete().eq("id", projectB.id); // cascades bomB + lineB
        await part.cleanup();
      },
    };
  }

  async function getPartDemand(partId: string): Promise<PartDemandRow | null> {
    const { data, error } = await service.from(VIEWS.part_demand).select("*").eq("part_id", partId).maybeSingle();
    if (error) throw new Error(`getPartDemand failed: ${error.message}`);
    return (data as PartDemandRow | null) ?? null;
  }

  async function getActiveCartItem(partId: string): Promise<CartItemRow | null> {
    const { data, error } = await service
      .from(TABLES.cart_items)
      .select("*")
      .eq("part_id", partId)
      .in("status", ["open", "dismissed"])
      .maybeSingle();
    if (error) throw new Error(`getActiveCartItem failed: ${error.message}`);
    return (data as CartItemRow | null) ?? null;
  }

  test(
    "canonical case: part with total_qty=500; Project A's active reconciled BOM needs 400 of it, Project B's active reconciled BOM needs 200 of it → v_part_demand.shortfall === 100 (exactly GREATEST(400+200-500, 0))",
    async () => {
      const scenario = await buildCanonicalScenario();
      try {
        const demand = await getPartDemand(scenario.partId);
        expect(demand).not.toBeNull();
        expect(demand!.demand).toBe(600);
        expect(demand!.available).toBe(500);
        expect(demand!.shortfall).toBe(100);
      } finally {
        await scenario.cleanup();
      }
    },
  );

  test(
    "the canonical case auto-creates EXACTLY ONE smark_cart_items row: source='auto_shortfall', qty_to_order=100 — not two lines, not a line per project",
    async () => {
      const scenario = await buildCanonicalScenario();
      try {
        await recomputeShortfallCartItems(service);
        const { data: items, error } = await service.from(TABLES.cart_items).select("*").eq("part_id", scenario.partId);
        if (error) throw error;
        expect(items).toHaveLength(1);
        expect(items![0]!.source).toBe("auto_shortfall");
        expect(items![0]!.qty_to_order).toBe(100);
        expect(items![0]!.status).toBe("open");
      } finally {
        await scenario.cleanup();
      }
    },
  );

  test(
    "the auto line's demand jsonb breaks down per-project as [{project: A, qty: 400}, {project: B, qty: 200}] — the full per-project demand, not just the 100 shortfall",
    async () => {
      const scenario = await buildCanonicalScenario();
      try {
        await recomputeShortfallCartItems(service);
        const item = await getActiveCartItem(scenario.partId);
        expect(item).not.toBeNull();
        const byProject = new Map(item!.demand.map((slice) => [slice.project_id, slice.qty]));
        expect(byProject.get(scenario.projectAId)).toBe(400);
        expect(byProject.get(scenario.projectBId)).toBe(200);
      } finally {
        await scenario.cleanup();
      }
    },
  );

  test(
    "build_qty change: doubling Project A's build_qty (need becomes 800+200=1000 against 500 available) recomputes shortfall to exactly 500 on the SAME cart line, not a second one [R2-27]",
    async () => {
      const scenario = await buildCanonicalScenario();
      try {
        await recomputeShortfallCartItems(service);
        const before = await getActiveCartItem(scenario.partId);
        expect(before).not.toBeNull();

        const { error } = await service.from(TABLES.boms).update({ build_qty: 2 }).eq("id", scenario.bomAId);
        if (error) throw error;

        const demand = await getPartDemand(scenario.partId);
        expect(demand!.shortfall).toBe(500);

        await recomputeShortfallCartItems(service);
        const after = await getActiveCartItem(scenario.partId);
        expect(after).not.toBeNull();
        expect(after!.id).toBe(before!.id);
        expect(after!.qty_to_order).toBe(500);

        const { data: allItems } = await service.from(TABLES.cart_items).select("id").eq("part_id", scenario.partId);
        expect(allItems).toHaveLength(1);
      } finally {
        await scenario.cleanup();
      }
    },
  );

  test(
    "arrival: stock arriving to bring total_qty to 600 (500+100) recomputes shortfall to exactly 0 and releases/closes the auto line — it is not left open at qty 100",
    async () => {
      const scenario = await buildCanonicalScenario();
      try {
        await recomputeShortfallCartItems(service);
        expect(await getActiveCartItem(scenario.partId)).not.toBeNull();

        const { error } = await service.from(TABLES.stock_locations).update({ qty: 600 }).eq("part_id", scenario.partId);
        if (error) throw error;

        const demand = await getPartDemand(scenario.partId);
        expect(demand!.available).toBe(600);
        expect(demand!.shortfall).toBe(0);

        await recomputeShortfallCartItems(service);
        expect(await getActiveCartItem(scenario.partId)).toBeNull();
      } finally {
        await scenario.cleanup();
      }
    },
  );

  test(
    "partial release: bulk-picking against Project A's BOM line releases only Project A's portion of demand — shortfall recomputes to reflect Project B's 200 alone, not an all-or-nothing reset",
    async () => {
      const scenario = await buildCanonicalScenario();
      try {
        await recomputeShortfallCartItems(service);
        expect(await getActiveCartItem(scenario.partId)).not.toBeNull();

        // Simulates the effect of a bulk-takeout completion on Project A's line
        // (owned by the takeout package, not this one): its outstanding need
        // drops to 0, which drops out of v_part_demand's `bl.qty > 0` join —
        // Project B's line is completely untouched.
        const { error } = await service.from(TABLES.bom_lines).update({ qty: 0 }).eq("id", scenario.lineAId);
        if (error) throw error;

        const demand = await getPartDemand(scenario.partId);
        expect(demand?.demand ?? 0).toBe(200);
        expect(demand?.shortfall ?? 0).toBe(0);
        if (demand) {
          const projectIds = new Set(demand.breakdown.map((slice) => slice.project_id));
          expect(projectIds.has(scenario.projectAId)).toBe(false);
          expect(projectIds.has(scenario.projectBId)).toBe(true);
        }

        await recomputeShortfallCartItems(service);
        expect(await getActiveCartItem(scenario.partId)).toBeNull();
      } finally {
        await scenario.cleanup();
      }
    },
  );

  test(
    "dismissal-resurrect: an auto line dismissed at shortfall=100 resurrects when demand grows to shortfall=150 (grows beyond the dismissed qty) [Q-05]",
    async () => {
      const scenario = await buildCanonicalScenario();
      try {
        await recomputeShortfallCartItems(service);
        const item = await getActiveCartItem(scenario.partId);
        expect(item).not.toBeNull();
        const { error: dismissError } = await service.from(TABLES.cart_items).update({ status: "dismissed" }).eq("id", item!.id);
        if (dismissError) throw dismissError;

        // Grows Project A's need 400 → 450: demand 650, shortfall 150 (> the dismissed qty of 100).
        const { error } = await service.from(TABLES.bom_lines).update({ qty: 450 }).eq("id", scenario.lineAId);
        if (error) throw error;

        await recomputeShortfallCartItems(service);
        const after = await getActiveCartItem(scenario.partId);
        expect(after).not.toBeNull();
        expect(after!.id).toBe(item!.id);
        expect(after!.status).toBe("open");
        expect(after!.qty_to_order).toBe(150);
      } finally {
        await scenario.cleanup();
      }
    },
  );

  test(
    "dismissal stays dismissed: an auto line dismissed at shortfall=100 does NOT resurrect if demand later recomputes to shortfall=100 or less (no growth beyond the dismissed qty)",
    async () => {
      const scenario = await buildCanonicalScenario();
      try {
        await recomputeShortfallCartItems(service);
        const item = await getActiveCartItem(scenario.partId);
        expect(item).not.toBeNull();
        const { error: dismissError } = await service.from(TABLES.cart_items).update({ status: "dismissed" }).eq("id", item!.id);
        if (dismissError) throw dismissError;

        // No demand change — shortfall recomputes to the same 100, not beyond it.
        await recomputeShortfallCartItems(service);
        const after = await getActiveCartItem(scenario.partId);
        expect(after).not.toBeNull();
        expect(after!.id).toBe(item!.id);
        expect(after!.status).toBe("dismissed");
        expect(after!.qty_to_order).toBe(100);
      } finally {
        await scenario.cleanup();
      }
    },
  );

  test(
    "archive release: archiving Project B (its 200 demand) recomputes shortfall to GREATEST(400-500, 0) = 0 and closes the auto line, even though Project A's BOM is untouched [R2-32]",
    async () => {
      const scenario = await buildCanonicalScenario();
      try {
        await recomputeShortfallCartItems(service);
        expect(await getActiveCartItem(scenario.partId)).not.toBeNull();

        const { error } = await service
          .from(TABLES.projects)
          .update({ archived_at: new Date().toISOString() })
          .eq("id", scenario.projectBId);
        if (error) throw error;

        const demand = await getPartDemand(scenario.partId);
        expect(demand?.demand ?? 0).toBe(400);
        expect(demand?.shortfall ?? 0).toBe(0);

        await recomputeShortfallCartItems(service);
        expect(await getActiveCartItem(scenario.partId)).toBeNull();
      } finally {
        await scenario.cleanup();
      }
    },
  );
});
