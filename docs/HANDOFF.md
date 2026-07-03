# HANDOFF.md — SmarkStock v2 build state (post-WF-4)

> Rewritten 2026-07-04 after the build completed. A fresh Claude Code session should read this
> file FIRST, then §1's files. The four feature workflows (WF-1…WF-4) are DONE, GREEN, and
> COMMITTED — do not re-plan or re-scaffold anything. What remains is wiring + deploy (§4).

## 1. Read these before doing anything

1. `FEATURES.md` — the build spec (v2, 38 approved R2 changes). BUILD TRUTH.
2. `plan/00-INDEX.md` → plan folder: per-surface specs (`plan/tab-*.md`), `plan/SCHEMA.md`,
   invariants (`plan/CROSS-FEATURE.md` §A3), test gate (`plan/TESTING.md`). Audit trail — any NEW
   client change gets id R2-39+, logs in `plan/CHANGE-LOG.md`, updates tab files + SCHEMA, then
   re-syncs FEATURES.md.
3. `docs/OWNERSHIP.md` — file-ownership map (still governs any future parallel-agent work).
4. `docs/DEV.md` — local dev runbook (supabase local, every command).

## 2. State snapshot (2026-07-04) — BUILD COMPLETE

All four phases built by multi-agent workflows, each reviewed adversarially, fixed, verified
green through the full gate (tsc · bun test · worker tests · build · db reset · playwright
desktop-1280 + mobile-360), and committed:

| Commit | Increment |
|---|---|
| `9ab894b`+`962fe0f` | WF-0 foundation: scaffold, 35-table schema + RLS (124 policies), design system, contracts, CI |
| `af8ecff` | WF-1 Phase-1: auth+shell, inventory, part drawer, shelves+audit, scan+movements, receive+labels, import+seed, dashboard |
| `88293d5` | WF-2 Phase-2: projects hub + phase timelines, named BOMs + reconcile, smart cart + checkout, bulk takeout, daily reports, expenses+charts, search+notifications, client portal (migration 0006 SECURITY DEFINER) |
| `8f58d7d` | WF-3 AI layer: lib/ai (alias layer, digest, fetch Claude client w/ mock-when-no-key), worker/ service (FOR UPDATE SKIP LOCKED claim, idempotent upserts, caps + ₹ ceilings), ordering workspace, run console, persisted review, settings expansion, receipt extraction, Phase-0 spike harness (code-complete, awaiting keys) |
| `d694898` | WF-4 hardening: full E2E flow suite (TESTING.md §3 flows 1-8), 10 audit findings fixed, executable RLS matrix (28 role cells + 19 db-schema tests), two load-race root fixes w/ regression tests |

**Completeness:** an opus critic walked all 38 R2 changes + FEATURES' 17 surfaces against code —
42/42 confirmed implemented (stub ≠ done). Only expected-incomplete item: Phase-0 live LCSC
measurement (§4.2).

**The whole AI/distributor path runs in deterministic MOCK mode** (no live keys anywhere). Every
external call sits behind an interface that selects mock-when-key-absent — the e2e gate exercises
enqueue → claim → plan → stream → review → cart for real. Wiring keys is config, not code.

**Test infra facts the hard way taught us** (all encoded in the repo, kept here so nobody
re-learns them):
- Playwright runs under Node even via `bunx` — only Bun auto-loads `.env.local`. The config
  self-loads it (existing env wins). `tests/e2e/global-setup.ts` seeds dev users
  (owner/employee/accountant — passwords in `scripts/seed-dev-users.ts`) AND the canonical demo
  dataset (both idempotent) before every run, so `supabase db reset` can never strand the suite.
- Playwright `workers: 2` is pinned — the shared `next dev` Turbopack server cold-compiles routes
  on first hit; higher fan-out reliably times navigations out.
- Cart invariant (cross-package, regression-tested in `tests/invariants/shortfall-500-400-200.test.ts`):
  review/manual demand slices must NEVER be destroyed by the auto-shortfall lifecycle —
  `lib/runs/cart.ts` converts auto rows (never merges silently), `lib/orders/demand.ts` re-checks
  `source='auto_shortfall'` at write time.

## 3. Operating protocol (unchanged, client-approved)

Multi-agent Workflow per phase; model split hard rule: builders/fixers `sonnet`,
integrator/reviewer/verifier `opus`, main loop spawns nothing on fable. Commit at every workflow
boundary (`WF-N: …` + Co-Authored-By Claude). Bun only. Local supabase only until keys land.
Never: npm/yarn, secrets in code, skipping RLS, stock mutation without movement+undo.
Recovery for interrupted/errored workflow runs: TaskStop → `Workflow({scriptPath, resumeFromRunId})`
(completed agents replay from cache; never edit the script's shared COMMON block between resumes).

## 4. What remains (needs Vaibhav, not code)

1. **Live keys** — create Supabase cloud project + R2 bucket (`smarkstock-files`) + set
   `ANTHROPIC_API_KEY`, distributor keys (Digikey OAuth2, Mouser, element14),
   `WORKER_SHARED_SECRET`. Registry: `.env.local.example`. Everything activates by env presence;
   no code changes expected. Then: run migrations against cloud, import real Stock List
   (`scripts/import-stocklist.ts`), onboarding queue for locations/labels.
2. **Phase-0 spike measurement (GATE for the browser-agent path)** — harness is code-complete in
   `worker/` + `docs/spike-browser-worker.md`. Needs ANTHROPIC_API_KEY + a SUPERVISED session with
   Vaibhav (~30 real TMCS lines vs LCSC; go/no-go per FEATURES §0). Until then: API distributors
   only; browser drivers stay env-gated stubs.
3. **Deploy** — Vercel Pro project (`bun run build`), GitHub branch protection requiring the
   `gate` check (docs/DEV.md §6 has the exact two steps), worker to Railway/Fly/Render with
   service role + `WORKER_SHARED_SECRET`. R2-29: red blocks deploy.
4. **Nightly live smoke** (post-keys) — the cost-capped live-API suite per `plan/TESTING.md` §4.
5. **Client demo** — canonical demo dataset seeds on every `db reset`; logins in
   `scripts/seed-dev-users.ts`. `/design-preview` shows the design system.

## 5. Known accepted trade-offs (documented, not bugs)

- Most `created_by`/`actor` stamping is app-layer-guaranteed; only attendance/time-entries have
  DB-level `auth.uid()` WITH CHECK (comment in `tests/integration/rls-matrix.test.ts`). Harden in
  DB later if wanted.
- BOM `sourcing_status` sync is an application-level write path — documented `test.todo` in
  `tests/integration/db-schema.test.ts`.
- Live-elapsed text on the dashboard agent card uses `suppressHydrationWarning` (intentionally
  client-local, 8s poll).
- Portal comments go straight to the feed with a flag chip (revisit if abused).
