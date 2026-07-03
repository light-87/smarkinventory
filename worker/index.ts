#!/usr/bin/env bun
/**
 * worker/index.ts — SmarkStock Browser-Worker service entry point.
 *
 * ── What this is ────────────────────────────────────────────────────────
 * The always-on job-claim service from FEATURES.md §4/§15: polls
 * `smark_agent_runs` for newly-enqueued runs (status "planning"), calls
 * Opus ONCE per run for a search plan, then polls `smark_order_jobs` and
 * fans out Sonnet item-agents across the configured distributor sequence
 * (REST clients + the Phase-0-gated BrowserDriver), writing
 * `smark_agent_results` idempotently as it goes.
 *
 * ── Deploy (Railway / Fly / Render) ─────────────────────────────────────
 * This is a standalone Bun package — its own `worker/package.json`, no
 * Next.js. Deploy as a long-running worker process (NOT a web service; the
 * tiny HTTP surface below is a health/status check, not the product):
 *   Build:  cd worker && bun install
 *   Start:  cd worker && bun run start        (== `bun run index.ts`)
 *   Env:    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_SHARED_SECRET,
 *           ANTHROPIC_API_KEY? (mock mode without it), BROWSER_DRIVER?,
 *           CLAUDE_MODEL_MASTER, CLAUDE_MODEL_ITEM, DIGIKEY_CLIENT_ID/SECRET,
 *           MOUSER_API_KEY, ELEMENT14_API_KEY — see worker/src/env.ts.
 * Railway/Fly/Render all support "one process, restart on crash" — that's
 * this service's entire operational model; `releaseStaleClaims()` below is
 * what makes a crash mid-item safe (the stuck job is requeued, never lost).
 *
 * ── Enqueue contract this expects from the app ──────────────────────────
 * See `types/worker.ts`'s `WorkerRunPlanColumn` doc — this file's job starts
 * once `smark_agent_runs` rows (status "planning", `plan.config` populated)
 * and their `smark_order_jobs` rows (status "queued") already exist.
 */

import { createSiteSemaphore, estimateNextCallRupees, RunCostTracker } from "./src/caps";
import { attachPlanToJob, claimNextJobs, completeJob, markJobSkipped, releaseStaleClaims } from "./src/claim";
import { AnthropicRestClaudePort, type ClaudePort } from "./src/claude-port";
import { createBrowserDriver, type BrowserDriver } from "./src/browser-driver";
import { createServiceRoleClient, type ServiceRoleClient } from "./src/db";
import { createDistributorClient } from "./src/distributors";
import type { DistributorClient } from "./src/distributors/types";
import { loadEnv, type WorkerEnv } from "./src/env";
import { runItemAgent } from "./src/item-agent";
import { planRun } from "./src/planner";
import {
  abortRunForCostCeiling,
  addActualCost,
  fetchPlanningRuns,
  getPersistedActualCost,
  getRunConfig,
  markRunReviewIfComplete,
  saveMasterPlan,
} from "./src/runs";
import { upsertResults } from "./src/results";
import type { ClaimedJob, ConcurrencyPreset, WorkerRunConfig } from "../types/worker";
import { resolveTier } from "./src/caps";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 3000);
const FANOUT_BATCH_LIMIT = 8; // absolute ceiling on jobs claimed per tick — see caps.ts MAX_FANOUT_WIDTH

interface RuntimeState {
  env: WorkerEnv;
  client: ServiceRoleClient;
  claudePort: ClaudePort | undefined;
  browserDriver: BrowserDriver | null;
  siteSemaphore: ReturnType<typeof createSiteSemaphore>;
  distributorClients: Map<string, DistributorClient>;
  costTrackers: Map<string, RunCostTracker>;
  runConfigCache: Map<string, WorkerRunConfig>;
  runsTouchedThisTick: Set<string>;
}

function buildRuntime(env: WorkerEnv): RuntimeState {
  return {
    env,
    client: createServiceRoleClient(env),
    claudePort: env.anthropicApiKey ? new AnthropicRestClaudePort(env.anthropicApiKey) : undefined,
    browserDriver: env.browserDriver ? createBrowserDriver(env.browserDriver) : null,
    siteSemaphore: createSiteSemaphore(),
    distributorClients: new Map(),
    costTrackers: new Map(),
    runConfigCache: new Map(),
    runsTouchedThisTick: new Set(),
  };
}

function getDistributorClient(state: RuntimeState, name: string, apiType: "rest" | "browse" | "none"): DistributorClient {
  const cached = state.distributorClients.get(name);
  if (cached) return cached;
  const client = createDistributorClient({ name, apiType }, state.env, state.browserDriver);
  state.distributorClients.set(name, client);
  return client;
}

/**
 * First creation of a run's tracker in this process's lifetime seeds it from
 * the persisted `actual_cost` (R2-37 / FEATURES §15/§18) — otherwise a
 * worker restart mid-run resets the in-memory tally to 0 while the DB's
 * spend survives, letting the run spend up to a full ceiling again per
 * restart. Subsequent calls reuse the same in-memory tracker (no repeat DB
 * read) exactly as before.
 */
async function getCostTracker(state: RuntimeState, runId: string, ceilingRupees: number): Promise<RunCostTracker> {
  let tracker = state.costTrackers.get(runId);
  if (!tracker) {
    const persistedSpend = await getPersistedActualCost(state.client, runId);
    tracker = new RunCostTracker(ceilingRupees, persistedSpend);
    state.costTrackers.set(runId, tracker);
  }
  return tracker;
}

async function processPlanningRuns(state: RuntimeState): Promise<void> {
  const planningRuns = await fetchPlanningRuns(state.client, 3);
  for (const { runId, config } of planningRuns) {
    try {
      const { plan, cost } = await planRun(state.env, config, state.claudePort);

      for (const search of plan.searches) {
        await attachPlanToJob(state.client, runId, search.bomLineId, search);
      }
      for (const skip of plan.skip) {
        await markJobSkipped(state.client, runId, skip.bomLineId);
      }

      await saveMasterPlan(state.client, runId, config, plan);
      state.runConfigCache.set(runId, config);
      const tracker = await getCostTracker(state, runId, config.rupeeCeiling);
      tracker.record(cost.estimatedRupees);
      if (cost.estimatedRupees > 0) await addActualCost(state.client, runId, cost.estimatedRupees);
      state.runsTouchedThisTick.add(runId);
    } catch (error) {
      console.error(`[worker] planning run ${runId} failed:`, error);
      // planner.ts/runs.ts already mark clearly-malformed configs failed;
      // an unexpected throw here (e.g. Claude transiently down) is left for
      // the next poll tick to retry — the run stays in "planning".
    }
  }
}

function tierFor(preset: ConcurrencyPreset) {
  return resolveTier(preset);
}

/**
 * Runs `items` through `worker`, never more than `limit` concurrently — a
 * small worker-pool (each of `min(limit, items.length)` lanes pulls the next
 * item off the shared queue until it's empty), NOT a single `Promise.all`
 * over everything at once. Used to cap a run's own concurrent item-agents at
 * its tier's `fanoutWidth` (report finding #4) independently of how many
 * OTHER runs' jobs happen to be claimed in the same tick.
 */
async function runWithConcurrencyLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function lane(): Promise<void> {
    while (index < items.length) {
      const item = items[index]!;
      index += 1;
      await worker(item);
    }
  }
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => lane());
  await Promise.all(lanes);
}

/** Marks a job `failed` and swallows/logs a completion failure rather than throwing over it. */
async function failJobQuietly(state: RuntimeState, jobId: string, context: string): Promise<void> {
  await completeJob(state.client, jobId, "failed").catch((completionError) => {
    console.error(`[worker] also failed to mark job ${jobId} failed (${context}):`, completionError);
  });
}

async function processOneJob(state: RuntimeState, job: ClaimedJob, config: WorkerRunConfig): Promise<void> {
  try {
    const line = config.lines.find((l) => l.bomLineId === job.bomLineId);
    if (!line || !job.plannedSearch) {
      throw new Error(`job ${job.jobId}: no matching line/plan for bomLineId ${job.bomLineId} in run ${job.runId}`);
    }

    const tracker = await getCostTracker(state, job.runId, config.rupeeCeiling);
    // Pre-spend gate (report finding #6): reserve a conservative estimate of
    // THIS call's cost against the ceiling BEFORE dispatching, not just
    // check cumulative spend after the fact — `wouldExceed` used to be dead
    // code, checked only in tests.
    if (tracker.hasExceededCeiling || tracker.wouldExceed(estimateNextCallRupees())) {
      await abortRunForCostCeiling(state.client, job.runId, tracker.spent, config.rupeeCeiling);
      // Report finding #7: the job that TRIGGERED the abort is already
      // 'claimed' — finish it immediately instead of leaving it to churn
      // through stale-claim recovery (requeue → re-claim → re-abort) for up
      // to MAX_CLAIM_ATTEMPTS cycles before it's finally parked failed.
      await failJobQuietly(state, job.jobId, `run ${job.runId} cost-ceiling abort`);
      return;
    }

    const clients = new Map<string, DistributorClient>();
    const distributorIds = new Map<string, string>();
    for (const d of config.distributorSequence) {
      if (!d.enabled) continue;
      clients.set(d.name, getDistributorClient(state, d.name, d.apiType));
      distributorIds.set(d.name, d.id);
    }

    const tier = tierFor(config.concurrencyPreset);
    const { outcome, cost } = await runItemAgent({
      line,
      plannedSearch: job.plannedSearch,
      depthPerItem: tier.depthPerItem,
      clients,
      distributorIds,
      siteSemaphore: state.siteSemaphore,
      rulesDigest: config.rulesDigest,
      env: state.env,
      claudePort: state.claudePort,
    });

    if (cost.estimatedRupees > 0) {
      tracker.record(cost.estimatedRupees);
      await addActualCost(state.client, job.runId, cost.estimatedRupees);
    }

    await upsertResults(state.client, job.runId, outcome.results);
    await completeJob(state.client, job.jobId, "done");
  } catch (error) {
    console.error(`[worker] job ${job.jobId} (run ${job.runId}) failed:`, error);
    await failJobQuietly(state, job.jobId, "unexpected error");
  }
}

/** One run's claimed jobs this tick, dispatched at no more than its tier's `fanoutWidth` concurrently (report finding #4). */
async function processRunJobs(state: RuntimeState, runId: string, jobs: ClaimedJob[]): Promise<void> {
  state.runsTouchedThisTick.add(runId);

  let config = state.runConfigCache.get(runId);
  if (!config) {
    try {
      config = await getRunConfig(state.client, runId);
      state.runConfigCache.set(runId, config);
    } catch (error) {
      console.error(`[worker] could not load run config for ${runId}:`, error);
      await Promise.all(jobs.map((job) => failJobQuietly(state, job.jobId, "run config load failure")));
      return;
    }
  }

  const tier = tierFor(config.concurrencyPreset);
  await runWithConcurrencyLimit(jobs, tier.fanoutWidth, (job) => processOneJob(state, job, config!));
}

async function processQueuedJobs(state: RuntimeState): Promise<void> {
  const claimed = await claimNextJobs(state.client, FANOUT_BATCH_LIMIT);
  if (claimed.length === 0) return;

  // Group by run so each run's OWN concurrency tier gates its OWN dispatch —
  // claiming is still capped globally by FANOUT_BATCH_LIMIT, but an Economy
  // run (fanoutWidth 2) must never fan out more than 2 concurrent item-agents
  // regardless of how many jobs from OTHER runs were claimed alongside it
  // (plan/tab-agent-run.md §2; report finding #4).
  const byRun = new Map<string, ClaimedJob[]>();
  for (const job of claimed) {
    const bucket = byRun.get(job.runId) ?? [];
    bucket.push(job);
    byRun.set(job.runId, bucket);
  }

  await Promise.all(Array.from(byRun.entries()).map(([runId, jobs]) => processRunJobs(state, runId, jobs)));
}

async function settleTouchedRuns(state: RuntimeState): Promise<void> {
  for (const runId of state.runsTouchedThisTick) {
    const becameReview = await markRunReviewIfComplete(state.client, runId).catch((error) => {
      console.error(`[worker] markRunReviewIfComplete failed for ${runId}:`, error);
      return false;
    });
    if (becameReview) {
      state.runConfigCache.delete(runId);
      state.costTrackers.delete(runId);
    }
  }
  state.runsTouchedThisTick.clear();
}

async function pollOnce(state: RuntimeState): Promise<void> {
  await releaseStaleClaims(state.client).catch((error) => console.error("[worker] releaseStaleClaims failed:", error));
  await processPlanningRuns(state);
  await processQueuedJobs(state);
  await settleTouchedRuns(state);
}

/** Guarded by `WORKER_SHARED_SECRET` — a health check + minimal status surface for Railway/Fly/Render, not a product API. */
function startStatusServer(state: RuntimeState): void {
  const port = Number(process.env.PORT ?? 8080);
  Bun.serve({
    port,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return new Response("ok", { status: 200 });
      }
      if (url.pathname === "/status") {
        if (!state.env.workerSharedSecret) {
          return new Response("WORKER_SHARED_SECRET not configured — /status disabled", { status: 503 });
        }
        const authHeader = request.headers.get("authorization") ?? "";
        if (authHeader !== `Bearer ${state.env.workerSharedSecret}`) {
          return new Response("unauthorized", { status: 401 });
        }
        return Response.json({
          mode: state.env.anthropicApiKey ? "live-claude" : "mock-claude",
          browserDriver: state.env.browserDriver ?? "unconfigured",
          runsInFlight: state.runConfigCache.size,
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  console.log(`[worker] status server listening on :${port} (/health, /status)`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const state = buildRuntime(env);
  startStatusServer(state);

  console.log(
    `[worker] starting — Claude: ${env.anthropicApiKey ? "live" : "MOCK (no ANTHROPIC_API_KEY)"}; ` +
      `browser driver: ${env.browserDriver ?? "none configured"}.`,
  );

  // Long-running poll loop is the entire point of this process.
  while (true) {
    await pollOnce(state).catch((error) => console.error("[worker] pollOnce failed:", error));
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

// Only run the poll loop when executed directly (`bun run index.ts` /
// `bun run start`) — importing this module from a test never starts it.
if (import.meta.main) {
  main().catch((error) => {
    console.error("[worker] fatal:", error);
    process.exit(1);
  });
}

export { buildRuntime, pollOnce, processPlanningRuns, processQueuedJobs, settleTouchedRuns };
