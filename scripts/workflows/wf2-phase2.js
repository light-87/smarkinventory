export const meta = {
  name: 'wf2-phase2-features',
  description: 'SmarkStock WF-2: Phase-2 — 8 parallel packages (sonnet), opus integrate/review, sonnet fix, opus verify',
  phases: [
    { title: 'Build', detail: '8 feature packages in parallel (sonnet)', model: 'sonnet' },
    { title: 'Integrate', detail: 'header seams, shared-file requests, consolidation (opus)', model: 'opus' },
    { title: 'Review', detail: '3 adversarial lenses over the increment (opus)', model: 'opus' },
    { title: 'Fix', detail: 'apply confirmed findings (sonnet)', model: 'sonnet' },
    { title: 'Verify', detail: 'tsc, tests, build, db reset, e2e (opus)', model: 'opus' },
  ],
}

const ROOT = 'C:/Users/vaibh/Desktop/Learning Projects/smark_inventory'

const COMMON = `
CONTEXT — read before writing code:
- ${ROOT}/FEATURES.md — build spec v2. §2 role matrix (note: accountant = read-only everywhere EXCEPT Expenses where accountant READS+WRITES; employee NEVER sees Expenses/AI-memory/Settings), §5 surfaces (find YOURS), §6 ordering contract, §9 movements/undo, §10 phase math, §11 portal access model.
- ${ROOT}/plan/tab-<yours>.md — the DETAILED spec for your surface (named in your mission). plan/SCHEMA.md = canonical SQL truth.
- ${ROOT}/docs/OWNERSHIP.md — file ownership. You may ONLY create/edit files in YOUR section. Shared files (app/layout.tsx, types/db.ts, lib/auth/roles.ts, lib/nav.ts, components/ui/*, components/shell/*, migrations 0001-0005, seed.sql, package.json) are OFF LIMITS — if you need a change there, put it in your report under notes-for-integrator.
- Phase-1 is BUILT and GREEN: auth+shell (login owner/employee/accountant — passwords in scripts/seed-dev-users.ts), inventory+part drawer, shelves+audit, scan, receive+labels, dashboard, import+canonical seed. A PLACEHOLDER page may exist at your route from WF-1 (EmptyState) — replace it, the route is yours.
- Foundation you MUST reuse (do not reinvent): types/db.ts (zod+types, TABLES map), lib/supabase/* (server/browser clients), lib/auth/roles.ts (canSee/canWrite), lib/matcher (THE matching ladder — reconcile/dup-guard/takeout all use it), lib/movements (movement+undo write path from WF-1 scan package — EVERY stock mutation goes through it), lib/import (xlsx BOM parsers), lib/storage (StoragePort — ALL file uploads go through it, never supabase storage), lib/labels (print queue), lib/format.ts (₹, en-IN dates), components/ui/* (base kit), lib/theme.ts.
- ALL Phase-2 tables already EXIST in migrations 0001–0005 (projects, phases, activities, documents, members, boms, bom_lines, bom_templates, cart_items, orders, order_lines, expenses, expense_accounts, attendance, time_entries, notifications, v_part_demand, v_daily_activity, v_expense_rollups…). Do NOT write migrations — the ONE exception is the portal package which owns the reserved supabase/migrations/0006_portal_fns.sql. Any other SQL need → notes-for-integrator.
- Design: match SmarkStock-prototype/SmarkStock.dc.html — dark #121212, cards #141414 radius 16, SMARK orange #f57d05 pills, JetBrains Mono for codes/qty/₹. Mobile-first: 360px works, 44px targets, no h-scroll (tables scroll inside their own overflow container).
HARD RULES: Bun only. TS strict — bunx tsc --noEmit must stay clean for your files. Server data via the supabase SERVER client + RLS (never the service key inside app routes; service key ONLY in scripts/tests). Every stock mutation writes smark_movements via lib/movements and is undoable. Statuses only walk FORWARD (cart open→ordered→arrived). No secrets. No git commits. Deps pre-installed (xlsx, html5-qrcode, qrcode, pdf-lib, recharts) — do NOT run bun add; extra dep needs → notes-for-integrator.
NOTIFICATIONS SEAM: if your surface must EMIT a notification (expense draft created, arrival, task assigned, portal comment), insert the row into smark_notifications directly from your own server code with a "// TODO(integrator): swap to lib/notifications fanout" comment — the search-notifications package builds the shared helper in parallel and the integrator consolidates after.
E2E: local supabase is running; bunx playwright test re-seeds dev users automatically (tests/e2e/global-setup.ts) and db reset applies the canonical demo seed (shelves A-D, SMK-000101 family). Copy the guard + login-helper pattern from tests/e2e/dashboard-smoke.spec.ts (process.versions.bun guard, loginAsOwner, 25s first-nav timeout).
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
  { key: 'projects-hub', prompt: `${COMMON}
SURFACE: Projects list + project hub. Spec: plan/tab-orders-projects.md (R2-03/04/06/14/15/16/30/32) + FEATURES §5.8 + §10 (phase math).
BUILD: (1) /projects — new-project card (name required, client optional), project cards (name · client · derived status pill draft/sourcing/sourced · BOM count · created), archived filter toggle. (2) Project hub tabs: OVERVIEW — client, derived status, PHASE TIMELINE editor per R2-30 (rows: name, start/end dates, free-text duration, tasks/notes; row kinds phase|parallel|buffer|footnote; add/remove/reorder; exactly ONE active phase, owner advances; date edits bump version label + log a 'change' activity), progress % = duration-weighted done phases (parallel/footnote rows OUTSIDE the math; pure fn in lib/projects/phase-math.ts, unit-tested), on-track chip (today vs active phase end; buffer rows absorb delay), payments strip (income smark_expenses rows with this project_id — visible to owner+accountant ONLY), share-link controls (copy /p/{share_token}, REGENERATE = revoke, owner-only). (3) TEAM & HOURS — owner assigns/removes members (smark_project_members), hours table per member from smark_time_entries (week/total, expandable dated entries). (4) DOCUMENTS — upload via StoragePort with REQUIRED display name → smark_project_documents; list name·type·size·by/at·download·delete (owner or uploader). (5) NOTES & TASKS — feed of Note/Meeting/Change/Task entries (title/body/author/ts); tasks get assignee+due+done toggle, open-task badges on header + project card; owner+employee write; append-only with 15-min author edit window; per-entry "share to portal" toggle (default OFF). (6) ARCHIVE (owner-only) — warning dialog spelling out consequences (releases cart demand, freezes activity, hides from pickers, portal stops resolving) → sets archived_at; unarchive reverses; archived projects excluded from all pickers.
BOM tab = a link into the bom-pipeline package's segment (app/(app)/projects/[projectId]/boms) — do NOT build BOM UI yourself.
Tests: tests/unit/phases-*.test.ts (weighted %, buffer absorption, parallel exclusion, single-active), tests/e2e/projects-*.spec.ts (create project, add phases, advance, archive warning).` },
  { key: 'bom-pipeline', prompt: `${COMMON}
SURFACE: Named BOMs per project + reconcile. Spec: plan/tab-orders-projects.md §2+R2-19 + FEATURES §5.8 BOMs bullet. SCOPE NOTE: ordering workspace / agent run / review console are WF-3 — build ONLY upload/create/reconcile/build-qty now; leave "Set up ordering →" as a disabled button labeled "AI sourcing — coming with the agent layer".
BUILD under app/(app)/projects/[projectId]/boms/**: (1) BOM list per project — each row: user-given NAME (unique per project, enforce + friendly error), line count, in-stock/to-order split, build_qty ×N badge, sourcing status chip, uploaded date/by. (2) UPLOAD BOM — name required + file; parse via lib/import/bom.ts; template download (xlsx: standard columns + any remembered custom columns from smark_bom_templates). (3) CREATE BOM in-app (R2-19) — spreadsheet-like grid editor starting from standard columns (# Reference Qty Value Footprint DNP Description MPN Manufacturer PartLink LCSC PN Priority/Notes), required-field validation (Reference/Qty/Value), "+ Add field" custom column (name + text/number type); ON SAVE store the column structure as the company template row (smark_bom_templates) so the next Create-BOM AND the downloadable template both reflect it; custom values ride in smark_bom_lines.extra jsonb. (4) RECONCILE — per BOM: run lib/matcher ladder (MPN → LCSC PN → value+package+voltage fuzzy) over lines vs smark_parts; need = line qty × build_qty; lines table with status tag (In stock · Shelf B · Box B-12 / orange To order / CONTESTED chip "shortfall in cart ×100" when v_part_demand shows cross-project demand > stock); stat trio (lines / in stock / to order); build_qty editor (×N banner; changing it re-reconciles need and marks any saved_run_id stale — set the flag, UI for it is WF-3).
Tests: tests/invariants/package-mandatory.test.ts stays green; tests/unit/reconcile-*.test.ts (×N math, unique-name, template memory), tests/e2e/bom-*.spec.ts (upload TMCS fixture → reconcile shows split).` },
  { key: 'cart-orders', prompt: `${COMMON}
SURFACE: Smart cart + checkout + orders. Spec: plan/tab-on-order.md (R2-09/10/12, Q-05 + Q-06 FINAL) + FEATURES §5.12.
BUILD: /cart — (A) CART: lines aggregated PER PART across projects (one line, demand breakdown chips "TMCS Mainboard 400 · GCU rev B 200"), available-in-stock, editable qty-to-order (prefill = shortfall or review qty), chosen distributor (changeable select over smark_distributors), editable unit price ₹, source chip review/auto/manual, remove/dismiss. Manual add: search any part → add qty. (B) SHORTFALL (Q-05 lifecycle — get this EXACT): v_part_demand aggregates line qty × build_qty over reconciled BOMs of ACTIVE (non-archived) projects; when combined demand > total_qty → ensure ONE auto cart line for exactly the shortfall (client's canonical case: 500 avail, A needs 400 + B needs 200 → auto line of 100); recompute on reconcile/movement/archive/build_qty change (server action recompute + on-load refresh is acceptable v1 — note your trigger choice); DISMISSED auto lines resurrect ONLY if shortfall grows beyond the dismissed qty. (C) CHECKOUT (Q-06): select lines → groups BY DISTRIBUTOR (LCSC: 12 lines · Digikey: 3) → per group the user pastes the distributor WEBSITE ORDER NUMBER (required, unique — this IS po_number) → confirm creates ONE smark_orders row + order_lines (project_id denormalized) + flips cart lines to ordered; a group without an order number STAYS in cart. Placing an order ALSO auto-creates a DRAFT smark_expenses row (is_draft, total, vendor=distributor, source_order_id, project links) + smark_notifications row for the owner ("// TODO(integrator): lib/notifications"). (D) ORDERED section grouped by PO (header: number/date/by/total ₹/receipt chip; lines with project·BOM chips; Mark arrived per line — PARTIAL ok, forward-only) + receipt upload per order → StoragePort → receipt_url (AI extraction = WF-3; leave "Extract prices" disabled with tooltip). (E) ARRIVED section → hand-off link to /receive put-away; arrival stamps the part's last_unit_price from the order line + writes a price_change part_event (old→new) when it differs.
Tests: CONVERT tests/invariants/forward-statuses.test.ts, tests/invariants/po-unique.test.ts, tests/invariants/shortfall-500-400-200.test.ts (the client's permanent example — exact numbers); tests/unit/cart-*.test.ts (aggregation, resurrect rule), tests/e2e/cart-*.spec.ts.` },
  { key: 'takeout', prompt: `${COMMON}
SURFACE: Bulk takeout. Spec: plan/tab-bulk-pick.md (R2-26/27 + R2-03 ripple) + FEATURES §5.6.
BUILD: /bulk-takeout — empty state: upload/paste zone + "Pick a project BOM" (project → named BOM picker over smark_boms of non-archived projects). Loaded: ×N builds banner (prefill = BOM build_qty, adjustable BEFORE starting; ad-hoc uploads get optional ×N input), progress bar checked/total, lines table: checkbox (in-stock only) · Reference · PICK QTY (line qty × N) · Value · location chip (Shelf B · Box B-12) via lib/matcher resolution, orange "To order →" chip for misses (deep-link /cart with a manual-add hint). Check-off walk (checked rows fade). FINISH: one confirm → a bulk_pick movement PER checked line via lib/movements (bom_id linked → project attribution), qty decrements + rollup, success toast; movements individually undoable after finish (surface via part drawer — just ensure undo_of works through lib/movements).
Tests: tests/unit/takeout-*.test.ts (×N pick math, resolution), tests/e2e/takeout-*.spec.ts (pick BOM → banner ×N → finish → movement logged).` },
  { key: 'daily-reports', prompt: `${COMMON}
SURFACE: Daily Reports. Spec: plan/tab-daily-reports.md (R2-07, Q-03/Q-01 closed) + FEATURES §5.13.
BUILD: /daily — day header (date picker default today, prev/next, person filter: owner=all, employee=SELF ONLY enforced in query, accountant=read all). Section 1 ATTENDANCE & WORK: my row = Clock in/Clock out taps + "working on" project selector (my assignments) → smark_attendance; MANUAL HOURS: day-end entry per project (pick project + hours + note → smark_time_entries source=manual), PROMPTED at clock-out if nothing logged; owner can add/correct anyone's; team table (owner/accountant): person · present chip · in/out · logged hours · projects. Section 2 MOVEMENTS TODAY: feed grouped by person ("took 145 × SMK-000101 · Box B-12 · bulk pick · TMCS Mainboard") from v_daily_activity/smark_movements + totals strip (out/in/adjustments). Section 3 ORDERING ACTIVITY: BOM uploads, cart adds, orders placed (PO), arrivals — from v_daily_activity. Section 4 EXPENSES TODAY (owner + accountant ONLY, employees never see the section): today's smark_expenses entries. EXPORT (R2-33): day or range → CSV/xlsx (movements + attendance + hours; + expenses for owner/accountant) via xlsx lib, download.
Tests: tests/unit/daily-*.test.ts (visibility filter, export shaping), tests/e2e/daily-*.spec.ts (clock in/out; employee sees self only — login as employee dev user).` },
  { key: 'expenses', prompt: `${COMMON}
SURFACE: Expenses + charts. Spec: plan/tab-expenses.md (R2-20/21/15/33/37) + FEATURES §5.14. ROLES: owner full, ACCOUNTANT READ+WRITE (the one place accountant writes), employee: route hidden AND server-guarded.
BUILD: /expenses — (A) ENTRIES: add-entry form (type Expense/Income · amount ₹ · date · account select from smark_expense_accounts · category chips Materials/Salaries/Rent/Utilities/Tools/Client payment/Other · vendor/party · note · optional project link (income+project = a payment, renders in that project's strip) · optional attachment via StoragePort · optional GST fields GSTIN+tax amount); entry list w/ filters (month/type/category/account/project), edit, SOFT delete (deleted_at, audit); DRAFTS from checkout (is_draft rows): chip-flagged, confirm/edit → real (owner confirms). (B) CHARTS (use recharts; dark-theme-aware: transparent backgrounds, #f57d05 accent + muted category palette, JetBrains Mono tick labels): period switcher monthly/quarterly/yearly; income-vs-expense bars, cumulative net line, category donut, by-account split, top-projects income, YoY compare; summary tiles month in/out/net + year in/out/net; AI SPEND METER (R2-37): ₹/run + monthly series from smark_agent_runs.actual_cost — renders honestly as zero-state until WF-3 populates it. (C) /settings/expense-accounts — CRUD card for cash/bank/UPI accounts (owner-only). (D) Export CSV/xlsx of filtered entries.
Tests: tests/unit/expenses-*.test.ts (rollups math, soft delete filter), tests/e2e/expenses-*.spec.ts (owner adds entry; EMPLOYEE CANNOT SEE the route — assert redirect/hidden).` },
  { key: 'search-notifications', prompt: `${COMMON}
SURFACE: Global search + notifications. Spec: FEATURES §5 header bullet + OWNERSHIP search-notifications section.
BUILD: (1) components/search/ — Ctrl-K command palette (also opened from the header field): sections Parts (PID/MPN/value) · Projects (name/client) · BOMs (name) · Orders (PO number); debounced server search (lib/search/queries.ts, RLS clients), keyboard nav, Enter deep-links (part drawer / project hub / BOM / cart PO group); scan-code RESOLVE FIRST: exact SMK- PID or box-code pattern short-circuits straight to the part/box (reuse the resolution helper from lib/scan — read-only import, note it). (2) components/notifications/ — bell dropdown: unread badge count, list (type icon · text · time · deep link), mark-read + mark-all-read; hooks/use-notifications.ts polling or realtime (your call — note it). (3) lib/notifications/fanout.ts — SERVER helpers other packages will import: notifyExpenseDraft(orderId,...), notifyArrival(...), notifyTaskAssigned(...), notifyPortalComment(...), notifyLowStock(...), notifyRulePending(...), notifyRunDone(...) — each inserts smark_notifications rows for the right audience (owner / assignee / role); keep signatures simple + documented. (4) app/api/notifications/** mark-read route if needed.
DO NOT edit components/shell/** (auth-shell's header currently renders its own stub field + bell) — build your components standalone + document in notes-for-integrator the EXACT two imports/props the integrator must swap into the header.
Tests: tests/unit/search-*.test.ts (pattern short-circuit, query shaping), tests/e2e/notifications-*.spec.ts (bell renders; palette opens on Ctrl-K, finds seeded SMK-000101).` },
  { key: 'portal', prompt: `${COMMON}
SURFACE: Client portal (PUBLIC). Spec: plan/tab-client-portal.md (R2-38/30) + FEATURES §11 + §17 bullet. THE SECURITY-CRITICAL PACKAGE — reads go ONLY through SECURITY DEFINER functions; the anon client must never touch base tables.
BUILD: (1) supabase/migrations/0006_portal_fns.sql (RESERVED for you — the ONE new migration): SECURITY DEFINER functions: portal_get_project(token) → name/status/completed_at/progress inputs + phases rows; portal_get_shared(token) → activities WHERE share_to_portal AND documents WHERE shared (name/type/size/url only); portal_add_comment(token, author_name, body) → inserts smark_project_activities type='change' tagged source='portal' AFTER a rate-limit check INSIDE the function (e.g. ≤5 comments per token per hour via a count query — reject with a clear error); ALL functions return NOTHING for archived projects or unknown/regenerated tokens (token invalid = 404, no distinction leaked). REVOKE default execute; GRANT to anon ONLY these functions. (2) app/p/[token]/ — public mobile-first page OUTSIDE the app shell (no rail/header; own minimal Smark-branded chrome, orange on dark): project name + status chip + est delivery (last phase end), PHASE TIMELINE rendered read-only (current highlighted, done checked, parallel/buffer styled, footnote rows as footnotes), progress % + on-track chip (same math as hub — import projects-hub's pure fn read-only or duplicate the small fn with a comment), UPDATES feed (shared activities only), shared documents (name+download), comment box (name + message → portal_add_comment; success = lands in feed + smark_notifications row for owner "from client portal" ("// TODO(integrator): lib/notifications")). (3) NEVER render: prices, ₹ anywhere, inventory, hours, internal notes, other projects. 404 page for bad token.
Tests: portal block of tests/integration/rls-matrix.test.ts (anon client: base-table selects DENIED, functions work, archived/regenerated token → empty), LEAK-SCAN e2e per FEATURES §16: fetch the portal page for the seeded demo project and assert NO ₹/price/qty-on-hand strings appear; tests/e2e/portal-*.spec.ts (timeline renders at 360px, comment posts).` },
]

const built = await parallel(PKGS.map(p => () =>
  agent(p.prompt, { label: p.key, phase: 'Build', model: 'sonnet' })))
log(`Build done: ${built.filter(Boolean).length}/8 packages`)

phase('Integrate')
const integration = await agent(`${COMMON}
ROLE: INTEGRATOR — you alone may edit shared files (components/shell/**, lib/nav.ts, types/db.ts, app/layout.tsx, seed.sql, package.json). Work the seams the 8 parallel builders could not:
1. HEADER SEAM: swap auth-shell's stub search field + bell in components/shell for the real components/search + components/notifications components (each builder's notes below give the exact imports/props). Keep the shell's layout/styling contract.
2. NOTIFICATION CONSOLIDATION: replace any direct smark_notifications inserts marked "// TODO(integrator)" in cart-orders/projects-hub/portal server code with the lib/notifications/fanout helpers, IF signatures line up — otherwise adapt fanout.ts (search-notifications owns it, but you arbitrate).
3. NAV: ensure lib/nav.ts entries for Projects/Cart/Daily/Expenses/Settings sub-pages match what shipped (labels per FEATURES §5; Expenses visible to owner+accountant only, More-sheet role filtering intact).
4. BUILDER REQUESTS: read the notes-for-integrator in the reports below; apply the safe ones (types/db.ts additions, seed.sql demo rows for projects/boms/cart so e2e + demo have data, small components/ui additions); defer anything scope-expanding with a note.
5. PROVE IT: bunx tsc --noEmit clean, bun run build clean, then report what you wired + declined.
BUILDER REPORTS:
${built.map((b, i) => `--- ${PKGS[i].key} ---\n${b ? String(b).slice(0, 4000) : '(builder returned nothing — inspect its files yourself)'}`).join('\n\n')}`,
  { label: 'integrate', phase: 'Integrate', model: 'opus' })
log('Integration pass done')

phase('Review')
const LENSES = [
  ['fidelity', `PLAN-FIDELITY lens: diff the built Phase-2 surfaces against plan/tab-{orders-projects,on-order,bulk-pick,daily-reports,expenses,client-portal}.md + FEATURES §5.8-14/§5.17 + §10 + §11. Hunt: phase math wrong (duration-weighted, parallel/footnote excluded, buffer absorbs), Q-05 lifecycle wrong (release on takeout/arrival/archive; dismissal-resurrect only when shortfall GROWS), checkout not grouped by distributor / po_number optional, draft expense missing on order placement, archive warning missing a consequence, portal showing anything price/inventory shaped, accountant write anywhere except Expenses, employee seeing Expenses/other-people daily data, share-to-portal defaulting ON, BOM name uniqueness unenforced, build_qty not multiplying need.`],
  ['correctness', `CORRECTNESS lens: real defects only. Run bunx tsc --noEmit, bun test, bun run build for evidence; read diffs for: service-role key leaking into app routes, portal functions missing SECURITY DEFINER/anon grants or leaking archived projects, RLS violations (writes that silently fail for accountant/employee), demand/shortfall math bugs (double counting a project, dismissed-line resurrection logic), po_number uniqueness race, movement writes bypassing lib/movements (rollup drift), soft-delete rows still counted in rollups, xlsx export/injection issues, unhandled nulls under noUncheckedIndexedAccess.`],
  ['ui-consistency', `UI/UX lens: compare against SmarkStock-prototype/SmarkStock.dc.html + WF-1 shipped surfaces: spacing/radius/color drift, tables without overflow containers (h-scroll leak at 360px), touch targets <44px, missing empty/loading/error states (new surfaces have MANY empty states — projects with no phases, empty cart, no expenses), toasts without undo where stock mutates (takeout finish), recharts default styling left un-themed (blue defaults on dark bg), portal not mobile-first or leaking app chrome, Ctrl-K palette unusable on mobile.`],
]
const reviews = await parallel(LENSES.map(([k, p]) => () =>
  agent(`${COMMON}\nROLE: Adversarial reviewer — TRY TO REFUTE that Phase-2 is done/correct. ${p}\nINTEGRATION NOTES: ${String(integration ?? '(none)').slice(0, 3000)}\nReport ONLY verified findings (file+evidence).`,
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
MISSION: Fix these verified findings (root causes). You may touch shared files ONLY where a finding demands it. Re-run bunx tsc --noEmit + bun test until clean. Do not expand scope.
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
  integration: String(integration ?? '').slice(0, 500),
  findings: allFindings.length,
  final_verify: verdict,
}
