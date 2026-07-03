import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, hasLocalSupabase } from "../helpers/supabase";
import { createTestActor, type TestActor } from "../invariants/fixtures";
import { getOrderingActivityForRange } from "@/lib/daily/queries";
import { TABLES } from "@/types/db";

/**
 * Finding #6 — `lib/daily/queries.ts`'s "run finished" activity label used a
 * raw `₹${r.actual_cost}` (no fixed decimals, no en-IN grouping at all) —
 * the worst of the four call sites the finding flagged, since it wasn't even
 * `.toFixed(2)`'d. Must go through the shared `formatINR`.
 *
 * `describe.skip` (not the sibling `describeDb`) mirrors
 * tests/integration/receive-core.test.ts's inline gate — a skipped
 * describe's body still runs in Bun, so building a service client eagerly
 * would throw with no local stack configured.
 */
const describeDb = hasLocalSupabase ? describe : describe.skip;

describeDb("lib/daily/queries getOrderingActivityForRange — run-finished cost formatting", () => {
  let service: SupabaseClient;
  let actor: TestActor;

  beforeAll(async () => {
    service = createServiceClient();
    actor = await createTestActor(service, "owner");
  });

  afterAll(async () => {
    await actor.cleanup();
  });

  function tag(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  test(
    "a lakh-scale actual_cost renders with full en-IN grouping in the 'run finished' feed label, not a raw unformatted number",
    async () => {
      const { data: project, error: projError } = await service
        .from(TABLES.projects)
        .insert({ name: `RunCostFmt-${tag()}`, created_by: actor.id })
        .select("id")
        .single();
      if (projError || !project) throw new Error(`project insert failed: ${projError?.message}`);

      const bomName = `B-${tag()}`;
      const { data: bom, error: bomError } = await service
        .from(TABLES.boms)
        .insert({ project_id: project.id, name: bomName, build_qty: 1, uploaded_by: actor.id })
        .select("id")
        .single();
      if (bomError || !bom) throw new Error(`bom insert failed: ${bomError?.message}`);

      const runId = randomUUID();
      const now = new Date();
      // 125000 formatted must be "1,25,000.00" (en-IN lakh grouping) — the old
      // `₹${r.actual_cost}` bug would have rendered the raw "125000" with no
      // decimals and no grouping at all.
      const { error: runError } = await service.from(TABLES.agent_runs).insert({
        id: runId,
        bom_id: bom.id,
        status: "done",
        concurrency_preset: "balanced",
        fanout_width: 3,
        depth_per_item: 3,
        per_site_cap: 2,
        est_cost: 125000,
        actual_cost: 125000,
        started_by: actor.id,
        updated_at: now.toISOString(),
      });
      if (runError) throw new Error(`agent_run insert failed: ${runError.message}`);

      try {
        const bounds = {
          startIso: new Date(now.getTime() - 60_000).toISOString(),
          endIso: new Date(now.getTime() + 60_000).toISOString(),
        };
        const items = await getOrderingActivityForRange(service, bounds, actor.id);
        const finished = items.find((i) => i.id === `${runId}-finished`);
        expect(finished).toBeDefined();
        expect(finished!.label).toBe(`run done · ₹1,25,000.00 · ${bomName}`);
        expect(finished!.label).not.toContain("₹125000"); // the old raw, ungrouped number (no decimals, no grouping)
      } finally {
        await service.from(TABLES.agent_runs).delete().eq("id", runId);
        await service.from(TABLES.projects).delete().eq("id", project.id); // cascades the bom
      }
    },
  );
});
