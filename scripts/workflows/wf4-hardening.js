export const meta = {
  name: 'wf4-hardening',
  description: 'SmarkStock WF-4: hardening — full E2E flow suite, codebase audit lenses, completeness critic, fix/verify to green',
  phases: [
    { title: 'E2E flows', detail: 'implement TESTING.md §3 flow suite (sonnet)', model: 'sonnet' },
    { title: 'Audit', detail: 'correctness/security/simplify lenses + completeness critic (opus)', model: 'opus' },
    { title: 'Fix', detail: 'apply confirmed findings + close gaps (sonnet)', model: 'sonnet' },
    { title: 'Verify', detail: 'full gate loop-until-green (opus)', model: 'opus' },
  ],
}

const ROOT = 'C:/Users/vaibh/Desktop/Learning Projects/smark_inventory'

const COMMON = `
CONTEXT — read before working:
- ${ROOT}/FEATURES.md (build spec v2), ${ROOT}/plan/TESTING.md (§3 flow suite, §5 invariants, §6 traceability), ${ROOT}/plan/CHANGE-LOG.md (all 38 R2 changes), ${ROOT}/docs/OWNERSHIP.md.
- ALL FOUR PHASES ARE BUILT AND GREEN (WF-0..WF-3 committed): full inventory loop, projects/BOMs/cart/daily/expenses/portal, AI layer in mock mode (worker, alias layer, run console, persisted review). Dev users owner/employee/accountant auto-seeded for e2e (tests/e2e/global-setup.ts); canonical demo seed applies on db reset; playwright workers pinned to 2 (Turbopack cold-compile contention — do not raise).
- E2E patterns: copy the guard + login-helper conventions from tests/e2e/dashboard-smoke.spec.ts (process.versions.bun guard, loginAs helpers, generous first-nav timeouts). Two projects run every spec: desktop-1280 + mobile-360.
- The full AI pipeline runs deterministically WITHOUT live keys (mock adapters) — e2e must exercise it for real, no skipping.
HARD RULES: Bun only. bunx tsc --noEmit stays clean. No secrets, no git commits, no bun add. Tests assert EXPECTED OUTPUT, not implementation (TESTING.md §1.5).
RETURN: terse report — files created/changed, what passes, blockers.`

const FINDINGS = {
  type: 'object', additionalProperties: false,
  properties: { findings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    file: { type: 'string' }, issue: { type: 'string' }, severity: { enum: ['critical','major','minor'] }, fix_hint: { type: 'string' } },
    required: ['file','issue','severity','fix_hint'] } } },
  required: ['findings'],
}
const GAPS = {
  type: 'object', additionalProperties: false,
  properties: { gaps: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    r2: { type: 'string' }, what_is_missing: { type: 'string' }, where_expected: { type: 'string' },
    size: { enum: ['minor','major'] }, fix_hint: { type: 'string' } },
    required: ['r2','what_is_missing','where_expected','size','fix_hint'] } },
    complete: { type: 'array', items: { type: 'string' } } },
  required: ['gaps','complete'],
}
const VERIFY = {
  type: 'object', additionalProperties: false,
  properties: {
    typecheck: { enum: ['pass','fail'] }, unit_tests: { enum: ['pass','fail'] }, worker_tests: { enum: ['pass','fail','skipped'] },
    next_build: { enum: ['pass','fail'] }, db_reset: { enum: ['pass','fail','skipped'] }, e2e: { enum: ['pass','fail','skipped'] },
    failures: { type: 'array', items: { type: 'string' } } },
  required: ['typecheck','unit_tests','worker_tests','next_build','db_reset','e2e','failures'],
}

phase('E2E flows')
const FLOWS = [
  { key: 'flow-pipeline', prompt: `${COMMON}
MISSION (tests only, you own tests/e2e/**): implement TESTING.md §3 flow 3 + flow 4 as tests/e2e/flow-3-ordering-pipeline.spec.ts + flow-4-receipt-path.spec.ts:
FLOW 3 (the big one, end-to-end expected output): create project → create BOM in-app with a custom column → set build_qty 10 → reconcile flips a ×1-in-stock line to to-order → run ordering (mock agents stream to console; wait for done) → review persists after page reload → add to cart → verify the canonical shortfall (seed a second project so 500 avail / 400+200 demanded → auto line of EXACTLY 100) → checkout blocked without order number → checkout with order number (grouped by distributor) → draft expense exists → mark arrived → put away via receive → last_unit_price stamped (assert via part drawer) → dashboard inventory value reflects it.
FLOW 4: upload the receipt fixture on an ordered group → Extract prices (mock) proposes → confirm → order line prices + part last_unit_price updated; assert NOTHING was written before confirm.
Break flows into resilient test.step chunks; prefer data-testid additions ONLY if a selector is genuinely unreachable (app edits limited to adding data-testid attributes — nothing behavioral). Both flows must pass on desktop-1280 AND mobile-360 locally before you return — run bunx playwright test on your specs (repeat until green or report the app bug blocking you as a finding in your report).` },
  { key: 'flow-team-money', prompt: `${COMMON}
MISSION (tests only, you own tests/e2e/**): implement TESTING.md §3 flows 1, 5, 6 as tests/e2e/flow-1b-roles-matrix.spec.ts (extend, don't duplicate, the existing flow-1-auth-roles.spec.ts), flow-5-team-day.spec.ts, flow-6-expenses.spec.ts:
FLOW 1 (deepen): login EACH role → assert exact nav surface per FEATURES §2 (rail groups, More sheet contents, hidden Settings cards); employee cannot approve AI-memory rules (UI hidden AND the server action/RLS denies — attempt it via the app and assert failure).
FLOW 5: employee clock-in → select working-on project → make a movement (scan take-out) → clock-out (hours prompt) → log manual hours → Daily Report shows attendance + hours + the movement; owner view shows team table + expenses section; employee view has NO expenses section and only self data.
FLOW 6: owner adds expense entries across two accounts + an income with project link → charts totals match the seeded sums (assert rendered numbers) → project hub payments strip shows the income → accountant can add/edit entries → employee gets redirected away from /expenses.
Same rules: test.step chunks, data-testid only if unreachable, run your specs both viewports until green or report the blocking app bug.` },
  { key: 'flow-pwa-a11y', prompt: `${COMMON}
MISSION (tests only, you own tests/e2e/**): implement TESTING.md §3 flows 7 + 8 as tests/e2e/flow-7-pwa-offline.spec.ts + flow-8-mobile-a11y.spec.ts:
FLOW 7: manifest.json served with correct fields; service worker registers; offline scan queue — go offline (context.setOffline), scan a take-out, assert the queued banner + localStorage entry, go online, assert it syncs into a movement.
FLOW 8 (the sweep): for EVERY authed route in lib/nav.ts plus /login and a portal page: at mobile-360 assert document.scrollWidth <= viewport width (no h-scroll — the FEATURES §18 hard rule); interactive elements in the primary flows ≥44px hit area (spot-check buttons/links via bounding boxes on key screens: scan stepper, cart line controls, bottom bar, More sheet); a reduced-motion pass (emulate prefers-reduced-motion, assert the run console still completes). Keep the route list DERIVED from lib/nav.ts import so new routes automatically join the sweep.
Same rules: run until green locally or report blocking app bugs.` },
]
const flowReports = await parallel(FLOWS.map(p => () =>
  agent(p.prompt, { label: p.key, phase: 'E2E flows', model: 'sonnet' })))
log(`E2E flow builders done: ${flowReports.filter(Boolean).length}/3`)

phase('Audit')
const AUDITS = [
  ['sec-rls', `SECURITY/RLS lens over the WHOLE codebase: service-role usage outside the sanctioned allowlist (7 run/ordering routes + lib/ai/alias per WF-3 integration doc), RLS gaps vs the FEATURES §2 matrix (write a quick probe test per suspicion against local supabase), portal SECURITY DEFINER functions (token guessing, archived leakage, rate-limit bypass), alias-layer leaks (grep every ClaudePort call site: does business context bypass lib/ai/alias anywhere?), secrets in code, client components importing server-only modules, xlsx/CSV injection, middleware auth bypass routes.`],
  ['correctness', `CORRECTNESS lens over the WHOLE codebase (not just diffs): run bunx tsc --noEmit, bun test, (cd worker && bun test) for evidence, then hunt cross-feature seams the per-WF reviews could not see: movement paths that bypass lib/movements, rollup drift across concurrent surfaces, v_part_demand vs cart recompute disagreements, status walks that can go backward via any route, undo chains double-reversing, stale-run flag not set on every build_qty mutation path, notification fan-out missing role filters, date/timezone bugs in daily reports (IST), ₹ formatting inconsistencies.`],
  ['simplify', `SIMPLIFY/CONSISTENCY lens: duplicated logic that should reuse the shared libs (stock-state utils, phase math imported by portal, CSV builders, toast/undo patterns), dead code from the placeholder era (WF-1 stubs now orphaned — the integrator noted two; find any more), inconsistent naming across packages, components/ui additions that duplicate an existing primitive, oversized client components that should be server components. ONLY report findings whose fix is safe + mechanical — no architecture rewrites.`],
]
const auditResults = await parallel([
  ...AUDITS.map(([k, p]) => () =>
    agent(`${COMMON}\nROLE: Adversarial whole-codebase auditor. ${p}\nReport ONLY verified findings (file+evidence).`,
      { label: `audit:${k}`, phase: 'Audit', schema: FINDINGS, model: 'opus' })),
  () => agent(`${COMMON}
ROLE: COMPLETENESS CRITIC. Walk ${ROOT}/plan/CHANGE-LOG.md — every one of the 38 R2 changes (36 🟢 + note the 2 ⚪ superseded as complete-by-proxy) — plus FEATURES.md §5's 17 surfaces and §16's invariant list. For EACH: verify the thing actually exists in code (open the files; a nav entry or stub does not count — the behaviour must be implemented). Mock-gated AI behaviour (live keys absent) counts as complete if the mock path exercises the full contract. Phase-0 live spike measurement is EXPECTED-INCOMPLETE (awaiting keys) — list it under complete with that caveat, not as a gap. Classify each real gap minor (fixer-sized) or major (needs its own builder — do NOT attempt).`,
    { label: 'completeness-critic', phase: 'Audit', schema: GAPS, model: 'opus' }),
])
const auditFindings = auditResults.slice(0, 3).filter(Boolean).flatMap(r => r.findings)
const critic = auditResults[3]
const minorGaps = critic ? critic.gaps.filter(g => g.size === 'minor') : []
const majorGaps = critic ? critic.gaps.filter(g => g.size === 'major') : []
log(`Audit: ${auditFindings.length} findings · gaps: ${minorGaps.length} minor, ${majorGaps.length} major`)

let verdict = null
let round = 0
let toFix = [
  ...auditFindings,
  ...minorGaps.map(g => ({ file: g.where_expected, issue: `[GAP ${g.r2}] ${g.what_is_missing}`, severity: 'major', fix_hint: g.fix_hint })),
]
while (round < 3) {
  round++
  if (toFix.length > 0) {
    phase('Fix')
    await agent(`${COMMON}
MISSION: Fix these verified findings + close these gaps (root causes; every bug fix ADDS a regression test per TESTING.md §1.4). Re-run bunx tsc --noEmit + bun test + (cd worker && bun test) until clean. Do not expand scope.
ITEMS:
${toFix.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}: ${f.issue} — ${f.fix_hint}`).join('\n')}`,
      { label: `fix:r${round}`, phase: 'Fix', model: 'sonnet' })
  }
  phase('Verify')
  verdict = await agent(`${COMMON}
MISSION: Verification only — run and report, fix nothing: (1) bunx tsc --noEmit (2) bun test (3) cd worker && bun test (4) bun run build (5) bunx supabase db reset (6) bunx playwright test — bare (desktop-1280 + mobile-360; global-setup seeds dev users; the NEW flow specs are part of the gate now). Exact failure messages.`,
    { label: `verify:r${round}`, phase: 'Verify', schema: VERIFY, model: 'opus' })
  const green = verdict && verdict.typecheck === 'pass' && verdict.unit_tests === 'pass' && verdict.next_build === 'pass'
    && (verdict.worker_tests !== 'fail') && (verdict.db_reset !== 'fail') && (verdict.e2e !== 'fail')
  if (green) { log(`Verify r${round}: GREEN`); break }
  log(`Verify r${round}: RED (${verdict ? verdict.failures.length : '?'})`)
  toFix = (verdict ? verdict.failures : []).map(f => ({ file: '(verify)', issue: f, severity: 'critical', fix_hint: 'make it pass' }))
}

return {
  flow_builders_done: flowReports.filter(Boolean).length,
  audit_findings: auditFindings.length,
  gaps_minor: minorGaps.length,
  major_gaps: majorGaps,
  completeness_confirmed: critic ? critic.complete.length : 0,
  final_verify: verdict,
}
