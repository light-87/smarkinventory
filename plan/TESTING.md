# TESTING.md — automated quality gate (R2-29)

> Client ask: "everything auto-tested on build so everything passes and is of expected behaviour —
> no nonsense, no manual tests, no one new thing breaking another; tests go all the way to expected
> output." This file is the testing PLAN; it becomes CI config + test suites at build time.

## 1. Principles

1. **Green build = deployable.** Vercel production deploys only from a passing pipeline; red blocks.
2. **No manual test steps.** Anything a human would click is a Playwright script.
3. **Every R2 change ships with tests.** The traceability table (§6) maps R2-NN → suites; a change
   without tests is not "done".
4. **Every bug fixed adds a regression test** — the "1 new thing breaking another" guard.
5. **Tests assert expected OUTPUT, not implementation** — e.g. "500 avail, A needs 400, B needs 200
   → cart auto-line of exactly 100" (the client's own example becomes a permanent test).

## 2. Layers (bottom-up)

| Layer | Runner | Scope | When |
|---|---|---|---|
| Static | `tsc --noEmit`, ESLint | types, lint | every push |
| Unit | `bun test` (Vitest-compatible) | pure logic: reconcile matcher ladder, demand/shortfall math (× build_qty), price stamping + price_change events, status walks, alias layer (MPN passthrough!), qty rollups, undo pairing, template/custom-field merging, xlsx template generation | every push |
| DB / RLS | integration vs local Supabase (`supabase start` in CI) | migrations apply cleanly; **RLS matrix tests** — one client per role asserting allow/deny per Q-01 (the matrix becomes executable spec); FK/unique constraints (PO unique, BOM name per project); triggers/views (`v_part_demand`, `v_daily_activity`, `v_expense_rollups`) | every push |
| API / server actions | route-level tests with seeded DB | BOM parse (real TMCS/GCU fixtures), checkout (PO required), receipt-extraction endpoint (mocked Claude), label PDF render, cart aggregation | every push |
| Worker | job-lifecycle suite | atomic claim (no double-processing under concurrency), idempotent result upserts, per-site cap never exceeded, ₹ ceiling abort, driver interface mocked | every push |
| E2E | Playwright (desktop 1280 + **mobile 360px**) | full flows against a preview deploy + seeded Supabase branch; AI + distributor calls **record/replay mocked** — deterministic, no live spend | PR + pre-deploy |

## 3. E2E flow suite (the "expected output all the way" set)

1. **Auth & roles:** login each role → sees exactly the Q-01 surface (nav, More sheet, hidden
   Settings cards); employee cannot approve rules (UI + RLS both).
2. **Inventory core loop:** new part (with custom field) → label PDF exists in R2 → scan PID →
   take out 5 → movement + dashboard + undo restores.
3. **Full ordering pipeline:** create project → create BOM in-app (custom column) → set build_qty
   10 → reconcile flips a ×1-in-stock line to to-order → run (mocked agents stream results) →
   review persists after reload → add to cart → **shortfall example: 500/400/200 → exactly 100
   auto-line** → checkout blocked without PO → checkout with PO → mark arrived → put away →
   `last_unit_price` stamped → dashboard inventory value updates.
4. **Receipt path:** upload receipt fixture → extraction (mocked) proposes prices → confirm →
   order lines + part prices updated.
5. **Team day:** employee check-in → switch project → check-out → Daily Report shows attendance +
   the movement they made; owner sees team + expenses section; employee does NOT see expenses.
6. **Expenses:** owner adds entry per account → charts totals match seeded sums; accountant/employee
   access per matrix.
7. **PWA/offline smoke:** app installable, shell cached, scan queues a movement offline → syncs.
8. **A11y/mobile:** 360px no horizontal scroll on every route; touch targets ≥44px; reduced-motion
   run path.

## 4. Fixtures & environments

- Deterministic seed = the prototype's mock dataset (parts incl. SMK-000101 family, boxes A-03…D-06,
  TMCS/GCU BOMs) promoted to canonical fixtures — tests and demos share one truth.
- Real BOM files (`TMCS_96x32_Matrix_V1.2.xlsx`, `GCU_V1.1_BOM.xlsx`, messy `Stock List.xlsx`
  sheets) as parser fixtures — importer tested against the real mess, incl. value/voltage splitting
  (R2-24).
- Claude + distributor responses: recorded fixtures with a replay client; a tiny live smoke suite
  runs nightly OFF the deploy path (cost-capped) to catch API drift.
- Ephemeral env per PR: Vercel preview + Supabase branch DB, seeded, destroyed after.

## 5. Invariant suite (A3 as tests — runs at every layer it applies)

- Print rule: existing part top-up NEVER creates a label row; new part exactly one.
- Every stock mutation has a movement; every movement is undoable once (`undo_of` chain correct).
- `total_qty` always equals Σ locations (property-based checks after random op sequences).
- Package-mandatory can't be disabled via any API path.
- Status walks only forward (cart→ordered→arrived); PO unique; BOM name unique per project.
- Alias layer: outbound AI payloads contain no client/project names or descriptions (leak test
  scans recorded payloads); MPN/LCSC pass through.
- Suggested rules never active without an approval event by an authorized role.

## 6. Traceability — R2 change → tests (maintained as changes land)

| R2 | Covered by |
|---|---|
| 01 | RLS matrix suite, E2E-1 |
| 03/19/27 | unit (reconcile ×N, templates), API (parse/create), E2E-3 |
| 08/09/10/12 | unit (aggregation, shortfall), API (checkout/PO), E2E-3/4 |
| 11/13 | unit (price stamp, events), E2E-3/4 |
| 02/04/07 | E2E-5, view tests |
| 20/21/28 | E2E-6, rollup view tests |
| 22/23/24/26 | E2E-1/2, importer units |
| 25 | each de-stubbed feature lands with its own spec (list in CROSS-FEATURE R2-25) |
| 30/38 | phase-timeline CRUD units; portal E2E: token access, regenerate revokes, comment → activity + notification, no price/inventory leakage (leak test) |
| 31/32/35 | duplicate-guard matcher units; archive E2E (warning → demand released → unarchive); print-queue batch PDF |
| 33/34 | export golden-files (CSV/xlsx match fixtures); search relevance smoke |
| 36/37 | notification fan-out per role matrix; AI-spend series equals seeded run costs |
| Q-06 | checkout splits by distributor: N distributors → N orders, each requiring its order number |
| Q-09 | PO placement → draft expense created, owner confirm flips is_draft, totals match |

## 7. CI pipeline (GitHub Actions → Vercel)

```
push/PR → typecheck + lint + unit + RLS/API (supabase local) + worker suite   [~fast, always]
        → build → preview deploy + seeded branch DB → Playwright E2E (desktop+mobile)
        → all green → mergeable; main → production deploy
nightly → live-API smoke (cost-capped) + full E2E matrix
```

Bun everywhere (`bun test`, `bunx playwright`). Coverage reported, but the gate is the flow suite +
invariants, not a % number — expected-output tests over vanity coverage.
