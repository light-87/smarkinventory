/**
 * worker/src/prompts.ts — the EXACT prompt text/payloads sent to Claude, in
 * one pure module (no I/O, no worker-runtime imports beyond shared types).
 *
 * Two consumers, one source of truth:
 *   - worker/src/planner.ts + item-agent.ts build the real calls from these;
 *   - the app's /ai_orc observatory re-renders them from a stored run config
 *     so the owner sees byte-for-byte what each model saw (docs/OWNERSHIP.md
 *     cross-import note) — keeping a display copy in the app would drift.
 */

import type { DistributorListingResult, WorkerBomLine, WorkerRunConfig } from "../../types/worker";

export const MASTER_SYSTEM_PROMPT = `You are the master ordering planner for SmarkStock, an electronics-inventory ordering system.
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
- Every bomLineId from the input's "lines" MUST appear in exactly one of "searches" or "skip" — never
  both, never omitted.
- "inStockLines" (when present) are lines already fully covered by stock — they have NO bomLineId and
  must NOT appear in your output; they exist so you see the complete uploaded BOM for context.
- A line with "dnp": true is marked Do-Not-Populate on the BOM (its qty is already 0) — put it in
  "skip" with a reason like "DNP — not populated on this build".
- "distributorOrder" is a reordering/subset of the run's enabled distributor names, tailored to this
  line (e.g. honor a per-line priority note like "LCSC only"; move a distributor earlier if the active
  rules digest names a preference for this part/category; a "partLink" URL hints which distributor the
  BOM's author bought from).
- Only use "skip" when the line is dnp, or the rules digest or the line's own note clearly says this
  part is already sufficiently stocked or should not be sourced this run — cite the rule in "ruleHit"
  when you do.
- "package" is a MANDATORY match rung — never suggest skipping the package check.
- "narration" is one short sentence for a live progress UI, in the form
  "Planned N searches · dispatched N item agents." (N = searches.length).
- Output raw JSON only — no prose before or after, no markdown code fence.`;

export const ITEM_SYSTEM_PROMPT = `You are a per-item ordering agent for SmarkStock. A deterministic system has
already fetched distributor listings for this BOM line and computed OBJECTIVE match flags
(package match, MPN match quality) for each — you must NOT contradict those flags. Your job is:
1. Optionally recommend ONE listing from the candidates whose "packageMatch" is true (package is a
   MANDATORY rung — you may never recommend a listing that doesn't match it, and never invent one).
2. Write one short "why" sentence citing the basis of your pick (or of the deterministic pick, if you
   don't override it) and any faults of the alternatives. Cite the active rules digest by name if it
   applies to this part/category.
Return ONLY this JSON object, nothing else:
{ "recommendedDistributorName": string | null, "why": string }`;

/** The Opus master call's user message — byte-for-byte what planRun sends. */
export function buildMasterPrompt(config: WorkerRunConfig): string {
  // The COMPLETE uploaded line ("the agent gets the whole BOM" decision) —
  // free-text fields (description/priorityNote/extra) arrive pre-aliased.
  const lines = config.lines.map((line) => ({
    bomLineId: line.bomLineId,
    lineNo: line.lineNo ?? null,
    refDesignators: line.refDesignators,
    qty: line.qty,
    dnp: line.dnp ?? false,
    value: line.value,
    footprint: line.footprint ?? null,
    packageName: line.packageName,
    voltage: line.voltage,
    description: line.description ?? null,
    mpn: line.mpn,
    manufacturer: line.manufacturer,
    lcscPn: line.lcscPn,
    partLink: line.partLink ?? null,
    priorityNote: line.priorityNote,
    extra: line.extra ?? null,
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
      inStockLines: config.inStockLines ?? [],
    },
    null,
    2,
  );
}

/** The Sonnet per-item call's user message — byte-for-byte what runItemAgent sends. */
export function buildItemPrompt(line: WorkerBomLine, listings: DistributorListingResult[], rulesDigest: string): string {
  return JSON.stringify(
    {
      // The complete uploaded line — description/priorityNote/extra arrive pre-aliased (types/worker.ts).
      line: {
        refDesignators: line.refDesignators,
        mpn: line.mpn,
        value: line.value,
        footprint: line.footprint ?? null,
        packageName: line.packageName,
        voltage: line.voltage,
        description: line.description ?? null,
        manufacturer: line.manufacturer,
        partLink: line.partLink ?? null,
        qtyNeeded: line.qty,
        priorityNote: line.priorityNote,
        extra: line.extra ?? null,
      },
      candidates: listings.map((l) => ({
        distributorName: l.distributorName,
        price: l.price,
        stockQty: l.stockQty,
        mpnMatch: l.mpnMatch,
        packageMatch: l.packageMatch,
        partStatus: l.partStatus,
      })),
      activeRulesDigest: rulesDigest,
    },
    null,
    2,
  );
}
