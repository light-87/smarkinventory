/**
 * worker/src/runs.ts — run-level lifecycle: reading the enqueue contract off
 * `smark_agent_runs.plan` (the `WorkerRunPlanColumn` envelope — see
 * types/worker.ts for the full contract this assumes bom-pipeline's
 * `lib/runs/**` enqueue action writes) and walking `status` forward
 * (`planning → running → review`; `failed` on any unrecoverable error —
 * A3 invariant: statuses only walk forward, never backward).
 */

import type { ClaudeMasterPlan, WorkerRunConfig, WorkerRunPlanColumn } from "../../types/worker";
import type { AgentRunRow, ServiceRoleClient } from "./db";

export interface PlanningRun {
  runId: string;
  config: WorkerRunConfig;
}

function isWorkerRunConfig(value: unknown): value is WorkerRunConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<WorkerRunConfig>;
  return (
    typeof v.runId === "string" &&
    typeof v.bomId === "string" &&
    Array.isArray(v.lines) &&
    Array.isArray(v.distributorSequence)
  );
}

/**
 * Runs the app has created (status "planning") but Opus hasn't planned yet.
 * A run whose `plan.config` doesn't parse is marked `failed` immediately
 * (with a clear reason) rather than polled forever — a malformed enqueue
 * payload is an integration bug, not a transient condition to retry.
 */
export async function fetchPlanningRuns(client: ServiceRoleClient, limit: number): Promise<PlanningRun[]> {
  const query = await client
    .from("smark_agent_runs")
    .select("*")
    .eq("status", "planning")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (query.error) throw new Error(`worker/runs: fetchPlanningRuns select failed: ${query.error.message}`);

  const result: PlanningRun[] = [];
  for (const row of (query.data ?? []) as AgentRunRow[]) {
    const envelope = row.plan as Partial<WorkerRunPlanColumn> | null;
    if (!envelope || !isWorkerRunConfig(envelope.config)) {
      await markRunFailed(
        client,
        row.id,
        "smark_agent_runs.plan.config did not match the WorkerRunConfig contract (types/worker.ts) — " +
          "check the enqueue action in lib/runs/** wrote the envelope shape documented there.",
      );
      continue;
    }
    result.push({ runId: row.id, config: envelope.config });
  }
  return result;
}

/** Writes the Opus output alongside the original config and flips `planning → running`. */
export async function saveMasterPlan(
  client: ServiceRoleClient,
  runId: string,
  config: WorkerRunConfig,
  masterPlan: ClaudeMasterPlan,
): Promise<void> {
  const envelope: WorkerRunPlanColumn = { config, masterPlan };
  const update = await client
    .from("smark_agent_runs")
    .update({ plan: envelope, status: "running" })
    .eq("id", runId)
    .eq("status", "planning"); // forward-only guard
  if (update.error) throw new Error(`worker/runs: saveMasterPlan failed for ${runId}: ${update.error.message}`);
}

export async function markRunFailed(client: ServiceRoleClient, runId: string, reason: string): Promise<void> {
  const update = await client
    .from("smark_agent_runs")
    .update({ status: "failed", plan: { failureReason: reason } })
    .eq("id", runId)
    .neq("status", "failed");
  if (update.error) throw new Error(`worker/runs: markRunFailed failed for ${runId}: ${update.error.message}`);
}

/**
 * FEATURES.md §15/§18 — "abort run past ceiling", writing `actual_cost`
 * either way (the caller has already been calling `addActualCost` as spend
 * happened; this just stops issuing NEW work for the run). Any job for this
 * run still sitting `queued` is marked `failed` so it's never silently
 * dropped nor picked up again; `actual_cost` itself is untouched here —
 * whatever was spent before the abort stays recorded.
 */
export async function abortRunForCostCeiling(client: ServiceRoleClient, runId: string, spentRupees: number, ceilingRupees: number): Promise<void> {
  const reason = `Aborted — ₹ ceiling reached (spent ₹${spentRupees.toFixed(2)} of ₹${ceilingRupees.toFixed(2)}).`;
  const jobsUpdate = await client
    .from("smark_order_jobs")
    .update({ status: "failed" })
    .eq("run_id", runId)
    .eq("status", "queued");
  if (jobsUpdate.error) throw new Error(`worker/runs: abortRunForCostCeiling job update failed for ${runId}: ${jobsUpdate.error.message}`);
  await markRunFailed(client, runId, reason);
}

/**
 * `running → review` once every one of the run's jobs has reached a
 * terminal state (done/failed) — the app's review screen takes it from
 * there; `review → done` is an app-side action (post human review), never
 * written by the worker.
 */
export async function markRunReviewIfComplete(client: ServiceRoleClient, runId: string): Promise<boolean> {
  const jobs = await client.from("smark_order_jobs").select("status").eq("run_id", runId);
  if (jobs.error) throw new Error(`worker/runs: job-status scan failed for ${runId}: ${jobs.error.message}`);
  const rows = (jobs.data ?? []) as Array<{ status: string }>;
  if (rows.length === 0) return false;
  const allTerminal = rows.every((r) => r.status === "done" || r.status === "failed");
  if (!allTerminal) return false;

  const update = await client
    .from("smark_agent_runs")
    .update({ status: "review" })
    .eq("id", runId)
    .eq("status", "running"); // forward-only guard
  if (update.error) throw new Error(`worker/runs: markRunReviewIfComplete update failed for ${runId}: ${update.error.message}`);
  return true;
}

/**
 * Any run's current config, regardless of status — used when dispatching a
 * claimed job whose run was planned on a previous poll tick (possibly a
 * previous process lifetime) so `index.ts` doesn't need to keep every
 * in-flight run's config resident in memory forever.
 */
export async function getRunConfig(client: ServiceRoleClient, runId: string): Promise<WorkerRunConfig> {
  const query = await client.from("smark_agent_runs").select("plan").eq("id", runId).single();
  if (query.error) throw new Error(`worker/runs: getRunConfig select failed for ${runId}: ${query.error.message}`);
  const envelope = (query.data as { plan: unknown }).plan as Partial<WorkerRunPlanColumn> | null;
  if (!envelope || !isWorkerRunConfig(envelope.config)) {
    throw new Error(`worker/runs: run ${runId} has no valid WorkerRunConfig in plan.config`);
  }
  return envelope.config;
}

/** Reads `smark_agent_runs.actual_cost` as it stands right now (0 if never spent) — used to seed a fresh `RunCostTracker` so accumulated spend survives a worker restart (R2-37 / FEATURES §15/§18). */
export async function getPersistedActualCost(client: ServiceRoleClient, runId: string): Promise<number> {
  const query = await client.from("smark_agent_runs").select("actual_cost").eq("id", runId).single();
  if (query.error) throw new Error(`worker/runs: getPersistedActualCost select failed for ${runId}: ${query.error.message}`);
  const row = query.data as { actual_cost: number | null };
  return row.actual_cost ?? 0;
}

/** Per-run write queues for `addActualCost` — see its own doc below. */
const costWriteQueues = new Map<string, Promise<void>>();

async function writeCostDelta(client: ServiceRoleClient, runId: string, deltaRupees: number): Promise<void> {
  const current = await client.from("smark_agent_runs").select("actual_cost").eq("id", runId).single();
  if (current.error) throw new Error(`worker/runs: addActualCost read failed for ${runId}: ${current.error.message}`);
  const row = current.data as { actual_cost: number | null };
  const next = (row.actual_cost ?? 0) + deltaRupees;
  const update = await client.from("smark_agent_runs").update({ actual_cost: next }).eq("id", runId);
  if (update.error) throw new Error(`worker/runs: addActualCost write failed for ${runId}: ${update.error.message}`);
}

/**
 * Read-add-write accumulator for `actual_cost` (AI-spend meter, R2-37).
 * `index.ts`'s `processQueuedJobs` runs up to `FANOUT_BATCH_LIMIT` item-agents
 * concurrently via `Promise.all`, and each finishing agent calls this for the
 * SAME `run_id` — two overlapping read-modify-writes would otherwise both
 * read the same base value and the second write clobbers the first (a lost
 * update that undercounts real spend and weakens the ₹-ceiling check that
 * reads this column). Calls for the same `runId` are serialized through a
 * per-run promise chain so each write's read sees the previous write's
 * result — closing the race for this service's actual deployed topology (one
 * worker process; Railway/Fly/Render "restart on crash", never horizontally
 * scaled). A true cross-process-safe atomic increment needs a SECURITY
 * DEFINER RPC (`update ... set actual_cost = coalesce(actual_cost,0) +
 * p_delta`) — schema is frozen for this package, so that's an
 * integrator-owned migration (see notes-for-integrator) if this ever runs as
 * more than one instance.
 */
export async function addActualCost(client: ServiceRoleClient, runId: string, deltaRupees: number): Promise<void> {
  if (deltaRupees <= 0) return;
  const previous = costWriteQueues.get(runId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => writeCostDelta(client, runId, deltaRupees));
  costWriteQueues.set(runId, next);
  try {
    await next;
  } finally {
    if (costWriteQueues.get(runId) === next) costWriteQueues.delete(runId);
  }
}
