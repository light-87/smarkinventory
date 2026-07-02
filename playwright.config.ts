import { defineConfig, devices } from "@playwright/test";

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
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  // A stray `.only` must never merge — fail the run if one slips into CI.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
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
