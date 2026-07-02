# SmarkStock — Round-2 Plan Folder

> Client reviewed the working prototype (`SmarkStock-prototype/SmarkStock.dc.html`) a second time and
> came back with ~50 changes + new features. This folder is the **single source of truth for the v2
> plan**. Plan files only — no code is written from here until the plan is approved.

## How this folder works

1. Every client change gets an ID **`R2-NN`** and one row in [`CHANGE-LOG.md`](CHANGE-LOG.md).
2. The change is then written into the **tab file(s)** it touches, under that tab's *Round-2 changes*
   section, referencing its `R2-NN` id.
3. If it changes data, [`SCHEMA.md`](SCHEMA.md) is updated in the same pass (new table / column /
   status walk), tagged with the same `R2-NN`.
4. If it ripples across tabs (most do), the ripple is recorded in
   [`CROSS-FEATURE.md`](CROSS-FEATURE.md) so no receiving tab is forgotten.
5. Anything unclear / "we'll discuss later" becomes a **`Q-NN`** entry in
   [`PENDING-DECISIONS.md`](PENDING-DECISIONS.md), linked from the change and from the tab file.
   A change blocked on a question keeps status 🟡 or 🔵 until resolved — the plan is only *complete*
   when every change is 🟢 and every Q is answered or explicitly deferred out of scope.

### Status legend (used everywhere)

| Emoji | Meaning |
|---|---|
| 🟢 | Planned — fully specified in the tab file(s) + schema |
| 🟡 | Needs input — partially specified, waiting on a `Q-NN` answer |
| 🔵 | Discuss later — parked by the client, tracked so it isn't lost |
| ⚪ | Superseded / merged into another change |

## File map

> **Naming note (client clarified):** the `tab-*.md` prefix means *planning unit*, not literally a
> nav tab. Some are nav tabs (Dashboard, Inventory, Projects, Cart, Daily Reports, Expenses…), some
> are screens INSIDE a flow (ordering workspace / agent run / order review live inside a project
> BOM), one is a drawer (part detail), one is shell chrome (login-shell). Nav truth lives in
> `tab-login-shell.md`; remember this when building.

| File | Covers |
|---|---|
| [`CHANGE-LOG.md`](CHANGE-LOG.md) | Every R2 change: one row, status, tabs + schema touched, overlaps |
| [`TESTING.md`](TESTING.md) | R2-29: automated quality gate — layers, E2E flows, invariant suite, CI pipeline |
| [`CROSS-FEATURE.md`](CROSS-FEATURE.md) | How tabs talk to each other; per-change ripple map |
| [`SCHEMA.md`](SCHEMA.md) | Supabase data model (baseline from FEATURES.md §11) — updated as we go |
| [`PENDING-DECISIONS.md`](PENDING-DECISIONS.md) | Open questions / discuss-laters (Q-NN) |
| [`tab-login-shell.md`](tab-login-shell.md) | PIN login, app shell (rail / bottom tabs / top bar), global scan modal, toasts |
| [`tab-dashboard.md`](tab-dashboard.md) | `#/dashboard` |
| [`tab-inventory.md`](tab-inventory.md) | `#/inventory` — list + deep filter |
| [`tab-part-detail.md`](tab-part-detail.md) | `#/part/:pid` — drawer: specs, locations, label, living history |
| [`tab-shelves.md`](tab-shelves.md) | `#/shelves` — rack browser + big-box detail |
| [`tab-scan.md`](tab-scan.md) | `#/scan` — part / box scan, take-out / add |
| [`tab-bulk-pick.md`](tab-bulk-pick.md) | `#/pick` — bulk pick from a BOM |
| [`tab-receive.md`](tab-receive.md) | `#/receive` — add part, top-up, receive against order, label sheet, onboarding queue |
| [`tab-orders-projects.md`](tab-orders-projects.md) | `#/projects` (was `#/order`) — projects list + project hub: named BOMs, team, timeline, notes/tasks |
| [`tab-daily-reports.md`](tab-daily-reports.md) | `#/daily` — NEW (R2-07): self-marked attendance, hours, day's movements + ordering, per person |
| [`tab-attendance.md`](tab-attendance.md) | stub — merged into Daily Reports (R2-07) |
| [`tab-expenses.md`](tab-expenses.md) | `#/expenses` — NEW (R2-20/21, owner + accountant): entries + charts + AI spend |
| [`tab-client-portal.md`](tab-client-portal.md) | `/p/:token` — NEW (R2-38): client-facing project page — phases, progress, updates, comments |
| [`tab-ordering-workspace.md`](tab-ordering-workspace.md) | `#/order/setup` — dseq, priorities, rules, tier |
| [`tab-agent-run.md`](tab-agent-run.md) | `#/order/run` — master + item-agent console |
| [`tab-order-review.md`](tab-order-review.md) | `#/order/review` — compare, feedback, mark ordered |
| [`tab-on-order.md`](tab-on-order.md) | `#/cart` (was `#/on-order`, R2-09) — smart cart / ordered by PO / arrived |
| [`tab-ai-memory.md`](tab-ai-memory.md) | `#/memory` — suggested + active rules, versioning |
| [`tab-settings.md`](tab-settings.md) | `#/settings` — keys, search rules, PIN, label size, thresholds |

## Baseline (what "current" means in every tab file)

- **Prototype:** `SmarkStock-prototype/SmarkStock.dc.html` (dc runtime, mock data in `buildMock()`),
  as approved after review 1 (review-1 changes like projects-per-order and the immersive rack are
  already IN the prototype and are part of the baseline).
- **Spec:** `FEATURES.md` (v1) — architecture, agents, schema §11, phases. Where a tab file and
  FEATURES.md disagree after R2 edits, **the tab file wins**; FEATURES.md gets regenerated at the end.
- Navigation baseline: desktop rail groups Overview (Dashboard, Inventory, Shelves) · Operate (Scan,
  Pick, Receive) · Ordering (Orders, On-order) · footer (AI Memory, Settings). Mobile bottom tabs:
  Dashboard, Inventory, Scan, Orders, AI Memory.

## Round-2 intake status

## ✅ PLAN COMPLETE (2026-07-02)

- Changes: **38 logged — 36 🟢 · 2 ⚪ superseded (R2-05→R2-30, R2-18→R2-04) · 0 open**
- Questions: **Q-01…Q-10 all CLOSED** (see PENDING-DECISIONS closed table)
- Ideas: I-01/02/04/05/06/07/08/10 approved → R2-31…R2-38 · I-03 declined · I-09 parked future
- **`FEATURES.md` v2 regenerated from this folder — that file is the build spec; this folder is
  the audit trail + per-surface detail.** New changes from here get R2-39+ and re-sync FEATURES.md.

## End-of-intake checklist (run when all ~50 are logged)

- [x] Every change 🟢 or consciously parked with client sign-off (36 🟢, 2 ⚪, 0 parked)
- [x] Overlap column resolved — no two changes silently contradict
- [x] `SCHEMA.md` consistent (every tab file's *Data touched* names real tables)
- [x] `CROSS-FEATURE.md` ripple map has no dangling "TBD"
- [x] Every R2 change mapped to test scenarios in `TESTING.md` §6 (R2-29 gate)
- [x] Regenerate `FEATURES.md` v2 from this folder — **done 2026-07-02 → build-ready**
