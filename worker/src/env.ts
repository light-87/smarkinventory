/**
 * worker/src/env.ts — environment parsing for the standalone Browser-Worker.
 *
 * Names match FEATURES.md §3/§4 exactly (the worker is not Next.js, so no
 * NEXT_PUBLIC_ prefix): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
 * `WORKER_SHARED_SECRET`, `ANTHROPIC_API_KEY?`, `BROWSER_DRIVER?`. Distributor
 * keys reuse the root `.env.local.example` names so one set of secrets works
 * for both the app (Settings screen, key presence checks) and this service.
 *
 * NO LIVE KEYS EXIST in this environment — every optional key below is
 * genuinely optional; its ABSENCE is what selects the deterministic mock
 * implementation for that concern (Claude, each distributor). This module
 * never throws on a missing optional key — only on a missing REQUIRED one,
 * and only when `loadEnv()` is actually called (index.ts / tests choose when).
 */

export interface WorkerEnv {
  /** Bare Postgres/Supabase project URL — required, service-role client target. */
  supabaseUrl: string;
  /** Service-role key — required. NEVER logged, never sent anywhere but Supabase. */
  supabaseServiceRoleKey: string;
  /** Guards the worker's own tiny HTTP status surface (see index.ts). Required to start the HTTP server; the poll loop itself doesn't need it. */
  workerSharedSecret: string | null;

  /** Selects the real ClaudePort when present; MockClaudePort otherwise. */
  anthropicApiKey: string | null;
  claudeModelMaster: string;
  claudeModelItem: string;

  /** `computeruse | playwright | browserbase` — Phase-0 gated; default is effectively unused until §0 goes GREEN. */
  browserDriver: "computeruse" | "playwright" | "browserbase" | null;
  /**
   * Remote Chromium WS endpoint for PlaywrightDriver's `connectOverCDP` (e.g. a
   * Hetzner box running a headless browser), full URL including its own auth
   * token query param. When unset, PlaywrightDriver launches a local Chromium
   * instead. Only takes effect once the Phase-0 gate (ALLOW_LIVE_BROWSER=1) is
   * open — see worker/src/browser-driver.ts.
   */
  playwrightWsEndpoint: string | null;

  digikeyClientId: string | null;
  digikeyClientSecret: string | null;
  mouserApiKey: string | null;
  element14ApiKey: string | null;

  /**
   * GLOBAL ceiling on concurrent browser searches across ALL runs/sites —
   * the per-site caps bound each distributor independently, but every browse
   * search lands on ONE shared Chromium (a ~2 GB box holds only 2–4 heavy
   * distributor pages at once), so this single semaphore is what actually
   * protects it. `BROWSER_MAX_CONCURRENCY`, default 2, clamped to [1, 8].
   */
  browserMaxConcurrency: number;
}

function optional(name: string): string | null {
  // Trimmed: a whitespace-only value counts as UNSET. This also gives
  // PowerShell users a way to force-unset a var that an --env-file would
  // otherwise re-fill (PS deletes a var assigned '' — set it to ' ' instead).
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : null;
}

function required(name: string): string {
  const v = optional(name);
  if (!v) {
    throw new Error(
      `worker/env: missing required env var ${name}. See worker/README.md / .env.local.example.`,
    );
  }
  return v;
}

function parseBrowserDriver(raw: string | null): WorkerEnv["browserDriver"] {
  if (raw === "computeruse" || raw === "playwright" || raw === "browserbase") return raw;
  if (raw) {
    throw new Error(
      `worker/env: BROWSER_DRIVER="${raw}" is not one of computeruse|playwright|browserbase.`,
    );
  }
  return null;
}

/** Reads and validates the full environment. Call once at process start. */
export function loadEnv(): WorkerEnv {
  return {
    supabaseUrl: required("SUPABASE_URL"),
    supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    workerSharedSecret: optional("WORKER_SHARED_SECRET"),
    anthropicApiKey: optional("ANTHROPIC_API_KEY"),
    claudeModelMaster: optional("CLAUDE_MODEL_MASTER") ?? "claude-opus-4-8",
    claudeModelItem: optional("CLAUDE_MODEL_ITEM") ?? "claude-sonnet-5",
    browserDriver: parseBrowserDriver(optional("BROWSER_DRIVER")),
    playwrightWsEndpoint: optional("PLAYWRIGHT_WS_ENDPOINT"),
    digikeyClientId: optional("DIGIKEY_CLIENT_ID"),
    digikeyClientSecret: optional("DIGIKEY_CLIENT_SECRET"),
    mouserApiKey: optional("MOUSER_API_KEY"),
    element14ApiKey: optional("ELEMENT14_API_KEY"),
    browserMaxConcurrency: parseBrowserMaxConcurrency(optional("BROWSER_MAX_CONCURRENCY")),
  };
}

function parseBrowserMaxConcurrency(raw: string | null): number {
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 2; // safe default for a small (2 GB) browser box
  return Math.max(1, Math.min(8, n));
}
