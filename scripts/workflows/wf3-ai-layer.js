export const meta = {
  name: 'wf3-ai-layer',
  description: 'SmarkStock WF-3: AI layer — foundations then surfaces (sonnet), opus integrate/review, sonnet fix, opus verify',
  phases: [
    { title: 'Foundations', detail: 'lib/ai + worker service in parallel (sonnet)', model: 'sonnet' },
    { title: 'Surfaces', detail: 'ordering UI, settings, receipts, dashboard (sonnet)', model: 'sonnet' },
    { title: 'Integrate', detail: 'seams + consolidation (opus)', model: 'opus' },
    { title: 'Review', detail: '3 adversarial lenses (opus)', model: 'opus' },
    { title: 'Fix', detail: 'apply confirmed findings (sonnet)', model: 'sonnet' },
    { title: 'Verify', detail: 'tsc, tests, worker tests, build, db reset, e2e (opus)', model: 'opus' },
  ],
}

const ROOT = 'C:/Users/vaibh/Desktop/Learning Projects/smark_inventory'

const COMMON = `
CONTEXT — read before writing code:
- ${ROOT}/FEATURES.md — build spec v2: §0 (Phase-0 spike GATES live browsing — code-complete only, NO live distributor calls), §4 architecture (Opus PLANS ONLY, never browses; worker claims jobs FOR UPDATE SKIP LOCKED), §6 pipeline contract, §7 search ladder (package NEVER substitutable), §12 alias layer (MPN/LCSC PN/package/distributor names pass through REAL; client/project/product names → CLIENT-A/PROJ-03; project descriptions/notes NEVER sent), §15 caps (fixed per-site concurrency cap ALWAYS beats the user knob; per-run ₹ ceiling).
- ${ROOT}/plan/tab-{ordering-workspace,agent-run,order-review,ai-memory,settings}.md — detailed specs for your surface.
- ${ROOT}/docs/OWNERSHIP.md — file ownership. Shared files off-limits → notes-for-integrator.
- Phases 1+2 are BUILT and GREEN: full inventory loop, projects hub + phase timelines, named BOMs + reconcile (lib/bom), smart cart + checkout (lib/orders), daily reports, expenses + charts, search palette + notifications (lib/notifications fanout helpers — USE THEM, do not insert smark_notifications directly), client portal. Dev users owner/employee/accountant seeded automatically for e2e.
- Foundation reuse (do not reinvent): types/db.ts, lib/supabase/*, lib/auth/roles.ts, lib/matcher, lib/movements, lib/import, lib/storage (StoragePort), lib/labels, lib/notifications, lib/format.ts, components/ui/*, recharts, pdf-lib, qrcode.
- NO LIVE KEYS EXIST (no ANTHROPIC_API_KEY, no distributor keys). EVERYTHING AI/distributor-shaped goes behind an interface with a deterministic MOCK implementation selected when the key/env is absent — the full pipeline (enqueue → claim → plan → item results → stream → review) must be exercisable end-to-end in mock mode, because the E2E gate runs it. Real implementations are written but only activate when env keys appear.
- Design: match SmarkStock-prototype/SmarkStock.dc.html (open it and read the isOrderSetup/isOrderRun/isOrderReview/isMemory/isSettings templates) — dark #121212, cards #141414 r16, orange #f57d05, JetBrains Mono codes/qty/₹. 360px works, 44px targets, no h-scroll.
HARD RULES: Bun only. bunx tsc --noEmit stays clean. RLS clients in app routes (service key only in worker/scripts/tests). Statuses walk forward only. Suggested AI-memory rules NEVER auto-activate (invariant test exists). Every Claude-bound payload passes the alias layer — CI leak test will scan. No secrets, no git commits, no bun add (deps pre-installed; needs → notes-for-integrator).
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
    typecheck: { enum: ['pass','fail'] }, unit_tests: { enum: ['pass','fail'] }, worker_tests: { enum: ['pass','fail','skipped'] },
    next_build: { enum: ['pass','fail'] }, db_reset: { enum: ['pass','fail','skipped'] }, e2e_smoke: { enum: ['pass','fail','skipped'] },
    failures: { type: 'array', items: { type: 'string' } } },
  required: ['typecheck','unit_tests','worker_tests','next_build','db_reset','e2e_smoke','failures'],
}

phase('Foundations')
const WAVE1 = [
  { key: 'ai-memory-lib', prompt: `${COMMON}
SURFACE: lib/ai (the shared AI plumbing) + AI Memory screen. Specs: plan/tab-ai-memory.md + FEATURES §12 + §10.
BUILD: (1) lib/ai/client.ts — Claude client behind an interface: ClaudePort { complete(req): Promise<res> } with AnthropicAdapter (real, uses ANTHROPIC_API_KEY + CLAUDE_MODEL_MASTER/CLAUDE_MODEL_ITEM envs, @anthropic-ai/sdk is NOT installed — call the REST API with fetch, api.anthropic.com/v1/messages, anthropic-version header) and MockAdapter (deterministic fixture responses keyed by prompt kind — used whenever the key is absent; factory getClaude() picks). (2) lib/ai/alias.ts — the ALIAS LAYER (server-only, service-role read of smark_ai_aliases): ensureAliases(kind, names[]) creates CLIENT-A/PROJ-NN/PROD-NN codes; aliasText(text) replaces every known real name with its code; deAliasText(text) reverses. PASS-THROUGH (never aliased): MPN, LCSC PN, package names, distributor names. Project descriptions/notes must NEVER enter payloads — export buildPlannerContext() that structurally CANNOT include them (whitelist fields, not blacklist). (3) lib/ai/digest.ts — rules-digest builder: active smark_learned_rules → compact numbered digest text, aliased; version from smark_learned_rules_doc; approving/rejecting/retiring bumps version (v++) and writes a diff line. (4) lib/ai/extract.ts — receipt-extraction helper: (fileText|imageBase64) → {lines: [{desc, qty, unit_price}], total} via ClaudePort (MockAdapter returns a fixture keyed to the seeded demo receipt); MPN-normalization helper too. (5) /ai-memory screen per plan/tab-ai-memory.md: header Rules v{N} pill + trust copy + latest diff line; SUGGESTED rule cards (scope pill Part/Category/Distributor/Project/Global/Order · subject · rule text · source quote · Approve/Reject — approve→active+v++, OWNER-ONLY); ACTIVE rules table (scope/subject/rule/confidence/Retire); run-log section listing which rule hit which line (from run data when it exists — empty-state OK).
Tests: CONVERT tests/invariants/alias-leak.test.ts (build a planner payload for a seeded project with a client name + description → assert code appears, real name does NOT, description text does NOT; MPN passes through) and tests/invariants/suggested-rules-never-auto-active.test.ts (insert feedback → rule stays suggested; only explicit approve activates); tests/unit/alias-*.test.ts, digest version tests.` },
  { key: 'worker', prompt: `${COMMON}
SURFACE: the standalone Browser-Worker service. Spec: FEATURES §0/§4/§15 + OWNERSHIP worker section. You own worker/** (own package.json — Bun runtime, minimal deps, may import ../types/worker only), types/worker.ts (the ONE shared types file you own), docs/spike-browser-worker.md.
BUILD: (1) worker/src/claim.ts — job claim loop: poll smark_order_jobs, claim atomically via FOR UPDATE SKIP LOCKED (postgres function or raw SQL through service-role client — document the SQL in a comment; if a helper function in the DB would be cleaner, note it for the integrator instead of writing a migration), heartbeat + release-on-crash (stale claim timeout). (2) worker/src/planner.ts — the Opus PLANNER: takes run config (BOM lines to-order, distributor sequence, priorities text, rules digest — ALL ALREADY ALIASED by the app at enqueue; worker never sees real client names), calls ClaudePort master model ONCE per run → JSON plan {searches[], skip[], narration}; Opus NEVER fetches distributor data. (3) worker/src/item-agent.ts — Sonnet per-line executor: walks the ladder (§7) across the distributor sequence via DistributorClient interface; writes smark_agent_results rows as it goes — IDEMPOTENT upserts keyed (run_id, line_id, distributor) so a re-claimed job never duplicates. (4) worker/src/distributors/ — DistributorClient interface + REST clients for Digikey (OAuth2), Mouser (key), Element14 (key) — each with a RECORD/REPLAY layer: fixtures under worker/tests/fixtures; replay mode (no key) serves fixtures; record mode (key present) hits live + saves. MockDistributor for e2e (deterministic prices/stock for the seeded TMCS parts). (5) worker/src/browser-driver.ts — BrowserDriver interface (searchPart(query) → listings) with three registered impls: ComputerUseDriver + BrowserbaseDriver (stubs throwing NotImplemented with clear message — Phase-0 gated) and PlaywrightDriver (code-complete but NEVER invoked in tests/CI — behind BROWSER_DRIVER env). (6) CAPS: per-site fixed concurrency cap map (constant) that clamps ANY user knob; per-run ₹ ceiling — estimate cost per Claude call (tokens×rate table), abort run past ceiling, write actual_cost to smark_agent_runs. (7) worker/index.ts — service entry (env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_SHARED_SECRET, ANTHROPIC_API_KEY?, BROWSER_DRIVER?); README-style header comment on deploy (Railway/Fly/Render). (8) docs/spike-browser-worker.md — the Phase-0 spike doc: harness code-complete (worker/spike/ — runs the ~30 TMCS lines through a chosen driver, measures hit-rate/latency/₹), status "AWAITING KEYS — live LCSC measurement in a supervised session", go/no-go criteria from FEATURES §0 restated, current posture: API-first, browser gated.
Tests (worker/tests/, run with bun test from worker/): atomic claim (two concurrent claimers, no double-claim — against local supabase), idempotent upsert (same job twice → same rows), cap clamping (knob 10, cap 3 → 3), ₹ ceiling abort, replay fixtures parse.` },
]
const wave1 = await parallel(WAVE1.map(p => () =>
  agent(p.prompt, { label: p.key, phase: 'Foundations', model: 'sonnet' })))
log(`Foundations done: ${wave1.filter(Boolean).length}/2`)

phase('Surfaces')
const WAVE2 = [
  { key: 'ordering-console', prompt: `${COMMON}
SURFACE: Ordering workspace + agent run console + persisted review (bom-pipeline package's WF-3 half). Specs: plan/tab-ordering-workspace.md + plan/tab-agent-run.md + plan/tab-order-review.md. lib/ai (alias/digest/client) and types/worker.ts + worker mock pipeline EXIST from the foundations wave — import, don't rebuild.
BUILD under app/(app)/projects/[projectId]/ordering|runs/** + components/ordering|run|review/** + lib/runs/**:
(1) WORKSPACE (per BOM; replaces the disabled "Set up ordering" button from WF-2): header project · BOM name; cards in order: Builds required ×N stepper (writes smark_boms.build_qty; changing re-splits reconcile + flags saved run stale) · Distributor sequence (drag-reorder rows + on/off toggles over smark_distributors + defaults from smark_distributor_preferences, Unikey default OFF, saved per BOM) · Priorities textarea (prefilled from sheet's Overall-priorities) + read-only per-line notes list · AI-memory context card (digest v pill + "{count} approved rules" + first rules preview, read-only) · Standard rules read-only ladder card ("change in Settings" link) · Economy/Balanced/Thorough segmented control + DRY-RUN ₹ estimate (pure fn: lines × tier depth × per-call token estimate — unit-test it) · Run ordering → enqueues.
(2) ENQUEUE (lib/runs/enqueue.ts, server): create smark_agent_runs row (config snapshot, rules_doc_version) + smark_order_jobs rows; context ALIASED HERE via lib/ai/alias before payload write (leak test covers this seam).
(3) RUN CONSOLE: master card (planner narration streamed, progress done/total, est ₹ vs actual, elapsed) + item lanes grid (per to-order line: status chips, comparison rows streaming in — Site · Price · Stock · MPN ✓/≈/✗ · Pkg ✓/✗ · link · recommended pill flash, "AI · why" footer; in-stock lines short-circuit "✓ Already in stock — N in Box X"). Streaming: subscribe to smark_agent_results (supabase realtime channel; SSE fallback via app/api/runs/[id]/stream if realtime flakes — your call, note it). In MOCK mode (no keys) the worker's MockDistributor + MockAdapter make a run complete deterministically in seconds — e2e depends on this.
(4) REVIEW (persisted, per R2-08): per-line cards (radio option table, recommended pre-selected; confidence /100 colored, <50 shows "⚠ verify manually"; AI·why; View listing ↗; ↺ Re-run this item → new jobs for that line); action = ADD TO CART (selected option + needed qty → smark_cart_items source review_add; already-in-cart shows "In cart ✓ ×N" + jump link) — NO "mark ordered" here; per-item feedback input → smark_agent_feedback → suggested rule (scope Part); whole-order remark → suggested rule (scope Order); footer "Added to cart: N items" + link + Save as PDF snapshot (pdf-lib). Review state persists on smark_agent_results.selected — reopening a sourced BOM lands on the stored review exactly as left. Stale banner when build_qty changed after the run.
Tests: tests/unit/runs-*.test.ts (dry-run estimate, stale flag), tests/e2e/ordering-run-review.spec.ts — THE flow: seeded BOM → workspace → run (mock completes) → review → add to cart → cart shows line. Both viewports.` },
  { key: 'settings-expansion', prompt: `${COMMON}
SURFACE: Settings completion (R2-28 + R2-01 leftovers). Spec: plan/tab-settings.md. Users&roles card (auth-shell) and Expense-accounts card (expenses) EXIST — do not touch them; you own the REST of app/(app)/settings/** + components/settings/** + lib/settings/**.
BUILD: /settings hub page (card grid linking sections, role-gated: owner sees all; accountant/employee see nothing here except what the matrix allows — check lib/auth/roles): (1) STANDARD SEARCH RULES card — the 7-step ladder listed; PACKAGE row PINNED required (no remove control, lock icon + tooltip "never substitutable"); other custom rows removable; "Add rule" free-text → smark_ordering_rules appended to every future order (workspace card mirrors read-only). (2) DISTRIBUTORS card (addable, R2-28): row per site — name · URL · method chip (REST-with-key / browser-agent) · masked key state · active toggle; "+ Add distributor" dialog (name, site URL, method, API key — key goes to a server-side store column note: keys live in env/server config, the row stores WHICH env key name to read, never the secret itself — document this); new sites appear in every BOM's sequence editor default OFF. (3) Small cards: Label size (Avery dropdown — drives lib/labels sheet layout, read by receive), Low-stock mode (per-part reorder_point semantics note + default threshold), Concurrency default (Economy/Balanced/Thorough default for new workspaces — per-site hard cap noted as always winning), Retire remembered custom part fields (list smark_part_field_templates rows + retire toggle — retired fields stop auto-rendering on Receive forms).
Tests: tests/unit/settings-*.test.ts (package-pinned rule cannot be removed — assert the action refuses), tests/e2e/settings-*.spec.ts (owner adds a custom rule → appears in workspace rules card; employee cannot open /settings).` },
  { key: 'receipts-wiring', prompt: `${COMMON}
SURFACE: receipt extraction wiring (cart-orders package's WF-3 slice). Spec: plan/tab-on-order.md §3-C + FEATURES §5.12. lib/ai/extract.ts EXISTS from the foundations wave.
BUILD: in the cart's Ordered section (components/cart + lib/orders — the receipt upload already stores to StoragePort + receipt_url): enable the "Extract prices" action → server action reads the stored receipt, calls lib/ai extract (MockAdapter returns the seeded fixture when no key), presents a CONFIRM dialog mapping extracted lines → order lines (fuzzy match by MPN/desc via lib/matcher where possible; unmatched rows shown for manual mapping); user confirms → fills missing unit_price on order lines + cart-source records + stores receipt_extracted jsonb on the order; NEVER silently writes prices (always the confirm step). Toast + notification via lib/notifications when extraction completes.
Tests: tests/unit/receipt-map.test.ts (extracted→order-line mapping incl. unmatched), e2e happy path with the mock fixture.` },
  { key: 'dashboard-agents', prompt: `${COMMON}
SURFACE: Dashboard agent-activity card (dashboard package's WF-3 slice). Spec: plan/tab-dashboard.md agent-activity section + FEATURES §5.1.
BUILD: replace the WF-1 placeholder in components/dashboard/agent-activity-card.tsx: recent smark_agent_runs (BOM name · project · status chip queued/planning/running/done/failed · done/total lanes · actual ₹ · started-by · elapsed/finished) + live-ish refresh while a run is active (poll or realtime, match dashboard's existing data pattern); links to the run console; keeps the honest empty state when no runs. Also add "on-order" stat correctness check: order_lines status=ordered count now real (WF-2) — verify the tile reads it; fix if still stubbed.
Tests: extend tests/unit/dashboard-*.test.ts for the runs shaping.` },
]
const wave2 = await parallel(WAVE2.map(p => () =>
  agent(p.prompt, { label: p.key, phase: 'Surfaces', model: 'sonnet' })))
log(`Surfaces done: ${wave2.filter(Boolean).length}/4`)

phase('Integrate')
const allReports = [...WAVE1.map((p, i) => [p.key, wave1[i]]), ...WAVE2.map((p, i) => [p.key, wave2[i]])]
const integration = await agent(`${COMMON}
ROLE: INTEGRATOR — you alone edit shared files (types/db.ts, lib/nav.ts, components/shell/**, seed.sql, package.json, migrations by assigned number — 0007 is yours if a builder requested SQL, e.g. the worker's claim function). Work the seams:
1. Apply builders' notes-for-integrator below (DB claim helper fn if requested → migration 0007 + types/db.ts sync; seed.sql demo rows for a mock agent run so dashboards/e2e have data; nav entries for /ai-memory + /settings subs; env-var registry additions to .env.local.example: ANTHROPIC_API_KEY, CLAUDE_MODEL_MASTER, CLAUDE_MODEL_ITEM, WORKER_SHARED_SECRET, BROWSER_DRIVER, distributor keys).
2. Wire the worker into the dev/test story: root package.json scripts "worker:dev" + ensure bun test does NOT try to run worker/tests from the app root (bunfig root already scopes — verify) and CI note if a workflow change is needed (do NOT edit ci.yml beyond adding the worker test job if straightforward).
3. Cross-check the alias seam: enqueue path uses lib/ai/alias BEFORE payload write; no route imports the service-role client outside the allowed list.
4. PROVE IT: bunx tsc --noEmit clean, bun run build clean, bun test green, worker tests green (cd worker && bun test). Report what you wired + declined.
BUILDER REPORTS:
${allReports.map(([k, b]) => `--- ${k} ---\n${b ? String(b).slice(0, 4000) : '(no report — inspect the files)'}`).join('\n\n')}`,
  { label: 'integrate', phase: 'Integrate', model: 'opus' })
log('Integration pass done')

phase('Review')
const LENSES = [
  ['fidelity', `PLAN-FIDELITY lens: diff against plan/tab-{ordering-workspace,agent-run,order-review,ai-memory,settings}.md + FEATURES §0/§4/§6/§7/§12/§15. Hunt: Opus doing anything but planning (any fetch in planner path), review offering "mark ordered" (must be Add-to-cart only), suggested rules auto-activating, alias layer skipped on ANY Claude-bound payload (enqueue, digest, extraction, MPN normalization) or aliasing MPN/LCSC/package/distributor (must pass through), project descriptions reaching payloads, per-site cap yielding to the user knob, package rule removable in Settings, build_qty change not flagging saved runs stale, review not persisting selections, browser drivers invocable without BROWSER_DRIVER env (Phase-0 gate).`],
  ['correctness', `CORRECTNESS lens: real defects with evidence. Run bunx tsc --noEmit, bun test, (cd worker && bun test), bun run build. Read for: claim race (two workers double-claiming), non-idempotent result upserts (re-claim duplicates rows), ₹ ceiling not enforced or cost never written, realtime/SSE stream leaking service-role or subscribing unauthenticated, mock/real adapter selection wrong (mock silently used when key EXISTS, or real called in tests), fetch-based Anthropic client error handling (429/5xx retry, timeout), receipt-confirm writing prices without user confirm, dry-run estimate NaN on empty BOMs, worker env validation.`],
  ['ui-consistency', `UI/UX lens vs SmarkStock-prototype (isOrderSetup/isOrderRun/isOrderReview/isMemory/isSettings): drag-reorder unusable on touch, lanes grid h-scroll at 360px, missing streaming/empty/error/failed-run states, recommended-pill flash missing, confidence colors wrong, stale-run banner missing, JetBrains Mono absent on ₹/qty, Settings cards not matching the locked card style, AI-memory approve/reject not owner-gated in UI.`],
]
const reviews = await parallel(LENSES.map(([k, p]) => () =>
  agent(`${COMMON}\nROLE: Adversarial reviewer — TRY TO REFUTE that the AI layer is done/correct/safe. ${p}\nINTEGRATION NOTES: ${String(integration ?? '(none)').slice(0, 3000)}\nReport ONLY verified findings (file+evidence).`,
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
MISSION: Fix these verified findings (root causes). Shared files only where a finding demands it. Re-run bunx tsc --noEmit + bun test + (cd worker && bun test) until clean. Do not expand scope.
FINDINGS:
${toFix.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}: ${f.issue} — ${f.fix_hint}`).join('\n')}`,
      { label: `fix:r${round}`, phase: 'Fix', model: 'sonnet' })
  }
  phase('Verify')
  verdict = await agent(`${COMMON}
MISSION: Verification only — run and report, fix nothing: (1) bunx tsc --noEmit (2) bun test (3) cd worker && bun test (report as worker_tests; 'skipped' only if the dir has no tests) (4) bun run build (5) bunx supabase db reset (6) bunx playwright test — bare, projects are desktop-1280 + mobile-360, global-setup auto-seeds dev users (browsers via bunx playwright install chromium if needed). Exact failure messages.`,
    { label: `verify:r${round}`, phase: 'Verify', schema: VERIFY, model: 'opus' })
  const green = verdict && verdict.typecheck === 'pass' && verdict.unit_tests === 'pass' && verdict.next_build === 'pass'
    && (verdict.worker_tests !== 'fail') && (verdict.db_reset !== 'fail') && (verdict.e2e_smoke !== 'fail')
  if (green) { log(`Verify r${round}: GREEN`); break }
  log(`Verify r${round}: RED (${verdict ? verdict.failures.length : '?'})`)
  toFix = (verdict ? verdict.failures : []).map(f => ({ file: '(verify)', issue: f, severity: 'critical', fix_hint: 'make it pass' }))
}

return {
  foundations_done: wave1.filter(Boolean).length,
  surfaces_done: wave2.filter(Boolean).length,
  integration: String(integration ?? '').slice(0, 500),
  findings: allFindings.length,
  final_verify: verdict,
}
