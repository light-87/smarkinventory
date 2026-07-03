import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Load .env.local into process.env for the Playwright runner + its worker
// processes (they inherit this process's env). Playwright runs under plain
// Node even when launched via `bunx` — only Bun auto-loads .env.local — so
// spec files that construct Supabase clients (the WF-4 flow specs use
// createServiceClient() in-test) silently starve without this and fail in
// ways that look like app bugs. Existing env always wins (CI exports the
// stack's real values explicitly; we must not clobber them).
const envLocal = path.join(__dirname, ".env.local");
if (existsSync(envLocal)) {
  for (const line of readFileSync(envLocal, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    const key = m?.[1];
    const rawValue = m?.[2];
    if (key === undefined || rawValue === undefined) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^(["'])(.*)\1$/, "$2");
  }
}

/**
 * SmarkStock Playwright config — R2-29 quality gate (plan/TESTING.md §2 "E2E"
 * layer + §7 CI pipeline).
 *
 * Two projects only, matching FEATURES.md's two hard breakpoints:
 *   - desktop-1280  the rail-nav desktop layout (1280×800).
 *   - mobile-360    the PWA's minimum supported width (FEATURES.md §3/§18:
 *                   "360px min, 44px targets, no h-scroll"). `devices["Pixel
 *                   9"]` is used because it is a real, current Playwright
 *                   device preset that happens to sit at exactly 360px wide
 *                   — real Android UA + touch + viewport-meta behaviour
 *                   instead of a hand-rolled viewport override.
 *
 * Every spec here runs against BOTH projects by default (Playwright applies
 * each `tests/e2e/*.spec.ts` file to every project in this list) — that's
 * how "desktop + mobile" coverage happens without duplicating test files.
 *
 * Fixtures/mocking: AI + distributor calls must be recorded/replayed per
 * plan/TESTING.md §4 (no live spend on the deploy path) — that wiring lands
 * with the feature packages that make those calls. This config only wires
 * the runner + the one spec that must never go red: tests/e2e/smoke.spec.ts
 * (app boots, locked dark theme renders). Real flow specs (plan/TESTING.md
 * §3, E2E-1..8) land here as their features ship.
 */

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  // Re-seeds the dev-role auth users every run — `supabase db reset` wipes
  // auth.users and every flow spec logs in as the seeded owner. See the
  // header comment in tests/e2e/global-setup.ts.
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  // A stray `.only` must never merge — fail the run if one slips into CI.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Fixed at 2 (not `undefined` locally, which defaults to ~half the
  // machine's CPU cores): the `webServer` all workers share is a single
  // `next dev` Turbopack process (R2-29 spec — see the block below), and
  // every route it hasn't compiled yet does so on demand, once, on first
  // request. With a high local worker count, many *different* first-touch
  // routes (dashboard, cart, daily, projects/:id, bulk-takeout, …) land on
  // the dev server in the same instant from unrelated spec files running
  // in parallel, and the resulting pile of concurrent cold compiles pushed
  // ordinary navigations past this suite's 25-30s timeouts (verified — the
  // same specs are reliably green at low concurrency and flaky/red at a
  // default ~8-worker fan-out on a 16-core box). 2 matches what CI already
  // runs (see .github/workflows/ci.yml's playwright job) so local and CI
  // see the same contention profile.
  workers: 2,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "desktop-1280",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "mobile-360",
      use: {
        ...devices["Pixel 9"], // 360×732, real Android Chrome UA, touch on
      },
    },
  ],

  // `bun run dev` per the R2-29 spec (dev server, not a prod build) —
  // Playwright boots it and polls baseURL until ready. Locally this reuses
  // a server you already have running (`bun run dev` in another tab); CI
  // always starts a fresh one and tears it down after the run.
  webServer: {
    command: "bun run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
