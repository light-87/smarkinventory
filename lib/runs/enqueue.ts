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
import { isLowStock } from "./stock";

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
  /** Every line for this BOM, ordered by line_no — the desktop full-BOM sourcing set. */
  allLines: BomLineRow[];
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

  const { data: lines, error: linesError } = await supabase
    .from(TABLES.bom_lines)
    .select("*")
    .eq("bom_id", bomId)
    .order("line_no", { ascending: true, nullsFirst: false });
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

  return { bom, project, allLines, toOrderLines, inStockLines, effectiveSequence };
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

/**
 * Desktop-only: the CLAUDE.md generator inside the ALREADY-INSTALLED desktop
 * runner (desktop/runner/session.ts) renders each line's `priorityNote` but
 * not `lcscPn`/`partLink`/`extra`, so those columns never reached the sourcing
 * agent. Folding them into the note is a pure server-side fix — every desktop
 * app already deployed on client machines picks it up on the next run with NO
 * re-install (the fix travels in the run config, not the binary). Leads with
 * LCSC PN because "LCSC PN given → source from LCSC only" is ordering rule #2.
 * Not applied to the cloud worker path (enqueueRun) — its prompts render these
 * fields first-class already.
 */
function foldColumnsIntoNoteForDesktop(line: WorkerBomLine): WorkerBomLine {
  const parts: string[] = [];
  if (line.lcscPn) parts.push(`LCSC PN: ${line.lcscPn}`);
  if (line.partLink) parts.push(`part link: ${line.partLink}`);
  if (line.extra) {
    for (const [key, value] of Object.entries(line.extra)) {
      if (value !== null && value !== "") parts.push(`${key}: ${value}`);
    }
  }
  if (parts.length === 0) return line;
  const existing = line.priorityNote ? ` · ${line.priorityNote}` : "";
  return { ...line, priorityNote: parts.join(" · ") + existing };
}

/**
 * Desktop low-stock "find an alternative" instruction (feature #9), injected
 * into a line's `priorityNote` (rendered by the already-installed desktop
 * runner — no re-install). It deliberately overrides the exact-MPN-first bias
 * for THIS line only: the previously recommended part is short on stock, so the
 * agent should keep it if it's since restocked, else find a different in-stock
 * equivalent matching value + package/size + the part-type electrical rating.
 * Best-effort by design (the agent reads listings) and flagged for review.
 */
function buildLowStockAlternativeNote(stock: number | null, needed: number): string {
  return (
    `ALTERNATIVES REQUESTED — the previously recommended part is low on stock (only ${stock ?? "?"}, need ${needed}). ` +
    `First, if the EXACT part is now sufficiently in stock, keep it. Otherwise find a DIFFERENT in-stock equivalent: ` +
    `same value, same package/size, and matching the electrical rating for this part type — resistor → voltage & power (wattage); ` +
    `inductor → current rating; capacitor → voltage & dielectric. Must have stock ≥ ${needed}. ` +
    `Check the distributors in the given order. Recommend the best in-stock equivalent and explain why; flagged for human review.`
  );
}

function withLowStockAlternativeNote(line: WorkerBomLine, note: string): WorkerBomLine {
  return { ...line, priorityNote: line.priorityNote ? `${note}\n${line.priorityNote}` : note };
}

/**
 * Full-BOM desktop runs source EVERY line (user decision 2026-07-20), including
 * ones the catalog already stocks. This tags those lines so the agent treats them
 * as price-comparison context, not a shortfall — and crucially does NOT skip them.
 */
function withInStockContextNote(line: WorkerBomLine): WorkerBomLine {
  const tag = "INVENTORY: this part is already in stock — source it anyway for price comparison (context only, do NOT skip).";
  return { ...line, priorityNote: line.priorityNote ? `${tag}\n${line.priorityNote}` : tag };
}

export interface EnqueueRunInput {
  bomId: string;
  tier: ConcurrencyPreset;
  actorId: string;
  /**
   * Sandbox test runs (/ai_orc): only the FIRST N to-order lines (by line #)
   * get planner context + jobs — the rest of the BOM is left out of the run
   * entirely, so a 5-line trial costs 5 lanes, not 100. Omit for real runs.
   */
  lineLimit?: number;
}

/**
 * (Krunal 2026-07-18) A hard "run to completion / never stop / don't claim done
 * early" directive for the DESKTOP agent, injected into its CLAUDE.md via
 * `overallPriorities` — a server-controlled field the desktop pulls fresh every
 * run, so this reaches every new run with NO desktop reinstall. Addresses the
 * agent pausing to ask which approach to take, and declaring "deliverable
 * complete" before every line has actually been written to results.json.
 */
export function buildRunToCompletionDirective(lineCount: number): string {
  return [
    "RUN TO COMPLETION — the single most important rule, above all others.",
    "You are running FULLY UNATTENDED: no human is watching to answer questions. NEVER stop to ask which approach to take, NEVER pause for confirmation, NEVER wait for input — if unsure, pick the most reasonable option and keep going.",
    `This BOM has ${lineCount} lines and you must produce a REAL result for every one — that is the whole job, not a sample. Do NOT say you are "done"/"finished"/"deliverable complete", and do NOT set "complete": true, until all ${lineCount} lines are genuinely resolved.`,
    // Redefine "done" so empty placeholders can't pass a count-only check (the agent
    // filled 64 of 68 lines with empty candidates:[] and still claimed complete).
    `A line is resolved ONLY IF its results.json entry has at least one real candidate, OR it is a DNP line ("skipped": "DNP"), OR you genuinely could not source it — "candidates": [] WITH a specific "notes" stating what you searched and why nothing qualified. An empty "candidates": [] with no real search behind it does NOT count. Counting entries is not enough; each entry must be real.`,
    // Retry threshold — the agent gave up after a single screenshot timeout.
    "Before recording an empty result for a line, make a GENUINE attempt: actually search the enabled distributors for it, and if a search errors or times out, RETRY it at least once — a single timeout or one failed page load is NOT a genuine attempt. Only after real attempts may you record an empty result and MOVE ON. One hard line must never stop or pause the whole run.",
    // Browser hygiene — the agent broke a URL by not encoding "0.1%" and wasted time on screenshots.
    'When you build a search URL, URL-ENCODE the query — encode %, &, #, +, and spaces (e.g. "0.1%" and "470K 1206" must be percent-encoded) — or type into the site\'s own search box instead. Read pages via the TEXT snapshot; do NOT take screenshots (they time out and burn the run).',
    // Distributor rule clarity — the agent read the per-line LCSC rule as contradicting the order.
    'Distributor rules do not conflict: the run\'s distributor ORDER (e.g. "LCSC → Unikey") is the global order to try for a normal line. The per-line rule "LCSC PN given → source from LCSC only" overrides the order for THAT line alone. Follow the per-line rule when a line has an LCSC PN; otherwise follow the global order.',
    "Write results.json after each line so progress is never lost, and work through the lines in efficient batches.",
  ].join(" ");
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
  const { bom, project, inStockLines, effectiveSequence } = loaded;

  if (loaded.toOrderLines.length === 0) {
    return { ok: false, error: "Nothing to order — every line on this BOM is already in stock." };
  }

  // Sandbox line limit: first N lines by sheet order (see EnqueueRunInput doc).
  const lineLimit =
    typeof input.lineLimit === "number" && Number.isFinite(input.lineLimit) && input.lineLimit >= 1
      ? Math.floor(input.lineLimit)
      : null;
  const toOrderLines = lineLimit
    ? [...loaded.toOrderLines].sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0)).slice(0, lineLimit)
    : loaded.toOrderLines;

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
    plan: { config, masterPlan: null, appMeta: { buildQtyAtRun: bom.build_qty, lineLimit } },
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

export type DesktopRunContextResult =
  | { ok: true; runId: string; projectId: string; config: WorkerRunConfig }
  | { ok: false; error: string };

/**
 * Desktop companion app (plan: SmarkStock Desktop, F-013 pivot) — builds the
 * SAME aliased run context a worker run gets, but the EXECUTION happens on
 * the user's PC (their own Claude Code session driving a real browser), so:
 *   - the run row is created with status "running" (not "planning") and
 *     `plan.appMeta.executor = "desktop"`, and
 *   - NO `smark_order_jobs` rows are inserted —
 * both of which keep the always-on worker from ever claiming it
 * (processPlanningRuns only takes status "planning"; processQueuedJobs only
 * takes queued job rows). Results come back through
 * app/api/desktop/results, which flips the run to "review" — from there the
 * existing review/feedback/cart surfaces work unchanged.
 */
export async function createDesktopRun(
  supabase: DB,
  service: DB,
  input: { bomId: string; actorId: string; lineLimit?: number; clientRendersColumns?: boolean; resourceAll?: boolean },
): Promise<DesktopRunContextResult> {
  const loaded = await loadBomContext(supabase, input.bomId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { bom, project, allLines, inStockLines, effectiveSequence } = loaded;

  // Full-BOM desktop runs (user decision 2026-07-20): source EVERY line, in-stock
  // included — stock is shown per line as context, never a filter. Only a genuinely
  // empty BOM has nothing to do.
  if (allLines.length === 0) {
    return { ok: false, error: "This BOM has no lines to source." };
  }

  // Resume + low-stock alternatives (no reinstall). On a re-run we look at the
  // BOM's previous run and split its already-sourced lines two ways:
  //   • GOOD (recommended stock covers the need, or unknown) → reuse: dropped
  //     from `config.lines` (agent skips them) and their prior results CLONED
  //     onto this run so review still shows the full order.
  //   • LOW-STOCK (recommended stock < needed) → re-source in "alternatives"
  //     mode (feature #9): kept in `config.lines` with an injected note telling
  //     the agent to find an in-stock equivalent; prior results NOT cloned.
  // Never-sourced lines fall through and are sourced normally (exact). This is
  // exactly what "run only the low-stock items and suggest equivalents" needs,
  // triggered by a plain desktop re-run. `resourceAll` opts out of the whole
  // split (full exact re-source). All server-side — the installed app is unchanged.
  const priorRunId = bom.saved_run_id;
  const reusedResults: Record<string, unknown>[] = [];
  const reusedLineIds = new Set<string>();
  const alternativeNoteByLineId = new Map<string, string>();

  const neededByLineId = new Map<string, number>();
  for (const l of allLines) neededByLineId.set(l.id, l.dnp ? 0 : (l.qty ?? 0) * bom.build_qty);

  if (!input.resourceAll && priorRunId) {
    const { data: prior, error: priorError } = await service
      .from(TABLES.agent_results)
      .select("*")
      .eq("run_id", priorRunId);
    if (priorError) return { ok: false, error: `Could not read the previous run's results: ${priorError.message}` };

    const rowsByLine = new Map<string, Record<string, unknown>[]>();
    for (const r of (prior ?? []) as Record<string, unknown>[]) {
      const lid = r["bom_line_id"] as string;
      (rowsByLine.get(lid) ?? rowsByLine.set(lid, []).get(lid)!).push(r);
    }
    for (const [lid, rows] of rowsByLine) {
      const needed = neededByLineId.get(lid) ?? 0;
      const recommended = rows.find((r) => r["is_recommended"] === true) ?? null;
      const recStock = recommended ? (recommended["stock_qty"] as number | null) : null;
      if (isLowStock(recStock, needed)) {
        alternativeNoteByLineId.set(lid, buildLowStockAlternativeNote(recStock, needed));
      } else {
        reusedLineIds.add(lid);
        reusedResults.push(...rows);
      }
    }
  }

  // Full BOM minus any lines reused from a prior run (their results are cloned below).
  // On a first run reusedLineIds is empty, so this is every line on the BOM.
  const remainingToOrder = allLines.filter((l) => !reusedLineIds.has(l.id));
  if (remainingToOrder.length === 0) {
    return {
      ok: false,
      error:
        "Every line on this BOM is already sourced from a previous run — open its review on the web. Tick “Re-source all” to source them again.",
    };
  }

  const lineLimit =
    typeof input.lineLimit === "number" && Number.isFinite(input.lineLimit) && input.lineLimit >= 1
      ? Math.floor(input.lineLimit)
      : null;
  const toOrderLines = lineLimit
    ? [...remainingToOrder].sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0)).slice(0, lineLimit)
    : remainingToOrder;

  const { plannerContext, rulesDigestVersion, rulesDigestAliased } = await buildAliasedRunContext(service, {
    bom,
    project,
    toOrderLines,
    effectiveSequence,
  });

  const aliasedTextByLineId = new Map(
    plannerContext.lines.map(
      (l, i) =>
        [
          toOrderLines[i]!.id,
          { priorityNote: l.priorityNote ?? null, description: l.description ?? null, extra: l.extra ?? null },
        ] as const,
    ),
  );
  // Fold LCSC PN / part link / custom columns into each line's note so an
  // OLDER desktop runner (which only prints `priorityNote`) still shows the
  // agent every column — no re-install needed. v0.2.0+ clients render those
  // columns first-class and send `clientRendersColumns`, so we skip the fold
  // to avoid printing them twice.
  const baseLines = buildWorkerBomLines(toOrderLines, bom.build_qty, aliasedTextByLineId);
  const foldedLines = input.clientRendersColumns ? baseLines : baseLines.map(foldColumnsIntoNoteForDesktop);
  // Feature #9: low-stock lines carry the "find an in-stock equivalent" note.
  const matchStateByLineId = new Map(allLines.map((l) => [l.id, l.match_state] as const));
  const workerLines = foldedLines.map((wl) => {
    let out = wl;
    const note = alternativeNoteByLineId.get(wl.bomLineId);
    if (note) out = withLowStockAlternativeNote(out, note);
    // Full-BOM context: tag lines the catalog already covers so the agent treats them
    // as price comparison, not a shortfall — never a reason to skip (DNP lines excepted).
    if (!wl.dnp && matchStateByLineId.get(wl.bomLineId) === "in_stock") out = withInStockContextNote(out);
    return out;
  });

  // (Krunal 2026-07-18) Prepend the run-to-completion directive to the buyer's
  // own priorities. Injected here (server-side) so the desktop CLAUDE.md gets it
  // with NO reinstall — the runner already renders overallPriorities verbatim.
  const overallPriorities = [buildRunToCompletionDirective(workerLines.length), plannerContext.priorities ?? ""]
    .filter(Boolean)
    .join("\n\n");

  const runId = crypto.randomUUID();
  const config: WorkerRunConfig = {
    runId,
    bomId: bom.id,
    aliasedProjectLabel: plannerContext.clientCode ? `${plannerContext.projectCode} (${plannerContext.clientCode})` : plannerContext.projectCode,
    distributorSequence: effectiveSequence.map((d) => ({ id: d.id, name: d.name, apiType: d.apiType, rank: d.rank, enabled: d.enabled })),
    overallPriorities,
    rulesDigest: rulesDigestAliased,
    rulesDigestVersion,
    orderingLadder: ["mpn", "lcsc", "value", "package", "status", "qty", "cost"],
    concurrencyPreset: "balanced", // informational — desktop runs one supervised session, not a fanout
    lines: workerLines,
    inStockLines: inStockLines.map((l) => ({
      lineNo: l.line_no,
      refDesignators: l.references,
      mpn: l.mpn,
      value: l.value,
      qty: l.dnp ? 0 : (l.qty ?? 0) * bom.build_qty,
    })),
    rupeeCeiling: 0, // execution cost is on the user's own Claude plan/key — nothing metered server-side
  };

  const { error: runInsertError } = await supabase.from(TABLES.agent_runs).insert({
    id: runId,
    bom_id: bom.id,
    status: "running",
    concurrency_preset: "balanced",
    fanout_width: 1,
    depth_per_item: effectiveSequence.filter((d) => d.enabled).length,
    per_site_cap: 1,
    est_cost: 0,
    actual_cost: null,
    plan: {
      config,
      masterPlan: null,
      appMeta: {
        buildQtyAtRun: bom.build_qty,
        lineLimit,
        executor: "desktop",
        ...(alternativeNoteByLineId.size > 0 ? { alternativesLineIds: [...alternativeNoteByLineId.keys()] } : {}),
      },
    },
    rules_doc_version: rulesDigestVersion || null,
    started_by: input.actorId,
  });
  if (runInsertError) return { ok: false, error: `Could not create the desktop run: ${runInsertError.message}` };

  // Carry the reused lines' prior results forward onto this run so the review
  // shows the full order (reused + newly sourced). Strip identity/timestamps
  // (baseRow: id/created_at/updated_at) and re-point run_id — every other
  // column, incl. the earlier selection, is preserved. Service client:
  // smark_agent_results is service-role-only RLS (0004).
  if (reusedResults.length > 0) {
    const clones = reusedResults.map((r) => {
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = r;
      void _id;
      void _c;
      void _u;
      return { ...rest, run_id: runId };
    });
    const { error: cloneError } = await service.from(TABLES.agent_results).insert(clones as never);
    if (cloneError) return { ok: false, error: `Run created but reused results couldn't be carried over: ${cloneError.message}` };
  }

  const { error: bomUpdateError } = await supabase
    .from(TABLES.boms)
    .update({ saved_run_id: runId, distributor_sequence: toStoredSequence(effectiveSequence) })
    .eq("id", bom.id);
  if (bomUpdateError) return { ok: false, error: `Run created but the BOM record couldn't be updated: ${bomUpdateError.message}` };

  return { ok: true, runId, projectId: project.id, config };
}
