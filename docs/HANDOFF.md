# HANDOFF.md — continue the SmarkStock v2 build (fresh session bootstrap)

> Written 2026-07-03 by the previous orchestrating session. A fresh Claude Code session should read
> this file FIRST, then the files in §1, then execute §4 in order. Everything here is current as of
> the WF-0 foundation build.

## 1. Read these before doing anything

1. `FEATURES.md` — the build spec (v2, regenerated from 38 approved client changes). BUILD TRUTH.
2. `plan/00-INDEX.md` → the plan folder: per-surface specs (`plan/tab-*.md`), canonical schema
   (`plan/SCHEMA.md`), invariants (`plan/CROSS-FEATURE.md` §A3), test gate (`plan/TESTING.md`).
3. `docs/OWNERSHIP.md` — file-ownership map for parallel agents (written by WF-0 integrator).
4. `docs/DEV.md` — local dev runbook (supabase local, test commands).
5. `scripts/workflows/wf1-phase1.js` — the READY WF-1 workflow script (launch via the Workflow
   tool with `scriptPath`).

## 2. State snapshot (2026-07-03)

**Done — planning:** prototype (SmarkStock-prototype/) approved through 2 client reviews; 38 R2
changes all planned (36 🟢, 2 ⚪ superseded); all 10 open questions closed; FEATURES.md v2
regenerated. Plan folder = audit trail; any NEW client change → id R2-39+, log in
`plan/CHANGE-LOG.md`, update tab files + SCHEMA + CROSS-FEATURE, re-sync FEATURES.md.

**Done — WF-0 foundation (all on disk, integration-verified):**
- Next.js App Router scaffold AT REPO ROOT (bun; tsc + build green at scaffold time).
- `supabase/migrations/0001…0005` — **35 `smark_` tables, 3 views, RLS on all 35, 124 policies**;
  `bunx supabase db reset` applies clean (verified live twice by the integrator against local
  Docker supabase). Seed: ordering rules, distributors, prefs.
- Design system port: `lib/theme.ts`, tailwind tokens, `components/ui/*` base kit (dark #121212,
  SMARK orange #f57d05), `/design-preview` page.
- Shared contracts: `types/db.ts` (zod, drift-fixed against SQL), `lib/supabase/*`,
  `lib/auth/roles.ts` (role matrix), `lib/matcher/` (THE part-matching ladder — reused by
  reconcile/dup-guard/takeout), `lib/storage/` (StoragePort + local-disk adapter; R2 adapter
  stubbed), `lib/format.ts`.
- CI harness: bun test + Playwright config + `.github/workflows/ci.yml` + invariant test skeletons
  (`tests/invariants/`, mostly test.todo).
- WF-1 deps pre-installed (xlsx, html5-qrcode, qrcode, pdf-lib) — parallel builders must NOT run
  `bun add`.

**WF-0 judgment status:** `COMPLETE — GREEN (2026-07-03)`. Opus reviewers found 6 findings (all
minor, 0 serious), fix round applied them, final verify: typecheck ✓ · unit tests ✓ · build ✓ ·
db reset ✓, zero failures. **Skip §4 Step 0 — start directly at Step 1 (launch WF-1).**

## 3. Operating protocol (client-approved, follow exactly)

- **Multi-agent workflows are approved** by Vaibhav for this build ("launch n agents"). Use the
  Workflow tool per phase; he approves between workflows only if something material changed.
- **Model split (hard rule, saves his session limits):** builder + fixer agents `model:'sonnet'`;
  integrator/reviewer/verifier agents `model:'opus'`; the main orchestrating loop spawns NOTHING
  on fable.
- **Loop pattern per workflow:** parallel sonnet builders (each owns files per OWNERSHIP.md; never
  touch shared files — integrator handles those) → 2–3 adversarial opus reviewers (schemas for
  structured findings) → opus fixer → opus verifier (`bunx tsc --noEmit` · `bun test` ·
  `bun run build` · `bunx supabase db reset` · playwright when relevant) → loop ≤3 rounds.
- **Git: commit at every workflow boundary** (approved). Repo already initialized; foundation
  committed. Message style: `WF-N: <what>` + Co-Authored-By Claude line.
- **Env:** bun 1.3.5, Docker present, LOCAL supabase only (`bunx supabase start`); NO live keys yet
  (Supabase cloud/R2/Anthropic/distributors — Vaibhav wires later; everything stays behind
  interfaces/env so missing keys never block). Windows machine — cross-platform scripts only.
- **Never:** npm/yarn, secrets in code, skipping RLS, mutating stock without a movement + undo.

## 4. Next actions, in order

**Step 0 — WF-0 judgment (if §2 says PENDING):** small workflow: two opus reviewers over the
foundation (lens A: plan-fidelity vs `plan/SCHEMA.md` + FEATURES §2 role matrix — especially
accountant-writes-expenses-only special case, UNIQUE(project_id,name), po_number NOT NULL,
v_part_demand math qty×build_qty non-archived; lens B: correctness — run tsc/test/build for
evidence) → opus fixer for confirmed findings → opus verifier (4 checks above). Then commit
`WF-0: foundation reviewed+verified`.

**Step 1 — WF-1 (Phase-1 features):** launch `scripts/workflows/wf1-phase1.js` via Workflow
(`{scriptPath: '<abs path>'}`). 8 sonnet builders: auth-shell · inventory+part-drawer ·
shelves+audit · scan+movements · receive+labels · import+seed · dashboard · invariants+e2e — then
3 opus review lenses → fix/verify loop (script encodes all of it). On green: commit `WF-1`.

**Step 2 — WF-2 (Phase-2):** author a new script, same pattern, packages: projects-hub (cards,
overview, PHASE TIMELINE per plan/tab-orders-projects.md R2-30, documents, notes/tasks, team,
archive-with-warning) · bom-pipeline (upload/create-BOM grid + remembered templates, reconcile via
lib/matcher, build_qty ×N) · cart-orders (smart shortfall v_part_demand, checkout grouped BY
DISTRIBUTOR with website order-number = po_number, receipt upload stub, PO→draft expense) ·
bulk-takeout · daily-reports (clock in/out + MANUAL hours) · expenses (entries+accounts+charts —
use the dataviz skill for charts) · search+notifications (Ctrl-K, bell fan-out) · client-portal
(`/p/:share_token`, opt-in shared content ONLY, never prices/inventory). Read each
`plan/tab-*.md` first; respect OWNERSHIP.md; commit on green.

**Step 3 — WF-3 (AI layer):** worker service (separate process dir `worker/`, job claim
FOR UPDATE SKIP LOCKED, BrowserDriver interface, REST distributor clients record/replay-mocked),
Opus planner + Sonnet item-agent prompt templates, ALIAS LAYER (`smark_ai_aliases`; MPN/LCSC pass
through real; descriptions never sent — leak test), AI Memory screen + digest versioning, run
console streaming + persisted reviews, receipt extraction endpoint (mock behind interface until
ANTHROPIC_API_KEY exists). Phase-0 spike harness code-complete but live LCSC measurement waits for
keys + a supervised session with Vaibhav.

**Step 4 — WF-4 (hardening):** full Playwright E2E per `plan/TESTING.md` §3 loop-until-green ·
360px/PWA/a11y sweep · whole-codebase review sweep (correctness/security-RLS/simplify lenses) ·
**completeness critic**: walk FEATURES.md + all 38 changes in `plan/CHANGE-LOG.md`, verify each
exists in code; gaps → next fix round.

## 5. Known open items (not blockers)

- Live keys: Supabase cloud, R2, ANTHROPIC_API_KEY, distributor APIs — Vaibhav wires; everything
  is behind env/interfaces.
- Phase-0 browser spike: still GATES the browser-agent path (FEATURES.md §0) — API distributors
  first.
- Deploy: Vercel Pro `bun run build` when Vaibhav is ready; CI must be green first (R2-29:
  red blocks deploy).
- Client-portal comment moderation default: straight-to-feed with flag chip (revisit if abused).
