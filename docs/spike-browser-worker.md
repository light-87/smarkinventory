# Phase-0 spike — Browser-Worker feasibility

**Status: AWAITING KEYS — live LCSC measurement in a supervised session.**

FEATURES.md §0 gates all agent work on this spike. Per the build brief for this
surface, **no live distributor/browser calls are permitted in this build** — no
`ANTHROPIC_API_KEY`, Digikey/Mouser/element14 keys, or a browser session exist
in this environment. Everything below is **code-complete and offline-verified**
(the harness runs end-to-end against deterministic mock data — see
"What's actually been run" below); the **go/no-go decision itself has not been
made** and cannot be made without a supervised live session.

---

## 1. What the spike measures (unchanged from FEATURES.md §0)

A standalone worker with a swappable `BrowserDriver` (primary: Anthropic
computer-use; alternates: Playwright, Browserbase) + one REST distributor
(Digikey or Mouser) for calibration, tested on ~30 real `TMCS_96x32` lines
spanning full-MPN / LCSC-PN-only / value+package-only. Metrics: correct-part
hit rate, match quality, anti-bot incidence, latency, **₹ per item + projected
₹ per run**, 5-way concurrency stability.

**GREEN** = ≥90% correct AND manageable anti-bot AND acceptable cost → build the
browser-agent hybrid. **Else** → API-first with browser fallback / driver swap.

## 2. Current posture: API-first, browser gated

- REST distributors (Digikey OAuth2, Mouser key, element14 key) are
  **code-complete** (`worker/src/distributors/{digikey,mouser,element14}.ts`),
  each behind a record/replay layer (`worker/src/distributors/record-replay.ts`)
  — replay-only until real keys exist, at which point the SAME code path
  starts recording live fixtures automatically (key presence is the only
  switch — see each file's constructor).
- The `BrowserDriver` interface (`worker/src/browser-driver.ts`) has three
  registered implementations:
  - `PlaywrightDriver` — **code-complete**, including a best-effort LCSC/
    Unikey search-page selector strategy from public knowledge (NOT verified
    against the live site — that verification is this spike's whole point).
  - `ComputerUseDriver`, `BrowserbaseDriver` — stubs that throw a clear
    "Phase-0 not yet green" error. These are the primary/alternate
    candidates FEATURES §0 names; they get real implementations once the
    Playwright/REST baseline has something to compare against.
  - **Hard gate in code, not just convention**: every driver's `searchPart`
    (via `assertLiveBrowsingAllowed` in browser-driver.ts) refuses to run
    unless `ALLOW_LIVE_BROWSER=1` is set — this must NEVER be set in CI or
    normal operation, only inside the supervised session described below.
- `MockDistributorClient` (`worker/src/distributors/mock.ts`) is what
  actually exercises the pipeline end-to-end today — deterministic
  price/stock by (distributor × query) hash, plus a small named-part table
  for parts other docs reference by exact value (e.g. `C14663`, AI Memory's
  baseline "already stocked" example).

## 3. What's actually been run (offline, this build)

```
cd worker
bun run spike            # == bun run spike/harness.ts
```

`worker/spike/harness.ts` runs the full pipeline — master plan (mock) → item
agent → `MockDistributorClient` → ladder scoring (`matcher-lite.ts`) → 5-way
concurrent fan-out — over `worker/spike/fixtures/tmcs-lines.json`, **30 lines
curated from the real `TMCS_96x32_Matrix_V1.2.xlsx`** (13 full-MPN, 7
LCSC-PN-only, 10 value+package-only, including two deliberate edge cases: a
non-numeric resistor value token and a line whose MPN column is blank but
whose LCSC PN is present). A representative run:

```
Lines: 30 (skipped by plan: 1)
Archetype coverage: {"full_mpn":13,"lcsc_only":7,"value_package_only":10}
Correct-part hit rate (package+MPN, mock): 41.4%
Exact-MPN matches: 12/29
Avg per-line latency (mock, no network): <1ms
Total wall time (5-way fanout, 29 lines): ~8ms
₹ per item / projected ₹ per run: ₹0.00 (no ANTHROPIC_API_KEY — cost measurement requires a live key)
Anti-bot incidence: N/A — browser path is Phase-0 gated, never invoked
```

**Read this number correctly:** the mock hit-rate (~41%) is an artifact of
`MockDistributorClient`'s deterministic-but-arbitrary MPN generation for
lines that have no real MPN to match against (LCSC-only and
value+package-only lines score `mpnMatch=none` by construction — there is no
live catalog to check "exact" against in mock mode). **It is NOT a proxy for
the real hit-rate** and must not be quoted as spike evidence either way — it
only proves the harness's WIRING is correct end-to-end (plan → fan-out →
concurrency → scoring → recommendation), which is what a code-complete,
key-less build can actually demonstrate. The real ≥90% bar can only be
measured against live data.

## 4. What a live run needs (the actual next step)

1. Provision ONE REST distributor key (Digikey or Mouser, per §0 — "one REST
   distributor for calibration") in `.env.local` (`DIGIKEY_CLIENT_ID`/
   `DIGIKEY_CLIENT_SECRET` or `MOUSER_API_KEY`). The moment a key is present,
   `worker/src/distributors/{digikey,mouser}.ts` switch from `replay` to
   `record` mode automatically — no code change.
2. A supervised session (human-watched, rate-limited, short) with
   `BROWSER_DRIVER=playwright` and `ALLOW_LIVE_BROWSER=1` set **only for that
   session** — verify/fix the selector strategy in
   `worker/src/browser-driver.ts`'s `scrapeListings()` against LCSC's actual
   markup, then run the ~30 real lines (swap `worker/spike/harness.ts`'s
   hard-coded `MockDistributorClient` construction for
   `createDistributorClient(...)` from `worker/src/distributors/index.ts`,
   which resolves to the real REST/browser clients once keys/gate are set —
   see the inline comment at that call site).
3. Record: correct-part hit rate against a human-verified answer key for
   those 30 lines, anti-bot incidents (CAPTCHAs, blocks, rate-limit walls),
   wall-clock latency per line, and `ANTHROPIC_API_KEY`-metered real ₹ spend
   (planner + item-agent calls) via `worker/src/caps.ts`'s
   `estimateCallCostRupees` / `RunCostTracker`, which are already wired to
   `smark_agent_runs.actual_cost`.
4. Fill in the go/no-go line below from those numbers.

## 5. Go/no-go — TO BE FILLED IN AFTER THE LIVE SESSION

```
GREEN  if: correct-part hit rate ≥ 90% AND anti-bot incidents are manageable
           (no persistent blocks across the 30-line run) AND ₹/run stays
           inside FEATURES §15/§18's ceiling with headroom.
ELSE:  API-first with browser fallback — keep REST distributors as primary,
       keep the browser path behind a driver swap (Playwright → Browserbase
       → computer-use) rather than committing to one, and revisit per-site
       caps/pacing before re-measuring.

Decision: NOT YET MADE. Blocked on live keys + a supervised browser session
(see §4). Do not build the "browser-agent hybrid" (FEATURES §0's GREEN
outcome) until this line is filled in with real numbers.
```

## 6. Notes for the integrator

- **`smark_order_jobs` atomic claim**: this package does not own migrations
  (frozen 0001–0006). `worker/src/claim.ts` documents a proposed
  `smark_claim_next_order_jobs(p_limit int)` SECURITY DEFINER RPC (the real
  `FOR UPDATE SKIP LOCKED` path) in a comment, and works correctly TODAY via
  a race-free conditional-UPDATE fallback that needs no migration — see that
  file's header for why the fallback is provably race-free, not just
  "usually fine". Consider adding the RPC as `0007_worker_claim_fn.sql` for
  the efficiency win (skips the fallback's occasional wasted read on
  contention); it is not required for correctness.
- **Enqueue contract**: bom-pipeline's `lib/runs/**` (not yet built) must
  write `smark_agent_runs` rows with `plan` = the `WorkerRunPlanColumn`
  envelope documented in `types/worker.ts` (`{ config: WorkerRunConfig,
  masterPlan: null }` at insert, `status: "planning"`), plus one
  `smark_order_jobs` row per to-order line. This is the ONE integration
  point between the app and this worker — see that type's doc comment for
  the full shape. In particular: **in-stock (skip-buy) lines should never
  get a job row at all** — the app renders those directly from reconcile
  data; `WorkerRunConfig.lines` only ever contains to-order/contested lines.
- **Rendering Opus's `skip[]` decisions**: when Opus's master plan skips a
  line (e.g. an "already stocked" learned-rule hit), the worker marks that
  line's job `done` immediately with no `smark_agent_results` rows — the
  skip reason lives in `smark_agent_runs.plan.masterPlan.skip[]` (readable
  by the app under the normal RLS policy on that table). The Order Review
  screen (bom-pipeline) needs to read that array to render the "✓ already
  in stock" / "skipped — <reason>" row per FEATURES §5.10's short-circuit
  UI, not just `smark_agent_results`.
- **₹ ceiling default**: `FEATURES.md §15/§18` calls for a per-run ceiling
  but no schema column currently holds a user-set value — `WorkerRunConfig.
  rupeeCeiling` is populated by whatever the app writes into the enqueue
  envelope; until Settings has a real "AI spend ceiling" control, treat the
  number the app sends as authoritative and pick a sensible default
  (`worker/src/caps.ts` doesn't hardcode one — it takes whatever
  `rupeeCeiling` arrives with).
- **`WORKER_SHARED_SECRET`**: used to gate the worker's own tiny `/status`
  HTTP endpoint (`worker/index.ts`) for ops visibility (Railway/Fly/Render
  health checks) — it is NOT part of the DB claim path (that's pure
  service-role Postgres access) and needs no coordination with the app
  beyond "same secret, different env var name" if a future admin surface
  wants to query worker status.
- **CI**: `.github/workflows/ci.yml` (integrator-locked) doesn't yet have a
  "worker suite" job. `docs/DEV.md` §6 documents the current five jobs;
  add a sixth (`cd worker && bun install && bun test`) per `plan/TESTING.md`
  §2's "Worker | job-lifecycle suite ... every push" row.
- **Root `eslint.config.mjs`** (integrator-locked) has no ignore entry for
  `worker/**` — it currently lints this package with the Next.js
  React/JSX ruleset, which doesn't apply here (no React, a `while (true)`
  poll loop is the intended shape, `console.*` is this service's ops
  visibility layer). Recommend adding `worker/**` to `globalIgnores` (or
  giving the worker its own lint config) rather than silencing rules
  file-by-file in a package that otherwise owns its own toolchain.
- **A real standalone `bun install`**: this repo currently resolves
  `worker/`'s one runtime dependency (`@supabase/supabase-js`) via Bun's
  normal upward `node_modules` search (the repo root already has it
  installed) — `worker/package.json` declares it correctly, but nothing has
  run `bun install` *inside* `worker/` in this build (out of scope per the
  "no `bun add`" rule for this task). Before a real Railway/Fly/Render
  deploy, run `cd worker && bun install` once to materialize its own
  `node_modules`/lockfile so the deploy doesn't depend on the monorepo
  layout being present at runtime.
