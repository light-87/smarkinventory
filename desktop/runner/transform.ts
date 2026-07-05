/**
 * desktop/runner/transform.ts — turns the agent-authored results.json into
 * the /api/desktop/results payload. The runner (code, not the model) owns
 * the objective calls: distributor name → id mapping, MPN-match quality and
 * the MANDATORY package rung are recomputed here with the worker's own pure
 * matcher functions — an agent claim of "recommended" never bypasses them
 * (same guard philosophy as worker/src/item-agent.ts).
 */

import { z } from "zod";
import type { WorkerRunConfig } from "../../types/worker";
// Pure functions, zero deps — the one worker module the desktop runner shares (like /ai_orc shares prompts.ts).
import { evaluateMpnMatch, evaluatePackageMatch } from "../../worker/src/matcher-lite";

export const AgentCandidateSchema = z.object({
  distributor: z.string().min(1),
  mpn: z.string().nullable().default(null),
  package: z.string().nullable().default(null),
  stock: z.number().int().nullable().default(null),
  price: z.number().nullable().default(null),
  currency: z.string().default("USD"),
  qtyBreaks: z.array(z.object({ qty: z.number().int().min(1), unitPrice: z.number() })).default([]),
  status: z.enum(["active", "nrnd", "eol"]).nullable().default(null),
  url: z.string().nullable().default(null),
  recommended: z.boolean().default(false),
  why: z.string().default(""),
});

export const AgentResultsFileSchema = z.object({
  complete: z.boolean().default(false),
  lines: z.record(
    z.string(),
    z.object({
      searchTerm: z.string().nullable().default(null),
      notes: z.string().nullable().default(null),
      skipped: z.string().nullable().default(null),
      candidates: z.array(AgentCandidateSchema).default([]),
    }),
  ),
});
export type AgentResultsFile = z.infer<typeof AgentResultsFileSchema>;

export interface TransformOutcome {
  payload: {
    runId: string;
    results: Array<Record<string, unknown>>;
    masterPlan: { narration: string; searches: Array<Record<string, unknown>>; skip: Array<Record<string, unknown>> };
  };
  warnings: string[];
}

export function transformResults(config: WorkerRunConfig, file: AgentResultsFile): TransformOutcome {
  const warnings: string[] = [];
  const distributorIdByName = new Map(config.distributorSequence.map((d) => [d.name.toLowerCase(), d.id]));
  const lineById = new Map(config.lines.map((l) => [l.bomLineId, l]));

  const results: Array<Record<string, unknown>> = [];
  const searches: Array<Record<string, unknown>> = [];
  const skip: Array<Record<string, unknown>> = [];

  for (const [bomLineId, entry] of Object.entries(file.lines)) {
    const line = lineById.get(bomLineId);
    if (!line) {
      warnings.push(`results.json references unknown line ${bomLineId} — dropped`);
      continue;
    }
    if (entry.skipped) {
      skip.push({ bomLineId, reason: entry.skipped, ruleHit: null });
      continue;
    }
    searches.push({
      bomLineId,
      distributorOrder: config.distributorSequence.filter((d) => d.enabled).map((d) => d.name),
      searchTerm: entry.searchTerm,
      notes: entry.notes,
      ruleHit: null,
    });

    const recommendedCount = entry.candidates.filter((c) => c.recommended).length;
    if (recommendedCount > 1) warnings.push(`line ${line.lineNo}: ${recommendedCount} candidates marked recommended — keeping the first`);
    let recommendedSeen = false;

    for (const c of entry.candidates) {
      const distributorId = distributorIdByName.get(c.distributor.toLowerCase());
      if (!distributorId) {
        warnings.push(`line ${line.lineNo}: unknown distributor "${c.distributor}" — candidate dropped`);
        continue;
      }
      // Objective rungs recomputed in CODE — the agent's text never decides these.
      const mpnMatch = evaluateMpnMatch(line.mpn, c.mpn);
      const packageMatch = evaluatePackageMatch(line.packageName, c.package);
      const isRecommended = c.recommended && !recommendedSeen;
      if (isRecommended) recommendedSeen = true;
      if (isRecommended && !packageMatch) {
        warnings.push(`line ${line.lineNo}: recommended candidate fails the mandatory package rung (${line.packageName ?? "no package"} vs ${c.package ?? "none"}) — kept but flagged`);
      }
      results.push({
        bomLineId,
        distributorId,
        distributorName: c.distributor,
        price: c.price,
        currency: c.currency,
        qtyBreaks: c.qtyBreaks,
        stockQty: c.stock,
        mpnMatch,
        packageMatch,
        partStatus: c.status,
        orderLink: c.url,
        isRecommended,
        confidence: isRecommended ? (packageMatch ? 85 : 40) : 55,
        why: c.why || (isRecommended ? "Recommended by the sourcing agent." : ""),
        raw: { source: "desktop-agent", searchTerm: entry.searchTerm, notes: entry.notes },
      });
    }
  }

  const doneLines = Object.keys(file.lines).length;
  return {
    payload: {
      runId: config.runId,
      results,
      masterPlan: {
        narration: `Desktop agent session — ${doneLines}/${config.lines.length} lines sourced, ${results.length} candidates.`,
        searches,
        skip,
      },
    },
    warnings,
  };
}
