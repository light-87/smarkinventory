# Agent Run (console — the centerpiece)

**Route:** `#/order/run` · **Spec:** FEATURES.md §5.5–§5.6, §4, §14 · **Prototype:** `isOrderRun`
(simulated; real app = worker + Realtime stream).

## 1. Purpose (baseline)

Watch the money being spent well: master planner narrates, item agents fan out per to-order line,
comparison rows stream in live, cost/progress/elapsed always visible.

## 2. Current behaviour (as prototyped)

- **Master card:** ◆ Master agent + typewriter status ("Reading rules, BOM & inventory…" → "Planning
  search strategy…" → "Planned N searches · dispatched N item agents."), progress bar, stats
  (done/total · est. cost ₹ · elapsed), speed toggle (1× / 4× / instant + ↺ Replay — demo controls),
  **Review results →** when done.
- **Item lanes (grid):** per to-order line — ref + value, status chip cycle (`Searching LCSC…` →
  `Checking Digikey stock…` → `Package match ✓` → `Comparing prices…` → done + spinner), rows appear
  one by one: Site · Price · Stock · MPN ✓/≈/✗ · Pkg ✓/✗ · Open ↗, recommended row flashes orange +
  pill. **In-stock lines short-circuit:** "✓ Already in stock — 2,568 in Box B-12" (skip-buy).
- Lane footer: "AI · why" line (basis of the pick, faults of others).
- Concurrency follows tier (economy 2 / balanced 3 / thorough all); respects reduced-motion
  (instant); run persists onto the project when done (`status → sourced`).
- **Real architecture (spec):** web app enqueues jobs → always-on **Browser-Worker** claims
  (atomic), Sonnet per-item agents execute the ladder (REST: Digikey/Mouser/element14; BrowserDriver:
  LCSC/Unikey), results inserted → Realtime/SSE streams to this screen. **Opus plans only, never
  browses.** Phase-0 spike gates the browser path. Idempotent upserts keyed (run, line, distributor);
  per-site hard cap; per-run ₹ ceiling.

## 3. Data touched

| Read | Write |
|---|---|
| run config (from workspace), rules digest, inventory (skip-buy) | `smark_agent_runs` (status walk, actual_cost), `smark_order_jobs`, `smark_agent_results` (streamed), project savedRun |

## 4. Talks to (edges)

- ← **Ordering workspace** config (A2-2); → **Order review** lanes (A2-3); → **Orders** project
  persistence (A2-4); → **Dashboard** agent-activity card (A2-15).
- Skip-buy decisions read live stock — must agree with Inventory/reconcile.
- Lane "why" can cite **AI Memory** rules ("skipped — matched already_stocked C14663") — run log
  records which rule influenced which line (§10 anti-drift).

## 5. Round-2 changes

### R2-03 (ripple) — runs persist per (project, BOM) 🟢
Run header shows project · **BOM name**; saved run + `sourced` status attach to that BOM's row in
the project hub, not to the project as a whole. Multiple BOMs of one project can have independent
runs (sequential or parallel — worker queue already keyed by run_id, no schema strain).

### R2-08 (ripple) — run + its review are one stored artifact 🟢
"Review results →" opens a review that stays saved with the run (selections, feedback, cart-adds)
— re-entering a sourced BOM later lands on the stored review, not a fresh one.

### R2-17 (ripple) — pseudonymized AI context 🟡
Prompts to Opus/Sonnet pass through the alias layer: client/project/product names → codes
(CLIENT-A, PROJ-03) via `smark_ai_aliases`; project descriptions/notes are **never** included.
Exception (explicit): **MPN / LCSC PN / package / distributor names go through real** — they are
public catalog identifiers and the search cannot work without them. De-aliasing happens server-side
when rendering results. Scope of the "all-context model" itself → Q-08.

## 6. Open questions on this tab

*(none yet)*
