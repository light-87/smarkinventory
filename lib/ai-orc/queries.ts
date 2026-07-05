/**
 * lib/ai-orc/queries.ts — read-side for the /ai_orc observatory: every run's
 * full lifecycle (exact prompts → per-agent lanes → results) plus worker
 * process/machine telemetry (migration 0008).
 *
 * SERVICE-ROLE reads by design: `smark_order_jobs`/`smark_agent_results` are
 * service-role-only tables (migration 0004), and this surface is the owner's
 * operations console — the API route (app/api/ai-orc/state) gates on
 * role === "owner" BEFORE calling anything here.
 *
 * Everything returned is intentionally the ALIASED truth — PROJ-xx/CLIENT-x
 * codes, never real names — because the page's whole point is "show me
 * byte-for-byte what the models see". Prompt strings are re-rendered from
 * the stored run config through worker/src/prompts.ts (the same module the
 * worker itself calls), so they cannot drift from reality.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentResultRow, Database, WorkerHeartbeatRow } from "@/types/db";
import { TABLES } from "@/types/db";
import type { ClaudeMasterPlan, PlannedSearch, SkipDecision, WorkerBomLine, WorkerRunConfig } from "@/types/worker";
import type { DistributorListingResult } from "@/types/worker";
import { ITEM_SYSTEM_PROMPT, MASTER_SYSTEM_PROMPT, buildItemPrompt, buildMasterPrompt } from "@/worker/src/prompts";

type DB = SupabaseClient<Database>;

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`[ai-orc] ${context}: ${error.message}`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Workers
 * ──────────────────────────────────────────────────────────────────────────── */

export interface WorkerCard {
  workerId: string;
  hostname: string | null;
  pid: number | null;
  startedAt: string | null;
  lastSeenAt: string;
  metrics: Record<string, unknown>;
}

export async function getWorkersState(service: DB): Promise<WorkerCard[]> {
  const { data, error } = await service
    .from(TABLES.worker_heartbeats)
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(10);
  assertNoError(error, "smark_worker_heartbeats");
  return ((data ?? []) as WorkerHeartbeatRow[]).map((row) => ({
    workerId: row.worker_id,
    hostname: row.hostname,
    pid: row.pid,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    metrics: row.metrics as Record<string, unknown>,
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Runs list
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RunListEntry {
  id: string;
  status: string;
  bomName: string | null;
  projectName: string | null;
  tier: string;
  estCost: number | null;
  actualCost: number | null;
  createdAt: string;
  jobCounts: Record<string, number>;
}

export async function listRecentRuns(service: DB, limit = 15): Promise<RunListEntry[]> {
  const { data: runs, error } = await service
    .from(TABLES.agent_runs)
    .select("id, status, bom_id, concurrency_preset, est_cost, actual_cost, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  assertNoError(error, "smark_agent_runs");
  const runRows = runs ?? [];
  if (runRows.length === 0) return [];

  const bomIds = Array.from(new Set(runRows.map((r) => r.bom_id)));
  const { data: boms, error: bomsError } = await service
    .from(TABLES.boms)
    .select("id, name, project_id")
    .in("id", bomIds);
  assertNoError(bomsError, "smark_boms");
  const bomById = new Map((boms ?? []).map((b) => [b.id, b]));

  const projectIds = Array.from(new Set((boms ?? []).map((b) => b.project_id)));
  const { data: projects, error: projectsError } =
    projectIds.length > 0
      ? await service.from(TABLES.projects).select("id, name").in("id", projectIds)
      : { data: [], error: null };
  assertNoError(projectsError, "smark_projects");
  const projectById = new Map((projects ?? []).map((p) => [p.id, p.name]));

  const runIds = runRows.map((r) => r.id);
  const { data: jobs, error: jobsError } = await service
    .from(TABLES.order_jobs)
    .select("run_id, status")
    .in("run_id", runIds);
  assertNoError(jobsError, "smark_order_jobs (counts)");
  const countsByRun = new Map<string, Record<string, number>>();
  for (const job of jobs ?? []) {
    const bucket = countsByRun.get(job.run_id) ?? {};
    bucket[job.status] = (bucket[job.status] ?? 0) + 1;
    countsByRun.set(job.run_id, bucket);
  }

  return runRows.map((run) => {
    const bom = bomById.get(run.bom_id);
    return {
      id: run.id,
      status: run.status,
      bomName: bom?.name ?? null,
      projectName: bom ? (projectById.get(bom.project_id) ?? null) : null,
      tier: run.concurrency_preset,
      estCost: run.est_cost,
      actualCost: run.actual_cost,
      createdAt: run.created_at,
      jobCounts: countsByRun.get(run.id) ?? {},
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Run deep dive — prompts + one lane per line
 * ──────────────────────────────────────────────────────────────────────────── */

export interface LaneCandidate {
  distributorName: string;
  price: number | null;
  stockQty: number | null;
  mpnMatch: string;
  packageMatch: boolean;
  partStatus: string | null;
  orderLink: string | null;
  isRecommended: boolean;
  confidence: number | null;
  why: string | null;
}

export interface RunLane {
  bomLineId: string;
  line: WorkerBomLine;
  jobStatus: string | null;
  attempts: number | null;
  claimedAt: string | null;
  plannedSearch: PlannedSearch | null;
  skip: SkipDecision | null;
  candidates: LaneCandidate[];
  /** Byte-for-byte Sonnet user message, re-rendered from stored line+results. Null until results exist. */
  itemUserPrompt: string | null;
}

export interface RunDeepDive {
  id: string;
  status: string;
  tier: string;
  fanoutWidth: number;
  depthPerItem: number;
  estCost: number | null;
  actualCost: number | null;
  rupeeCeiling: number | null;
  createdAt: string;
  narration: string | null;
  masterSystemPrompt: string;
  /** Byte-for-byte Opus user message re-rendered from the stored config. */
  masterUserPrompt: string | null;
  itemSystemPrompt: string;
  inStockLines: NonNullable<WorkerRunConfig["inStockLines"]>;
  rulesDigest: string;
  overallPriorities: string;
  distributorSequence: { name: string; enabled: boolean; rank: number }[];
  /** Sandbox runs only (/ai_orc test bench): the first-N-lines cap this run was enqueued with. */
  lineLimit: number | null;
  lanes: RunLane[];
}

interface PlanEnvelope {
  config?: WorkerRunConfig;
  masterPlan?: ClaudeMasterPlan | null;
  failureReason?: string;
  appMeta?: { buildQtyAtRun?: number; lineLimit?: number | null };
}

function whyFromRaw(raw: unknown): string | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "why" in raw) {
    const why = (raw as { why?: unknown }).why;
    return typeof why === "string" ? why : null;
  }
  return null;
}

export async function getRunDeepDive(service: DB, runId: string): Promise<RunDeepDive | null> {
  const { data: run, error } = await service.from(TABLES.agent_runs).select("*").eq("id", runId).maybeSingle();
  assertNoError(error, "smark_agent_runs (deep dive)");
  if (!run) return null;

  const envelope = (run.plan ?? {}) as PlanEnvelope;
  const config = envelope.config ?? null;
  const masterPlan = envelope.masterPlan ?? null;

  const [{ data: jobs, error: jobsError }, { data: results, error: resultsError }, { data: distributors, error: distError }] =
    await Promise.all([
      service.from(TABLES.order_jobs).select("*").eq("run_id", runId),
      service.from(TABLES.agent_results).select("*").eq("run_id", runId),
      service.from(TABLES.distributors).select("id, name"),
    ]);
  assertNoError(jobsError, "smark_order_jobs");
  assertNoError(resultsError, "smark_agent_results");
  assertNoError(distError, "smark_distributors");

  const distributorNameById = new Map((distributors ?? []).map((d) => [d.id, d.name]));
  const jobByLineId = new Map((jobs ?? []).map((j) => [j.bom_line_id, j]));
  const resultsByLineId = new Map<string, AgentResultRow[]>();
  for (const row of (results ?? []) as AgentResultRow[]) {
    const bucket = resultsByLineId.get(row.bom_line_id) ?? [];
    bucket.push(row);
    resultsByLineId.set(row.bom_line_id, bucket);
  }

  const searchByLineId = new Map((masterPlan?.searches ?? []).map((s) => [s.bomLineId, s]));
  const skipByLineId = new Map((masterPlan?.skip ?? []).map((s) => [s.bomLineId, s]));

  const lanes: RunLane[] = (config?.lines ?? []).map((line) => {
    const job = jobByLineId.get(line.bomLineId);
    const rows = resultsByLineId.get(line.bomLineId) ?? [];

    const candidates: LaneCandidate[] = rows.map((row) => ({
      distributorName: distributorNameById.get(row.distributor_id) ?? row.distributor_id,
      price: row.price,
      stockQty: row.stock_qty,
      mpnMatch: row.mpn_match,
      packageMatch: row.package_match,
      partStatus: row.part_status,
      orderLink: row.order_link,
      isRecommended: row.is_recommended,
      confidence: row.confidence,
      why: whyFromRaw(row.raw),
    }));

    // Re-render the Sonnet payload from the same stored data the worker used.
    // Fields the prompt doesn't read (currency/qtyBreaks/…) are filled with
    // neutral values purely to satisfy the shared type.
    const listingShaped = rows.map(
      (row): DistributorListingResult => ({
        bomLineId: row.bom_line_id,
        distributorId: row.distributor_id,
        distributorName: distributorNameById.get(row.distributor_id) ?? row.distributor_id,
        price: row.price,
        currency: "",
        qtyBreaks: (row.qty_breaks ?? []).map((b) => ({ qty: b.qty, unitPrice: b.unit_price })),
        stockQty: row.stock_qty,
        mpnMatch: row.mpn_match,
        packageMatch: row.package_match,
        partStatus: row.part_status,
        orderLink: row.order_link,
        isRecommended: row.is_recommended,
        confidence: row.confidence ?? 0,
        why: whyFromRaw(row.raw) ?? "",
        raw: null,
      }),
    );

    return {
      bomLineId: line.bomLineId,
      line,
      jobStatus: job?.status ?? null,
      attempts: job?.attempts ?? null,
      claimedAt: job?.claimed_at ?? null,
      plannedSearch: searchByLineId.get(line.bomLineId) ?? null,
      skip: skipByLineId.get(line.bomLineId) ?? null,
      candidates,
      itemUserPrompt: config && rows.length > 0 ? buildItemPrompt(line, listingShaped, config.rulesDigest) : null,
    };
  });

  return {
    id: run.id,
    status: run.status,
    tier: run.concurrency_preset,
    fanoutWidth: run.fanout_width,
    depthPerItem: run.depth_per_item,
    estCost: run.est_cost,
    actualCost: run.actual_cost,
    rupeeCeiling: config?.rupeeCeiling ?? null,
    createdAt: run.created_at,
    narration: masterPlan?.narration ?? envelope.failureReason ?? null,
    masterSystemPrompt: MASTER_SYSTEM_PROMPT,
    masterUserPrompt: config ? buildMasterPrompt(config) : null,
    itemSystemPrompt: ITEM_SYSTEM_PROMPT,
    inStockLines: config?.inStockLines ?? [],
    rulesDigest: config?.rulesDigest ?? "",
    overallPriorities: config?.overallPriorities ?? "",
    distributorSequence: (config?.distributorSequence ?? []).map((d) => ({ name: d.name, enabled: d.enabled, rank: d.rank })),
    lineLimit: typeof envelope.appMeta?.lineLimit === "number" ? envelope.appMeta.lineLimit : null,
    lanes,
  };
}
