/**
 * lib/runs/queries.ts — read models for the Ordering Workspace, Agent Run
 * console, and Order Review (plan/tab-ordering-workspace.md,
 * plan/tab-agent-run.md, plan/tab-order-review.md).
 *
 * Two Supabase clients flow through this file, deliberately:
 *  - `supabase` — the caller's per-request RLS client (smark_boms,
 *    smark_bom_lines, smark_distributors, smark_agent_runs, smark_cart_items
 *    all have real owner/employee/accountant policies).
 *  - `service` — a service-role client, REQUIRED for `smark_order_jobs` /
 *    `smark_agent_results` (service-role-only RLS, migration 0004) and for
 *    `smark_learned_rules` / `smark_learned_rules_doc` (owner-only RLS —
 *    migration 0004's own comment: the workspace's memory-context card "are
 *    computed server-side (service role)... never a direct client read",
 *    specifically so an employee running an order still sees the real
 *    digest instead of an RLS-silenced empty one).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunRow, BomLineRow, BomRow, Database, MpnMatch, PartStatus } from "@/types/db";
import { TABLES } from "@/types/db";
import { getActiveRules, getDigestSummary, scopeLabel, buildGlobalAliasMapping, deAliasText } from "@/lib/ai";
import { getPrimaryLocationsByPartId, getProjectHeader, type ProjectHeader } from "@/lib/bom/queries";
import { formatNumber } from "@/lib/format";
import type { ClaudeMasterPlan, WorkerRunConfig } from "@/types/worker";
import { isRunStale } from "./dry-run";
import { resolveDistributorSequence } from "./distributor-sequence";
import type {
  InStockLane,
  LaneOptionRow,
  MemoryContextCard,
  PerLineNote,
  ReviewData,
  ReviewFeedbackEntry,
  ReviewLineCard,
  RunConsoleData,
  RunHeader,
  RunStreamSnapshot,
  SourcingLane,
  StandardRuleRow,
  WorkspaceBomHeader,
  WorkspaceData,
} from "./types";

type DB = SupabaseClient<Database>;

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`[runs] ${context}: ${error.message}`);
}

function lineRef(line: Pick<BomLineRow, "references" | "line_no">): string {
  return line.references ?? (line.line_no != null ? `Line ${line.line_no}` : "—");
}

function lineValue(line: Pick<BomLineRow, "value" | "footprint" | "mpn">): string {
  return [line.value, line.footprint].filter(Boolean).join(" · ") || (line.mpn ?? "—");
}

function toWorkspaceBomHeader(bom: BomRow): WorkspaceBomHeader {
  return {
    id: bom.id,
    name: bom.name,
    buildQty: bom.build_qty,
    priorityNotes: bom.priority_notes,
    sourcingStatus: bom.sourcing_status,
    savedRunId: bom.saved_run_id,
  };
}

function planEnvelope(run: Pick<AgentRunRow, "plan">): { config?: WorkerRunConfig; masterPlan?: ClaudeMasterPlan | null; appMeta?: { buildQtyAtRun?: number } } {
  return (run.plan as { config?: WorkerRunConfig; masterPlan?: ClaudeMasterPlan | null; appMeta?: { buildQtyAtRun?: number } } | null) ?? {};
}

/**
 * `dealiasMapping` reverses the SAME global (name → alias code) mapping the
 * run's context was built with at enqueue time (`lib/runs/enqueue.ts`
 * `buildAliasedRunContext` → `lib/ai`'s `buildGlobalAliasMapping`) — the
 * master narration is model-authored text generated FROM aliased context
 * (`config.aliasedProjectLabel`, the aliased `rulesDigest`/
 * `overallPriorities`), so its echo can carry any of those codes back
 * un-de-aliased if this isn't applied (report finding #1).
 */
function toRunHeader(run: AgentRunRow, currentBuildQty: number, dealiasMapping: Map<string, string>): RunHeader {
  const envelope = planEnvelope(run);
  const narration = envelope.masterPlan?.narration ?? null;
  return {
    id: run.id,
    bomId: run.bom_id,
    status: run.status,
    concurrencyPreset: run.concurrency_preset,
    estCost: run.est_cost,
    actualCost: run.actual_cost,
    createdAt: run.created_at,
    narration: narration ? deAliasText(narration, dealiasMapping) : null,
    isStale: isRunStale({ currentBuildQty, runBuildQtyAtEnqueue: envelope.appMeta?.buildQtyAtRun ?? null }),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ordering Workspace
 * ──────────────────────────────────────────────────────────────────────────── */

const STANDARD_RULE_LABELS: Record<string, string> = {
  mpn: "MPN (exact → known equivalents)",
  lcsc: "LCSC PN (if present → LCSC only)",
  value: "Value (R: value/V, tol, W; C: value/V, dielectric)",
  package: "Package — mandatory, never substitutable",
  status: "Part status (Active > NRND > EOL)",
  qty: "Quantity (≥ multiplied need)",
  cost: "Cost (lowest, all else equal)",
  custom: "Custom rule",
};

export async function getWorkspaceData(supabase: DB, service: DB, bomId: string): Promise<WorkspaceData | null> {
  const { data: bom, error: bomError } = await supabase.from(TABLES.boms).select("*").eq("id", bomId).maybeSingle();
  assertNoError(bomError, "smark_boms");
  if (!bom) return null;

  const project = await getProjectHeader(supabase, bom.project_id);
  if (!project) return null;

  const { data: lines, error: linesError } = await supabase.from(TABLES.bom_lines).select("*").eq("bom_id", bomId);
  assertNoError(linesError, "smark_bom_lines");
  const allLines = (lines ?? []) as BomLineRow[];
  const toOrderLineCount = allLines.filter((l) => l.match_state !== "in_stock").length;

  const perLineNotes: PerLineNote[] = allLines
    .filter((l): l is BomLineRow & { priority_note: string } => Boolean(l.priority_note))
    .map((l) => ({ ref: lineRef(l), note: l.priority_note }));

  const [{ data: distributors, error: distError }, { data: preferences, error: prefError }, { data: rules, error: rulesError }] = await Promise.all([
    supabase.from(TABLES.distributors).select("id, name, api_type, active"),
    supabase.from(TABLES.distributor_preferences).select("distributor_id, rank, enabled"),
    supabase.from(TABLES.ordering_rules).select("*").order("rank", { ascending: true }),
  ]);
  assertNoError(distError, "smark_distributors");
  assertNoError(prefError, "smark_distributor_preferences");
  assertNoError(rulesError, "smark_ordering_rules");

  const distributorSequence = resolveDistributorSequence(
    bom.distributor_sequence,
    (distributors ?? []) as { id: string; name: string; api_type: "rest" | "browse" | "none"; active: boolean }[],
    (preferences ?? []) as { distributor_id: string; rank: number; enabled: boolean }[],
  );

  const standardRules: StandardRuleRow[] = (rules ?? []).map((r) => ({
    rank: r.rank,
    key: r.key,
    label: STANDARD_RULE_LABELS[r.key] ?? r.key,
    mandatory: r.mandatory,
    enabled: r.enabled,
  }));

  // Service-role read — see module doc (employee sees the real digest, not an owner-only RLS-empty one).
  const [digestSummary, activeRules] = await Promise.all([getDigestSummary(service), getActiveRules(service)]);
  const memory: MemoryContextCard = {
    version: digestSummary.version,
    activeCount: activeRules.length,
    preview: activeRules.slice(0, 4).map((r) => ({ scope: scopeLabel(r.scope), text: r.ruleText })),
    moreCount: Math.max(0, activeRules.length - 4),
  };

  let savedRun: WorkspaceData["savedRun"] = null;
  if (bom.saved_run_id) {
    const { data: run, error: runError } = await supabase
      .from(TABLES.agent_runs)
      .select("id, status, plan")
      .eq("id", bom.saved_run_id)
      .maybeSingle();
    assertNoError(runError, "smark_agent_runs (saved run)");
    if (run) {
      const envelope = planEnvelope(run as Pick<AgentRunRow, "plan">);
      savedRun = {
        id: run.id,
        status: run.status,
        isStale: isRunStale({ currentBuildQty: bom.build_qty, runBuildQtyAtEnqueue: envelope.appMeta?.buildQtyAtRun ?? null }),
      };
    }
  }

  return {
    project,
    bom: toWorkspaceBomHeader(bom),
    toOrderLineCount,
    perLineNotes,
    distributorSequence,
    memory,
    standardRules,
    savedRun,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * In-stock lanes (app-level skip-buy — never sent to the worker at all)
 * ──────────────────────────────────────────────────────────────────────────── */

async function getInStockLanes(supabase: DB, lines: BomLineRow[]): Promise<InStockLane[]> {
  const inStock = lines.filter((l) => l.match_state === "in_stock" && !l.dnp);
  if (inStock.length === 0) return [];

  const partIds = Array.from(new Set(inStock.map((l) => l.matched_part_id).filter((v): v is string => Boolean(v))));
  const locations = await getPrimaryLocationsByPartId(supabase, partIds);

  return inStock.map((l) => {
    const loc = l.matched_part_id ? locations.get(l.matched_part_id) : undefined;
    return {
      bomLineId: l.id,
      ref: lineRef(l),
      value: lineValue(l),
      flag: loc ? `${formatNumber(loc.qty)} in Box ${loc.boxName}` : "Already in stock",
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * "AI · why" — the worker computes a per-result `why` string
 * (worker/src/item-agent.ts) and persists it into `raw.why`
 * (worker/src/results.ts `toInsertRow`'s `withWhy`). Prefers that
 * model-authored string when present; falls back to an honest, objective
 * one-line summary built from the columns that always persist (mpn_match/
 * package_match/is_recommended) when it isn't (e.g. results written before
 * `raw.why` existed).
 * ──────────────────────────────────────────────────────────────────────────── */
function resultWhy(row: Pick<AgentResultDbRow, "raw" | "mpn_match" | "package_match" | "is_recommended">, dealiasMapping: Map<string, string>): string {
  const raw = row.raw;
  if (raw && typeof raw === "object" && "why" in raw && typeof (raw as { why: unknown }).why === "string") {
    // Model-authored text generated from ALIASED context (line's
    // priorityNote, aliasedProjectLabel, rulesDigest) — de-alias before it
    // ever reaches the UI (report finding #1).
    return deAliasText((raw as { why: string }).why, dealiasMapping);
  }
  const bits: string[] = [];
  bits.push(row.mpn_match === "exact" ? "exact MPN match" : row.mpn_match === "approx" ? "approximate MPN match" : "no MPN match");
  bits.push(row.package_match ? "package matches" : "package does not match");
  if (row.is_recommended) bits.push("lowest-cost option meeting the ladder's requirements");
  return bits.join(", ") + ".";
}

/* ────────────────────────────────────────────────────────────────────────────
 * Sourcing lanes (to-order lines — worker-tracked)
 * ──────────────────────────────────────────────────────────────────────────── */

interface AgentResultDbRow {
  id: string;
  bom_line_id: string;
  distributor_id: string;
  price: number | null;
  stock_qty: number | null;
  mpn_match: MpnMatch;
  package_match: boolean;
  part_status: PartStatus | null;
  order_link: string | null;
  is_recommended: boolean;
  confidence: number | null;
  selected: boolean;
  raw: unknown;
}

async function getSourcingLanes(
  service: DB,
  runId: string,
  run: AgentRunRow,
  toOrderLines: BomLineRow[],
  dealiasMapping: Map<string, string>,
): Promise<SourcingLane[]> {
  const [{ data: jobs, error: jobsError }, { data: results, error: resultsError }] = await Promise.all([
    service.from(TABLES.order_jobs).select("bom_line_id, status").eq("run_id", runId),
    service.from(TABLES.agent_results).select("*").eq("run_id", runId),
  ]);
  assertNoError(jobsError, "smark_order_jobs");
  assertNoError(resultsError, "smark_agent_results");

  const jobStatusByLine = new Map((jobs ?? []).map((j) => [j.bom_line_id as string, j.status as string]));
  const resultRows = (results ?? []) as AgentResultDbRow[];

  const distributorIds = Array.from(new Set(resultRows.map((r) => r.distributor_id)));
  let distributorNames = new Map<string, string>();
  if (distributorIds.length > 0) {
    const { data: distributors, error: distError } = await service.from(TABLES.distributors).select("id, name").in("id", distributorIds);
    assertNoError(distError, "smark_distributors (result join)");
    distributorNames = new Map((distributors ?? []).map((d) => [d.id as string, d.name as string]));
  }

  const resultsByLine = new Map<string, AgentResultDbRow[]>();
  for (const row of resultRows) {
    const bucket = resultsByLine.get(row.bom_line_id) ?? [];
    bucket.push(row);
    resultsByLine.set(row.bom_line_id, bucket);
  }

  const skipByLine = new Map((planEnvelope(run).masterPlan?.skip ?? []).map((s) => [s.bomLineId, s.reason] as const));

  return toOrderLines.map((line) => {
    const rows: LaneOptionRow[] = (resultsByLine.get(line.id) ?? [])
      .slice()
      .sort((a, b) => (b.is_recommended ? 1 : 0) - (a.is_recommended ? 1 : 0) || (a.price ?? Infinity) - (b.price ?? Infinity))
      .map(
        (r): LaneOptionRow => ({
          resultId: r.id,
          distributorId: r.distributor_id,
          distributorName: distributorNames.get(r.distributor_id) ?? "—",
          price: r.price,
          currency: "INR",
          stockQty: r.stock_qty,
          mpnMatch: r.mpn_match,
          packageMatch: r.package_match,
          partStatus: r.part_status,
          orderLink: r.order_link,
          isRecommended: r.is_recommended,
          confidence: r.confidence,
          why: resultWhy(r, dealiasMapping),
          selected: r.selected,
        }),
      );

    const jobStatus = (jobStatusByLine.get(line.id) ?? "not_dispatched") as SourcingLane["jobStatus"];
    const rawSkipReason = skipByLine.get(line.id) ?? null;

    return {
      bomLineId: line.id,
      ref: lineRef(line),
      value: lineValue(line),
      jobStatus,
      // Model-authored (Opus master plan) — same de-aliasing requirement as `why` above (report finding #1).
      aiSkipReason: rawSkipReason ? deAliasText(rawSkipReason, dealiasMapping) : null,
      rows,
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Agent Run console
 * ──────────────────────────────────────────────────────────────────────────── */

export async function getRunConsoleData(supabase: DB, service: DB, runId: string): Promise<RunConsoleData | null> {
  const { data: run, error: runError } = await supabase.from(TABLES.agent_runs).select("*").eq("id", runId).maybeSingle();
  assertNoError(runError, "smark_agent_runs");
  if (!run) return null;

  const { data: bom, error: bomError } = await supabase.from(TABLES.boms).select("*").eq("id", run.bom_id).maybeSingle();
  assertNoError(bomError, "smark_boms");
  if (!bom) return null;

  const project = await getProjectHeader(supabase, bom.project_id);
  if (!project) return null;

  const { data: lines, error: linesError } = await supabase.from(TABLES.bom_lines).select("*").eq("bom_id", bom.id);
  assertNoError(linesError, "smark_bom_lines");
  const allLines = (lines ?? []) as BomLineRow[];
  const toOrderLines = allLines.filter((l) => l.match_state !== "in_stock");

  // Global (name → alias code) mapping, reversed via `deAliasText` for every
  // model-authored string below — the run's context was built from this same
  // global set (`lib/runs/enqueue.ts` `buildAliasedRunContext`), so a
  // narration/skip-reason/why can carry ANY in-system project or client code
  // back, not just this run's own two (report finding #1).
  const dealiasMapping = await buildGlobalAliasMapping(service);

  const [inStockLanes, sourcingLanes] = await Promise.all([
    getInStockLanes(supabase, allLines),
    getSourcingLanes(service, runId, run as AgentRunRow, toOrderLines, dealiasMapping),
  ]);

  const doneCount = sourcingLanes.filter((l) => l.jobStatus === "done" || l.jobStatus === "failed" || l.aiSkipReason).length;

  return {
    project,
    bom: toWorkspaceBomHeader(bom),
    run: toRunHeader(run as AgentRunRow, bom.build_qty, dealiasMapping),
    inStockLanes,
    sourcingLanes,
    doneCount,
    totalCount: sourcingLanes.length,
  };
}

/** SSE snapshot (app/api/runs/[runId]/stream) — sourcing lanes only; in-stock lanes never change mid-run. */
export async function getRunSnapshot(service: DB, runId: string): Promise<RunStreamSnapshot | null> {
  const { data: run, error: runError } = await service.from(TABLES.agent_runs).select("*").eq("id", runId).maybeSingle();
  assertNoError(runError, "smark_agent_runs (snapshot)");
  if (!run) return null;

  const { data: lines, error: linesError } = await service.from(TABLES.bom_lines).select("*").eq("bom_id", run.bom_id);
  assertNoError(linesError, "smark_bom_lines (snapshot)");
  const toOrderLines = ((lines ?? []) as BomLineRow[]).filter((l) => l.match_state !== "in_stock");

  const dealiasMapping = await buildGlobalAliasMapping(service);
  const sourcingLanes = await getSourcingLanes(service, runId, run as AgentRunRow, toOrderLines, dealiasMapping);
  const envelope = planEnvelope(run as Pick<AgentRunRow, "plan">);
  const doneCount = sourcingLanes.filter((l) => l.jobStatus === "done" || l.jobStatus === "failed" || l.aiSkipReason).length;
  const narration = envelope.masterPlan?.narration ?? null;

  return {
    status: run.status,
    narration: narration ? deAliasText(narration, dealiasMapping) : null,
    doneCount,
    totalCount: sourcingLanes.length,
    estCost: run.est_cost,
    actualCost: run.actual_cost,
    sourcingLanes,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Order Review (persisted per R2-08)
 * ──────────────────────────────────────────────────────────────────────────── */

function toFeedbackEntry(row: { id: string; comment: string; created_at: string; result_id: string | null }, bomLineByResult: Map<string, string>): ReviewFeedbackEntry {
  return {
    id: row.id,
    bomLineId: row.result_id ? (bomLineByResult.get(row.result_id) ?? null) : null,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

export async function getReviewData(supabase: DB, service: DB, runId: string): Promise<ReviewData | null> {
  const console_ = await getRunConsoleData(supabase, service, runId);
  if (!console_) return null;

  const { data: feedback, error: feedbackError } = await supabase.from(TABLES.agent_feedback).select("*").eq("run_id", runId);
  assertNoError(feedbackError, "smark_agent_feedback");

  const resultToBomLine = new Map<string, string>();
  for (const lane of console_.sourcingLanes) {
    for (const row of lane.rows) resultToBomLine.set(row.resultId, lane.bomLineId);
  }

  const itemFeedback = new Map<string, ReviewFeedbackEntry[]>();
  const orderRemarks: ReviewFeedbackEntry[] = [];
  for (const row of feedback ?? []) {
    const entry = toFeedbackEntry(row as { id: string; comment: string; created_at: string; result_id: string | null }, resultToBomLine);
    if (entry.bomLineId) {
      const bucket = itemFeedback.get(entry.bomLineId) ?? [];
      bucket.push(entry);
      itemFeedback.set(entry.bomLineId, bucket);
    } else {
      orderRemarks.push(entry);
    }
  }

  // Cart cross-reference — "In cart ✓ ×N" (source review_add against this run's results).
  const resultIds = Array.from(new Set(console_.sourcingLanes.flatMap((l) => l.rows.map((r) => r.resultId))));
  const { data: cartItems, error: cartError } = resultIds.length
    ? await supabase.from(TABLES.cart_items).select("id, demand, status, chosen_result_id").in("chosen_result_id", resultIds)
    : { data: [] as { id: string; demand: unknown; status: string; chosen_result_id: string | null }[], error: null };
  assertNoError(cartError, "smark_cart_items (review cross-ref)");

  const inCartQtyByLine = new Map<string, number>();
  for (const item of cartItems ?? []) {
    const demand = (item.demand as Array<{ bom_line_id: string; qty: number }>) ?? [];
    for (const slice of demand) {
      if (slice.bom_line_id) inCartQtyByLine.set(slice.bom_line_id, (inCartQtyByLine.get(slice.bom_line_id) ?? 0) + slice.qty);
    }
  }

  const { data: allLines, error: allLinesError } = await supabase.from(TABLES.bom_lines).select("id, qty").eq("bom_id", console_.bom.id);
  assertNoError(allLinesError, "smark_bom_lines (needed qty)");
  const neededQtyByLine = new Map((allLines ?? []).map((l) => [l.id as string, (l.qty ?? 0) * console_.bom.buildQty] as const));

  const lines: ReviewLineCard[] = console_.sourcingLanes.map((lane) => ({
    ...lane,
    cartQtyNeeded: neededQtyByLine.get(lane.bomLineId) ?? 0,
    inCartQty: inCartQtyByLine.get(lane.bomLineId) ?? null,
    feedback: itemFeedback.get(lane.bomLineId) ?? [],
  }));

  // Deliberately counts THIS RUN'S OWN lines that resolved an inCartQty, not
  // `inCartQtyByLine.keys().length` — a matched `smark_cart_items` row is the
  // PART's aggregated cart line (SCHEMA.md §4: "one cart line per part,
  // aggregated across projects"), so its `demand` array can carry slices
  // from OTHER runs/BOMs that happened to add the same part before or after
  // this one. Counting every demand slice on that shared row would leak
  // unrelated runs' line counts into "Added to cart: N items" for this run.
  const cartAddedCount = lines.filter((l) => l.inCartQty != null).length;

  return {
    project: console_.project,
    bom: console_.bom,
    run: console_.run,
    inStockLanes: console_.inStockLanes,
    lines,
    orderRemarks,
    cartAddedCount,
  };
}

export type { ProjectHeader };
