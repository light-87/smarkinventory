export const meta = {
  name: 'wf1-phase1-features',
  description: 'SmarkStock WF-1: Phase-1 features — 8 parallel packages (sonnet), opus review/fix/verify',
  phases: [
    { title: 'Build', detail: '8 feature packages in parallel (sonnet)', model: 'sonnet' },
    { title: 'Review', detail: '3 adversarial lenses over the whole increment (opus)', model: 'opus' },
    { title: 'Fix', detail: 'apply confirmed findings (sonnet)', model: 'sonnet' },
    { title: 'Verify', detail: 'tsc, tests, build, db reset, e2e smoke (opus)', model: 'opus' },
  ],
}

const ROOT = 'C:/Users/vaibh/Desktop/Learning Projects/smark_inventory'

const COMMON = `
CONTEXT — read before writing code:
- ${ROOT}/FEATURES.md — build spec v2. §2 role matrix, §5 surfaces (find YOUR surface), §7-§10 domain rules.
- ${ROOT}/plan/tab-<yours>.md — the DETAILED spec for your surface (named in your mission).
- ${ROOT}/docs/OWNERSHIP.md — file ownership map. You may ONLY create/edit files in YOUR section. Shared files (app/layout.tsx, types/db.ts, lib/auth/roles.ts, nav config) are OFF LIMITS — if you need a change there, note it in your report for the integrator.
- Foundation you MUST reuse (do not reinvent): types/db.ts (zod+types), lib/supabase/* (clients), lib/auth/roles.ts (canSee/canWrite), lib/matcher (THE matcher), lib/storage (StoragePort — use it for any file), lib/format.ts (₹, en-IN), components/ui/* (base kit), lib/theme.ts.
- Design: match SmarkStock-prototype/SmarkStock.dc.html visuals — dark #121212, cards #141414 radius 16, orange #f57d05 pills, JetBrains Mono for codes/qty. Mobile-first: works at 360px, 44px targets, no h-scroll.
HARD RULES: Bun only. TS strict — bunx tsc --noEmit must stay clean for your files. Server data via supabase server client + RLS (never service key in app routes). Every stock mutation writes smark_movements and supports undo (undo_of). No secrets. No git commits. Deps are pre-installed (xlsx, html5-qrcode, qrcode, pdf-lib) — do NOT run bun add; if you truly need another dep, note it in your report instead.
Local supabase is running (bunx supabase start already done); .env.local points at it.
RETURN: terse report — files created, decisions, notes-for-integrator, blockers.`

const FINDINGS = {
  type: 'object', additionalProperties: false,
  properties: { findings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    file: { type: 'string' }, issue: { type: 'string' }, severity: { enum: ['critical','major','minor'] }, fix_hint: { type: 'string' } },
    required: ['file','issue','severity','fix_hint'] } } },
  required: ['findings'],
}
const VERIFY = {
  type: 'object', additionalProperties: false,
  properties: {
    typecheck: { enum: ['pass','fail'] }, unit_tests: { enum: ['pass','fail'] }, next_build: { enum: ['pass','fail'] },
    db_reset: { enum: ['pass','fail','skipped'] }, e2e_smoke: { enum: ['pass','fail','skipped'] },
    failures: { type: 'array', items: { type: 'string' } } },
  required: ['typecheck','unit_tests','next_build','db_reset','e2e_smoke','failures'],
}

phase('Build')
const PKGS = [
  { key: 'auth-shell', prompt: `${COMMON}
SURFACE: Login + app shell. Spec: plan/tab-login-shell.md.
BUILD: (1) /login — username+password (maps username→{username}@smark.internal for supabase auth), dark branded card, error shake, PWA install prompt placeholder. (2) Authed layout app/(app)/layout.tsx: desktop rail (Overview: Dashboard/Inventory/Shelves · Operate: Scan/Bulk takeout/Receive · Projects: Projects/Cart · Team: Daily Reports/Expenses(owner+accountant) · footer: AI Memory/Settings) with active states per prototype; mobile bottom bar Dashboard·Inventory·Scan·Projects·More (More = bottom sheet listing role-visible rest). (3) Header: title, search/scan field (Enter → if code matches PID/box pattern route to part/box, else no-op stub for WF-2 search), notifications bell SHELL (unread count query, dropdown list, mark read), avatar menu (name+role chip, Settings link, Logout). (4) Route guard middleware (unauthed→/login) + role-gating nav via lib/auth/roles. (5) Placeholder pages (EmptyState) for every route another package doesn't own so nav never 404s: /projects /cart /daily /expenses /memory /settings.
YOU OWN the shared shell per OWNERSHIP.md — you are the ONE package allowed to touch app/(app)/layout.tsx + nav config.` },
  { key: 'inventory-partdetail', prompt: `${COMMON}
SURFACE: Inventory list + part-detail drawer. Specs: plan/tab-inventory.md + plan/tab-part-detail.md.
BUILD: /inventory — facet sidebar (Category, Package, Voltage, Stock in/low/out, Status, Dielectric-from-attributes, Shelf) with live counts + clear-all + chips; search (PID/MPN/value/mfr/LCSC); table per prototype columns (+V, optional Price col hidden on mobile) with qty pills + stock tick colors; Export CSV of filtered view (server route, hand-rolled CSV). Drawer at /inventory?pid= or /part/[pid] — specs grid (+Last price, Stock value), locations table, ESD label preview (real QR via qrcode lib, PID-encoded, human text per §8), living-record timeline (event icons, price_change old→new rendering, PO chip, filters by type/project), Adjust qty action (dialog → movement w/ undo toast), Print label → enqueue (print_status=queued) toast, Order more → /cart stub link.
Stock state rule: qty=0 out, ≤reorder_point low (shared util in your files).` },
  { key: 'shelves-audit', prompt: `${COMMON}
SURFACE: Shelves rack browser + box audit. Spec: plan/tab-shelves.md (audit spec in §5).
BUILD: /shelves — rack bands per shelf (header tile+name+box count, thick plank border), horizontal big-box cards (code, name, category chip, first-5 part chips w/ low dots, +N more, orange low dot) per prototype; box detail view — breadcrumb, left card (box QR real-encoded, label text, Print Big-Box label → queue), Live contents table (rows → part drawer link). AUDIT: "Count / audit" launches guided flow — walk contents, confirm/type qty per ESD; variances create adjust movements tagged reason='audit' (undoable), stamp last_counted_at; partial audit resumable (persist progress in table or localStorage — your call, note it); "last audited {date}" in box header.` },
  { key: 'scan-movements', prompt: `${COMMON}
SURFACE: Scan + take-out/add. Spec: plan/tab-scan.md.
BUILD: /scan — scanner zone: code input (autofocus, Enter resolves; HID = debounce burst ending Enter into one scan) + camera scan via BarcodeDetector w/ html5-qrcode fallback (behind a "Camera" toggle, permission-safe); resolve PID→part card, box→box card, else toast. Part card: PID/MPN/value/loc/qty, stepper, Take out (orange) / Add — writes movement, updates location qty + part total_qty, Undo toast (writes undo_of movement reversing). Box card: contents preview, Count/audit → link to shelves audit, Receive into this box → /receive?box= link. OFFLINE: if navigator.offLine or supabase call fails w/ network error, queue movement in localStorage + banner "N queued — will sync"; sync on reconnect (simple, tested).
Movement + undo logic = a lib in YOUR files (lib/movements/) exposed for receive/takeout packages to reuse — keep it pure + unit-tested (rollup sync total_qty).` },
  { key: 'receive-labels', prompt: `${COMMON}
SURFACE: Receive + label print queue + onboarding queue. Spec: plan/tab-receive.md.
BUILD: /receive — three flat action cards (R2-23): (1) NEW PART form: category chips, Value*, Voltage, Package*, Qty*, MPN/Mfr optional, "+ add custom field" (creates smark_part_field_templates row; remembered fields auto-render on future forms; values→attributes jsonb), AI-suggested storage = category+package match over big boxes (pure fn, no AI call yet), DUPLICATE GUARD via lib/matcher on save (warning card "Looks like SMK-000101 — Top up instead?" one-tap switch / Create anyway sets needs_review), save → part+location+label queued. (2) TOP UP EXISTING: scan/type PID → part card → add qty (movement reason=receive, history event, NO label). (3) PUT AWAY ARRIVALS: reads smark_order_lines line_status=arrived — WF-2 fills data; build the UI + empty state now. PLUS: Print queue strip — count of print_status=queued labels → "Print sheet" server route renders ALL queued onto one Avery L7651 (38×21mm, 5×13 grid) PDF via pdf-lib + qrcode (QR = PID/box-id only, human text lines), stores via StoragePort, returns download URL, marks printed. PLUS: onboarding queue section — parts where needs_review or no location: assign Shelf→Box→ESD inline + queue label.` },
  { key: 'import-seed', prompt: `${COMMON}
SURFACE: Data import + canonical seed. Spec: FEATURES.md §14, plan/SCHEMA.md.
BUILD (lib + scripts + tests, minimal UI): (1) lib/import/stocklist.ts — parse ${ROOT}/Stock List.xlsx (15 messy sheets: per-sheet column maps, in-cell subheadings like "A) FUSE", side-by-side tables, merged headers) → part rows {category, value, voltage (SPLIT combined "0.1µF/50V"), package, mpn, lcsc_pn, mfr, qty?, attributes{}} with source_sheet + needs_review flags; dedupe by MPN/LCSC. COPY the xlsx into tests/fixtures/ first; write bun tests asserting real counts + spot-checked rows + split correctness. (2) lib/import/bom.ts — parse TMCS_96x32_Matrix_V1.2.xlsx + GCU_V1.1_BOM.xlsx (clean schema: # Reference Qty Value Footprint DNP Description MPN Manufacturer PartLink LCSC) → bom_lines; fixtures + tests (TMCS: expect ~122 lines, mix of full-MPN/LCSC-only/value-only). (3) scripts/import-stocklist.ts — bun script: parse → upsert smark_parts via supabase (service key from env — script-only, documented). (4) Extend supabase/seed.sql (or a seed script) with the CANONICAL demo dataset ported from SmarkStock-prototype mock (shelves A-D, 9 boxes, ~15 hand-picked parts incl. SMK-000101 family with locations/history/prices, 4 shelves) so E2E + dev have stable data. (5) /settings/import placeholder page w/ run instructions (real UI later).` },
  { key: 'dashboard', prompt: `${COMMON}
SURFACE: Dashboard. Spec: plan/tab-dashboard.md.
BUILD: /dashboard — 7 stat cards (units, SKUs, low, out, on-order [order_lines ordered count — 0 until WF-2], movements today, Inventory value ₹ = Σ total_qty×last_unit_price w/ "N unpriced" sublabel); Recent movements feed (time, PID link, ±delta chip, reason, box chip; "today's report →" linking /daily); Agent activity card (empty-state placeholder "no runs yet" — WF-3 wires it); Usage by project bars (distinct parts per project from part projects/events — placeholder-tolerant). All real queries via server components against local supabase; responsive per prototype.` },
  { key: 'invariants-e2e', prompt: `${COMMON}
SURFACE: Test hardening for Phase-1. Spec: plan/TESTING.md §3 flows 1-2, §5 invariants.
BUILD (tests only, you own tests/**): implement (un-todo) the invariant specs that are now implementable against lib/movements + matcher + schema: undo pairing (movement+undo_of nets zero), qty rollup property (random op sequence → total_qty == Σ locations, run against local supabase), print rule (top-up creates NO qr_labels row; new part exactly one — DB-level test), package-mandatory (matcher never returns package mismatch), stock-state boundaries. E2E (Playwright): flow-1 auth+roles (login owner sees full rail; wrong password error) and flow-2 inventory loop (seeded part visible, filter by category, open drawer, adjust qty +5 → movement appears, undo restores) + 360px viewport variant. Use seeded data (import-seed package provides it — coordinate via seed.sql; if seed missing, write your own minimal test seed in tests/fixtures/seed-test.sql and note it). Keep supabase-dependent tests skippable via env flag SKIP_DB_TESTS for CI resilience.` },
]

const built = await parallel(PKGS.map(p => () =>
  agent(p.prompt, { label: p.key, phase: 'Build', model: 'sonnet' })))
log(`Build done: ${built.filter(Boolean).length}/8 packages`)

phase('Review')
const LENSES = [
  ['fidelity', `PLAN-FIDELITY lens: diff the built Phase-1 surfaces against plan/tab-{login-shell,inventory,part-detail,shelves,scan,receive,dashboard}.md + FEATURES.md §5.1-7. Hunt: missing required behaviours (undo everywhere? dup-guard one-tap switch? voltage facet? print queue marks printed? audit stamps last_counted_at? More sheet role-filtered?), role matrix violations in UI gating, invariant breaches (§ CROSS-FEATURE A3).`],
  ['correctness', `CORRECTNESS lens: real defects only. Run bunx tsc --noEmit, bun test, bun run build for evidence; read the diffs for: supabase client misuse (server vs browser), movement math bugs (rollup drift, double-undo), race conditions in qty updates, broken imports/routes, localStorage offline queue data loss, CSV/PDF generation errors, unhandled nulls with noUncheckedIndexedAccess.`],
  ['ui-consistency', `UI/UX lens: compare rendered structure against SmarkStock-prototype/SmarkStock.dc.html (read its template): spacing/radius/color drift, missing mobile bottom bar behaviours, touch targets <44px, tables without overflow containers (h-scroll leaks), missing empty/loading/error states, toasts without Undo where stock mutates, JetBrains Mono missing on codes/qty.`],
]
const reviews = await parallel(LENSES.map(([k, p]) => () =>
  agent(`${COMMON}\nROLE: Adversarial reviewer — TRY TO REFUTE that this increment is done/correct. ${p}\nReport ONLY verified findings (file+evidence).`,
    { label: `review:${k}`, phase: 'Review', schema: FINDINGS, model: 'opus' })))
const allFindings = reviews.filter(Boolean).flatMap(r => r.findings)
log(`Review: ${allFindings.length} findings`)

let verdict = null
let round = 0
let toFix = allFindings
while (round < 3) {
  round++
  if (toFix.length > 0) {
    phase('Fix')
    await agent(`${COMMON}
MISSION: Fix these verified findings (root causes). Re-run bunx tsc --noEmit + bun test until clean. Do not expand scope.
FINDINGS:
${toFix.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}: ${f.issue} — ${f.fix_hint}`).join('\n')}`,
      { label: `fix:r${round}`, phase: 'Fix', model: 'sonnet' })
  }
  phase('Verify')
  verdict = await agent(`${COMMON}
MISSION: Verification only — run and report, fix nothing: (1) bunx tsc --noEmit (2) bun test (3) bun run build (4) bunx supabase db reset (5) bunx playwright test — run it bare: the two projects are desktop-1280 + mobile-360 (there is NO 'chromium' project); e2e global-setup auto-seeds the dev users after the reset (install browsers if needed via bunx playwright install chromium; mark e2e skipped only if browsers can't install). Exact failure messages.`,
    { label: `verify:r${round}`, phase: 'Verify', schema: VERIFY, model: 'opus' })
  const green = verdict && verdict.typecheck === 'pass' && verdict.unit_tests === 'pass' && verdict.next_build === 'pass'
    && (verdict.db_reset !== 'fail') && (verdict.e2e_smoke !== 'fail')
  if (green) { log(`Verify r${round}: GREEN`); break }
  log(`Verify r${round}: RED (${verdict ? verdict.failures.length : '?'})`)
  toFix = (verdict ? verdict.failures : []).map(f => ({ file: '(verify)', issue: f, severity: 'critical', fix_hint: 'make it pass' }))
}

return {
  packages_done: built.filter(Boolean).length,
  reports: built.filter(Boolean).map(b => String(b).slice(0, 300)),
  findings: allFindings.length,
  final_verify: verdict,
}