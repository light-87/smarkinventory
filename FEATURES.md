# FEATURES.md — SmarkStock v2

> **Build spec for Claude Code.** Read with the global standards in `~/.claude/CLAUDE.md`
> (Next.js + TS + Tailwind/MUI · Supabase · Cloudflare R2 · Bun · Vercel · PWA). Where this file and
> the global standards differ, **this file wins** (notably: all AI = **Claude API**, not Sarvam).
>
> **v2 (2026-07-02)** — regenerated after prototype review 2: 38 logged changes (R2-01…R2-38), all
> approved. Per-surface detail, change history, and rationale live in **`plan/`** (tab files,
> `SCHEMA.md`, `CROSS-FEATURE.md`, `TESTING.md`, `CHANGE-LOG.md`). If this file and `plan/` ever
> disagree, `plan/` is the audit trail — fix this file.

**Product:** inventory + AI ordering + **company operations** system for **Smark Automation**, a
small Indian electronics / PCB-assembly manufacturer. Non-technical, mobile-first users; ~2000
parts tracked by **Shelf → Big Box → ESD plastic**. v2 adds the company layer: projects as client
jobs (multi-BOM, phases, team, documents), smart cross-project cart with distributor orders,
attendance + daily reports, expenses + income, and a client-facing portal.

**AI (Claude API):** **Opus** = master planner + rule learning; **Sonnet** = per-item search
agents; small calls for MPN normalization + receipt extraction. All business context passes a
**pseudonymization layer** (§12).

---

## 0. Phase 0 — Browser-Worker Feasibility Spike ⚠️ GATE — BUILD THIS FIRST

Unchanged from v1 and still gates all agent work. Standalone worker with a swappable
`BrowserDriver` (primary: Anthropic computer-use; alternates: Playwright, Browserbase) + one REST
distributor (Digikey or Mouser) for calibration. Test on ~30 real `TMCS_96x32` lines spanning
full-MPN / LCSC-PN-only / value+package-only. Measure correct-part hit rate, match quality,
anti-bot incidence, latency, **₹ per item + projected ₹ per run**, 5-way concurrency stability.
**GREEN** = ≥90% correct AND manageable anti-bot AND acceptable cost → build browser-agent hybrid.
Else API-first with browser fallback / driver swap. Deliverable: `docs/spike-browser-worker.md` +
go/no-go line.

---

## 1. Overview & goals

1. **Know where every part is** (Shelf → Big Box → ESD plastic) and how many remain — with price,
   so the dashboard shows inventory value.
2. **Order intelligently** — per project & named BOM: reconcile against stock (× build quantity),
   AI agents compare distributors by a fixed rule ladder, review persists, chosen options land in a
   **smart cart** that also auto-catches cross-project shortfalls; checkout groups by distributor
   under real website order numbers; receipts upload + AI-extract prices.
3. **Label everything with QR** — one scan away; existing parts never get reprints.
4. **Run the company in the same app** — projects with phase timelines shared to clients via a
   portal, team assignment + manual hours, self-marked attendance, daily activity reports,
   expenses/income with charts.
5. **Learn from corrections** — reviewable, versioned AI memory; nothing trains the model.
6. **Ship tested** — every build passes an automated gate (unit → RLS matrix → E2E); red blocks
   deploy (§16).

---

## 2. Users & roles — FINAL matrix

Supabase Auth, **username + password** (username maps to synthetic email
`{username}@smark.internal`). No PIN anywhere; sessions persist per device; manual logout. Owner
creates all accounts in Settings (no self-signup, no email flows — owner resets passwords).
Deactivate, never delete (history FKs). Roles:

| Area | Owner | Employee | Accountant |
|---|---|---|---|
| Dashboard · Inventory · Shelves · Scan · Bulk takeout · Receive | full | full | read-only |
| Projects (BOMs, runs, review, cart-add) · Cart & checkout | full | full | read-only |
| Daily Reports | all people | **self only** | read all |
| Expenses (+charts, AI spend) | full | hidden | **read + write** |
| AI Memory approve · Settings · user management | full | hidden | hidden |

Enforced twice: UI (items hidden) and **RLS** (matrix = executable tests, §16). Every mutation
stamps the real `user_id`. **Client portal** (§11) is a tokenized public surface, not a role;
`client` login role is a reserved future seam. Single tenant; `tenant_id` seam deferred.

## 3. Tech stack & environment

Per global standards: Next.js App Router + TS, Tailwind + MUI, Zustand, react-hook-form + zod,
Bun, Vercel Pro; Supabase (Postgres + Auth + Realtime), all tables `smark_`-prefixed, uuid PKs,
timestamps, RLS on everything; R2 bucket `smarkstock-files` for ALL files (BOMs, labels, receipts,
documents, exports). Design system = locked SmarkStock dark theme, SMARK orange `#f57d05`
(`DESIGN.md` + tokens). Mobile-first PWA (manifest, SW, install prompt on login, 360px min, 44px
targets, offline scan queue).

```
NEXT_PUBLIC_SUPABASE_URL= / NEXT_PUBLIC_SUPABASE_ANON_KEY= / SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=  CLAUDE_MODEL_MASTER=(opus)  CLAUDE_MODEL_ITEM=(sonnet)
CLOUDFLARE_R2_ACCESS_KEY= / CLOUDFLARE_R2_SECRET_KEY= / CLOUDFLARE_R2_BUCKET=smarkstock-files / CLOUDFLARE_R2_ENDPOINT=
DIGIKEY_CLIENT_ID= / DIGIKEY_CLIENT_SECRET= / MOUSER_API_KEY= / ELEMENT14_API_KEY=   # + keys added via Settings
WORKER_SHARED_SECRET=  BROWSER_DRIVER=(computeruse|playwright|browserbase)
```

## 4. Architecture

v1 architecture holds: **Vercel app** (enqueue + subscribe + all CRUD) ↔ **Supabase** (Postgres +
Realtime job/result rows) ↔ **always-on Browser-Worker** (Railway/Fly/Render; claims jobs
`FOR UPDATE SKIP LOCKED`, Sonnet item agents, REST for Digikey/Mouser/element14, BrowserDriver for
LCSC/Unikey/added sites, writes `smark_agent_results` → Realtime streams to UI). **Opus plans, never
browses.** New in v2: the **alias layer** (§12) wraps every AI call server-side; the **client
portal** is a public Next.js route reading via security-definer functions only; **notifications**
fan out on system events.

---

## 5. Surfaces (nav truth; per-surface spec in `plan/tab-*.md`)

**Desktop rail** — Overview: Dashboard · Inventory · Shelves | Operate: Scan · Bulk takeout ·
Receive | Projects: Projects · Cart | Team: Daily Reports · Expenses (owner/accountant) | footer:
AI Memory · Settings. **Mobile bottom bar:** Dashboard · Inventory · Scan · Projects · **More**
(sheet with the rest, role-filtered). **Header:** screen title · global **search/scan field**
(scan codes resolve first; else Ctrl-K palette over parts/projects/BOMs/PO numbers) · notifications
bell (arrival, task assigned, rule pending, low stock, run done, expense draft, portal comment) ·
avatar (name + role chip, Settings, Logout).

1. **Dashboard** — stats: units, SKUs, low, out, on-order, movements today, **inventory value ₹**
   (Σ qty × last price, "N unpriced" honesty label); recent movements (+"today's report →");
   agent activity; usage by project.
2. **Inventory** — facet sidebar (Category, Package, **Voltage**, Stock, Status, Dielectric,
   Distributor, Project, Shelf) + search; columns PID · MPN · Value · **V** · Package · Category ·
   Qty · Location · Status (+optional Price); row → part drawer; **Export CSV/xlsx** of the
   filtered view.
3. **Part detail (drawer, `#/part/:pid`)** — specs (+last price, stock value), locations, label
   preview + print(queue), **living record**: every event timestamped with actor, qty, price,
   PO + distributor, project → client; `price_change` events show old → new; contested-stock strip
   when cross-project demand exceeds stock; filters; Order more / Adjust qty.
4. **Shelves** — immersive rack (shelf bands → big-box cards with part chips + low dots) → box
   detail (Big-Box QR label, live contents) → **guided audit**: confirm/type qty per ESD, variances
   = `adjust` movements tagged `audit`, `last_counted_at` stamped, partial/resumable.
5. **Scan** — HID (debounced keystroke buffer) + camera (`BarcodeDetector`, html5-qrcode fallback);
   part card (stepper, Take out / Add, undo toasts), box card (contents, audit,
   receive-into-this-box). Offline: movements queue + sync.
6. **Bulk takeout** (renamed) — upload / paste / **pick a project BOM**; lines resolved to
   locations; build-qty multiplies pick amounts (banner ×N); check-off walk; finish logs
   `bulk_pick` movements; "To order →" for misses.
7. **Receive** — three flat cards: **New part** (category chips, Value, **Voltage**, Package, Qty,
   MPN/Mfr optional, **"+ add custom field"** remembered for future forms, AI-suggested storage,
   **duplicate guard**: matcher hit → "Looks like SMK-000101 — top up instead?"), **Top up
   existing** (scan PID, add qty, NO reprint), **Put away arrivals** (grouped by PO/order number,
   existing→top-up / new→one label, stamps `last_unit_price` + history). **Label print queue**:
   all labels queue → one Avery-layout PDF per batch (size from Settings). Onboarding queue for
   imported no-location parts (assign Shelf→Box→ESD + queue label).
8. **Projects** (`#/projects`) — cards (name, client, status, BOM count) + archived filter.
   **Project hub:**
   - **Overview** — client, derived status, **phase timeline** (§10) with progress % + on-track
     chip, **payments strip** (linked income entries), share-link controls (portal §11).
   - **BOMs** — many per project, each **named** (unique per project): upload (template) or
     **create in-app** (grid editor, standard columns + "+ add field"; structure remembered as the
     company BOM template and mirrored into the downloadable xlsx). Per BOM: line count,
     in-stock/to-order split, **build qty ×N**, sourcing status, its saved run/review. Reconcile:
     MPN → LCSC PN → value+package(+voltage) fuzzy; need = line qty × build_qty; contested-stock
     chips when cross-project demand bites.
   - **Team & hours** — owner assigns employees; hours table per member from **manual** day
     entries.
   - **Documents** — named uploads to R2 (list, preview, download).
   - **Notes & tasks** — feed of Note / Meeting / **Change** / Task entries; tasks get assignee
     (members), due, done; open-task badges; owner+employee write; append-only (15-min author edit
     window); entries can be marked **"share to portal"**.
   - **Archive** — warning dialog (releases cart demand, freezes activity, hides from pickers,
     suspends portal); unarchive reverses.
9. **Ordering workspace** (per BOM) — **Builds required ×N** · distributor sequence
   (drag-reorder, toggles; sites managed in Settings) · plain-English priorities (sheet-prefilled)
   · AI-memory context card (digest v + count) · standard rules read-only · Economy/Balanced/
   Thorough + dry-run ₹ estimate → Run.
10. **Agent run** — master card (Opus narration, progress, done/total, est ₹, elapsed) + item
    lanes streaming comparison rows (site, price, stock, MPN ✓/≈/✗, Pkg ✓/✗, link, recommended,
    "AI · why"); in-stock lines short-circuit (checked at ×build_qty); run persists on the BOM;
    changing build_qty later flags the run stale.
11. **Review (per run, persisted)** — selections + feedback stored with the run, reopenable
    read-consistent forever; radio per option, confidence /100 + why, re-run item; **only action:
    Add to cart** (selected option + needed qty). Whole-order remark → AI Memory. PDF snapshot.
12. **Cart** (`#/cart`) — lines aggregated per part with per-project demand breakdown; sources:
    review adds, **auto-shortfall** (500 avail, A needs 400 + B needs 200 → auto line of 100;
    lifecycle: registers at reconcile of active BOMs, releases on takeout/arrival/archive;
    dismissed lines resurrect only if shortfall grows), manual adds. Editable qty + **unit price**;
    **checkout groups by distributor** → one order per group with its **website order number**
    (required, unique) → auto-creates a **draft expense** (owner confirms). Receipt upload → R2 +
    Claude extraction fills/corrects line prices (user confirms). Below: **Ordered** (grouped by
    order number, partial arrivals) and **Arrived** (→ Receive put-away).
13. **Daily Reports** (`#/daily`) — per day/person: **attendance** (self clock-in/out + working-on
    project selector), **manual hours** entry per project (prompted at clock-out; owner can
    correct), movements (who took/added what), ordering activity (uploads, runs, cart adds, orders,
    arrivals), **expenses section (owner/accountant)**. Day/range **export**. Employee sees self;
    owner all; accountant read-all.
14. **Expenses** (`#/expenses`, owner + accountant) — entries: type, amount, date, **account**
    (cash/bank/UPI from Settings), category, vendor, note, optional project (= payment), optional
    GST fields, attachment; PO-spawned **drafts** to confirm; soft delete. **Charts:** monthly/
    quarterly/yearly income vs expense, cumulative net, category donut, by-account, top-project
    income, YoY + **AI spend meter** (₹/run + monthly from run costs). Export.
15. **AI Memory** — suggested rules (approve/reject) → active versioned digest (v++ per change),
    retire; run log records which rule hit which line. Digest is **aliased** before injection.
16. **Settings** — Users & roles (owner adds/edits/deactivates, resets passwords) · Standard search
    rules (add/remove custom; **package pinned required**) · **Distributors** (addable: name, URL,
    REST key or browser method; keys server-side) · **Expense accounts** (cash/bank/UPI) · label
    size (drives the print-queue PDF) · low-stock mode · concurrency default · retire remembered
    custom part fields.
17. **Client portal** (`/p/:share_token`, public, mobile-first, Smark-branded) — read-only: phase
    timeline (current highlighted, footnote rows), progress % + on-track chip, **explicitly
    shared** updates/documents only; comment box → project feed as `change` + owner notification.
    **Never:** prices, inventory, hours, internal notes. Regenerate token = revoke.

---

## 6. The ordering pipeline (end-to-end contract)

Project → named BOM (upload/created) → reconcile (× build_qty; in-stock / to-order /
contested) → workspace (sequence, priorities, tier, ×N) → Opus plan (aliased context; **plans
only**) → worker fan-out (Sonnet per line; REST or BrowserDriver; per-site hard cap ALWAYS beats
the user knob; idempotent upserts keyed run+line+distributor) → results stream → **review
(persisted)** → add to cart → smart cart (aggregation + shortfall) → checkout per distributor
(website order number) → draft expense → receipt extraction → arrivals (partial OK) → put-away
(print rule) → `last_unit_price` + living record + inventory value. Statuses walk forward only:
`cart(open) → ordered → arrived`. Feedback at review/whole-order → suggested rules → approval →
digest v++ → next plan.

## 7. The standard search ladder (global, Settings-tunable)

1 MPN (exact → known equivalents) · 2 LCSC PN (if present → LCSC only) · 3 Value (R: value/V, tol,
W; C: value/V, dielectric) · 4 **Package — mandatory, never substitutable** · 5 Part status
(Active > NRND > EOL) · 6 Quantity (≥ multiplied need) · 7 Cost (lowest, all else equal) · + custom
rules appended via Settings. Same matcher serves BOM reconcile, bulk takeout resolution, and the
duplicate-part guard.

## 8. QR + labels (print rule is an invariant)

Two smart labels (QR + human text): **ESD-plastic label** encodes short PID (`SMK-000482`);
**Big-Box label** encodes box id → live contents. One QR per box, never per unit. **Existing part →
top-up, never reprint; new part → exactly one label.** All label creation **queues**; batch prints
one Avery-layout PDF (size from Settings) → R2. Scan resolves PID → part / box id → contents.

## 9. Movements, undo, audit

Every stock mutation writes `smark_movements` (actor, reason: pick/receive/adjust/bulk_pick/undo/
audit-tagged, bom/order links) and is undoable (`undo_of`). `total_qty` = Σ locations (kept in
sync, property-tested). Guided box audits stamp `last_counted_at`. Daily Reports is a read-only
union over movements + events + runs + orders + attendance + hours.

## 10. Phase timelines & progress (Q-07 final)

Per project: ordered phase rows — name, start/end dates, free-text duration ("9-10 days"),
tasks/notes, row kinds `phase | parallel | buffer | footnote` — modeled on Smark's real estimate
sheets. Exactly one **active** phase (owner advances). **Completion % = duration-weighted done
phases.** On-track chip = today vs active phase end date; buffer rows absorb delay before "late".
Parallel/footnote rows sit outside the math. Project done = last phase done + owner confirm
(stamps `completed_at`). Date edits bump a version label + log `change` activities. Rendered
identically in the hub and the portal.

## 11. Client portal access model

Capability token per project (`share_token`, regenerable). Public route; reads ONLY via
security-definer functions returning: project name/status, phases, progress, explicitly-shared
activities/documents. Comment endpoint rate-limited; comments land as `change` activities tagged
"from client portal" + notify owner. Sharing is opt-in per item (default OFF — nothing leaks by
accident).

## 12. AI privacy — the alias layer

Server-side map `smark_ai_aliases` (client/project/product → `CLIENT-A`, `PROJ-03`). Applied to
EVERY Claude call carrying business context (Opus plans, memory digest, receipt extraction, MPN
normalization); de-aliased on the way back. **Pass-through exceptions (search correctness):** MPN,
LCSC PN, package, distributor names — public catalog identifiers. Project descriptions/notes are
**never** sent. Leak-tested in CI (§16). Phase-4 seam: internal chat assistant over aliased data.

## 13. Data model (Supabase; canonical detail in `plan/SCHEMA.md`)

**Users/team:** `smark_app_users` (username, role, active) · `smark_attendance` (user, date,
in/out, current project) · `smark_time_entries` (manual hours: project, user, date, hours) ·
`smark_project_members`.
**Catalog/location:** `smark_parts` (+`voltage`, `last_unit_price`, `currency`, attributes jsonb,
total_qty, reorder_point, needs_review) · `smark_part_field_templates` (remembered custom fields) ·
`smark_shelves` · `smark_big_boxes` · `smark_stock_locations` (ESD plastic).
**Projects:** `smark_projects` (client, share_token, archived_at, completed_at) ·
`smark_project_phases` (§10) · `smark_project_documents` · `smark_project_activities`
(note/meeting/change/task + task fields, portal-share flag).
**BOMs:** `smark_boms` (name unique/project, build_qty, distributor_sequence, priorities,
sourcing_status, saved_run_id, created_in_app) · `smark_bom_lines` (+`extra` jsonb) ·
`smark_bom_templates` (remembered column structure).
**Ordering:** `smark_ordering_rules` (ladder; package mandatory) · `smark_distributors` (addable) ·
`smark_distributor_preferences` · `smark_order_jobs` (atomic claim) · `smark_agent_runs` (cost,
rules_doc_version) · `smark_agent_results` (streamed; `selected` persists review) ·
`smark_cart_items` (source review/auto/manual, demand jsonb, qty, price, status open/dismissed/
ordered) · `v_part_demand` (demand × build_qty over active reconciled BOMs of non-archived
projects; shortfall → auto cart line; Q-05 lifecycle) · `smark_orders` (per distributor group;
`po_number` = website order number, unique; receipt_url + receipt_extracted) · `smark_order_lines`
(project_id denorm, status ordered→arrived).
**Learning:** `smark_agent_feedback` · `smark_learned_rules` (suggested/active/retired) ·
`smark_learned_rules_doc` (versioned digest) · `smark_ai_aliases`.
**History/labels:** `smark_part_events` (append-only; + price_change old→new, location_moved,
order_id) · `smark_movements` (undo_of) · `smark_qr_labels` (+print_status queued/printed).
**Finance:** `smark_expenses` (type, amount, date, account_id, category, vendor, GST optional,
project_id = payment, is_draft, source_order_id, soft delete) · `smark_expense_accounts` ·
`v_expense_rollups`.
**Misc:** `smark_notifications` · `v_daily_activity`.
All tables: uuid PK, created_at/updated_at, created_by where mutating, **RLS per §2 matrix**.

## 14. Import & onboarding

BOMs (`TMCS_96x32_Matrix_V1.2.xlsx`, `GCU_V1.1_BOM.xlsx`) parse clean. **Stock List.xlsx** (15
messy sheets, zero location data): per-sheet column-map importer → `smark_parts` with category +
source_sheet, unmapped → attributes, dedupe by MPN/LCSC, `needs_review` flags, **value/voltage
split** (`0.1µF/50V` → `0.1µF` + `50V`), NO locations created. Then the **onboarding flow**:
needs-location queue → assign Shelf → Big Box → ESD → labels via the **batch print queue** (the
2000-part time sink — build it deliberately). Real files are parser test fixtures.

## 15. Integrations & ToS posture

Digikey (OAuth2 REST) · Mouser (key) · element14 (key, region) · LCSC + Unikey (**BrowserDriver**,
C-number strong key, human pacing) · **+ any site added via Settings** (REST-with-key or browser).
Config-encoded per-distributor budgets, min delay, daily caps, backoff on 429/403, short-TTL query
cache, **fixed small per-site concurrency cap that always overrides the user knob**. Prefer API
distributors when the part exists there. Timestamp results; treat comparisons as decision-support.

## 16. Testing & CI — the quality gate (R2-29; full plan in `plan/TESTING.md`)

**Green build = deployable; red blocks. No manual test steps.** Layers: typecheck/lint → `bun test`
units (matcher, demand math × build_qty, price stamping, undo pairing, alias passthrough) → local-
Supabase integration (**RLS matrix as executable spec**, constraints, views) → API/server actions
(real BOM fixtures) → worker suite (atomic claim, idempotency, caps, ₹ ceiling) → Playwright E2E
desktop + **360px mobile** against seeded preview (AI + distributor calls record/replay; live smoke
nightly only). **Invariant suite:** print rule, undo, forward statuses, package-mandatory,
qty-rollup property tests, order-number uniqueness, alias leak scan, suggested-never-auto-active.
Client's own example is a permanent test: 500 avail / 400 + 200 demanded → auto cart line of
exactly 100. Every R2 change maps to tests (traceability §6 of TESTING.md); every bug fix adds a
regression test.

## 17. Deployment & ops

Vercel Pro (`bun run build`) + always-on worker (Railway/Fly/Render; service role +
`WORKER_SHARED_SECRET`) + Supabase (migrations in-repo) + R2. Queue = `smark_order_jobs` poll v1.
Observability: every run logs plan, per-line results, actual ₹, which rule hit which line; AI
spend surfaces in Expenses. Backups: Supabase PITR + R2 versioning.

## 18. Non-functional requirements

Cost ceilings + dry-run estimates + caching; Opus planning-only. Idempotent everything in the
worker path. PWA offline browsing + queued scans. RLS everywhere; keys server-side; portal
capability-token only; alias layer on all business-context AI calls. 360px, 44px targets, no
h-scroll, reduced-motion. English-first, Marathi/Hindi seam.

## 19. Build order

- **Phase 0 (GATE):** spike (§0).
- **Phase 1:** auth + roles + RLS matrix · inventory core (parts incl. voltage/custom fields,
  shelves, scan, receive + duplicate guard, labels + print queue, import + onboarding, audit) ·
  dashboard · **CI gate live from day one** (§16).
- **Phase 2:** Projects hub (multi-BOM named, create-BOM + templates, build qty, documents,
  notes/tasks, phases + progress) · reconcile · cart (manual + review-less mode) + checkout per
  distributor + receipts + prices/value · bulk takeout · daily reports (attendance + manual hours)
  · expenses + accounts + charts · exports · search · notifications.
- **Phase 3:** agents (API distributors first, browser per spike) · run console · persisted
  reviews · smart shortfall automation · AI memory + alias layer · AI spend meter.
- **Phase 4:** client portal · internal chat assistant over aliased data (Q-08 v2) · WhatsApp
  notification channel (future) · client login role (future) · merge-parts tool (future).

## 20. Risks (delta from v1)

v1 risks all stand (browser automation/ToS — Phase 0 exists for this; anti-bot; price volatility;
label printing; messy import; agent cost; concurrency correctness; scanner quirks). New in v2:
1. **Demand double-ordering** — mitigated by Q-05 lifecycle + dismissal-resurrect rule + tests.
2. **Portal leakage** — opt-in sharing only, token revocation, leak tests, no prices ever.
3. **Receipt extraction accuracy** — always user-confirmed, never silent writes.
4. **Build-qty staleness** — saved runs flagged stale on ×N change, never silently wrong.
5. **Alias-layer gaps** — CI payload scans; MPN pass-through documented and bounded.

## 21. Out of scope / declined

Placing orders ON distributor sites (human buys; we track order numbers) · multi-warehouse ·
multi-tenant billing · GRN/invoice accounting beyond the expense ledger · **I-03 low-stock
auto-cart (declined)** · I-09 merge tool, WhatsApp channel, client logins (parked future).
Assumptions: single Smark tenant; owner owns all accounts (zero developer dependency); real BOMs
match observed schema; Stock List stays the messy source of truth until migrated.
