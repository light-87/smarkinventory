/**
 * worker/src/planner.ts — the Opus MASTER PLANNER (FEATURES.md §4/§6).
 *
 * Called ONCE per run. Takes the already-aliased `WorkerRunConfig` (client/
 * project names are already `PROJ-03`-style codes or absent entirely — see
 * types/worker.ts header) and asks Opus for a JSON search plan. Opus NEVER
 * fetches distributor data itself — `item-agent.ts` does that, using this
 * plan's per-line `distributorOrder` as a starting point.
 *
 * Mock-first: with no `ANTHROPIC_API_KEY`, `planRun` takes the deterministic
 * `mockMasterPlan` path — no network call, no cost — so the full pipeline
 * (enqueue → claim → plan → item results → stream → review) is exercisable
 * end-to-end in CI/E2E without live keys (build brief: "the full pipeline
 * must be exercisable end-to-end in mock mode").
 */

import { estimateCallCostRupees } from "./caps";
import { extractJsonObject, type ClaudePort } from "./claude-port";
import type { WorkerEnv } from "./env";
import type { ClaudeMasterPlan, CostEstimate, PlannedSearch, SkipDecision, WorkerRunConfig } from "../../types/worker";

const SYSTEM_PROMPT = `You are the master ordering planner for SmarkStock, an electronics-inventory ordering system.
You NEVER browse or fetch live distributor data yourself — item-level agents do that afterwards, using
your plan as their starting point. Your ONLY job is to read the run configuration (already
pseudonymized: no real client/project names, only public catalog identifiers like MPN/LCSC-PN/package
and a code like "PROJ-03") and return a single JSON object, nothing else, matching EXACTLY this shape:

{
  "searches": [ { "bomLineId": string, "distributorOrder": string[], "notes": string|null, "ruleHit": {"ruleId": string, "ruleSummary": string} | null } ],
  "skip": [ { "bomLineId": string, "reason": string, "ruleHit": {"ruleId": string, "ruleSummary": string} | null } ],
  "narration": string
}

Rules:
- Every bomLineId from the input MUST appear in exactly one of "searches" or "skip" — never both, never omitted.
- "distributorOrder" is a reordering/subset of the run's enabled distributor names, tailored to this
  line (e.g. honor a per-line priority note like "LCSC only"; move a distributor earlier if the active
  rules digest names a preference for this part/category).
- Only use "skip" when the rules digest or a line's own note clearly says this part is already
  sufficiently stocked or should not be sourced this run — cite the rule in "ruleHit" when you do.
- "package" is a MANDATORY match rung — never suggest skipping the package check.
- "narration" is one short sentence for a live progress UI, in the form
  "Planned N searches · dispatched N item agents." (N = searches.length).
- Output raw JSON only — no prose before or after, no markdown code fence.`;

export function buildMasterPrompt(config: WorkerRunConfig): string {
  const lines = config.lines.map((line) => ({
    bomLineId: line.bomLineId,
    refDesignators: line.refDesignators,
    qty: line.qty,
    value: line.value,
    packageName: line.packageName,
    voltage: line.voltage,
    mpn: line.mpn,
    manufacturer: line.manufacturer,
    lcscPn: line.lcscPn,
    priorityNote: line.priorityNote,
  }));

  const enabledDistributors = config.distributorSequence
    .filter((d) => d.enabled)
    .sort((a, b) => a.rank - b.rank)
    .map((d) => d.name);

  return JSON.stringify(
    {
      project: config.aliasedProjectLabel,
      distributorSequence: enabledDistributors,
      orderingLadder: config.orderingLadder,
      overallPriorities: config.overallPriorities,
      activeRulesDigest: config.rulesDigest,
      lines,
    },
    null,
    2,
  );
}

/**
 * Defensive pass: guarantees every input line is accounted for exactly once,
 * regardless of what the model returned. Skip wins on a duplicate — it is
 * the more specific, harder-to-justify decision, so a model that both
 * "searched" and "skipped" a line most likely meant to skip it.
 */
export function reconcilePlanWithLines(plan: ClaudeMasterPlan, config: WorkerRunConfig): ClaudeMasterPlan {
  const validIds = new Set(config.lines.map((l) => l.bomLineId));
  const skipById = new Map(plan.skip.filter((s) => validIds.has(s.bomLineId)).map((s) => [s.bomLineId, s]));
  const searchById = new Map(
    plan.searches.filter((s) => validIds.has(s.bomLineId) && !skipById.has(s.bomLineId)).map((s) => [s.bomLineId, s]),
  );

  const enabledDistributors = config.distributorSequence
    .filter((d) => d.enabled)
    .sort((a, b) => a.rank - b.rank)
    .map((d) => d.name);

  const searches: PlannedSearch[] = [];
  const skip: SkipDecision[] = [];
  for (const line of config.lines) {
    const skipDecision = skipById.get(line.bomLineId);
    if (skipDecision) {
      skip.push(skipDecision);
      continue;
    }
    const search = searchById.get(line.bomLineId);
    searches.push(
      search ?? {
        bomLineId: line.bomLineId,
        distributorOrder: enabledDistributors,
        notes: null,
        ruleHit: null,
      },
    );
  }

  return { searches, skip, narration: plan.narration || `Planned ${searches.length} searches · dispatched ${searches.length} item agents.` };
}

/** Deterministic, network-free stand-in for Opus — selected when `ANTHROPIC_API_KEY` is absent. */
export function mockMasterPlan(config: WorkerRunConfig): ClaudeMasterPlan {
  const enabledDistributors = config.distributorSequence
    .filter((d) => d.enabled)
    .sort((a, b) => a.rank - b.rank)
    .map((d) => d.name);

  const searches: PlannedSearch[] = [];
  const skip: SkipDecision[] = [];

  for (const line of config.lines) {
    // Deterministic "already stocked" demo hook for e2e fixtures — a line
    // whose priority note mentions it explicitly is skipped, citing that
    // note back as the rule hit (mirrors the shape a real learned-rule
    // citation would take, without needing live rule data in mock mode).
    if (line.priorityNote?.toLowerCase().includes("already_stocked")) {
      skip.push({
        bomLineId: line.bomLineId,
        reason: `Skipped — priority note flags this as already stocked ("${line.priorityNote}").`,
        ruleHit: { ruleId: "mock-already-stocked", ruleSummary: line.priorityNote },
      });
      continue;
    }

    // LCSC-PN present, no MPN → ladder rung 2 ("LCSC PN → LCSC only") wins;
    // otherwise honor an explicit "LCSC only" style priority note; otherwise
    // use the full enabled sequence in rank order.
    let distributorOrder = enabledDistributors;
    let notes: string | null = null;
    if (line.lcscPn && !line.mpn) {
      distributorOrder = enabledDistributors.filter((name) => name === "LCSC");
      if (distributorOrder.length === 0) distributorOrder = enabledDistributors;
      notes = "LCSC PN present, no MPN — ladder rung 2 (LCSC-PN → LCSC only).";
    } else if (line.priorityNote?.toLowerCase().includes("lcsc only")) {
      distributorOrder = enabledDistributors.filter((name) => name === "LCSC");
      if (distributorOrder.length === 0) distributorOrder = enabledDistributors;
      notes = `Per-line note: "${line.priorityNote}".`;
    }

    searches.push({ bomLineId: line.bomLineId, distributorOrder, notes, ruleHit: null });
  }

  return {
    searches,
    skip,
    narration: `Planned ${searches.length} searches · dispatched ${searches.length} item agents.`,
  };
}

export interface PlanRunResult {
  plan: ClaudeMasterPlan;
  cost: CostEstimate;
}

export async function planRun(
  env: Pick<WorkerEnv, "anthropicApiKey" | "claudeModelMaster">,
  config: WorkerRunConfig,
  claudePort?: ClaudePort,
): Promise<PlanRunResult> {
  if (!env.anthropicApiKey || !claudePort) {
    const plan = reconcilePlanWithLines(mockMasterPlan(config), config);
    return { plan, cost: { estimatedRupees: 0, tokenUsage: { inputTokens: 0, outputTokens: 0 } } };
  }

  const result = await claudePort.complete({
    model: env.claudeModelMaster,
    system: SYSTEM_PROMPT,
    userMessage: buildMasterPrompt(config),
    maxTokens: 4000,
    effort: "medium",
  });

  const raw = extractJsonObject<ClaudeMasterPlan>(result.text);
  const plan = reconcilePlanWithLines(raw, config);
  const estimatedRupees = estimateCallCostRupees(env.claudeModelMaster, result.tokensIn, result.tokensOut);
  return {
    plan,
    cost: { estimatedRupees, tokenUsage: { inputTokens: result.tokensIn, outputTokens: result.tokensOut } },
  };
}
