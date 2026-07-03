/**
 * worker/tests/helpers.ts — local-Supabase test harness for the worker
 * package. Deliberately NOT an import of `tests/helpers/supabase.ts` (root,
 * integrator-locked "Shared" file, and outside what `docs/OWNERSHIP.md`
 * lets `worker/**` import anyway) — this duplicates the same
 * "`.env.local` best-effort read → skip DB suites if unreachable" pattern
 * for exactly the same reason `worker/src/db.ts` duplicates row shapes
 * instead of importing `types/db.ts`. Keeps `bun test` (run from `worker/`)
 * green with or without `bunx supabase start`.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe } from "bun:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnvLocal(): void {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const path = resolve(process.cwd(), "..", ".env.local"); // bun test runs from worker/
  if (!existsSync(path)) return;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnvLocal();

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const hasLocalSupabase = url.length > 0 && serviceRoleKey.length > 0;

/** `describe` when the local stack is reachable, `describe.skip` otherwise. */
export const describeWithDb = hasLocalSupabase ? describe : describe.skip;

export function createTestServiceClient(): SupabaseClient {
  if (!hasLocalSupabase) {
    throw new Error("createTestServiceClient() called without a local Supabase stack — guard with describeWithDb.");
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface SeededRunFixture {
  projectId: string;
  bomId: string;
  bomLineIds: string[];
  runId: string;
  distributorId: string;
}

/** Minimal valid row chain (project → bom → bom_lines → agent_run) satisfying every FK the worker's own tables need. */
export async function seedRunFixture(client: SupabaseClient, lineCount: number): Promise<SeededRunFixture> {
  const project = await client
    .from("smark_projects")
    .insert({ name: `worker-test-project-${crypto.randomUUID()}` })
    .select()
    .single();
  if (project.error) throw new Error(`seedRunFixture: project insert failed: ${project.error.message}`);
  const projectId = (project.data as { id: string }).id;

  const bom = await client
    .from("smark_boms")
    .insert({ project_id: projectId, name: `worker-test-bom-${crypto.randomUUID()}`, build_qty: 1 })
    .select()
    .single();
  if (bom.error) throw new Error(`seedRunFixture: bom insert failed: ${bom.error.message}`);
  const bomId = (bom.data as { id: string }).id;

  const bomLineIds: string[] = [];
  for (let i = 0; i < lineCount; i += 1) {
    const line = await client
      .from("smark_bom_lines")
      .insert({ bom_id: bomId, line_no: i + 1, value: "10K", footprint: "R0603", match_state: "to_order" })
      .select()
      .single();
    if (line.error) throw new Error(`seedRunFixture: bom_line insert failed: ${line.error.message}`);
    bomLineIds.push((line.data as { id: string }).id);
  }

  const run = await client
    .from("smark_agent_runs")
    .insert({ bom_id: bomId, status: "planning", concurrency_preset: "balanced", fanout_width: 3, depth_per_item: 3, per_site_cap: 3 })
    .select()
    .single();
  if (run.error) throw new Error(`seedRunFixture: agent_run insert failed: ${run.error.message}`);
  const runId = (run.data as { id: string }).id;

  const distributor = await client.from("smark_distributors").select("id").eq("name", "Digikey").limit(1).maybeSingle();
  if (distributor.error) throw new Error(`seedRunFixture: distributor lookup failed: ${distributor.error.message}`);
  const distributorRow = distributor.data as { id: string } | null;
  if (!distributorRow) {
    throw new Error("seedRunFixture: no 'Digikey' row in smark_distributors — run `bunx supabase db reset` (seed.sql seeds it).");
  }

  return { projectId, bomId, bomLineIds, runId, distributorId: distributorRow.id };
}

/** Deletes a fixture in FK-safe order (run → bom_lines → bom → project). Best-effort — logs, never throws. */
export async function cleanupRunFixture(client: SupabaseClient, fixture: SeededRunFixture): Promise<void> {
  await client.from("smark_agent_results").delete().eq("run_id", fixture.runId);
  await client.from("smark_order_jobs").delete().eq("run_id", fixture.runId);
  await client.from("smark_agent_runs").delete().eq("id", fixture.runId);
  await client.from("smark_bom_lines").delete().eq("bom_id", fixture.bomId);
  await client.from("smark_boms").delete().eq("id", fixture.bomId);
  await client.from("smark_projects").delete().eq("id", fixture.projectId);
}

export async function insertJob(
  client: SupabaseClient,
  runId: string,
  bomLineId: string,
  plan: unknown = { bomLineId, distributorOrder: ["Digikey"], notes: null, ruleHit: null },
): Promise<string> {
  const insert = await client
    .from("smark_order_jobs")
    .insert({ run_id: runId, bom_line_id: bomLineId, plan, status: "queued" })
    .select()
    .single();
  if (insert.error) throw new Error(`insertJob failed: ${insert.error.message}`);
  return (insert.data as { id: string }).id;
}
