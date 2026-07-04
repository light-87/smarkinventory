/**
 * lib/runs/enqueue.ts — the enqueue contract (types/worker.ts's
 * `WorkerRunPlanColumn` doc, FEATURES.md §6/§9/§12): creates one
 * `smark_agent_runs` row (status "planning", `plan.config` populated) + one
 * `smark_order_jobs` row per to-order line, with every business-context
 * field ALREADY ALIASED before it's written (§12 — the leak test scans this
 * seam). Also covers the review screen's "↺ Re-run this item" /
 * "↺ Re-run whole order" actions, which reuse the same context-building path.
 *
 * `smark_order_jobs` is service-role-only by RLS design (migration 0004's own
 * header: "Suggested-rule creation... is likewise a server-side (service-
 * role) side effect" — same reasoning extends to every write on this table;
 * see its "SERVICE ROLE ONLY" comment block). Everything else here
 * (`smark_agent_runs`, `smark_boms`) uses the caller's normal per-request RLS
 * client — HARD RULE: "RLS clients in app routes (service key only in
 * worker/scripts/tests)" with this one documented, integrator-authored
 * exception.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BomLineRow, BomRow, Database } from "@/types/db";
import { TABLES } from "@/types/db";
import { buildPlannerContext, buildGlobalAliasMapping, getDigestForInjection, aliasDigestForInjection } from "@/lib/ai";
import { derivePackageFromFootprint, splitValueVoltage } from "@/lib/bom/footprint";
import { getProjectHeader } from "@/lib/bom/queries";
import type {
  ConcurrencyPreset,
  DistributorDescriptor,
  PlannedSearch,
  WorkerBomLine,
  WorkerRunConfig,
} from "@/types/worker";
import { CONCURRENCY_TIER_PRESETS } from "@/types/worker";
import { computeDryRunEstimate, computeRupeeCeiling } from "./dry-run";
import { resolveDistributorSequence, toStoredSequence, type EffectiveDistributorRow } from "./distributor-sequence";

type DB = SupabaseClient<Database>;

/**
 * Informational value stamped on `smark_agent_runs.per_site_cap` (FEATURES
 * §15). The worker's OWN `worker/src/caps.ts` `PER_SITE_CAPS` map is the
 * real, always-lower, non-overridable enforcement — this column is a record
 * of what the app believed at enqueue time, not a second source of truth
 * bom-pipeline is allowed to import (docs/OWNERSHIP.md: worker/src/** isn't
 * in this package's cross-import allowlist).
 */
const INFORMATIONAL_PER_SITE_CAP = 2;

export type EnqueueRunResult = { ok: true; runId: string } | { ok: false; error: string };

interface LoadedBomContext {
  bom: BomRow;
  project: { id: string; name: string; client: string | null };
  toOrderLines: BomLineRow[];
  /** Already fully stocked — no jobs, but the planner still sees them (complete-file context). */
  inStockLines: BomLineRow[];
  effectiveSequence: EffectiveDistributorRow[];
}

async function loadBomContext(supabase: DB, bomId: string): Promise<LoadedBomContext | { error: string }> {
  const { data: bom, error: bomError } = await supabase.from(TABLES.boms).select("*").eq("id", bomId).maybeSingle();
  if (bomError) return { error: bomError.message };
  if (!bom) return { error: "That BOM no longer exists." };

  const project = await getProjectHeader(supabase, bom.project_id);
  if (!project) return { error: "That BOM's project no longer exists." };

  const { data: lines, error: linesError } = await supabase.from(TABLES.bom_lines).select("*").eq("bom_id", bomId);
  if (linesError) return { error: linesError.message };

  const allLines = (lines ?? []) as BomLineRow[];
  const toOrderLines = allLines.filter((l) => l.match_state !== "in_stock");
  const inStockLines = allLines.filter((l) => l.match_state === "in_stock");

  const [{ data: distributors, error: distError }, { data: preferences, error: prefError }] = await Promise.all([
    supabase.from(TABLES.distributors).select("id, name, api_type, active"),
    supabase.from(TABLES.distributor_preferences).select("distributor_id, rank, enabled"),
  ]);
  if (distError) return { error: distError.message };
  if (prefError) return { error: prefError.message };

  const effectiveSequence = resolveDistributorSequence(
    bom.distributor_sequence,
    (distributors ?? []) as { id: string; name: string; api_type: "rest" | "browse" | "none"; active: boolean }[],
    (preferences ?? []) as { distributor_id: string; rank: number; enabled: boolean }[],
  );

  return { bom, project, toOrderLines, inStockLines, effectiveSequence };
}

/**
 * Aliases project/client + priorities + per-line notes, and the active rules
 * digest, for ONE run's context — all against the SAME global mapping
 * (`lib/ai`'s `buildGlobalAliasMapping`, built from EVERY project name +
 * distinct client value in `smark_projects`, not just this run's own two
 * names).
 *
 * `smark_learned_rules_doc.content` is built from ALL active rules across
 * EVERY project (lib/ai/digest.ts `buildDigestContent`), in real names — a
 * whole-order rule stores `subject = <that other run's project name>`
 * (lib/runs/feedback.ts `submitOrderRemark`: `subject: project?.name`), and
 * every rule's free-text `value.text` may mention any client verbatim.
 * Free-text priorities and per-line notes have the exact same problem (e.g.
 * "expedite like the Power Breezer order" on an unrelated BOM) — see this
 * package's report finding #2. A mapping built from only THIS run's own
 * project/client leaves every OTHER project/client name un-aliased wherever
 * it appears, shipping it verbatim into `config.rulesDigest` /
 * `config.overallPriorities` / a line's `priorityNote` — which the worker
 * injects straight into the Opus master prompt AND every Sonnet item prompt
 * (FEATURES §12 hard rule: "every Claude-bound payload passes the alias
 * layer"). Routing both through the one global mapping closes that gap for
 * good, and keeps `lib/runs/queries.ts`'s inbound de-aliasing (finding #1)
 * symmetric with what actually went out.
 */
async function buildAliasedRunContext(
  supabase: DB,
  ctx: Pick<LoadedBomContext, "bom" | "project" | "toOrderLines" | "effectiveSequence">,
) {
  const globalMapping = await buildGlobalAliasMapping(supabase);

  const plannerContext = await buildPlannerContext(
    {
      project: { name: ctx.project.name, client: ctx.project.client },
      bomName: ctx.bom.name,
      buildQty: ctx.bom.build_qty,
      distributorSequence: ctx.effectiveSequence.filter((d) => d.enabled).map((d) => d.name),
      priorities: ctx.bom.priority_notes,
      // The COMPLETE line, as uploaded ("the agent gets the whole BOM").
      // buildPlannerContext aliases the free-text fields (priorityNote,
      // description, string extra values); the rest pass through real.
      lines: ctx.toOrderLines.map((l) => ({
        lineNo: l.line_no ?? 0,
        references: l.references,
        mpn: l.mpn,
        lcscPn: l.lcsc_pn,
        value: l.value,
        footprint: l.footprint,
        qty: l.dnp ? 0 : (l.qty ?? 0) * ctx.bom.build_qty,
        dnp: l.dnp,
        description: l.description,
        manufacturer: l.manufacturer,
        partLink: l.part_link,
        extra: l.extra,
        priorityNote: l.priority_note,
      })),
    },
    supabase,
    globalMapping,
  );

  const digest = await getDigestForInjection(supabase); // owner-only RLS on smark_learned_rules_doc — lib/ai's getDigestForInjection
  // takes whichever client it's given; callers of THIS module always pass a service client (see enqueueRun below)
  // so an employee-started run still gets the real digest, not an RLS-empty one (migration 0004's own note).
  const aliasedDigestContent = aliasDigestForInjection(digest.content, globalMapping);

  return { plannerContext, rulesDigestVersion: digest.version, rulesDigestAliased: aliasedDigestContent };
}

/** Already-aliased free-text fields for one line, keyed off the planner context (same alias pass, by construction). */
interface AliasedLineText {
  priorityNote: string | null;
  description: string | null;
  extra: Record<string, string | number | boolean | null> | null;
}

/** The COMPLETE uploaded line for the item agents — free-text fields come pre-aliased via `aliasedTextByLineId`. */
function buildWorkerBomLines(
  toOrderLines: BomLineRow[],
  buildQty: number,
  aliasedTextByLineId: Map<string, AliasedLineText>,
): WorkerBomLine[] {
  return toOrderLines.map((l) => {
    const aliased = aliasedTextByLineId.get(l.id);
    return {
      bomLineId: l.id,
      lineNo: l.line_no,
      refDesignators: l.references,
      // DNP lines need nothing (mirrors reconcile's own need math) — the dnp
      // flag tells the planner to skip, qty 0 makes over-ordering impossible.
      qty: l.dnp ? 0 : (l.qty ?? 0) * buildQty,
      value: l.value,
      footprint: l.footprint,
      packageName: derivePackageFromFootprint(l.footprint),
      voltage: splitValueVoltage(l.value).voltage,
      mpn: l.mpn,
      manufacturer: l.manufacturer,
      lcscPn: l.lcsc_pn,
      dnp: l.dnp,
      description: aliased?.description ?? null,
      partLink: l.part_link,
      extra: aliased?.extra ?? null,
      priorityNote: aliased?.priorityNote ?? null,
    };
  });
}

export interface EnqueueRunInput {
  bomId: string;
  tier: ConcurrencyPreset;
  actorId: string;
}

/**
 * Creates the run + jobs from the Ordering Workspace's "Run ordering →"
 * (or Review's "↺ Re-run whole order", which calls this same function with a
 * fresh run). `service` MUST be a service-role client (see module doc) —
 * callers get it from `createServiceClient()`, never a per-request one.
 */
export async function enqueueRun(supabase: DB, service: DB, input: EnqueueRunInput): Promise<EnqueueRunResult> {
  const loaded = await loadBomContext(supabase, input.bomId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { bom, project, toOrderLines, inStockLines, effectiveSequence } = loaded;

  if (toOrderLines.length === 0) {
    return { ok: false, error: "Nothing to order — every line on this BOM is already in stock." };
  }

  // Digest read needs the service client (smark_learned_rules_doc is owner-only RLS; see buildAliasedRunContext doc).
  const { plannerContext, rulesDigestVersion, rulesDigestAliased } = await buildAliasedRunContext(service, {
    bom,
    project,
    toOrderLines,
    effectiveSequence,
  });

  // plannerContext.lines is index-aligned with toOrderLines — pull the already-aliased free-text fields back per line id.
  const aliasedTextByLineId = new Map(
    plannerContext.lines.map(
      (l, i) =>
        [
          toOrderLines[i]!.id,
          { priorityNote: l.priorityNote ?? null, description: l.description ?? null, extra: l.extra ?? null },
        ] as const,
    ),
  );
  const workerLines = buildWorkerBomLines(toOrderLines, bom.build_qty, aliasedTextByLineId);

  const distributorDescriptors: DistributorDescriptor[] = effectiveSequence.map((d) => ({
    id: d.id,
    name: d.name,
    apiType: d.apiType,
    rank: d.rank,
    enabled: d.enabled,
  }));

  const dryRun = computeDryRunEstimate({ toOrderLineCount: toOrderLines.length, tier: input.tier });
  const tierConfig = CONCURRENCY_TIER_PRESETS[input.tier];
  const runId = crypto.randomUUID();

  const config: WorkerRunConfig = {
    runId,
    bomId: bom.id,
    aliasedProjectLabel: plannerContext.clientCode ? `${plannerContext.projectCode} (${plannerContext.clientCode})` : plannerContext.projectCode,
    distributorSequence: distributorDescriptors,
    overallPriorities: plannerContext.priorities ?? "",
    rulesDigest: rulesDigestAliased,
    rulesDigestVersion,
    orderingLadder: ["mpn", "lcsc", "value", "package", "status", "qty", "cost"],
    concurrencyPreset: input.tier,
    lines: workerLines,
    // The planner sees the COMPLETE file: already-stocked lines ride along as
    // public-safe summaries (no jobs, no free text — see InStockLineSummary).
    inStockLines: inStockLines.map((l) => ({
      lineNo: l.line_no,
      refDesignators: l.references,
      mpn: l.mpn,
      value: l.value,
      qty: l.dnp ? 0 : (l.qty ?? 0) * bom.build_qty,
    })),
    rupeeCeiling: computeRupeeCeiling(dryRun),
  };

  const { error: runInsertError } = await supabase.from(TABLES.agent_runs).insert({
    id: runId,
    bom_id: bom.id,
    status: "planning",
    concurrency_preset: input.tier,
    fanout_width: tierConfig.fanoutWidth,
    depth_per_item: tierConfig.depthPerItem,
    per_site_cap: INFORMATIONAL_PER_SITE_CAP,
    est_cost: dryRun.estimatedRupees,
    actual_cost: null,
    plan: { config, masterPlan: null, appMeta: { buildQtyAtRun: bom.build_qty } },
    rules_doc_version: rulesDigestVersion || null,
    started_by: input.actorId,
  });
  if (runInsertError) return { ok: false, error: `Could not start the run: ${runInsertError.message}` };

  const { error: jobsError } = await service.from(TABLES.order_jobs).insert(
    toOrderLines.map((l) => ({ run_id: runId, bom_line_id: l.id, plan: null, status: "queued" as const })),
  );
  if (jobsError) {
    await supabase.from(TABLES.agent_runs).update({ status: "failed", plan: { failureReason: jobsError.message } }).eq("id", runId);
    return { ok: false, error: `Could not queue the run's jobs: ${jobsError.message}` };
  }

  const { error: bomUpdateError } = await supabase
    .from(TABLES.boms)
    .update({ saved_run_id: runId, distributor_sequence: toStoredSequence(effectiveSequence) })
    .eq("id", bom.id);
  if (bomUpdateError) return { ok: false, error: `Run started but the BOM record couldn't be updated: ${bomUpdateError.message}` };

  return { ok: true, runId };
}

/**
 * "↺ Re-run this item" (plan/tab-order-review.md §2) — queues ONE fresh
 * `smark_order_jobs` row for a single line on an EXISTING run, reusing that
 * run's already-planned distributor order for the line rather than paying
 * for a second Opus planning call (Opus plans once per run, FEATURES §4).
 * Flips the run back `review → running` (the one deliberate exception to the
 * worker's own forward-only planning/running/review walk — see
 * worker/src/runs.ts; a human re-opening a stored review for one more look
 * is not the worker cycling backward on its own).
 */
export async function reRunItem(supabase: DB, service: DB, input: { runId: string; bomLineId: string }): Promise<EnqueueRunResult> {
  const { data: run, error: runError } = await supabase.from(TABLES.agent_runs).select("*").eq("id", input.runId).maybeSingle();
  if (runError) return { ok: false, error: runError.message };
  if (!run) return { ok: false, error: "That run no longer exists." };

  const envelope = run.plan as { config?: WorkerRunConfig } | null;
  const config = envelope?.config;
  if (!config) return { ok: false, error: "This run has no stored plan to re-run from." };

  const line = config.lines.find((l) => l.bomLineId === input.bomLineId);
  if (!line) return { ok: false, error: "That line isn't part of this run." };

  const plannedSearch: PlannedSearch = {
    bomLineId: input.bomLineId,
    distributorOrder: config.distributorSequence.filter((d) => d.enabled).map((d) => d.name),
    // Same deterministic derivation as the planner's fallback (worker/src/planner.ts defaultSearchTerm).
    searchTerm: line.mpn ?? line.lcscPn ?? ([line.value, line.packageName].filter(Boolean).join(" ") || null),
    notes: "Re-run requested from the review screen.",
    ruleHit: null,
  };

  const { error: jobError } = await service
    .from(TABLES.order_jobs)
    .insert({ run_id: input.runId, bom_line_id: input.bomLineId, plan: plannedSearch, status: "queued" });
  if (jobError) return { ok: false, error: jobError.message };

  await supabase.from(TABLES.agent_runs).update({ status: "running" }).eq("id", input.runId).eq("status", "review");

  return { ok: true, runId: input.runId };
}

/** "↺ Re-run whole order" — a fresh run for the same BOM; updates `saved_run_id` to point at it. */
export async function reRunWholeOrder(supabase: DB, service: DB, input: { bomId: string; tier: ConcurrencyPreset; actorId: string }): Promise<EnqueueRunResult> {
  return enqueueRun(supabase, service, input);
}
