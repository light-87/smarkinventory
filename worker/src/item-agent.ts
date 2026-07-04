/**
 * worker/src/item-agent.ts — the Sonnet PER-LINE executor (FEATURES.md
 * §4/§6/§7). Walks the ladder across the distributor sequence via the
 * `DistributorClient` interface, then writes `smark_agent_results` rows.
 *
 * Split of responsibility (deliberate, see matcher-lite.ts header):
 *   - The OBJECTIVE ladder checks (package-mandatory, mpn match quality,
 *     status/qty/cost scoring) are ALWAYS computed deterministically by
 *     `matcher-lite.ts` — an invariant like "package match is mandatory,
 *     never substitutable" must hold even if an LLM call fails, times out,
 *     or hallucinates. This is also exactly what runs in mock mode (no
 *     `ANTHROPIC_API_KEY`) — the full pipeline stays exercisable end-to-end
 *     without live keys.
 *   - WHEN a real key is present, Sonnet gets ONE extra call per line to
 *     supply the natural-language "AI · why" narration and — only within
 *     the deterministically-viable (package-matched) candidate set — an
 *     optional override of which listing is recommended (e.g. citing an
 *     active "prefer_distributor" rule). An invalid/out-of-set pick from
 *     Sonnet is ignored, never trusted blindly.
 */

import { estimateCallCostRupees } from "./caps";
import type { KeyedSemaphore } from "./caps";
import { extractJsonObject, type ClaudePort } from "./claude-port";
import type { DistributorClient, DistributorListing } from "./distributors/types";
import type { WorkerEnv } from "./env";
import { evaluateMpnMatch, evaluatePackageMatch, pickRecommended } from "./matcher-lite";
import type {
  CostEstimate,
  DistributorListingResult,
  ItemAgentOutcome,
  PlannedSearch,
  WorkerBomLine,
} from "../../types/worker";

// Prompt text/payload live in prompts.ts — shared with the app's /ai_orc
// observatory so what it displays is byte-for-byte what this module sends.
import { ITEM_SYSTEM_PROMPT, buildItemPrompt } from "./prompts";

function toResult(
  line: WorkerBomLine,
  listing: DistributorListing,
  distributorId: string,
  isRecommended: boolean,
  confidence: number,
  why: string,
): DistributorListingResult {
  return {
    bomLineId: line.bomLineId,
    distributorId,
    distributorName: listing.distributorName,
    price: listing.price,
    currency: listing.currency,
    qtyBreaks: listing.qtyBreaks.map((b) => ({ qty: b.qty, unitPrice: b.unitPrice })),
    stockQty: listing.stockQty,
    mpnMatch: evaluateMpnMatch(line.mpn, listing.mpn),
    packageMatch: evaluatePackageMatch(line.packageName, listing.packageName),
    partStatus: listing.partStatus,
    orderLink: listing.orderLink,
    isRecommended,
    confidence,
    why,
    raw: listing.raw,
  };
}

export interface RunItemAgentOptions {
  line: WorkerBomLine;
  plannedSearch: PlannedSearch;
  depthPerItem: number;
  /** distributor name → client, resolved by distributors/index.ts for this run. */
  clients: ReadonlyMap<string, DistributorClient>;
  /** distributor name → smark_distributors.id, for stamping results. */
  distributorIds: ReadonlyMap<string, string>;
  siteSemaphore: KeyedSemaphore;
  rulesDigest: string;
  env: Pick<WorkerEnv, "anthropicApiKey" | "claudeModelItem">;
  claudePort?: ClaudePort;
}

export interface RunItemAgentResult {
  outcome: ItemAgentOutcome;
  cost: CostEstimate;
}

export async function runItemAgent(options: RunItemAgentOptions): Promise<RunItemAgentResult> {
  const { line, plannedSearch, depthPerItem, clients, distributorIds, siteSemaphore, rulesDigest, env, claudePort } = options;

  const attemptOrder = plannedSearch.distributorOrder.slice(0, Math.max(1, depthPerItem));
  const found: Array<{ listing: DistributorListing; distributorId: string }> = [];

  for (const distributorName of attemptOrder) {
    const client = clients.get(distributorName);
    const distributorId = distributorIds.get(distributorName);
    if (!client || !distributorId) continue; // unknown/disabled distributor — skip, don't fail the whole line

    const release = await siteSemaphore.acquire(distributorName);
    try {
      const listings = await client.search({
        mpn: line.mpn,
        lcscPn: line.lcscPn,
        value: line.value,
        packageName: line.packageName,
        searchTerm: plannedSearch.searchTerm ?? null,
        qty: line.qty,
      });
      for (const listing of listings) found.push({ listing, distributorId });
    } finally {
      release();
    }
  }

  if (found.length === 0) {
    return {
      outcome: { bomLineId: line.bomLineId, results: [], skipped: null },
      cost: { estimatedRupees: 0, tokenUsage: { inputTokens: 0, outputTokens: 0 } },
    };
  }

  const listingsOnly = found.map((f) => f.listing);
  const deterministic = pickRecommended(line, listingsOnly, line.qty);

  let recommendedListing = deterministic.best;
  let why = deterministic.why;
  let cost: CostEstimate = { estimatedRupees: 0, tokenUsage: { inputTokens: 0, outputTokens: 0 } };

  if (env.anthropicApiKey && claudePort) {
    const preliminaryResults = found.map(({ listing, distributorId }) =>
      toResult(line, listing, distributorId, listing === deterministic.best, deterministic.confidence, deterministic.why),
    );
    const prompt = buildItemPrompt(line, preliminaryResults, rulesDigest);
    const call = await claudePort.complete({
      model: env.claudeModelItem,
      system: ITEM_SYSTEM_PROMPT,
      userMessage: prompt,
      maxTokens: 800,
      effort: "medium",
    });
    cost = {
      estimatedRupees: estimateCallCostRupees(env.claudeModelItem, call.tokensIn, call.tokensOut),
      tokenUsage: { inputTokens: call.tokensIn, outputTokens: call.tokensOut },
    };
    try {
      const verdict = extractJsonObject<{ recommendedDistributorName: string | null; why: string }>(call.text);
      if (verdict.recommendedDistributorName) {
        const override = found.find(
          (f) =>
            f.listing.distributorName === verdict.recommendedDistributorName &&
            evaluatePackageMatch(line.packageName, f.listing.packageName), // never trust an override that breaks the mandatory rung
        );
        if (override) recommendedListing = override.listing;
      }
      if (verdict.why) why = verdict.why;
    } catch {
      // Malformed model output — keep the deterministic pick/why rather than failing the line.
    }
  }

  const results: DistributorListingResult[] = found.map(({ listing, distributorId }) =>
    toResult(line, listing, distributorId, listing === recommendedListing, deterministic.confidence, listing === recommendedListing ? why : deterministic.why),
  );

  return { outcome: { bomLineId: line.bomLineId, results, skipped: null }, cost };
}
