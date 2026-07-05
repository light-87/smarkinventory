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

## Processed log

<!-- Claude moves resolved entries here with commit hashes, so the Findings section stays short -->

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
