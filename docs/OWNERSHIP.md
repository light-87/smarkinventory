# OWNERSHIP.md — file-ownership map for the feature workflows

> **Rule zero:** a package touches ONLY the paths listed in its section, plus creating its own
> tests under the globs given. Anything in [§ Shared — integrator only](#shared--integrator-only)
> is off-limits to every feature package: request the change from the integrator instead (that
> includes *adding a table to `types/db.ts`* and *claiming a migration number*).
>
> Paths that don't exist yet are the **canonical locations** — create them exactly there.
> Spec truth: `FEATURES.md` (§2 roles, §5 surfaces, §19 build order) + `plan/` (SCHEMA.md is
> canonical for all SQL). Design truth: `DESIGN.md` + `tokens.json` + `variables.css` + `theme.css`
> (locked — nobody edits these).

## Conventions every package follows

- Route pages under `app/(app)/<surface>/` (authed shell group; `(app)/layout.tsx` itself is
  auth-shell's). Public routes get their own top-level segment (`app/login/`, `app/p/`).
- Feature UI in `components/<package>/…` — `components/ui/*` is the shared design system
  (integrator-gated; propose additions, don't edit in place).
- Feature logic in `lib/<package>/…`. Server Actions live next to their route or in
  `lib/<package>/actions.ts`. Route Handlers under `app/api/<package>/…`.
- Hooks in `hooks/use-<name>.ts` — named per package below.
- Tests: `tests/unit|integration|e2e/<package>-*.test.ts` / `*.spec.ts`. The pre-created
  skeleton files listed per package are **converted in place** (keep the test names).
- **DB changes:** migrations `0001`–`0005` are FROZEN. A package needing schema gets the next
  number assigned by the integrator (`0006_…` is already reserved for portal, below) and must
  update `types/db.ts` **via the integrator**.

---

## auth-shell

Login (username+password → synthetic email), session, role gating, the app shell (rail /
bottom bar / header chrome), user management (Settings → Users), PWA install prompt on login.

**Owns**
- `app/login/**` · `app/(app)/layout.tsx` (the shell) · `app/(app)/settings/users/**`
- `middleware.ts` (repo root — session refresh; wraps `lib/supabase/middleware.ts`)
- `components/shell/**` (rail, bottom bar, header frame, avatar menu; header hosts slots that
  render `components/search/` + `components/notifications/` — import only, don't own)
- `components/auth/**` · `lib/auth/session.ts` · `lib/auth/users.ts` (admin createUser flows)
- `app/api/auth/**`
- `public/manifest.json` + service-worker registration + install-prompt component
- Tests: `tests/integration/rls-matrix.test.ts` (convert the todos — this package seeds the role
  users), `tests/e2e/auth-*.spec.ts`, `tests/unit/roles.test.ts` (extend only)

**Does NOT own:** `lib/auth/roles.ts` (integrator), `lib/supabase/*` (integrator).

## inventory

Inventory table + facet sidebar (Category, Package, Voltage, Stock, Status, Dielectric,
Distributor, Project, Shelf), search-within-table, CSV/xlsx export of the filtered view.

**Owns**
- `app/(app)/inventory/**` · `components/inventory/**` · `lib/inventory/**` (facet builders,
  export) · `hooks/use-inventory-filters.ts`
- Tests: `tests/unit/inventory-*.test.ts`, `tests/e2e/inventory-*.spec.ts`

## part-detail

The part drawer (`#/part/:pid` — intercepted/parallel route), specs + last price + stock value,
locations, label preview, living record timeline with filters, contested-stock strip,
Order more / Adjust qty entry points.

**Owns**
- `app/(app)/part/**` (+ the interception segment it registers inside `app/(app)/`)
- `components/part-detail/**` · `lib/part-events/**` (timeline query/shaping, adjust action)
- Tests: `tests/unit/part-events-*.test.ts`, `tests/e2e/part-detail-*.spec.ts`

## shelves

Immersive rack view (shelf bands → big-box cards → box detail with live contents) + guided audit
(variances → `adjust` movements tagged audit, `last_counted_at`, partial/resumable).

**Owns**
- `app/(app)/shelves/**` · `components/shelves/**` · `lib/audit/**`
- Tests: `tests/unit/audit-*.test.ts`, `tests/e2e/shelves-*.spec.ts`

## scan

HID keystroke buffer + camera scan (`BarcodeDetector` → html5-qrcode fallback), part/box cards,
take-out / add with undo toasts, offline movement queue + sync.

**Owns**
- `app/(app)/scan/**` · `components/scan/**` · `lib/scan/**` (buffer, camera, offline queue,
  code→PID/box resolution) · `lib/movements/**` (movement+undo write path, shared by takeout/
  receive via import) · `hooks/use-scanner.ts`
- Service-worker offline-queue logic (coordinates with auth-shell on SW registration)
- Tests: `tests/invariants/undo-pairing.test.ts`, `tests/invariants/qty-rollup.test.ts`
  (convert), `tests/unit/scan-*.test.ts`, `tests/e2e/scan-*.spec.ts`

## receive

Three receive cards (New part + custom fields + duplicate guard, Top up, Put away arrivals by
PO), AI storage suggestion, label print queue → Avery batch PDF, onboarding queue for imported
no-location parts.

**Owns**
- `app/(app)/receive/**` · `components/receive/**` · `lib/receive/**` ·
  `lib/labels/**` (QR render, print queue, Avery PDF → R2)
- `app/api/labels/**`
- Tests: `tests/invariants/print-rule.test.ts` (convert), `tests/unit/labels-*.test.ts`,
  `tests/e2e/receive-*.spec.ts`

## import

Stock List.xlsx per-sheet column-map importer (dedupe by MPN/LCSC, value/voltage split,
`needs_review`, `source_sheet`, NO locations) + BOM xlsx parsing primitives reused by
bom-pipeline.

**Owns**
- `lib/import/**` (sheet mappers, value/voltage splitter, dedupe) · `scripts/import-stock.ts`
  (bun script) · `tests/fixtures/**` (checked-in copies/excerpts of the real xlsx files)
- Tests: `tests/unit/import-*.test.ts` (real files as fixtures per FEATURES §14)

**Does NOT own:** the onboarding UI (receive owns the queue surface).

## dashboard

Stats tiles (units, SKUs, low, out, on-order, movements today, inventory value ₹ with "N
unpriced"), recent movements, agent activity, usage by project.

**Owns**
- `app/(app)/dashboard/**` (and repointing `app/(app)/page.tsx` → dashboard redirect, in
  coordination with auth-shell) · `components/dashboard/**` · `lib/dashboard/**` (stat queries)
- Tests: `tests/unit/dashboard-*.test.ts`, `tests/e2e/dashboard-*.spec.ts`

## projects-hub

Projects list + project hub: Overview (client, derived status, phase timeline + progress % +
on-track chip, payments strip, share controls), Team & hours, Documents, Notes & tasks feed,
Archive/unarchive.

**Owns**
- `app/(app)/projects/**` EXCEPT the BOM/ordering segments owned by bom-pipeline (below)
- `components/projects/**` · `lib/projects/**` (phase math: duration-weighted completion %,
  on-track, buffer absorption; archive action; share-token regenerate; documents to R2)
- `app/api/projects/**` (documents upload)
- Tests: `tests/unit/phases-*.test.ts`, `tests/e2e/projects-*.spec.ts`

## bom-pipeline

Named BOMs per project (upload + in-app grid builder + remembered template + downloadable xlsx),
reconcile (uses `lib/matcher` + `lib/import` parsers), ordering workspace (sequence, priorities,
tiers, dry-run ₹), run console (streaming lanes), persisted review (select + re-run + Add to
cart + feedback + PDF snapshot).

**Owns**
- `app/(app)/projects/[projectId]/boms/**` · `app/(app)/projects/[projectId]/ordering/**` ·
  `app/(app)/projects/[projectId]/runs/**`
- `components/bom/**` · `components/ordering/**` · `components/run/**` · `components/review/**`
- `lib/bom/**` (create/parse/template/reconcile/build-qty staleness) · `lib/runs/**` (enqueue,
  SSE relay of `smark_agent_results`, review persistence — service-role server code)
- `app/api/runs/**` · `app/api/boms/**`
- Tests: `tests/invariants/package-mandatory.test.ts` (convert), `tests/unit/reconcile-*.test.ts`,
  `tests/e2e/bom-*.spec.ts`

**Does NOT own:** `lib/matcher/**` (integrator-shared, already built), the worker (below).

## cart-orders

Smart cart (aggregation per part, per-project demand breakdown, auto-shortfall lifecycle,
dismissal-resurrect), checkout grouped by distributor under website order numbers, draft-expense
spawn, receipt upload + Claude extraction (user-confirmed), Ordered/Arrived sections,
arrival → put-away handoff + `last_unit_price` stamping.

**Owns**
- `app/(app)/cart/**` · `components/cart/**` · `lib/orders/**` (checkout, demand recompute
  triggers, shortfall auto-lines, arrival allocation, receipt-extract server action)
- `app/api/orders/**` · `app/api/receipts/**`
- Tests: `tests/invariants/forward-statuses.test.ts`, `tests/invariants/po-unique.test.ts`,
  `tests/invariants/shortfall-500-400-200.test.ts` (convert all three),
  `tests/unit/cart-*.test.ts`, `tests/e2e/cart-*.spec.ts`

## takeout

Bulk takeout: upload / paste / pick a project BOM, lines→locations resolve (via `lib/matcher`),
build-qty ×N banner, check-off walk, finish → `bulk_pick` movements (via `lib/movements`),
"To order →" for misses.

**Owns**
- `app/(app)/bulk-takeout/**` · `components/takeout/**` · `lib/takeout/**`
- Tests: `tests/unit/takeout-*.test.ts`, `tests/e2e/takeout-*.spec.ts`

## daily-reports

Attendance (self clock-in/out + working-on selector), manual hours (clock-out prompt; owner
corrections), per-day/per-person digest over `v_daily_activity`, expenses section
(owner/accountant), day/range export.

**Owns**
- `app/(app)/daily/**` · `components/daily/**` · `lib/daily/**` (attendance + time-entry
  actions, digest queries, export)
- Tests: `tests/unit/daily-*.test.ts`, `tests/e2e/daily-*.spec.ts` (incl. employee-sees-self)

## expenses

Entries (type, amount, date, account, category, vendor, GST, project=payment, attachment),
PO-spawned draft confirmation, soft delete, charts (rollups, category donut, by-account,
top-project, YoY, AI spend meter), expense accounts Settings card, export.

**Owns**
- `app/(app)/expenses/**` · `app/(app)/settings/expense-accounts/**` ·
  `components/expenses/**` · `lib/expenses/**`
- Tests: `tests/unit/expenses-*.test.ts`, `tests/e2e/expenses-*.spec.ts` (incl. employee-hidden)

## search-notifications

Global header search/scan field (scan-code resolve first, Ctrl-K palette over
parts/projects/BOMs/PO numbers) + notifications (fan-out writes on system events, bell badge,
mark-read, deep links).

**Owns**
- `components/search/**` · `components/notifications/**` · `lib/search/**` ·
  `lib/notifications/**` (fan-out helpers other packages import — e.g. cart-orders calls
  `notifyArrival()`) · `app/api/notifications/**` · `hooks/use-notifications.ts`
- Tests: `tests/unit/search-*.test.ts`, `tests/e2e/notifications-*.spec.ts`

**Seam:** auth-shell's header renders these components; the slot contract is agreed with the
integrator, neither package edits the other's files.

## portal

Public client portal `/p/:share_token`: phases + progress + on-track, explicitly-shared
activities/documents only, rate-limited comment box → `change` activity + owner notification.

**Owns**
- `app/p/**` · `components/portal/**` · `lib/portal/**`
- `supabase/migrations/0006_portal_fns.sql` — **reserved**: the SECURITY DEFINER read/comment
  functions (token → phases/shared items; comment insert). Portal reads ONLY through these.
- Tests: the portal block of `tests/integration/rls-matrix.test.ts` (coordinate with
  auth-shell), `tests/e2e/portal-*.spec.ts`, leak-scan test per FEATURES §16

## worker

The always-on Browser-Worker (Railway/Fly/Render): claims `smark_order_jobs`
(`FOR UPDATE SKIP LOCKED`), Sonnet item agents, REST clients (Digikey/Mouser/element14),
swappable `BrowserDriver` (computeruse | playwright | browserbase), per-site caps, ₹ ceilings,
idempotent result upserts. Phase-0 spike lives here first (`docs/spike-browser-worker.md`).

**Owns**
- `worker/**` (standalone package at repo root — own `package.json`, run with Bun)
- `types/worker.ts` (job/result wire contracts — the ONE types file a feature package owns)
- `docs/spike-browser-worker.md`
- Tests: `worker/tests/**` (atomic claim, idempotency, caps, cost ceiling — run in worker CI job)

**Does NOT own:** `smark_agent_*` table shapes (`types/db.ts`, integrator).

## ai-memory

AI Memory screen (suggested → approve/reject → versioned digest, retire, run-log rule hits) +
the shared AI plumbing: Claude client, alias layer (pseudonymize/de-alias every business-context
call), rules-digest builder, MPN normalization + receipt-extraction prompt helpers.

**Owns**
- `app/(app)/ai-memory/**` · `components/ai-memory/**`
- `lib/ai/**` (claude client, alias service — server-only, reads `smark_ai_aliases` via service
  role; digest builder; extraction helpers used by cart-orders + bom-pipeline via import)
- `app/api/ai/**`
- Tests: `tests/invariants/alias-leak.test.ts`,
  `tests/invariants/suggested-rules-never-auto-active.test.ts` (convert both),
  `tests/unit/alias-*.test.ts`

---

## Shared — integrator only

Feature packages may READ these everywhere but never edit them. Changes go through the
integrator (one PR-equivalent per change, so parallel packages never collide):

| Path | Why it's locked |
|---|---|
| `app/layout.tsx` · `app/globals.css` | Root shell + global CSS — one owner or fonts/tokens fork |
| `types/db.ts` | The single DB contract; must stay 1:1 with migrations (SQL wins) |
| `lib/auth/roles.ts` | The §2 role matrix as code; RLS's twin |
| `lib/nav.ts` **(canonical nav config — integrator creates with auth-shell's first PR)** | Rail/bottom-bar/More-sheet truth; every package registers its surface here via the integrator |
| `lib/supabase/**` (client, server, middleware, env) | Client factories + trust boundaries |
| `lib/matcher/**` · `lib/cn.ts` · `lib/format.ts` · `lib/theme.ts` | Shared logic several packages depend on |
| `components/ui/**` | Locked design system (DESIGN.md); additions reviewed by integrator |
| `supabase/config.toml` · `supabase/migrations/0001–0005` · `supabase/seed.sql` | Applied baseline — append-only via assigned numbers (0006 = portal) |
| `package.json` · `bun.lock` · `bunfig.toml` · `tsconfig.json` · `next.config.ts` · `postcss.config.mjs` · `eslint.config.mjs` · `playwright.config.ts` | Toolchain — dependency adds via integrator (Bun only) |
| `.github/workflows/ci.yml` | The quality gate (§16) |
| `tests/helpers/**` · `tests/integration/db-schema.test.ts` · `tests/integration/harness.test.ts` · `tests/unit/design-tokens.test.ts` · `tests/unit/smoke.test.ts` | Harness + schema-truth suites |
| `.env.local.example` | Env-var registry — new keys announced through the integrator |
| `DESIGN.md` · `tokens.json` · `variables.css` · `theme.css` · `FEATURES.md` · `plan/**` · `docs/DEV.md` · this file | Spec + design + runbook truth |

**Cross-package imports allowed** (read-only dependencies, no edits): `lib/movements` (scan) ←
takeout/receive · `lib/labels` (receive) ← shelves/part-detail · `lib/import` (import) ←
bom-pipeline · `lib/matcher` (shared) ← bom-pipeline/takeout/receive · `lib/notifications`
(search-notifications) ← cart-orders/projects-hub/ai-memory/portal · `lib/ai` (ai-memory) ←
cart-orders/bom-pipeline/receive · `lib/scan` (scan: resolve/classify + CameraScanner component) ←
auth-shell-header/receive/search-notifications · `lib/search` (search-notifications: partHref/boxHref)
← auth-shell-header · `components/projects/confirm-dialog` (projects-hub) ← bom-pipeline (delete-BOM
confirm). If you need a function that doesn't exist in a dependency,
ask that package's owner (via the orchestrator), don't add it yourself.
