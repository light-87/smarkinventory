/**
 * worker/src/telemetry.ts — process + machine metrics heartbeat for the
 * /ai_orc observatory (migration 0008 `smark_worker_heartbeats`).
 *
 * Every HEARTBEAT_INTERVAL_MS the worker upserts one row keyed on
 * "hostname#pid" with a jsonb snapshot: RSS/heap, system free/total memory,
 * process CPU %, active item agents, runs in flight, mock-vs-live mode. This
 * is how a 2 GB box stays observable — the page can show memory pressure
 * live while a run fans out. A failed upsert only logs (telemetry must never
 * take the worker down); a stopped worker simply goes stale by last_seen_at.
 */

import os from "node:os";
import type { ServiceRoleClient } from "./db";
import type { WorkerEnv } from "./env";

const HEARTBEAT_INTERVAL_MS = Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 10_000);

/** Live counters the poll loop mutates — read at each beat. */
export interface TelemetryCounters {
  activeItemAgents: number;
  jobsDoneSinceStart: number;
  jobsFailedSinceStart: number;
}

export const counters: TelemetryCounters = {
  activeItemAgents: 0,
  jobsDoneSinceStart: 0,
  jobsFailedSinceStart: 0,
};

const MB = 1024 * 1024;
const startedAtIso = new Date().toISOString();

let lastCpu = process.cpuUsage();
let lastCpuAt = process.hrtime.bigint();

/** Process CPU % since the previous beat (user+system across all cores). */
function cpuPercentSinceLastBeat(): number {
  const nowCpu = process.cpuUsage();
  const nowAt = process.hrtime.bigint();
  const elapsedMicros = Number(nowAt - lastCpuAt) / 1_000;
  const usedMicros = nowCpu.user - lastCpu.user + (nowCpu.system - lastCpu.system);
  lastCpu = nowCpu;
  lastCpuAt = nowAt;
  if (elapsedMicros <= 0) return 0;
  return Math.round((usedMicros / elapsedMicros) * 1000) / 10;
}

export interface TelemetryDeps {
  client: ServiceRoleClient;
  env: Pick<WorkerEnv, "anthropicApiKey" | "browserDriver" | "claudeModelMaster" | "claudeModelItem">;
  /** Live view into the poll loop's state — how many runs have configs cached right now. */
  runsInFlight: () => number;
}

function collectMetrics(deps: TelemetryDeps): Record<string, unknown> {
  const mem = process.memoryUsage();
  return {
    rssMb: Math.round(mem.rss / MB),
    heapUsedMb: Math.round(mem.heapUsed / MB),
    sysFreeMb: Math.round(os.freemem() / MB),
    sysTotalMb: Math.round(os.totalmem() / MB),
    cpuPercent: cpuPercentSinceLastBeat(),
    uptimeSec: Math.round(process.uptime()),
    activeItemAgents: counters.activeItemAgents,
    jobsDone: counters.jobsDoneSinceStart,
    jobsFailed: counters.jobsFailedSinceStart,
    runsInFlight: deps.runsInFlight(),
    mode: deps.env.anthropicApiKey ? "live-claude" : "mock-claude",
    browserDriver: deps.env.browserDriver ?? "none",
    liveBrowserGateOpen: process.env.ALLOW_LIVE_BROWSER === "1",
    modelMaster: deps.env.claudeModelMaster,
    modelItem: deps.env.claudeModelItem,
    pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 3000),
  };
}

async function beat(deps: TelemetryDeps, workerId: string): Promise<void> {
  const metrics = collectMetrics(deps);
  const { error } = await deps.client.from("smark_worker_heartbeats").upsert(
    {
      worker_id: workerId,
      hostname: os.hostname(),
      pid: process.pid,
      started_at: startedAtIso,
      last_seen_at: new Date().toISOString(),
      metrics,
    },
    { onConflict: "worker_id" },
  );
  if (error) {
    console.error(`[worker] telemetry heartbeat failed: ${error.message}`);
    return;
  }
  console.log(
    `[worker] beat — rss ${metrics.rssMb as number}MB · sys free ${metrics.sysFreeMb as number}/${metrics.sysTotalMb as number}MB · ` +
      `cpu ${metrics.cpuPercent as number}% · agents ${metrics.activeItemAgents as number} · runs ${metrics.runsInFlight as number}`,
  );
}

/** Starts the heartbeat interval. Fire-and-forget; never throws into the poll loop. */
export function startTelemetry(deps: TelemetryDeps): void {
  const workerId = `${os.hostname()}#${process.pid}`;
  void beat(deps, workerId).catch((error) => console.error("[worker] telemetry first beat failed:", error));
  setInterval(() => {
    void beat(deps, workerId).catch((error) => console.error("[worker] telemetry beat failed:", error));
  }, HEARTBEAT_INTERVAL_MS);
  console.log(`[worker] telemetry heartbeat every ${HEARTBEAT_INTERVAL_MS}ms as "${workerId}"`);
}
