# Cross-Feature Map — how the tabs talk to each other

> Two halves. **Part A** is the baseline wiring (as prototyped + FEATURES.md): the shared entities and
> every edge between tabs. When an R2 change lands in one tab, walk its edges here to find every other
> tab that must absorb it. **Part B** is the living ripple map: one entry per R2 change that crosses a
> tab boundary, saying exactly what each receiving tab must change.

---

## Part A — baseline wiring

### A1. Shared entities (the nouns every tab reads or writes)

| Entity (schema home) | Written by | Read by |
|---|---|---|
| **Part** + qty rollup (`smark_parts`, `smark_stock_locations`) | Receive (new/top-up/put-away), Scan (±qty), Bulk pick (−qty), Onboarding queue | Inventory, Part detail, Shelves, Dashboard, Scan, Orders reconcile, Agent run ("already stocked"), Bulk pick resolve |
| **Movement** (`smark_movements`) | Scan take-out/add, Bulk pick finish, Receive confirm, qty adjust, Undo | Dashboard (recent movements, movements-today), Part detail (history feed) |
| **Part living history** (`smark_part_events`) | Receive (received/top-up rows), Order review (ordered), system (adjust/note) | Part detail timeline, AI planner context (per FEATURES.md §6.4) |
| **Shelf / Big box** (`smark_shelves`, `smark_big_boxes`, QR labels) | Settings-less for now: created during Receive/onboarding; box QR printed in Shelves/Receive | Shelves browser, Scan (box scan → live contents), Receive (suggested storage), Bulk pick (pick locations) |
| **Project** (`smark_projects` — extended in round 1 to own orders) | Orders tab (create project, attach BOM, saved run) | Orders list cards, Ordering workspace header, Agent run persistence, Dashboard usage-by-project, Inventory project facet |
| **BOM + lines** (`smark_boms`, `smark_bom_lines`) | Orders tab upload (template parse) | Orders workspace table (in-stock/to-order split), Ordering workspace (per-line notes), Agent run lanes, Bulk pick |
| **Agent run + results** (`smark_agent_runs`, `smark_order_jobs`, `smark_agent_results`) | Agent run console (worker writes results; run persisted onto project) | Order review lanes, Dashboard agent-activity, Orders project card status (`draft → sourced`) |
| **Order lines / statuses** (`smark_orders`, `smark_order_lines`) | Order review "Mark ordered" (creates), On-order "Mark arrived" (walks status) | On-order groups, Receive "against an order" list, Dashboard on-order stat, Part detail history |
| **AI Memory rules + digest** (`smark_learned_rules`, `_doc` versions) | Order review feedback + whole-order remark (suggested), AI Memory approve/reject/retire (active, version++) | Ordering workspace "context v{N}" card, Agent run master plan (digest injected), AI Memory screen |
| **Standard search rules** (`smark_ordering_rules`) | Settings (add/remove; package row locked `required`) | Ordering workspace (read-only display), Agent run ladder execution |
| **Distributor sequence** (`smark_distributor_preferences` default → per-BOM `distributor_sequence`) | Settings-level default; per-order editor in Ordering workspace | Agent run (site order per lane), Review rows order |
| **Onboarding queue** (`needs_review` / no-location parts from Stock List import) | Import job (creates), Receive "Batch generate" (drains: assign + print) | Receive queue count, Inventory (parts flagged) |
| **Auth/PIN session** | Login; Settings (change PIN) | Shell (lock), everything (gate) |
| **User + role** (`smark_app_users`) `[R2-01]` | Settings Users card (owner) | Login, shell avatar, every actor stamp, RLS, Q-01 matrix |
| **Attendance day** (`smark_attendance`) `[R2-02]` | Attendance tab (self check-in/out + project tag) | Attendance owner board, project hours (per Q-03 model) |
| **Project membership** (`smark_project_members`) `[R2-04]` | Project hub Team section | Attendance working-on picker, task assignee list, hours table |
| **Time entry** (`smark_time_entries`) `[R2-04]` | Attendance flow and/or manual (Q-03) | Project hub Team & hours, Attendance range view |
| **Project activity** (`smark_project_activities`) `[R2-06]` | Project hub Notes & tasks (owner+employee) | Project feed, open-task badges, change-request trail |
| **Cart line** (`smark_cart_items`) `[R2-09]` | Review add, auto-shortfall, manual add | Cart tab, checkout, contested-stock flags |
| **Purchase order** (`smark_orders` + PO) `[R2-12]` | Cart checkout | Cart Ordered/Arrived, Receive put-away, part history PO chips, expenses seam |
| **Project document** (`smark_project_documents`) `[R2-16]` | Project hub Documents | Hub list, activity-entry references |
| **AI alias map** (`smark_ai_aliases`) `[R2-17]` | Server alias service | Every Claude call w/ business context (planner, digest, extraction) |
| **BOM template** (`smark_bom_templates`) `[R2-19]` | Create-BOM save | Create-BOM prefill, xlsx template generator |
| **Expense entry** (`smark_expenses`) `[R2-20]` | Expenses tab (owner + accountant), PO auto-draft | Expense charts, Daily Reports §4, project Payments strip |
| **Project phase** (`smark_project_phases`) `[R2-30]` | Hub timeline editor (owner) | Overview progress, on-track chip, client portal, Q-07 completion |
| **Notification** (`smark_notifications`) `[R2-36]` | System events (arrivals, tasks, rules, drafts, portal comments) | Bell/badge, deep links |
| **Portal token** (`smark_projects.share_token`) `[R2-38]` | Hub share controls | Client portal access; regenerate = revoke |

### A2. Edge list (tab → tab, with the payload)

**Ordering pipeline (the main chain)**
1. **Orders/Projects → Ordering workspace** — active project + parsed BOM (lines, priorities text,
   per-line notes) via `Set up ordering →`.
2. **Ordering workspace → Agent run** — run config {dseq order + on/off, priorities, tier
   (economy/balanced/thorough → concurrency), memory digest version}. `Run ordering →`.
3. **Agent run → Order review** — finished lanes: comparison rows {dist, price, stock, MPN ✓/≈/✗,
   Pkg ✓/✗, link, recommended}, per-lane confidence + "why", skip-buy flags. `Review results →`.
4. **Agent run → Orders/Projects** — run persisted on the project (`savedRun`, status → `sourced`);
   re-entering the project shows the saved run, not a re-run.
5. `[R2-08/09 rewrite]` **Order review → Cart** — "Add to cart" sends {selected result, needed qty,
   project·BOM·line ref} → cart line (aggregated per part). Review itself persists with the run.
   ~~"Mark ordered" on review~~ removed.
6. `[R2-09/12 rewrite]` **Cart → order → Receive** — checkout (any projects mixed) creates ONE
   order under a required **PO number**; "Mark arrived" per line flips status; line appears in
   Receive → put-away grouped by PO with its existing/new flag. Receipt upload → AI price extract.
7. **Receive → Inventory/Part detail/Shelves/Dashboard** — confirm put-away: existing part → top-up
   ESD qty, append history row, **no reprint**; new part → create part + location, print 1 ESD label.
   Movements + stats update everywhere. `[R2-11]` arrival stamps `last_unit_price` → inventory value.
7b. `[R2-10]` **Any BOM/stock change → Cart** — demand recompute (`v_part_demand`); combined
   cross-project demand > stock → auto shortfall cart line; contested flags shown in project BOM
   view + part detail.
7c. `[R2-07]` **Everything → Daily Reports** — movements, ordering events, attendance, hours union
   into the per-day/per-person digest (read-only view).

**Learning loop**
8. **Order review → AI Memory** — per-item feedback text and whole-order remark → suggested rule
   {scope, subject, rule, source quote}.
9. **AI Memory → Ordering workspace / Agent run** — approve → rule active, `version++`; workspace
   shows "AI Memory added as context v{N} · {count} rules"; master plan consumes the digest; lane
   "why" lines can cite rules ("skipped — already stocked C14663").

**Inventory & physical ops**
10. **Scan ↔ Part detail** — part code → part card (scan tab) or drawer (`#/part/:pid` from top-bar
    scan / global modal / any part row anywhere).
11. **Scan → Shelves** — box code → box live contents (audit / receive-into-this-box entry points).
12. **Bulk pick → Movements/Inventory** — checked lines decrement stock on finish; unresolved lines
    deep-link **→ Orders** ("To order →").
13. **Shelves → Part detail** — box contents row click opens the part drawer.
14. **Inventory → Part detail** — row click opens drawer; facets ← part typed columns + attributes.
15. **Dashboard → everywhere** — read-only aggregates; agent-activity card deep-links into the
    running/last run (Orders project).
16. **Receive (new part) ← AI suggest** — category+package → suggested big box (`boxByCategory`),
    user can override; label printed from label sheet.

**Shell**
17. **Top-bar scan / global modal → Part detail or Shelves** — code resolution (PID → part, box id →
    box); wrong code → toast.
18. **Settings → Ordering workspace** (rules read-only view), **→ Agent run** (concurrency default),
    **→ Receive/labels** (label size), **→ Login** (PIN).

### A3. Invariants to preserve across any R2 change

- **One QR per ESD plastic, one per big box — never per unit; existing part top-up never reprints.**
- **Package match is mandatory** in the ladder; a change may add rules but not make package optional.
- Every stock mutation writes a movement and is **undoable** (toast Undo / `undo_of`).
- Part qty shown anywhere = rollup of its ESD locations — single source (`total_qty` denorm).
- Sourcing (BOMs, runs, reviews) always lives inside a **project BOM**; a run + its review are
  reproducible from their saved snapshot. `[R2-12 amends]` **Purchases are global** (one PO spans
  projects) — project traceability moves to the order **line** level and must never be lost.
- AI memory is **advisory, versioned, reviewable** — suggested never silently becomes active.
- Statuses only walk forward: `cart(open) → ordered → arrived` (put-away closes the loop)
  `[R2-09 relabel]`; every order carries a unique PO number `[R2-12]`.

---

## Part B — R2 ripple map (living)

> One block per cross-tab change. Format:
>
> ### R2-NN — short title
> - **Origin tab:** where the client asked for it → see that tab file's entry
> - **Ripples:**
>   - `tab-x.md` — what must change there
>   - `SCHEMA.md` — table/column deltas
> - **Invariants checked:** (any of A3 affected? how preserved?)

### R2-01 — Username/password logins, 3 roles (owner · employee · accountant) 🟡

- **Origin tab:** [`tab-login-shell.md`](tab-login-shell.md) (login v2) + [`tab-settings.md`](tab-settings.md) (owner adds users)
- **Ripples:**
  - `tab-settings.md` — new owner-only **Users & roles** card (add / reset password / deactivate);
    App-PIN card superseded (Q-02).
  - `SCHEMA.md` — new `smark_app_users`; RLS baseline rewritten; all actor/created_by columns → real
    user FKs.
  - **Every tab (deferred until Q-01):** once the access matrix lands, each tab file gets a
    one-line "visible to / actions by role" note, and AI-Memory approve + Settings edits get pinned
    to owner. Until then no tab hides anything.
  - Shell — avatar shows display name + role chip; Lock → Logout; movements/history render real
    display names instead of "SA"/"RT" initials (Dashboard feed, Part-detail timeline, box counts).
- **Invariants checked:** A3 unchanged — undo/movement writing now stamps `actor`; AI-memory
  "suggested never auto-active" gains an enforcement point (approve = owner-only, pending Q-01
  confirmation).

### R2-02 — Attendance tracking (new tab) 🟡

- **Origin tab:** [`tab-attendance.md`](tab-attendance.md) (new file)
- **Ripples:**
  - `tab-login-shell.md` — rail "Team" group + role-aware mobile tab proposal (with Q-01).
  - `tab-orders-projects.md` — "working-on" project tag reads project membership (R2-04).
  - `SCHEMA.md` — `smark_attendance` (draft fields until Q-03).
  - Dashboard — deliberately NO widget yet (noted in tab file; only if client asks).
- **Invariants checked:** none of A3 touched (no stock/order paths).

### R2-03 — Orders tab → Projects tab, multiple named BOMs per project 🟢

- **Origin tab:** [`tab-orders-projects.md`](tab-orders-projects.md)
- **Ripples:**
  - `tab-login-shell.md` — nav rename Orders→Projects (rail + mobile slot), route `#/projects`.
  - `tab-ordering-workspace.md` / `tab-agent-run.md` / `tab-order-review.md` — pipeline scoped to
    (project, **named BOM**); per-BOM dseq/priorities/saved-run; header shows `project · BOM`.
  - `tab-on-order.md` — rows chip-labeled `project · BOM`, optional project filter.
  - `tab-bulk-pick.md` — "pick a project BOM" source alongside ad-hoc upload.
  - `SCHEMA.md` — `smark_boms.name` unique per project + `sourcing_status` + `saved_run_id`;
    project status derived.
- **Invariants checked:** "orders always live inside a project" (A3) — strengthened: now inside a
  project **BOM**; run reproducibility now per-BOM snapshot.

### R2-04 — Project team + hours 🟡 · R2-05 — client-shared timeline 🔵 · R2-06 — notes/changes/tasks 🟢

- **Origin tab:** [`tab-orders-projects.md`](tab-orders-projects.md) (hub sections) +
  [`tab-attendance.md`](tab-attendance.md) (hours surface)
- **Ripples:**
  - `SCHEMA.md` — `smark_project_members`, `smark_time_entries` (Q-03), `smark_projects` timeline
    columns (minimal, Q-04), `smark_project_activities`.
  - Task assignees restricted to project members; membership feeds attendance picker.
  - R2-05: NOTHING client-facing planned yet — Q-04 gates any share link/portal/PDF work.
  - Accountant visibility of hours/notes/timeline rides on Q-01.
- **Invariants checked:** A3 untouched; new append-only feed mirrors the living-record principle
  (part history ↔ project activity feed — same pattern, different subject).

### R2-07 — Daily Reports tab (new; absorbs Attendance) 🟡

- **Origin tab:** [`tab-daily-reports.md`](tab-daily-reports.md) (new); [`tab-attendance.md`](tab-attendance.md) → stub.
- **Ripples:** `tab-login-shell.md` — Team group entry = Daily Reports; mobile role-aware slot.
  `tab-dashboard.md` — "today's report →" link. `SCHEMA.md` — `v_daily_activity` view only.
  Q-03(a) closed (self-marked); Q-03(b) hours model still open.
- **Invariants checked:** read-only digest — no new write paths besides attendance itself.

### R2-08 — Review persists; only adds to cart 🟢

- **Origin tab:** [`tab-order-review.md`](tab-order-review.md)
- **Ripples:** `tab-agent-run.md` — run+review = one stored artifact. `tab-on-order.md` (Cart) —
  receives review adds. `tab-orders-projects.md` — sourced BOM reopens its stored review.
  `SCHEMA.md` — `selected` stamps on results; `to_order` leaves `smark_order_lines`.
- **Invariants checked:** run reproducibility strengthened (review state included).

### R2-09 / R2-10 / R2-12 — Smart Cart + global PO orders 🟢/🟡

- **Origin tab:** [`tab-on-order.md`](tab-on-order.md) (retitled **Cart**)
- **Ripples:**
  - `tab-order-review.md` — action renamed, qty prefill semantics.
  - `tab-orders-projects.md` + `tab-part-detail.md` — contested-stock flags (R2-10).
  - `tab-receive.md` — put-away grouped by PO; arrival stamps last price.
  - `tab-dashboard.md` — inventory value ₹ (R2-11 sibling).
  - `tab-login-shell.md` — nav label Cart.
  - `SCHEMA.md` — `smark_cart_items`, `v_part_demand`, orders rework (po_number, receipt fields,
    bom_id dropped), order_lines project denorm.
- **Invariants checked:** A3 "orders live inside a project" AMENDED (see A3) — purchases global,
  line-level traceability mandatory; status walk relabeled cart→ordered→arrived; demand lifecycle
  guarded by **Q-05** so auto-lines can't double-order (dismissal memory + aggregation per part).

### R2-11 — Price per part + inventory value 🟢

- **Origin tab:** [`tab-dashboard.md`](tab-dashboard.md) (value stat)
- **Ripples:** `tab-part-detail.md` (last price + stock value), `tab-inventory.md` (optional
  column, confirm), `tab-receive.md` (arrival stamp), `SCHEMA.md` (`last_unit_price`, `currency`).
  Price sources: cart manual entry (R2-09) + receipt extraction (R2-12) + existing part-event
  history.
- **Invariants checked:** value derivable at read-time; unpriced parts surfaced, not guessed.

### R2-13 — Fully detailed living record 🟢

- **Origin tab:** [`tab-part-detail.md`](tab-part-detail.md)
- **Ripples:** `SCHEMA.md` — part-events enrichment (price_change/location_moved/picked,
  price_old/new, order_id). Writers: Receive (arrival + price stamp), Cart checkout (ordered),
  Scan/Bulk pick (picked), box-move flows (location_moved). Daily Reports consumes the same events.
- **Invariants checked:** append-only preserved; client names via join, not copies.

### R2-14 🟡 / R2-15 🔵 / R2-16 🟢 — performance · payments · documents

- **Origin tab:** [`tab-orders-projects.md`](tab-orders-projects.md)
- **Ripples:** `SCHEMA.md` (`completion_pct`+`completed_at` draft Q-07; `smark_project_documents`;
  payments = `smark_expenses.project_id` seam only). R2-14 progress uses R2-06 task ratio +
  R2-05 dates + (later) Q-03 hours. R2-16 documents referenced from activity entries.
- **Invariants checked:** nothing auto-computes "performance" without Q-07 sign-off.

### R2-17 — AI pseudonymization layer 🟡

- **Origin:** cross-cutting server concern (no single tab)
- **Ripples:** `tab-agent-run.md` (planner/agent prompts aliased), `tab-ai-memory.md` (digest
  aliased on injection, screen keeps real names), receipt extraction (R2-12) — runs through the
  same layer. `SCHEMA.md` — `smark_ai_aliases`.
- **Invariants checked:** MPN/LCSC/package/distributor stay real (search correctness); descriptions
  never sent; mapping never leaves the server. Q-08 scopes the "all-context model".

### R2-19 — In-app BOM builder + remembered structure 🟢

- **Origin tab:** [`tab-orders-projects.md`](tab-orders-projects.md)
- **Ripples:** `SCHEMA.md` (`smark_bom_templates`, `bom_lines.extra`, `boms.created_in_app`).
  Downloadable xlsx template renders the SAME remembered columns (one structure everywhere).
  Reconcile/pipeline path identical to uploads — custom columns display-only for agents (not sent
  as search keys).
- **Invariants checked:** BOM named+unique per project (R2-03) applies to created BOMs too.

### R2-20 / R2-21 — Expenses tab + charts (owner-only) 🟡

- **Origin tab:** [`tab-expenses.md`](tab-expenses.md) (new)
- **Ripples:** `tab-daily-reports.md` §4 (owner-only day section), `tab-login-shell.md` (nav item,
  owner-visible), `SCHEMA.md` (`smark_expenses` draft + rollup views), `tab-orders-projects.md`
  (payments strip seam, parked). Q-09 collects fields/categories/PO-auto-entry; Q-01 records the
  accountant-tension (client said owner-only, yet accountant role exists).
- **Invariants checked:** no double counting vs inventory value (separate concepts; PO→expense
  auto-entry only if Q-09 approves).

### R2-22 — Mobile "More" tab 🟢

- **Origin tab:** [`tab-login-shell.md`](tab-login-shell.md). Closes the mobile-slot half of Q-01;
  the matrix still filters what the More sheet lists per role. No schema.

### R2-23 / R2-24 — Receive simplification, custom part fields, voltage split 🟢

- **Origin tab:** [`tab-receive.md`](tab-receive.md), [`tab-inventory.md`](tab-inventory.md)
- **Ripples:** `SCHEMA.md` — `smark_part_field_templates`, `smark_parts.voltage`; Stock-List
  importer + BOM reconcile split combined value/voltage strings; Inventory gains V column + facet;
  custom-field values deep-filterable via attributes; Settings gains "retire remembered fields".
- **Invariants checked:** attributes jsonb remains the long-tail home; voltage joins the promoted
  facet set; nothing breaks the §5.4 ladder (value/voltage both feed the Value rule).

### R2-25 — No demo stubs: everything real 🟢 (+Q-10)

- **Origin:** blanket, all tabs. **Stub inventory** (from prototype exploration — each must be a
  real feature at build):
  1. Print ESD / Big-Box label buttons → real PDF render → R2 + print flow (label size from
     Settings).
  2. Download template ↓ → real xlsx generated from the remembered BOM template (R2-19).
  3. Save as PDF cart / review → real PDF artifacts.
  4. "+ Add site" (workspace) → real distributor add (now Settings-managed, R2-28).
  5. Settings dropdowns (label size · low-stock mode · concurrency) → functional selects persisted.
  6. Box scan **Count / audit** → real audit flow — needs a mini-spec → **Q-10**.
  7. "Receive into this box" → preset box in Receive put-away/top-up.
  8. Datasheet ↗ / order links / "View recommended listing" → real URLs (agent results carry them).
  9. Part drawer **Adjust qty** → real adjust with movement + undo; **Order more** → cart add.
  10. QR codes → real encode (PID / box id); scan camera + HID paths per §8.
  11. MPN AI lookup (receive) → real Claude normalize call (§6.5).
  12. Upload zones (BOM, bulk takeout, receipts, documents) → real parsers/storage.
  13. Simulate-scan buttons → dev-only, stripped in production.
  14. Connected-accounts chips (Settings) → real status or removed.
- **Invariants checked:** every new real flow that mutates stock writes movements + undo (A3).

### R2-26 — "Bulk takeout" rename 🟢

- Labels only; internal keys unchanged. Tabs: bulk-pick file header, shell nav, More sheet.

### R2-27 — Build quantity 🟢

- **Origin tab:** [`tab-ordering-workspace.md`](tab-ordering-workspace.md)
- **Ripples:** `tab-orders-projects.md` (BOM row shows ×N + stale-run flag), `tab-on-order.md`
  (demand view multiplies), `tab-bulk-pick.md` (takeout ×N), `tab-agent-run.md` (min-qty in plan),
  `SCHEMA.md` (`build_qty`, `v_part_demand`).
- **Invariants checked:** skip-buy correctness at ×N (in-stock only if stock ≥ multiplied need);
  saved-run staleness surfaced, never silently wrong.

### R2-28 — Settings expansion 🟢

- **Origin tab:** [`tab-settings.md`](tab-settings.md)
- **Ripples:** `tab-expenses.md` (account picker on entries), `SCHEMA.md`
  (`smark_expense_accounts`, `expenses.account_id`, distributors addable), workspace dseq lists
  dynamic distributor set (new sites default OFF, browser-driver unless keyed API).
- **Invariants checked:** keys server-side only; per-site caps apply to added sites too (ToS
  posture §13).

### Round-3 batch — Q&A closures + approved ideas (R2-30…R2-38)

- **R2-30 phase timeline + R2-38 client portal:** hub Overview gets the phase editor; portal
  (`tab-client-portal.md`) renders it read-only via `share_token`; timeline edits log `change`
  activities; portal comments → activities + owner notification. Q-07 (completion math over
  phases) is the ONLY remaining design input for these.
- **R2-31 duplicate guard:** Receive new-part save runs the shared reconcile matcher — same ladder
  as BOM reconcile and bulk takeout (one matcher, three consumers).
- **R2-32 archive:** warning dialog → releases this project's demand from `v_part_demand`
  (settles the archive-half of Q-05), freezes activities/tasks, hides from pickers, suspends
  portal link. Unarchive reverses.
- **R2-33 exports:** Inventory (filtered view), Daily Reports (day/range), Expenses (filtered
  ledger) → CSV/xlsx server-side.
- **R2-34 global search:** extends the top-bar field — parts/projects/BOMs/PO numbers; scan codes
  still resolve first (scan beats search on exact code match).
- **R2-35 print queue:** all label creation paths (new part, onboarding assign, box label) queue
  instead of print-now; Receive shows the queue; one Avery PDF per batch.
- **R2-36 notifications:** event fan-out respects the final role matrix (e.g. `expense_draft` +
  `rule_pending` → owner only; accountant gets expense events too).
- **R2-37 AI spend:** Expenses charts read `smark_agent_runs.actual_cost` — no new write path.
- **Q-06 amendment ripple:** checkout groups by distributor (one order + website order-number per
  group) — Cart §3-C, Receive put-away grouping, and part-history PO chips all reference the
  per-distributor order rows; "order all projects at once" preserved WITHIN each distributor group.
- **Invariants:** A3 status walk unchanged (each distributor-order walks independently); demand
  release now has a defined archive path; portal never exposes prices/inventory (new invariant:
  **portal shows only explicitly-shared content**).
