/**
 * worker/tests/claim.test.ts — atomic claim (two+ concurrent claimers, no
 * double-claim) + stale-claim release, against local Supabase.
 *
 * `claimNextJobs` claims GLOBALLY (any run's queued jobs), and bun may
 * interleave other DB test files' fixtures with this one — so every
 * assertion filters to THIS fixture's run and claims with generous limits,
 * instead of assuming this file's jobs are the only queued rows in the DB
 * (they repeatedly weren't — recurring "expected 4, received 6" flake).
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { claimNextJobs, MAX_CLAIM_ATTEMPTS, releaseStaleClaims } from "../src/claim";
import { cleanupRunFixture, createTestServiceClient, describeWithDb, insertJob, seedRunFixture, type SeededRunFixture } from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

describeWithDb("claim.ts — atomic claim", () => {
  let client: SupabaseClient;
  let fixture: SeededRunFixture;

  beforeEach(async () => {
    client = createTestServiceClient();
    fixture = await seedRunFixture(client, 6);
    for (const bomLineId of fixture.bomLineIds) {
      await insertJob(client, fixture.runId, bomLineId);
    }
  });

  afterEach(async () => {
    await cleanupRunFixture(client, fixture);
  });

  test("N concurrent claimers never double-claim, and every job of this run gets claimed", async () => {
    // 6 claimers × 3 slots = 18 capacity — enough slack to absorb a few
    // foreign queued jobs from concurrently-running test files.
    const claimers = Array.from({ length: 6 }, () => claimNextJobs(client, 3));
    const results = await Promise.all(claimers);
    const mine = results.flat().filter((job) => job.runId === fixture.runId);

    expect(mine.length).toBe(6); // every one of THIS run's jobs claimed exactly once
    expect(new Set(mine.map((job) => job.jobId)).size).toBe(6); // no job id appears twice

    const rows = await client.from("smark_order_jobs").select("id,status").eq("run_id", fixture.runId);
    expect(rows.error).toBeNull();
    const statuses = (rows.data ?? []) as Array<{ status: string }>;
    expect(statuses.every((r) => r.status === "claimed")).toBe(true);
  });

  test("claiming more than available returns only what's queued", async () => {
    const first = (await claimNextJobs(client, 30)).filter((j) => j.runId === fixture.runId);
    expect(first.length).toBe(6); // the generous limit drained this run entirely
    const second = (await claimNextJobs(client, 30)).filter((j) => j.runId === fixture.runId);
    expect(second.length).toBe(0); // nothing of ours left to claim
  });

  test("a job's plannedSearch round-trips through the plan column", async () => {
    const claimed = (await claimNextJobs(client, 30)).filter((j) => j.runId === fixture.runId);
    expect(claimed.length).toBe(6);
    expect(claimed[0]?.plannedSearch?.distributorOrder).toEqual(["Digikey"]);
  });
});

describeWithDb("claim.ts — stale-claim release", () => {
  let client: SupabaseClient;
  let fixture: SeededRunFixture;

  beforeEach(async () => {
    client = createTestServiceClient();
    fixture = await seedRunFixture(client, 2);
  });

  afterEach(async () => {
    await cleanupRunFixture(client, fixture);
  });

  test("a claim older than the stale timeout is requeued", async () => {
    const jobId = await insertJob(client, fixture.runId, fixture.bomLineIds[0]!);
    const ancientTimestamp = new Date(Date.now() - 60 * 60_000).toISOString(); // 1 hour ago
    const setStale = await client
      .from("smark_order_jobs")
      .update({ status: "claimed", claimed_at: ancientTimestamp, attempts: 1 })
      .eq("id", jobId);
    expect(setStale.error).toBeNull();

    const result = await releaseStaleClaims(client);
    expect(result.requeued).toBeGreaterThanOrEqual(1);

    const after = await client.from("smark_order_jobs").select("status,claimed_at").eq("id", jobId).single();
    expect(after.data?.status).toBe("queued");
    expect(after.data?.claimed_at).toBeNull();
  });

  test("a stale claim past MAX_CLAIM_ATTEMPTS is marked failed instead of recycled", async () => {
    const jobId = await insertJob(client, fixture.runId, fixture.bomLineIds[1]!);
    const ancientTimestamp = new Date(Date.now() - 60 * 60_000).toISOString();
    const setStale = await client
      .from("smark_order_jobs")
      .update({ status: "claimed", claimed_at: ancientTimestamp, attempts: MAX_CLAIM_ATTEMPTS })
      .eq("id", jobId);
    expect(setStale.error).toBeNull();

    const result = await releaseStaleClaims(client);
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const after = await client.from("smark_order_jobs").select("status").eq("id", jobId).single();
    expect(after.data?.status).toBe("failed");
  });

  test("a fresh claim is left alone", async () => {
    const jobId = await insertJob(client, fixture.runId, fixture.bomLineIds[0]!);
    const claimNow = await client
      .from("smark_order_jobs")
      .update({ status: "claimed", claimed_at: new Date().toISOString(), attempts: 1 })
      .eq("id", jobId);
    expect(claimNow.error).toBeNull();

    await releaseStaleClaims(client);

    const after = await client.from("smark_order_jobs").select("status").eq("id", jobId).single();
    expect(after.data?.status).toBe("claimed");
  });
});
