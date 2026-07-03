#!/usr/bin/env bun
/**
 * worker/spike/harness.ts — the Phase-0 spike harness (FEATURES.md §0).
 *
 * Runs the ~30 real TMCS_96x32 lines (worker/spike/fixtures/tmcs-lines.json
 * — curated from the actual `TMCS_96x32_Matrix_V1.2.xlsx`, spanning the
 * three archetypes the spec names: full-MPN / LCSC-PN-only /
 * value+package-only) through the full worker pipeline (master plan → item
 * agent → distributor search → recommendation), entirely OFFLINE — no
 * Supabase connection, no live distributor/Claude calls (`DistributorClient`
 * is always `MockDistributorClient` here; `ClaudePort` is never constructed).
 *
 * This is the "code-complete harness" the build brief asks for — it
 * measures the SHAPE of the metrics (hit-rate, latency, concurrency
 * stability) the real go/no-go decision needs, using deterministic mock
 * data as a stand-in for what a supervised live session (real Digikey/
 * Mouser keys + a real Playwright/computer-use browser session against
 * LCSC) would produce. `docs/spike-browser-worker.md` records the current
 * status ("AWAITING KEYS") and the go/no-go criteria this harness's REAL
 * run (once keys exist) will be judged against.
 *
 * Run: `bun run spike` (from `worker/`) or `bun run spike/harness.ts`.
 */

import { createSiteSemaphore } from "../src/caps";
import { MockDistributorClient } from "../src/distributors/mock";
import { runItemAgent } from "../src/item-agent";
import { mockMasterPlan, reconcilePlanWithLines } from "../src/planner";
import type { DistributorClient } from "../src/distributors/types";
import type { DistributorDescriptor, WorkerBomLine, WorkerRunConfig } from "../../types/worker";

interface FixtureLine {
  bomLineId: string;
  archetype: "full_mpn" | "lcsc_only" | "value_package_only";
  refDesignators: string;
  qty: number;
  value: string;
  packageName: string;
  mpn: string | null;
  manufacturer: string | null;
  lcscPn: string | null;
  priorityNote: string | null;
}

const DISTRIBUTORS: DistributorDescriptor[] = [
  { id: "dist-digikey", name: "Digikey", apiType: "rest", rank: 1, enabled: true },
  { id: "dist-mouser", name: "Mouser", apiType: "rest", rank: 2, enabled: true },
  { id: "dist-element14", name: "element14", apiType: "rest", rank: 3, enabled: true },
  { id: "dist-lcsc", name: "LCSC", apiType: "browse", rank: 4, enabled: true },
  { id: "dist-unikey", name: "Unikey", apiType: "browse", rank: 5, enabled: false },
];

const RULES_DIGEST =
  "v1: prefer LCSC for GCU 0.1µF caps; C14663 already stocked, don't reorder below 500; " +
  "never substitute package.";

async function loadFixtureLines(): Promise<FixtureLine[]> {
  const file = Bun.file(new URL("./fixtures/tmcs-lines.json", import.meta.url));
  return (await file.json()) as FixtureLine[];
}

function toWorkerBomLine(fixture: FixtureLine): WorkerBomLine {
  return {
    bomLineId: fixture.bomLineId,
    refDesignators: fixture.refDesignators,
    qty: fixture.qty,
    value: fixture.value,
    packageName: fixture.packageName,
    voltage: null,
    mpn: fixture.mpn,
    manufacturer: fixture.manufacturer,
    lcscPn: fixture.lcscPn,
    priorityNote: fixture.priorityNote,
  };
}

function buildRunConfig(lines: WorkerBomLine[]): WorkerRunConfig {
  return {
    runId: "spike-run",
    bomId: "spike-bom",
    aliasedProjectLabel: "PROJ-SPIKE",
    distributorSequence: DISTRIBUTORS,
    overallPriorities: "Prefer Digikey/Mouser when in stock; package match is mandatory.",
    rulesDigest: RULES_DIGEST,
    rulesDigestVersion: 1,
    orderingLadder: ["mpn", "lcsc", "value", "package", "status", "qty", "cost"],
    concurrencyPreset: "balanced",
    lines,
    rupeeCeiling: 500,
  };
}

interface LineMetric {
  bomLineId: string;
  skipped: boolean;
  found: number;
  recommended: string | null;
  mpnMatch: string | null;
  packageMatch: boolean | null;
  confidence: number | null;
  elapsedMs: number;
}

async function runFanout(config: WorkerRunConfig, clients: Map<string, DistributorClient>, fanout: number): Promise<LineMetric[]> {
  const distributorIds = new Map(config.distributorSequence.map((d) => [d.name, d.id]));
  const siteSemaphore = createSiteSemaphore();
  const plan = reconcilePlanWithLines(mockMasterPlan(config), config);

  const skippedIds = new Set(plan.skip.map((s) => s.bomLineId));
  const metrics: LineMetric[] = [];

  // Process in fanout-sized batches to exercise the "5-way concurrency
  // stability" measurement the spike asks for, without needing a real
  // fanout scheduler (index.ts's Promise.all IS this same pattern).
  const searches = plan.searches;
  for (let i = 0; i < searches.length; i += fanout) {
    const batch = searches.slice(i, i + fanout);
    const batchResults = await Promise.all(
      batch.map(async (search) => {
        const line = config.lines.find((l) => l.bomLineId === search.bomLineId);
        if (!line) throw new Error(`spike: no line for ${search.bomLineId}`);
        const started = performance.now();
        const { outcome } = await runItemAgent({
          line,
          plannedSearch: search,
          depthPerItem: 5,
          clients,
          distributorIds,
          siteSemaphore,
          rulesDigest: config.rulesDigest,
          env: { anthropicApiKey: null, claudeModelItem: "n/a" },
        });
        const elapsedMs = performance.now() - started;
        const recommended = outcome.results.find((r) => r.isRecommended) ?? null;
        return {
          bomLineId: line.bomLineId,
          skipped: false,
          found: outcome.results.length,
          recommended: recommended?.distributorName ?? null,
          mpnMatch: recommended?.mpnMatch ?? null,
          packageMatch: recommended?.packageMatch ?? null,
          confidence: recommended?.confidence ?? null,
          elapsedMs,
        };
      }),
    );
    metrics.push(...batchResults);
  }

  for (const bomLineId of skippedIds) {
    metrics.push({
      bomLineId,
      skipped: true,
      found: 0,
      recommended: null,
      mpnMatch: null,
      packageMatch: null,
      confidence: null,
      elapsedMs: 0,
    });
  }

  return metrics;
}

async function main(): Promise<void> {
  const fixtures = await loadFixtureLines();
  const archetypeById = new Map(fixtures.map((f) => [f.bomLineId, f.archetype]));
  const lines = fixtures.map(toWorkerBomLine);
  const config = buildRunConfig(lines);

  // Deliberately ALWAYS the deterministic mock here, never the real
  // distributors/index.ts registry — the spike harness's job in this build
  // is to measure the pipeline's SHAPE against synthetic data (no live keys
  // exist anywhere in this environment); routing through the registry would
  // resolve Digikey/Mouser/element14 to their real REST clients, which fall
  // to REPLAY mode and require recorded fixtures this harness never creates.
  // A live spike run swaps this line for `createDistributorClient(...)` per
  // distributor once real keys exist (docs/spike-browser-worker.md).
  const clients = new Map<string, DistributorClient>(
    DISTRIBUTORS.map((d): [string, DistributorClient] => [d.name, new MockDistributorClient(d.name, d.apiType)]),
  );

  const startedAll = performance.now();
  const metrics = await runFanout(config, clients, 5); // "5-way concurrency" per FEATURES §0
  const totalElapsedMs = performance.now() - startedAll;

  const searched = metrics.filter((m) => !m.skipped);
  const hits = searched.filter((m) => m.packageMatch && m.mpnMatch !== "none");
  const exactMpn = searched.filter((m) => m.mpnMatch === "exact");
  const hitRate = searched.length > 0 ? (hits.length / searched.length) * 100 : 0;
  const avgLatencyMs = searched.length > 0 ? searched.reduce((sum, m) => sum + m.elapsedMs, 0) / searched.length : 0;

  console.log("=== SmarkStock Browser-Worker — Phase-0 spike (MOCK DATA) ===");
  console.log(`Lines: ${fixtures.length} (skipped by plan: ${metrics.length - searched.length})`);
  console.log(`Archetype coverage: ${JSON.stringify(countBy(fixtures, (f) => f.archetype))}`);
  console.log(`Correct-part hit rate (package+MPN, mock): ${hitRate.toFixed(1)}%`);
  console.log(`Exact-MPN matches: ${exactMpn.length}/${searched.length}`);
  console.log(`Avg per-line latency (mock, no network): ${avgLatencyMs.toFixed(2)}ms`);
  console.log(`Total wall time (5-way fanout, ${searched.length} lines): ${totalElapsedMs.toFixed(2)}ms`);
  console.log(`₹ per item / projected ₹ per run: ₹0.00 (no ANTHROPIC_API_KEY — cost measurement requires a live key)`);
  console.log(`Anti-bot incidence: N/A — browser path is Phase-0 gated, never invoked (see worker/src/browser-driver.ts)`);
  console.log("");
  console.log("Per-line detail:");
  for (const m of metrics) {
    const archetype = archetypeById.get(m.bomLineId) ?? "unknown";
    if (m.skipped) {
      console.log(`  ${m.bomLineId} [${archetype}] — SKIPPED by plan`);
    } else {
      console.log(
        `  ${m.bomLineId} [${archetype}] — found ${m.found}, recommended ${m.recommended ?? "none"}, ` +
          `mpnMatch=${m.mpnMatch}, packageMatch=${m.packageMatch}, confidence=${m.confidence}`,
      );
    }
  }
  console.log("");
  console.log("Status: AWAITING KEYS — see docs/spike-browser-worker.md for the go/no-go line and what a live run needs.");
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("spike harness failed:", error);
    process.exit(1);
  });
}

export { buildRunConfig, loadFixtureLines, runFanout, toWorkerBomLine };
