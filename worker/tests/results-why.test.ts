/**
 * worker/tests/results-why.test.ts — the AI "why" narration must survive
 * into persistence even though `smark_agent_results` has no dedicated
 * column for it (worker/src/results.ts stashes it under `raw.why` as an
 * interim fix — see that file's module doc + this package's report finding
 * #2). `lib/runs/queries.ts`'s `resultWhy` reads `raw.why` first, before
 * falling back to a synthesized objective one-liner, specifically to pick
 * this up.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertResult } from "../src/results";
import { cleanupRunFixture, createTestServiceClient, describeWithDb, seedRunFixture, type SeededRunFixture } from "./helpers";
import type { DistributorListingResult } from "../../types/worker";

function makeResult(bomLineId: string, distributorId: string, why: string, raw: unknown): DistributorListingResult {
  return {
    bomLineId,
    distributorId,
    distributorName: "Digikey",
    price: 1.5,
    currency: "INR",
    qtyBreaks: [],
    stockQty: 50,
    mpnMatch: "exact",
    packageMatch: true,
    partStatus: "active",
    orderLink: "https://example.invalid/part",
    isRecommended: true,
    confidence: 90,
    why,
    raw,
  };
}

describeWithDb("results.ts — 'why' narration persistence", () => {
  let client: SupabaseClient;
  let fixture: SeededRunFixture;

  beforeEach(async () => {
    client = createTestServiceClient();
    fixture = await seedRunFixture(client, 1);
  });

  afterEach(async () => {
    await cleanupRunFixture(client, fixture);
  });

  test("the computed 'why' string survives into raw.why, alongside the original raw payload's own fields", async () => {
    const bomLineId = fixture.bomLineIds[0]!;
    const why = "exact MPN match, package matches, lowest-cost option meeting the ladder's requirements.";
    await upsertResult(client, fixture.runId, makeResult(bomLineId, fixture.distributorId, why, { sku: "ABC123" }));

    const row = await client
      .from("smark_agent_results")
      .select("raw")
      .eq("run_id", fixture.runId)
      .eq("bom_line_id", bomLineId)
      .eq("distributor_id", fixture.distributorId)
      .single();

    expect(row.error).toBeNull();
    const raw = row.data?.raw as { why?: string; sku?: string } | null;
    expect(raw?.why).toBe(why);
    expect(raw?.sku).toBe("ABC123");
  });

  test("a non-object raw payload (defensive case) is wrapped rather than dropping 'why'", async () => {
    const bomLineId = fixture.bomLineIds[0]!;
    const why = "no MPN match, package does not match.";
    await upsertResult(client, fixture.runId, makeResult(bomLineId, fixture.distributorId, why, "unexpected string payload"));

    const row = await client
      .from("smark_agent_results")
      .select("raw")
      .eq("run_id", fixture.runId)
      .eq("bom_line_id", bomLineId)
      .eq("distributor_id", fixture.distributorId)
      .single();

    const raw = row.data?.raw as { why?: string; rawValue?: unknown } | null;
    expect(raw?.why).toBe(why);
    expect(raw?.rawValue).toBe("unexpected string payload");
  });

  test("updating an existing row (idempotent re-run) also carries the new 'why' forward", async () => {
    const bomLineId = fixture.bomLineIds[0]!;
    await upsertResult(client, fixture.runId, makeResult(bomLineId, fixture.distributorId, "first pass reasoning.", { sku: "ABC123" }));
    await upsertResult(client, fixture.runId, makeResult(bomLineId, fixture.distributorId, "second pass reasoning.", { sku: "ABC123" }));

    const row = await client
      .from("smark_agent_results")
      .select("raw")
      .eq("run_id", fixture.runId)
      .eq("bom_line_id", bomLineId)
      .eq("distributor_id", fixture.distributorId)
      .single();

    const raw = row.data?.raw as { why?: string } | null;
    expect(raw?.why).toBe("second pass reasoning.");
  });
});
