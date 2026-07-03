/**
 * worker/tests/idempotent-upsert.test.ts — same job's results written twice
 * (a re-claimed job re-running the ladder) must never duplicate
 * `smark_agent_results` rows (SCHEMA.md §4 comment on that table).
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertResult, upsertResults } from "../src/results";
import { cleanupRunFixture, createTestServiceClient, describeWithDb, seedRunFixture, type SeededRunFixture } from "./helpers";
import type { DistributorListingResult } from "../../types/worker";

function makeResult(bomLineId: string, distributorId: string, price: number): DistributorListingResult {
  return {
    bomLineId,
    distributorId,
    distributorName: "Digikey",
    price,
    currency: "INR",
    qtyBreaks: [{ qty: 1, unitPrice: price }],
    stockQty: 100,
    mpnMatch: "exact",
    packageMatch: true,
    partStatus: "active",
    orderLink: "https://example.invalid/part",
    isRecommended: true,
    confidence: 90,
    why: "test fixture",
    raw: { test: true },
  };
}

describeWithDb("results.ts — idempotent upsert", () => {
  let client: SupabaseClient;
  let fixture: SeededRunFixture;

  beforeEach(async () => {
    client = createTestServiceClient();
    fixture = await seedRunFixture(client, 1);
  });

  afterEach(async () => {
    await cleanupRunFixture(client, fixture);
  });

  test("writing the same (run, line, distributor) result twice yields exactly one row", async () => {
    const bomLineId = fixture.bomLineIds[0]!;
    await upsertResult(client, fixture.runId, makeResult(bomLineId, fixture.distributorId, 1.5));
    await upsertResult(client, fixture.runId, makeResult(bomLineId, fixture.distributorId, 1.5)); // simulates a re-claimed job re-running

    const rows = await client
      .from("smark_agent_results")
      .select("id,price")
      .eq("run_id", fixture.runId)
      .eq("bom_line_id", bomLineId)
      .eq("distributor_id", fixture.distributorId);

    expect(rows.error).toBeNull();
    expect((rows.data ?? []).length).toBe(1);
  });

  test("a second write with a DIFFERENT price updates the existing row in place", async () => {
    const bomLineId = fixture.bomLineIds[0]!;
    await upsertResult(client, fixture.runId, makeResult(bomLineId, fixture.distributorId, 1.5));
    await upsertResult(client, fixture.runId, makeResult(bomLineId, fixture.distributorId, 2.25));

    const rows = await client
      .from("smark_agent_results")
      .select("id,price")
      .eq("run_id", fixture.runId)
      .eq("bom_line_id", bomLineId)
      .eq("distributor_id", fixture.distributorId);

    expect((rows.data ?? []).length).toBe(1);
    expect(Number((rows.data as Array<{ price: number }>)[0]?.price)).toBe(2.25);
  });

  test("upsertResults processes a batch idempotently even with repeats in the same call", async () => {
    const bomLineId = fixture.bomLineIds[0]!;
    const result = makeResult(bomLineId, fixture.distributorId, 3);
    await upsertResults(client, fixture.runId, [result, result, result]);

    const rows = await client
      .from("smark_agent_results")
      .select("id")
      .eq("run_id", fixture.runId)
      .eq("bom_line_id", bomLineId)
      .eq("distributor_id", fixture.distributorId);

    expect((rows.data ?? []).length).toBe(1);
  });
});
