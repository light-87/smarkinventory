/**
 * worker/tests/runs-cost.test.ts — `smark_agent_runs.actual_cost`
 * accumulation (worker/src/runs.ts `addActualCost` / `getPersistedActualCost`,
 * R2-37 / FEATURES §15/§18). DB-backed — exercises the real read-modify-write
 * path (and its per-run serialization fix) against local Supabase, not a
 * mock.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addActualCost, getPersistedActualCost } from "../src/runs";
import { cleanupRunFixture, createTestServiceClient, describeWithDb, seedRunFixture, type SeededRunFixture } from "./helpers";

describeWithDb("runs.ts — actual_cost accumulation", () => {
  let client: SupabaseClient;
  let fixture: SeededRunFixture;

  beforeEach(async () => {
    client = createTestServiceClient();
    fixture = await seedRunFixture(client, 1);
  });

  afterEach(async () => {
    await cleanupRunFixture(client, fixture);
  });

  test("getPersistedActualCost reads 0 for a freshly-created run (actual_cost starts null)", async () => {
    expect(await getPersistedActualCost(client, fixture.runId)).toBe(0);
  });

  test("a single addActualCost call adds its delta", async () => {
    await addActualCost(client, fixture.runId, 12.5);
    expect(await getPersistedActualCost(client, fixture.runId)).toBeCloseTo(12.5);
  });

  test("many concurrent addActualCost calls for the SAME run never lose an update — serialized per run_id", async () => {
    // Without serialization this is a classic lost-update race: every call
    // reads the same base value over the network before any of them write
    // it back, so only the LAST write to land survives instead of the sum.
    // 20 concurrent callers (well above worker/index.ts's own
    // FANOUT_BATCH_LIMIT=8) makes the race close to certain if the fix
    // regresses.
    const deltas = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
    const expectedTotal = deltas.reduce((sum, d) => sum + d, 0); // 210

    await Promise.all(deltas.map((delta) => addActualCost(client, fixture.runId, delta)));

    expect(await getPersistedActualCost(client, fixture.runId)).toBeCloseTo(expectedTotal);
  });

  test("a non-positive delta is a no-op", async () => {
    await addActualCost(client, fixture.runId, 5);
    await addActualCost(client, fixture.runId, 0);
    await addActualCost(client, fixture.runId, -3);
    expect(await getPersistedActualCost(client, fixture.runId)).toBeCloseTo(5);
  });
});
