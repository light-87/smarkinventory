# TESTING-FINDINGS.md — manual-test findings log

> Fill this in while working through `docs/MANUAL-TESTING.md`. One block per issue, copy the
> template. Don't self-censor — "button feels cramped" is a valid finding. When ready, tell
> Claude **"process the findings"**: each OPEN item becomes a fix (with a regression test where
> it's a real bug), severities drive order, and STATUS gets updated back into this file.

**Severity:** `S1` broken/wrong data/blocks the client demo · `S2` works but wrong behavior or
confusing enough to embarrass us · `S3` polish (spacing, copy, speed) · `IDEA` not a defect —
something the client will probably ask for (gets an R2-NN and goes through the plan folder,
NOT silently built).

**Status:** `OPEN` → `FIXED (commit)` / `WONTFIX (why)` / `PLANNED (R2-NN)`.

---

## Template (copy me)

```
### F-001 · S2 · OPEN
Surface: (e.g. Receive → Top up)
Role/device: (owner / employee / accountant · desktop / phone / PWA)
What happened:
What I expected:
Steps to reproduce: (if not obvious)
Screenshot: docs/testing-screenshots/f-001.png (optional)
```

---

## Findings

<!-- newest at the top -->

---

## P1c — first successful desktop end-to-end run (separate clean machine, 2026-07-05)

Ran the SmarkStock Desktop supervised verification per `desktop_app_handoff.md` on a
second, separate Windows machine (not the original dev PC). Result: **the full flow
works** — sign-in → `/api/desktop/run-context` → real-browser Claude Code sourcing →
`transform.ts` → `/api/desktop/results` upload → web review screen. First successful
run outside the original dev environment, 5-line BOM, 22 candidates, uploaded clean.

Setup/environment findings (all resolved, none are code bugs):
- New machine needs Bun + **Node ≥20.9.0** (Next.js 16 requirement) + Brave/Chrome +
  Claude Code CLI signed in + a hand-copied `.env.cloud.local` (gitignored, doesn't
  travel with `git clone`) containing `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, **and `SUPABASE_SERVICE_ROLE_KEY`** — a missing
  service-role key 500s `/api/desktop/run-context` (`createServiceClient()`,
  `lib/supabase/server.ts:92`). Web app must be started with
  `bun --env-file=.env.cloud.local run dev` to actually point at cloud, not local.
- `bun install` / `bunx` EPERM `NtSetInformationFile` failures on Windows — caused by
  OneDrive-synced folders and/or Windows Defender real-time scanning locking files
  mid-move. Fix: move the repo out of OneDrive, add Defender exclusions for the repo
  + `%USERPROFILE%\.bun` + `%LOCALAPPDATA%\Temp`.
- `bunx @playwright/mcp` first run failed (`Cannot find module
  'playwright-core/lib/utilsBundle'`) — same underlying cause as above (partial
  extraction). Workaround this session: installed a Playwright MCP plugin directly in
  Claude Code instead of relying on the runner's generated `.mcp.json`. This validated
  the sourcing/ordering logic but NOT the CDP-attach to the dedicated persistent Brave
  profile (`brave.ts`) — that still needs a real run once the bunx path is reliable.
- Desktop login is username→synthetic-email (`lib/auth/roles.ts` `usernameToEmail`):
  `DESKTOP_EMAIL` must be `{username}@smark.internal` (e.g. `owner@smark.internal`),
  not the plain username shown in the web UI.

### F-014 · S2 · FIXED (this session)
Surface: Desktop runner (`desktop/runner/transform.ts`, `desktop/runner/run.ts`)
Role/device: desktop companion app / Windows
What happened: `run.ts`'s watch loop retried silently forever (no output) even though
the agent had written a complete, spec-compliant `results.json`. Root cause:
`AgentCandidateSchema.why` was `z.string().default("")`, which only applies the
default for `undefined` — an explicit `"why": null` (which the agent correctly writes
for every non-recommended candidate, since CLAUDE.md only requires `why` on the
recommended pick) failed `z.string()` validation, failing the whole file's
`safeParse` with zero visible error.
What I expected: either the null should validate, or a validation failure should be
visible instead of an infinite silent retry.
Fix: `why: z.string().nullable().default(null)` in `transform.ts`; added a
"consecutive parse failures" warning to `run.ts`'s watch loop so this class of issue
surfaces after 5 retries instead of hanging silently forever. Regression test added
in `tests/unit/desktop-transform.test.ts`.
Status: FIXED (this session).

### F-015 · S3 · OPEN
Surface: Desktop runner (`desktop/runner/run.ts` sign-in)
Role/device: desktop companion app
What happened: the runner signs in once at the start and reuses that access token for
the final upload (`persistSession: false, autoRefreshToken: false`). A long
human-supervised sourcing session outlasted the token's lifetime, so
`POST /api/desktop/results` failed with `401 Not signed in.` on the first full run.
Worked around by re-running with a fresh sign-in and pasting the already-completed
`results.json` into the new session folder before the token aged out again.
What I expected: the desktop app should stay signed in for the length of a
supervised run, however long the human takes.
Fix (not yet applied — decide when P2/Tauri app is built): flip to
`autoRefreshToken: true` + `persistSession: true` with a secure storage adapter (e.g.
Tauri's OS-keychain storage), mirroring whatever persistence pattern the web app's own
client-side Supabase client already uses. Narrower alternative: re-authenticate right
before the upload call rather than reusing the original token.
Status: PLANNED (P2).

### F-016 · S3 · OPEN
Surface: Desktop runner (`transform.ts` package-match guard) / BOM data quality
Role/device: desktop companion app
What happened: on the test BOM, all 5 lines' recommended candidates were flagged
"fails the mandatory package rung (no package vs ...)" — `derivePackageFromFootprint`
returned no package because the BOM's `footprint` column was empty for these rows.
Not a bug in the guard logic (it's working as designed — flagging, not silently
trusting the agent), but worth checking this BOM's footprint data before drawing
conclusions from the flags.
What I expected: n/a — flagging behavior, just noting the root cause for whoever
reviews this run's warnings.
Status: OPEN (data quality check, not a code fix).

---

## Processed log

<!-- Claude moves resolved entries here with commit hashes, so the Findings section stays short -->

### F-013 · IDEA · DONE — the big 50-line TMCS experiment (report in docs/experiments/)
Full three-way test on TMCS_96x32_Matrix_V1.2_test_raw.xlsx (50 seeded lines: 25 with MPN,
25 without) vs the engineer-filled sheet. Report: docs/experiments/TMCS-sourcing-comparison.pdf
(+ .html). Keys verified live first (Digikey OAuth ✓, Mouser ✓, element14 ✓ but free tier
rate-limits ~40% of rapid calls; real payload shapes recorded — Digikey pricing sits in
ProductVariations, element14 stock = `inv`, element14 India store prices in INR).
- ARM A "hybrid" (production mirror: REST pre-fetch by code + Haiku Batch judge + web only
  for LCSC/gaps): ₹123 total = ₹2.47/line, ~29 min batch, 50/50 parsed, 52 web searches.
  Score: 25 EXACT, 1 FAMILY, 10 AGENT+, 9 DIFFERENT, 5 MISS.
- ARM B "browser agent" (REAL Brave over CDP — browserCopilot pattern from
  claude-session-control — reading live LCSC/DigiKey/Mouser/element14/Unikey pages, Haiku
  judge): ₹38 total = ₹0.77/line, 33 min, ZERO bot blocks on any site incl. Mouser,
  50/50 parsed. Score: 25 EXACT, 1 FAMILY, 11 AGENT+, 10 DIFFERENT, 3 MISS.
- Verdict: both arms match the engineer on half the lines exactly and fill 10-11 lines the
  engineer left empty; the real-Brave browser agent is the cost/coverage winner locally
  (residential IP + real fingerprint beats every bot wall), while the REST hybrid is the
  deployable/24-7 path. Production direction: REST APIs + real-browser rung (or proxy) for
  LCSC, exactly as the pipeline is shaped today.

### F-012 · IDEA · BUILT (user decision: everything runs on the box)
Surface: worker browse path — residential proxy support so LCSC/Unikey scraping can run
FROM the Hetzner box (Akamai blocks its datacenter IP directly — F-008 constraint).
Built: `BROWSER_PROXY_SERVER` (+ optional `BROWSER_PROXY_USERNAME`/`_PASSWORD`) on the
worker env → PlaywrightDriver routes ALL scraping traffic through it. Two modes:
- LOCAL launch: playwright's own proxy option (supports username/password).
- REMOTE browserless (the box): proxy baked into Chromium launch args via the ws URL's
  `launch` JSON param (`buildCdpEndpointWithProxy`) — `--proxy-server` cannot carry
  credentials, so use IP-WHITELIST auth at the proxy provider (whitelist 167.233.229.51).
USER TO-DO before box deployment: pick a residential proxy provider (Decodo/IPRoyal/etc.,
~$4–10/mo at our volume), whitelist the box IP, set BROWSER_PROXY_SERVER in the box env.
Until then the worker keeps running from the PC (residential IP, no proxy needed).

### F-011 · IDEA · REVERTED (user decision — data quality over convenience)
LCSC stays on the BROWSER SCRAPER alone. The jlcsearch hybrid (built + verified in
cb4e41d) was removed the same day: its stock snapshot disagreed with lcsc.com's own
displayed stock (201,594 vs 27,150 for C85866) and it carries a single price point
instead of the full qty-break ladder. For ordering decisions the page a human would buy
from is the source of truth, and the scraper reads exactly that (real stock, full price
ladder, sister-part fuzzy matches). jlcsearch remains an option later for cheap
pre-screening (existence checks) if scrape volume ever becomes a problem — the client
lives in git history at cb4e41d.
Original build notes: ─────────────────────────────────────────────
Surface: worker LCSC path — jlcsearch community API (jlcsearch.tscircuit.com, keyless)
Surface: worker LCSC path — jlcsearch community API (jlcsearch.tscircuit.com, keyless)
User found the aklofas/kicad-happy skill docs describing it. Verified live: exact MPN /
C-code lookups return structured package/stock/price with NO browser and NO Akamai
IP-blocking (works from the datacenter box) — but ZERO fuzzy matching (near-miss MPNs
return empty where LCSC's own site finds sister parts). Built as a HYBRID:
`LcscJlcSearchClient` (worker/src/distributors/lcsc.ts) tries jlcsearch first (0.5s
courtesy pacing, 15s timeout, Phase-0 gated like every live call), and falls back to the
verified browser scraper on zero hits or API errors. Wired in the factory only when a
browser driver exists, so mock/e2e stay deterministic. Live smoke: GCM21BR72A104KA37L →
C85866, 0805, $0.015, instant; the two KEMET AUTO MPNs correctly fall through to the
scraper. Caveats noted: jlcsearch stock can differ from lcsc.com's shown stock (201,594 vs
27,150 for C85866 — different snapshot/warehouse aggregation); single price point, not the
full break ladder (order link lets a human verify). 4 unit tests (mapping, fallback on
zero/error, gate).

### F-010 · IDEA · BUILT (user decision, see commit) — full-ladder search, quality first
Decision (user): "call all — API calls don't cost much, and we're giving the results to the
agent anyway. Don't think about cost right now; finding the best item matters, cost can be
reduced after." Built: the item agent now searches EVERY distributor in the master's order
for EVERY line (REST + browse), accumulating all hits — supersedes F-009's zero-result-only
fallback. depthPerItem no longer truncates the search (kept as a stored config knob / future
cost lever). Wall-clock note: browse sites serialize (LCSC cap 1), so full-ladder adds
seconds per line, not rupees. Also queued: when distributor API keys land in env, wire each
REST client per its official docs; distributors with NO obtainable key get site-specific
scrapers instead.

### F-009 · S2 · FIXED (user decision, see commit) — not-found fallback ladder
Surface: worker item agent + run console + /ai_orc lanes
Decision (user): if a line isn't found in the first API, try the next, then the browser
sites, and only then say "cannot find". Built:
- The tier's depthPerItem still caps how many distributors are searched for PRICE
  COMPARISON, but when that walk finds NOTHING the agent now keeps walking the REST of the
  master's ladder (REST APIs then browse sites), stopping at the first hit. Previously an
  economy run gave up after 2 distributors.
- A done-with-zero-results lane now says so explicitly: run console + review show "No
  listings found across any site in the sequence" (console used to show "Waiting for
  results…" forever); /ai_orc shows "Not found — searched every distributor in the ladder".
- Tests: worker/tests/item-agent-fallback.test.ts (fallback walks + stops at first hit;
  no fallback when depth found options; full-ladder exhaustion). Also de-flaked
  claim.test.ts (asserts now scope to their own run — claimNextJobs is global and other DB
  test files' fixtures kept tripping the counts).

### F-008 · S1 · FIXED (see commit) — first LIVE end-to-end AI run completed
Surface: worker live path (real Opus/Sonnet + real LCSC scraping), run cc85d890
Symptom: sandbox run stuck on "planning" 8+ min. Root causes found & fixed, in order:
1. NO worker was connected to cloud (zero heartbeats) — the started "agent" wasn't
   pointing at cloud Supabase. I ran the worker myself with the cloud env.
2. playwright is BROKEN under Bun-on-Windows (CDP websocket AND local pipe transport both
   hang; plain Node connects in 1.5s) → worker now also runs under Node
   (`worker/start-live-windows.ps1`; `import.meta.main` guard + Bun.serve made Node-safe).
3. `.env.cloud.local` had a STALE browserless token (401) and `wss://` where the box serves
   plain `ws://` — both fixed in the env file.
4. LCSC blocks BOTH the default HeadlessChrome UA (fixed: realistic Chrome UA on a shared
   browser context) AND the Hetzner datacenter IP entirely (Akamai — NOT fixable by UA; LCSC
   browsing must run from a residential IP until a proxy exists. Remote browserless also
   kills CDP sessions at its session timeout — the "browser has been closed" cascade).
5. LCSC scraper selectors were unverified guesses → rewrote against the LIVE site:
   `tr[id^=productId]` rows; extracts real MPN, LCSC PN (C-number from the detail URL),
   manufacturer, package, stock, full qty-break ladder. Structured fields flow into
   matcher-lite (real mpn_match instead of blanket "none").
6. unikeyic.com hangs forever → generic-site navigation timeout 15s, treated as 0 listings
   (was: 45s hang then lane failure).
7. Digikey/Mouser/Element14 seeded api_type='browse' in cloud (no scraper URL → contributed
   nothing) → driver now returns 0 listings for unknown browse sites instead of throwing;
   permanent data fix = scripts/cloud-sql/04-fix-distributor-api-types.sql (USER RUNS).
8. Worker overwrote plan.appMeta when storing the master plan → now preserved (lineLimit
   chip on /ai_orc survives planning).
RESULT (5-line test, tier thorough): planning ₹2.34, total ₹3.26, ~4 min. Opus authored
perfect per-line searchTerms. 4/5 lines got real LCSC listings (exact MPN hit with 27,150
stock + price tiers for GCM21BR72A104KA37L); 5th (MAASH31LSB7105KTCA01) genuinely not
stocked at LCSC. All 4 candidates show pkg=false ONLY because the uploaded BOM is the
stripped file with no Footprint column — package is the mandatory rung. Re-upload the
ORIGINAL GCU_V1.1_BOM.xlsx for a real accuracy read.

### F-007 · IDEA · BUILT (user-requested directly, see commit)
Surface: /ai_orc — sandbox test bench
Request: "upload a BOM and set up ordering from /ai_orc, and test with 5 items only first —
see how long it takes and how accurate it is before the full 100-line run." Built:
- Sandbox panel at the top of /ai_orc (owner-only, same as the page): pick a recent BOM or
  upload a fresh .xlsx (same parser/storage path as Projects), choose lines-to-test (default
  5, max 50) + tier (default economy), Start test run → the run auto-selects in the deep dive.
- `lineLimit` on lib/runs/enqueue.ts: only the FIRST N to-order lines (by sheet line #) get
  planner context + jobs — a 5-line trial costs 5 lanes and a 5-line rupee ceiling, never the
  whole BOM. Stamped in plan.appMeta; deep dive shows a "test · first N lines" chip.
- Regression test: tests/integration/ai-orc-sandbox-line-limit.test.ts (limit picks by
  line_no, not insert order; jobs count matches; appMeta stamped).

### F-006 · IDEA · BUILT (design locked with user, see commit)
Surface: worker browse path — single 2 GB Chromium box safety
Locked decisions: (1) scripted scraper, master-planned — no LLM-per-page; (2) browser only
where no API (already true: Digikey/Mouser/element14 = REST, LCSC/Unikey = browse); (3) global
env-configurable cap. Built:
- `BROWSER_MAX_CONCURRENCY` (default 2, clamp 1–8): ONE global semaphore every browse search
  must acquire — across all runs and sites — layered on the per-site caps, so the shared
  Chromium box never holds more than N pages regardless of tier/fanout. A 100-line BOM drains
  in waves; REST lines fan out freely beside it.
- PlaywrightDriver now REUSES one CDP/browser connection (lazy, reset on failure) instead of
  connect-per-search; only pages open/close per search.
- Master now authors `searchTerm` per line (exact query the agent types — MPN → LCSC →
  value+package, may be sharpened but never invented); deterministic fallback backfills any
  search the model omits/blanks; mock planner + re-run path fill it too; browse driver uses it
  first. Shown per lane on /ai_orc.

### F-005 · IDEA · BUILT (user-requested directly, see commit)
Surface: NEW — /ai_orc observatory + worker telemetry
Request: "monitoring page for run progress + server RAM/CPU; 2 GB worker box; prompt-to-agent
visibility." Built:
- Migration 0008 `smark_worker_heartbeats` (owner-read RLS, service-role writes) + worker
  heartbeat every 10s: RSS/heap, system free/total MB, CPU %, active item agents, runs in
  flight, jobs done/failed, mock-vs-live, browser gate, models. Cloud: run
  scripts/cloud-sql/03-worker-telemetry.sql once.
- /ai_orc (owner-only, by URL): worker fleet cards with RAM bars, capacity-math card (tier
  fanout 2/3/6 capped at 8, per-site caps, browser double-gate — 99 parallel browsers are
  impossible by construction), runs list, and per-run deep dive: EXACT Opus/Sonnet system +
  user prompts (re-rendered via the new shared worker/src/prompts.ts — the same module the
  worker calls, so zero drift) and one lane per line: plan → candidates → why → exact item
  payload. Polls every 3s.

### F-004 · S2 · FIXED (see commit)
Surface: BOM detail page + AI ordering pipeline
Decision: the BOM page is a pure sheet mirror and the AI reads the complete file.
- Removed from the BOM page: Lines/In stock/To order stat trio, per-line Status chips,
  Re-reconcile button — stock checking is the agents' job during a run. Reconcile still runs
  silently on upload/×N change (feeds cross-project demand + which lines skip the worker).
- Agents now receive the COMPLETE uploaded line: line #, references, qty(×N), value, raw
  footprint, derived package, voltage (now split from "100uF/63V"-style cells — was always
  null before), description, manufacturer, MPN, LCSC, PartLink URL, per-line note, custom
  extra columns. Description/notes/extra string values pass the same global alias scrub
  (leak tests extended + green).
- DNP lines: qty forced to 0, flagged to the planner, mock + live planner skip them ("DNP —
  not populated"). Previously they were sent as buyable with full qty.
- The master planner also sees already-in-stock lines as read-only context (no jobs, no
  free text), so it reads the whole file the way the user does.
Note: the "footprint — on every row" report was NOT a bug — the uploaded file was the
user-modified GCU_V1.1_BOM_removed.xlsx, which genuinely has no Footprint column.

### F-003 · S2 · FIXED (see commit)
Surface: Projects → BOMs → BOM detail table
What happened: the table hid half the uploaded file — Description, Manufacturer, PartLink,
LCSC, per-line notes and custom extra columns were parsed + stored but never rendered.
Decision recorded: the BOM screen mirrors the uploaded file as-is; Status is informational
only (exact MPN/LCSC), and the AI pipeline receives every non-in-stock line raw.
Fix: BOM detail now renders all parsed columns (conditional LCSC/Note, dynamic extras,
PartLink as a clickable link); long references/descriptions truncate with full-text tooltips.

### F-001 · S2 · FIXED (a85963b)
Surface: Projects → BOMs list
What happened: no way to delete a BOM.
Fix: per-row delete button (owner/employee) with confirm dialog; lines cascade-delete; a BOM
that already has AI sourcing runs is not deletable by design (run/cost history is protected) —
the button explains and points to archiving the project instead.

### F-002 · S1 · FIXED (a85963b)
Surface: Projects → BOMs → upload GCU_V1.1_BOM.xlsx
What happened: Status column showed wrong inventory matches (e.g. "10uF/25V 1206" pinned to a
part in "Capacitors 0603") — the fuzzy value+package matcher rung was guessing identities for
BOM lines whose MPN isn't in the catalog. Note: the parse itself was faithful — rows 94–100
(blank refs, repeated C1/C2/H1/J1/U1) genuinely exist in the file (second board section).
Fix: BOM reconcile now matches on exact MPN/LCSC identity only; everything else stays
unresolved ("To order") and goes to AI sourcing as-is. Fuzzy matching still serves Receive's
duplicate guard and bulk takeout, where a person confirms the hit.
