# Desktop App Handoff — continue from here

> For the next Claude session (Sonnet). Read this + `desktop/README.md` + the approved plan at
> `~/.claude/plans/drifting-drifting-tome.md`. Working style: fix one thing at a time, commit at
> boundaries (`git commit -F <msgfile>` — PowerShell mangles multi-line `-m`), push to main, log
> findings in `docs/TESTING-FINDINGS.md`. Bun for everything EXCEPT playwright (broken under
> Bun-on-Windows — anything touching playwright runs under `node --import tsx`). End commits with
> `Co-Authored-By:` line for the model in use.

## The pivot (approved 2026-07-05)

Experiment F-013 (see `docs/experiments/AI-Sourcing-Pilot-Client-Report.pdf`) proved the
**real-browser agent wins** for BOM sourcing: real Brave + residential IP passed every distributor
bot wall (LCSC/DigiKey/Mouser/element14/Unikey, zero blocks), 26/37 exact matches vs a human
engineer, 11/13 empty lines filled, ₹0.77/line. A real browser needs a desktop — so:

**SmarkStock Desktop**: a lightweight Windows companion app (Tauri shell) that executes sourcing
on the user's PC via **their own Claude Code terminal** (subscription OR API key — whatever their
`claude` CLI is signed in with; legitimate because it's their own supervised interactive session).
Everything else — inventory, projects, review, ordering, mobile PWA — stays on the existing web
app, unchanged. **Single agent mode** (no embedded API-key pipeline in the desktop app; the old
always-on worker remains in the repo for server-side API-only runs).

## What's DONE (P1, commit ff2108f — all pushed, all green)

Web side:
- `lib/supabase/server.ts` → `createBearerClient(token)` — desktop sends the user's Supabase
  access token via `Authorization: Bearer`; same email/password login as web.
- `lib/runs/enqueue.ts` → `createDesktopRun()` — builds the SAME aliased `WorkerRunConfig` a
  worker run gets, but inserts the run with **status "running"**, `plan.appMeta.executor =
  "desktop"`, and **NO `smark_order_jobs` rows** — this is what keeps the always-on worker from
  ever claiming desktop runs. Returns `{runId, projectId, config}`.
- `app/api/desktop/run-context/route.ts` (POST `{bomId, lineLimit?}`) — bearer auth →
  owner/employee gate (`smark_role` + `canWrite("projects")`) → `createDesktopRun` → returns
  `{runId, config, reviewPath}`.
- `app/api/desktop/results/route.ts` (POST) — validates with `lib/desktop/sync.ts` zod schemas,
  checks every result belongs to the run's own lines/distributors, idempotent upserts into
  `smark_agent_results` (keyed run/line/distributor, worker semantics), stores masterPlan into the
  plan envelope (preserving config+appMeta), flips run → "review". Web review screens work as-is.

Desktop runner (`desktop/runner/`, CLI — P2's UI wraps this exact flow):
- `brave.ts` — dedicated Brave/Chrome, CDP **:9333** (deliberately not 9222), persistent profile
  `~/.smarkstock-browser`. Pattern from `claude-session-control/server/browserCopilot.ts`.
- `prefetch.ts` — DigiKey/Mouser/element14 REST pre-fetch with the LIVE payload shapes verified in
  F-013: DigiKey pricing nests in `ProductVariations` (prefer Cut Tape variation); element14 stock
  = `inv`, India store = INR, free tier 403s → one paced retry; Mouser matches docs. Keys optional
  (missing key = skip that API). Paced ~1.2s/line for Mouser's 30/min limit.
- `session.ts` — generates the Claude Code session folder: `CLAUDE.md` (the 7 ordering rules,
  every line + its API candidates, search URLs per site, STRICT incremental `results.json`
  contract — update after EVERY line, `complete: true` at end), `.mcp.json` (playwright MCP pinned
  0.0.76, `--cdp-endpoint http://127.0.0.1:9333`), `.claude/settings.local.json` (pre-approved:
  mcp__browser/Read/Write/Edit), seeded `results.json`.
- `transform.ts` — results.json → API payload. **The objective rungs are recomputed in CODE**:
  `evaluateMpnMatch`/`evaluatePackageMatch` imported from `worker/src/matcher-lite` (pure module) —
  an agent "recommended" claim never bypasses the mandatory package rung; unknown
  distributors/lines → warnings, double-recommendation demoted.
- `run.ts` — CLI orchestrator: sign in → run-context → prefetch → ensureBrowser → generateSession
  (`~/.smarkstock-sessions/<runId>`) → spawn `claude` in a visible PowerShell window (cwd =
  session dir) → poll results.json every 3s (tolerant of mid-write JSON) → transform → upload →
  print review URL.
- Tests: `tests/unit/desktop-transform.test.ts` (4 cases). Gates all green: root tsc, eslint,
  `bun run build`, 839/0 app tests.

## What REMAINS

**P1c — supervised verification run (NEXT, needs the user present):**
1. Web app running locally with cloud env (user runs it), `claude` CLI signed in.
2. `$env:DESKTOP_EMAIL/…PASSWORD` set, then:
   `bun --env-file=.env.cloud.local run desktop/runner/run.ts --bom <bomId> --lines 5`
3. User tells the opened terminal "source the BOM per CLAUDE.md" and supervises.
4. Verify: results.json fills line-by-line → upload succeeds → run shows on the web review screen
   (`reviewPath` printed) with candidates + recommended picks + why.
5. Expect first-run friction: playwright MCP download on first `claude` start; possible one-time
   site challenges in the fresh Brave profile (user solves once, profile remembers). Fix whatever
   breaks in the contract (session.ts wording) rather than the guard (transform.ts).
6. Then the 50-line TMCS sample (`TMCS_96x32_Matrix_V1.2_test_raw.xlsx` in repo root) and compare
   against F-013 tallies (docs/experiments/).

**P2 — Desktop UI + Tauri shell:**
- Tauri 2 window + sidecar server (compile with `bun build --compile` → single exe; Rust toolchain
  needed once on this PC).
- UI (React + Tailwind, Material Blue #1976D2): login → BOM picker (list from Supabase) or local
  .xlsx upload (reuse `lib/import/bom.ts` + `lib/bom/parse-upload.ts`) → ordering setup (digest
  preview, distributor toggles) → run progress (tail results.json, per-line lanes like /ai_orc) →
  "review on web" handoff link.
- Prereq wizard: detect Brave/Chrome, detect `claude` CLI + signed-in state, install instructions.
- Installer: Tauri bundler → .msi; verify on a clean-ish machine.

**P3 — polish:** auto-update check, error surfaces (upload retry from preserved results.json),
element14 backoff tuning, docs, findings entry.

## Gotchas the next session MUST know

- **PowerShell deletes an env var assigned `''`** — use `' '` (space) to force-unset; worker env
  `optional()` trims. Bit us hard once (F-008).
- **playwright hangs under Bun-on-Windows** (both transports) — Node only for playwright code.
- `.env.local` must ALWAYS point at the LOCAL stack (test suites depend on it); cloud creds live
  in gitignored `.env.cloud.local`.
- The user runs all cloud SQL manually via numbered files in `scripts/cloud-sql/` — never write to
  cloud schema yourself; data fixes also got blocked by the permission classifier once, so prefer
  SQL files + asking.
- Some worker claim tests are DB-global — if `bun test` shows claim.test.ts flakes, rerun (they
  were de-flaked in 734023c, but the pattern is known).
- `git add -A` once swept the user's stray xlsx files — stage NAMED paths only. Untracked-on-
  purpose in repo root: `GCU_V1.1_BOM_removed.xlsx`, `TMCS_*.xlsx`, `worker/dist-run.tmp.mjs`.
- Distributor API keys live in `.env.cloud.local` and all three are verified working.
- Memory files: see `~/.claude/.../memory/MEMORY.md` — `desktop-pivot.md` has this pivot,
  `windows-live-worker-runtime.md` has the runtime traps.
