# SmarkStock Browser-Worker

The always-on job-claim service from `FEATURES.md` §4/§15: claims
`smark_order_jobs` (`FOR UPDATE SKIP LOCKED`-equivalent), calls Opus once per
run for a search plan, fans out Sonnet item-agents across REST distributors
(Digikey/Mouser/element14) and a Phase-0-gated `BrowserDriver`
(LCSC/Unikey), and writes `smark_agent_results` idempotently.

Standalone Bun package — own `package.json`, no Next.js. See
`../docs/spike-browser-worker.md` for the Phase-0 feasibility spike (status:
**AWAITING KEYS**) and `../docs/OWNERSHIP.md`'s "worker" section for what
this package owns.

## Quick start

```bash
cd worker
bun install        # first time only — see "Standalone install" note below
cp ../.env.local.example .env.local   # fill in SUPABASE_URL etc.
bun run dev         # watches + runs the poll loop
bun run spike       # runs the Phase-0 spike harness offline (mock data)
bun test            # unit + DB-backed suites (DB suites self-skip without a local stack)
bun run typecheck   # tsc --noEmit
```

## Environment

See `src/env.ts` for the full list and which keys are optional. With no
`ANTHROPIC_API_KEY`, the worker runs entirely on deterministic mock logic
(`planner.ts`'s `mockMasterPlan`, `item-agent.ts`'s matcher-lite-only path,
`MockDistributorClient`) — the full pipeline stays exercisable end-to-end.

## Layout

```
src/
  env.ts            — env parsing
  db.ts              — service-role Supabase client + local row shapes
  claim.ts           — atomic job claim, stale-claim release
  runs.ts            — run-level lifecycle (planning → running → review)
  results.ts         — idempotent smark_agent_results writes
  caps.ts            — per-site concurrency caps + ₹ ceiling
  claude-port.ts      — raw-fetch Claude transport (no SDK dependency)
  planner.ts          — Opus master planner (+ deterministic mock)
  item-agent.ts       — Sonnet per-line executor (+ deterministic mock)
  matcher-lite.ts      — objective ladder scoring for distributor listings
  browser-driver.ts    — BrowserDriver interface (Phase-0 gated)
  distributors/        — DistributorClient impls (Digikey/Mouser/element14/Mock) + record/replay
spike/
  harness.ts           — Phase-0 spike harness (offline, mock data)
  fixtures/tmcs-lines.json — 30 real TMCS_96x32 lines, curated by archetype
tests/                 — bun:test suites (claim, idempotency, caps, cost ceiling, replay fixtures, matcher-lite, planner)
```

## Standalone install note

This repo currently resolves the worker's one runtime dependency
(`@supabase/supabase-js`) via Bun's normal upward `node_modules` search (the
monorepo root already has it installed), so `bun test`/`bun run spike` work
here without a separate `bun install` inside `worker/`. Before a real
standalone deploy (Railway/Fly/Render), run `bun install` inside `worker/`
once so it has its own `node_modules`/lockfile independent of the monorepo
layout.
