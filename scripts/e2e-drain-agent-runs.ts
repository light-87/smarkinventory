#!/usr/bin/env bun
/**
 * scripts/e2e-drain-agent-runs.ts — for tests/e2e/ordering-run-review.spec.ts
 * ONLY: synchronously ticks the worker's own poll loop (worker/index.ts's
 * exported `buildRuntime`/`pollOnce`) a bounded number of times so a run
 * enqueued via the Ordering Workspace reaches a terminal status
 * (`review`/`done`/`failed`) inside the test, without needing the always-on
 * `worker/index.ts` process running in the background during `bunx
 * playwright test`.
 *
 * Deliberately builds its OWN `WorkerEnv` rather than calling `loadEnv()`:
 * `.env.local` sets `BROWSER_DRIVER=computeruse` for normal dev use, but this
 * script forces `browserDriver: null` and `anthropicApiKey: null` so every
 * distributor resolves to the deterministic `MockDistributorClient`
 * (worker/src/distributors/index.ts) and the planner/item-agent take their
 * mock paths (worker/src/planner.ts, worker/src/item-agent.ts) — no network
 * call, no live key, ever, regardless of what's in the ambient environment.
 * The e2e spec itself is responsible for pointing every fixture BOM's
 * distributor sequence at ONLY a "browse"-type distributor (LCSC) with no
 * REST client dependency, so a `smark_order_jobs` row never reaches a
 * Digikey/Mouser/element14 REST client that would throw in replay mode with
 * no recorded fixture (worker/src/distributors/record-replay.ts).
 *
 * Run via `bun run scripts/e2e-drain-agent-runs.ts` (mirrors
 * tests/e2e/global-setup.ts's `execFileSync("bun", ["run", ...])` pattern) —
 * NOT added as a package.json script (package.json is integrator-owned per
 * docs/OWNERSHIP.md; this file is invoked by its path instead).
 */

import { buildRuntime, pollOnce } from "../worker/index";
import type { WorkerEnv } from "../worker/src/env";

const MAX_TICKS = Number(process.env.E2E_DRAIN_MAX_TICKS ?? 15);
const TICK_DELAY_MS = 200;

function requireEnv(...names: string[]): string {
  for (const name of names) {
    const v = process.env[name];
    if (v) return v;
  }
  throw new Error(
    `e2e-drain-agent-runs: none of ${names.join("/")} are set — run via \`bunx playwright test\` (see docs/DEV.md), which loads .env.local.`,
  );
}

async function main(): Promise<void> {
  const env: WorkerEnv = {
    supabaseUrl: requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    workerSharedSecret: null,
    anthropicApiKey: null, // force the deterministic mock planner/item-agent path — see module doc
    claudeModelMaster: "mock",
    claudeModelItem: "mock",
    browserDriver: null, // force MockDistributorClient for any "browse" distributor — see module doc
    playwrightWsEndpoint: null,
    digikeyClientId: null,
    digikeyClientSecret: null,
    mouserApiKey: null,
    element14ApiKey: null,
  };

  const state = buildRuntime(env);
  for (let i = 0; i < MAX_TICKS; i += 1) {
    await pollOnce(state);
    await new Promise((resolve) => setTimeout(resolve, TICK_DELAY_MS));
  }
  console.log(`[e2e-drain-agent-runs] drained ${MAX_TICKS} ticks.`);
}

main().catch((error) => {
  console.error("[e2e-drain-agent-runs] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
