# AI-ORCHESTRATION.md — the complete AI ordering pipeline, for hands-on experimenting

> Everything the AI layer does today, exactly as coded (every claim carries a file:line so you can
> jump in and change it). Written for the first live experiment session: read §1–§2 to understand,
> §3–§6 for the knobs, §7 to run and watch it, §8 for experiments, §9 for the honest list of what
> has never touched a live service. Log problems in `docs/TESTING-FINDINGS.md` like everything else.

> **Update 2026-07-04:** the easiest way to watch everything is now the **`/ai_orc` observatory**
> (owner-only, by URL): live worker RAM/CPU heartbeats (migration 0008; cloud needs
> `scripts/cloud-sql/03-worker-telemetry.sql` once), the exact Opus/Sonnet prompts per run, and
> one lane per line with plan → candidates → why. Both system prompts + payload builders moved to
> **`worker/src/prompts.ts`** (shared with the page — this doc's §2 file:line pointers into
> planner.ts/item-agent.ts refer to text that now lives there). Agents also now receive the
> COMPLETE BOM line (description, partLink, dnp, voltage, custom columns — F-004). Browse-path
> safety (F-006): **`BROWSER_MAX_CONCURRENCY`** (default 2) is a GLOBAL semaphore over the one
> shared Chromium — a 100-line BOM drains in waves of N; PlaywrightDriver reuses one CDP
> connection; and the master plan now authors a per-line **`searchTerm`** the scraper types.

---

## 1. The big picture

```
Ordering workspace ── "Run ordering →"
   │  runOrderingAction → enqueueRun            lib/runs/enqueue.ts:177
   │    · aliases ALL business context here     lib/ai/alias.ts (buildPlannerContext :379)
   │    · dry-run ₹ estimate + ceiling (4×)     lib/runs/dry-run.ts:55,72
   │    · writes smark_agent_runs (planning)
   │    · writes 1 smark_order_jobs row PER to-order line (queued)
   ▼
WORKER (separate process, worker/) — 3s poll loop        worker/index.ts:280
   │  claim runs in 'planning' → ONE Opus call/run       worker/src/planner.ts:173
   │    plan = {searches[], skip[], narration}; plan attached to each job
   │  claim jobs FOR UPDATE SKIP LOCKED (RPC 0007)       worker/src/claim.ts:99
   │  per job → ONE Sonnet call/line (optional override) worker/src/item-agent.ts:119
   │    · deterministic ladder ALWAYS runs first (matcher-lite)
   │    · listings come from DistributorClients (mock/replay today)
   │    · results upserted idempotently (run,line,distributor)  worker/src/results.ts:55
   ▼
Run console — polling SSE, 1.5s snapshots                app/api/runs/[runId]/stream/route.ts
   ▼
Review (persisted forever) → Add to cart                 lib/runs/select.ts · lib/runs/cart.ts
```

Two hard rules baked in as code, not convention:
- **Opus plans, never browses** — the planner's system prompt forbids it AND the planner code has
  no distributor access at all (worker/src/planner.ts).
- **Package is never substitutable** — item-agent rejects any model override that names a
  package-mismatched listing (worker/src/item-agent.ts:181), independent of what the model says.

## 2. Prompt formation — where the words come from

### 2.1 Opus master planner (1 call per run)
- **System prompt:** `worker/src/planner.ts:22-44` — instructs JSON-only output of
  `{searches[], skip[], narration}`, forbids browsing, mandates every bomLineId lands in exactly
  one of searches/skip, package rung never skippable.
- **User message:** `buildMasterPrompt` `worker/src/planner.ts:46-77` — one JSON blob:
  `{project: <ALIASED label>, distributorSequence, orderingLadder, overallPriorities,
  activeRulesDigest: <ALIASED digest>, lines: [{bomLineId, refDesignators, qty, value,
  packageName, voltage, mpn, manufacturer, lcscPn, priorityNote}]}`.
- **Defensive net:** whatever the model returns passes `reconcilePlanWithLines`
  (`planner.ts:85-117`) which re-guarantees full line coverage (skip wins duplicates). So a bad
  plan degrades, never drops lines.
- Call params: `model = env.claudeModelMaster`, maxTokens 4000, effort "medium" (`planner.ts:173-198`).

### 2.2 Sonnet item agent (1 call per to-order line, and only an OVERRIDE)
- The deterministic ladder picks a best listing first, every time. The Sonnet call
  (`worker/src/item-agent.ts:159-189`) may override it and writes the "AI · why" sentence; it
  only fires when `ANTHROPIC_API_KEY` is set.
- **System prompt:** `item-agent.ts:36-45` — "must NOT contradict the objective flags",
  recommend only packageMatch:true candidates, return `{recommendedDistributorName, why}`.
- **User message:** `buildItemPrompt` `item-agent.ts:47-71` —
  `{line: {mpn, value, packageName, voltage, qtyNeeded, priorityNote}, candidates: [{distributorName,
  price, stockQty, mpnMatch, packageMatch, partStatus}], activeRulesDigest}`. maxTokens 800.

### 2.3 Small calls (app-side, `lib/ai/extract.ts`)
- **Receipt extraction** system prompt `:51-54` → `{lines:[{desc,qty,unit_price}], total}`;
  content is receipt text or an image block (`:56-66`). Always user-confirmed before any write.
- **MPN normalization** system prompt `:117-120` → `{normalized, confidence}`.
- Neither ever receives business context (names/projects) — `extract.ts:15-18`.

### 2.4 The alias layer (what the models can and cannot see)
- **Outbound:** `buildPlannerContext` (`lib/ai/alias.ts:379`) is structurally whitelisted — the
  input type has NO field for descriptions/notes, so they *cannot* leak. Project/client names →
  `PROJ-NN`/`CLIENT-X` codes; the mapping covers **every** project in the DB
  (`buildGlobalAliasMapping` `:432`), so a rule that names some *other* project is scrubbed too.
  The rules digest is aliased before injection (`lib/ai/digest.ts:86`).
- **Pass-through by design (search can't work otherwise):** MPN, LCSC PN, package/footprint,
  manufacturer, distributor names (`types/worker.ts:24-31`).
- **Inbound:** model-authored text (narration, skip reasons, per-line "why") is de-aliased before
  the UI renders it (`lib/runs/queries.ts:94,:230,:325`).
- CI leak test: `tests/invariants/alias-leak.test.ts`.

## 3. Models & the mock/live switch

| | App side (`lib/ai/client.ts`) | Worker side (`worker/src/claude-port.ts`) |
|---|---|---|
| Used for | receipt extraction, MPN normalize | planner + item agents |
| Real adapter | raw fetch → `api.anthropic.com/v1/messages` (`:145`) | same wire shape (`:87`) |
| Retry | none — single 90s-timeout attempt (`:100`) | 2 retries, exp backoff, on 429/5xx/network (`:106-130`) |
| Switch | `ANTHROPIC_API_KEY` set → real, else Mock (`getClaude :365`) | same check at `worker/index.ts:75` |
| Models | `CLAUDE_MODEL_MASTER` / `CLAUDE_MODEL_ITEM`; **empty ⇒ defaults `claude-opus-4-8` / `claude-sonnet-5`** (`:102-103` · `worker/src/env.ts:79-80`) | same defaults, read independently |

**Mock behavior worth knowing when demoing:** the mock receipt extractor returns a polished
fixture when the receipt contains "Digikey Order Confirmation" or "DK-DEMO-0001"
(`client.ts:239-252`), else a generic regex scrape. Mock planner/item responses are static
fixtures; mock distributor prices are deterministic per part (same query → same price), and
C14663 is hardcoded to the famous "2,568 in Box B-12" (`worker/src/distributors/mock.ts:33`).

## 4. Distributor clients (worker/src/distributors/)

- **Interface:** `{name, apiType, search(query) → listings}` (`types.ts:39`).
- **REST clients — written to public API docs, NEVER exercised live** (§9): Digikey (OAuth2
  client-credentials, token cached; `digikey.ts`), Mouser (key param; `mouser.ts`), element14
  (key + storeId default `in.element14.com`; `element14.ts`).
- **Record/replay:** every REST search wraps `withRecordReplay` (`record-replay.ts`). With a key
  present → **record mode** (hits live, saves fixture to
  `worker/tests/fixtures/<distributor>/<slug>.json`); no key → **replay** (fixture or a clear
  error). First live session with a Digikey/Mouser key will *create* the fixture library.
- **MockDistributor** covers everything else: unlisted sites, browse-type sites with no driver
  (`index.ts:64-85`).

## 5. Browser / Chromium (the Phase-0-gated path)

- `BrowserDriver` interface: `worker/src/browser-driver.ts:45`. Three impls:
  ComputerUse + Browserbase = **stubs that always throw** (`:62-73`); **PlaywrightDriver** is
  code-complete (`:92-121`).
- **Double gate to go live:** `BROWSER_DRIVER=playwright` selects it, AND
  `ALLOW_LIVE_BROWSER=1` must be set or `searchPart` throws (`:17-26`). Tests/CI can never
  accidentally browse.
- **Local vs remote Chromium:** unset `PLAYWRIGHT_WS_ENDPOINT` → `chromium.launch({headless})`;
  set it (e.g. your Hetzner box's ws URL incl. auth token) → `chromium.connectOverCDP(...)`
  (`:103`). Closing disconnects the session, never kills the remote browser.
- **Honesty note:** the scraping selectors (`:143-164`) are educated guesses, never verified
  against real LCSC — expect to iterate on them in the supervised session.
- **Spike harness (Phase-0):** `cd worker && bun run spike` — runs ~30 real TMCS lines
  (3 archetypes: full-MPN / LCSC-only / value+package-only) through the mock pipeline at 5-way
  concurrency and prints hit-rate/latency/cost. Today it ends with "AWAITING KEYS". The real
  go/no-go (≥90% correct, manageable anti-bot, acceptable ₹) is measured live per
  `docs/spike-browser-worker.md` — do that WITH Claude in a supervised session.

## 6. Money controls (read before the first live run)

- **Dry-run estimate** (workspace UI): lines × tier depth × 2500 tokens + one 4000-token planner
  call, flat ₹1.5/1k tokens (`lib/runs/dry-run.ts:25-62`) — deliberately rough and app-side.
- **₹ ceiling = 4× estimate, min ₹100**, stamped into the run config at enqueue
  (`dry-run.ts:72-74`).
- **Worker enforces it PRE-SPEND**: before each job it checks a conservative next-call estimate
  against the tally (`worker/index.ts:183-191`); tripping it fails the remaining jobs + the run
  with "₹ ceiling reached" (`worker/src/runs.ts:94`). The tally survives worker restarts (seeded
  from persisted `actual_cost`, `worker/index.ts:101`).
- **Real rates** (worker): opus $5/$25, sonnet $3/$15 per M tokens, unknown model → opus-tier
  over-estimate, ₹83/USD (`worker/src/caps.ts:134-141`). `actual_cost` accumulates per call and
  feeds the run card + the Expenses AI-spend meter.
- **Per-site concurrency caps beat every knob**: Digikey 3 · Mouser 3 · element14 2 · **LCSC 1 ·
  Unikey 1** · unlisted 1 (`caps.ts:25-33`), enforced by a semaphore around every search
  (`item-agent.ts:130`). Tier fanout additionally clamped to 8 (`caps.ts:36`).

## 7. Running and watching it

### 7.1 Start (mock mode — safe, free, works today)
```powershell
# terminal 1 — app (local stack up, seeded)
bun run dev
# terminal 2 — worker
cd worker
bun install            # first time
# worker/.env.local needs ONLY: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
#   (values from `bunx supabase status`), WORKER_SHARED_SECRET=anything
bun run dev            # 3s poll loop; logs every claim/plan/result
```
Then: project → BOM → Set up ordering → tier → **Run ordering →** and watch the console stream.
(E2E uses `scripts/e2e-drain-agent-runs.ts` to tick the same loop without a worker process —
handy for scripted experiments too.)

### 7.2 Go live (one small BOM first!)
Add to `worker/.env.local`: `ANTHROPIC_API_KEY=...` (models default sensibly, §3). Optionally
distributor keys — their first live searches auto-record fixtures (§4). Leave `BROWSER_DRIVER`
unset. Expect single-digit ₹ for a small run; verify the run card's est vs actual and the
Expenses meter afterwards.

### 7.3 Watching the DB (Studio: http://127.0.0.1:54323 → SQL)
```sql
-- run state + spend
select status, est_cost, actual_cost from smark_agent_runs where id = '<runId>';
-- jobs by status
select status, count(*) from smark_order_jobs where run_id = '<runId>' group by status;
-- results per line (idempotency key: run_id + bom_line_id + distributor_id)
select * from smark_agent_results where run_id = '<runId>' order by bom_line_id;
-- stuck jobs (what the 5-min stale-reclaim sweeps)
select * from smark_order_jobs where status='claimed' and claimed_at < now() - interval '5 minutes';
```

### 7.4 When something breaks
- Run stuck in **planning** → worker not running, or config failed validation (worker log; run
  flips to failed if malformed).
- Jobs stuck **claimed** → worker died mid-job; the 5-min stale sweep requeues (5 attempts, then
  parked failed) — `worker/src/claim.ts:150`.
- Run **failed** with empty lanes → check `smark_agent_runs.plan.failureReason` in the DB — the
  console does NOT surface it yet (known gap, §9).
- SSE console frozen → it's 1.5s polling, not realtime; refresh reconnects
  (`hooks/use-run-stream.ts`).

## 8. Experiments to try (in order)

1. **Mock run, read everything** — full pipeline, zero cost. Judge narration, lanes, review.
2. **Prompt surgery** — edit the planner system prompt (`worker/src/planner.ts:22`), restart the
   worker, rerun, diff plans. Same for the item-agent's "why" style (`item-agent.ts:36`).
3. **Alias audit** — before a live run, log `buildMasterPrompt(config)` output (worker log) and
   read it as the model would: any real name visible = S1 finding.
4. **First live run** — key in, one 5-line BOM, economy tier. Watch spend land.
5. **Ceiling trip** — set a run's est absurdly low (or temporarily raise `RUPEES_PER_1K_TOKENS`)
   and confirm the run fails cleanly with "₹ ceiling reached", not silent overspend.
6. **Distributor recording** — add a Mouser key, run a line with a known MPN, inspect the fixture
   file it records under `worker/tests/fixtures/mouser/`.
7. **Rules loop** — leave review feedback ("prefer LCSC for caps") → approve in AI Memory
   (digest v++) → rerun → check the plan's `ruleHit` citations honor it.
8. **Remote Chromium (supervised, last)** — `BROWSER_DRIVER=playwright`, `ALLOW_LIVE_BROWSER=1`,
   your `PLAYWRIGHT_WS_ENDPOINT` — the Phase-0 measurement per `docs/spike-browser-worker.md`.

## 9. Known gaps & stubs in this path (don't re-discover them)

- REST distributor request shapes **never exercised live** (`digikey.ts:5-12` etc.) — expect
  field-name fixes on first real calls; record/replay makes those cheap.
- Browser scraping selectors unverified against real sites (`browser-driver.ts:143-164`).
- ComputerUse/Browserbase drivers are throw-stubs pending Phase-0 go/no-go.
- Run console doesn't show `plan.failureReason` for failed runs (read model gap,
  `lib/runs/queries.ts:83-97`).
- "AI · why" lives in `smark_agent_results.raw.why` — no dedicated column yet
  (`worker/src/results.ts:18-27`).
- AI-Memory's "which rule hit which line" log is a best-effort proxy from feedback provenance
  (`lib/ai/queries.ts:63-72`), not a per-result citation column.
- `actual_cost` accumulation is single-worker-safe only — horizontal scaling needs an atomic
  RPC (`worker/src/runs.ts:172-179`).
- No DB unique constraint behind the result upsert key — idempotency is app-enforced
  (`worker/src/results.ts:55-83`).
