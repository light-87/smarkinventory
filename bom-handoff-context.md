# BOM Sourcing Fixes — Handoff Context (2026-07-20)

> Read this to catch up on what the **"ordering issues" session** changed in the
> shared `smark_inventory` repo. All work is committed to `main` and deployed to
> prod (Vercel), plus a desktop app release (v0.6.0) and one prod Supabase SQL run.
> If you're continuing other work (e.g. Mark's talk / the two other bugs), the
> only overlap is the shared files listed at the bottom.

---

## The problem this session fixed

The **desktop** BOM sourcing agent sourced only **3 of a 129-line BOM** and marked
the run `"complete"`. Digging in found 3 real bugs. The sourcing agent's own
"10 bugs" self-critique was **mostly confabulation** — it blamed the prompt for
rules the prompt already contained. Don't chase those (see "Not bugs" below).

## Bugs found (real) → how we fixed them

1. **Only 68 of 129 lines reached the agent, in scrambled order.**
   The desktop run filtered lines to net-demand (`match_state !== "in_stock"`) and
   the downstream `smark_bom_lines` fetches had no `ORDER BY line_no`. The prompt
   also **hardcoded the reduced count** ("68 lines"), so the agent believed 68 was
   the whole BOM.
   → **Fix:** desktop runs now source the **full BOM (all 129)**, in-stock lines
   shown as price-comparison context (not filtered); added `ORDER BY line_no`
   everywhere. (User decision: source all 129 for price-checking.)

2. **Fake completion was silently accepted.** The agent wrote 68 results entries —
   3 real, 64 empty `candidates:[]`, `complete:true` — and the server marked the
   BOM "sourced" anyway. The completion guardrail was **count-only** (empty
   placeholders satisfied it) and there was **no server-side coverage check**.
   → **Fix:** a **coverage guardrail** in `lib/desktop/sync.ts` — the BOM is only
   marked `sourced` (which unblocks the cart) when every line has a real result or
   a genuine skip. The review shows an **incomplete banner** + an **"Accept anyway"**
   owner override. Rewrote the agent's run-to-completion directive (real-result
   definition, retry threshold, URL-encoding, no screenshots, LCSC-only clarity).

3. **A leaked test rule polluted every run.** `tests/integration/bom-pipeline-enqueue-alias-leak.test.ts`
   approved a learned rule against the **shared Supabase**; a crashed run left it
   orphaned and it leaked verbatim ("Alias Leak Project A … expedite via Digikey")
   into every run's "Buyer's standing rules."
   → **Fix:** ran `scripts/cloud-sql/02-purge-leaked-rule.sql` in prod (digest is
   now v5 = "No active rules"); hardened the test to roll back the digest doc
   version it creates so it can't re-poison the shared DB.

Also fixed (found via the live agent): raw search URLs weren't URL-encoded (broke
on `0.1%`), screenshots timing out (prompt now says use text snapshots), and the
sourcing model was **Haiku** (too weak → upgraded to **Sonnet**).

## Not bugs (confabulated — do not "fix")

- "Prompt missing MPN / lowest-price / active-status rules" — **false**, they're in
  `desktop/runner/session.ts` (ordering rules 1–7).
- "Unikey is a bogus distributor" — **false**, it's real (unikeyic.com).

## Also fixed — P6 (reconcile sibling-stock netting)

`reconcile.ts` compared each BOM line's need against a matched part's **full** stock,
so several lines sharing one part could all be stamped `in_stock` even when their
combined need exceeded stock — hiding a real shortfall from the sourcing split and
inflating the "In stock" count. `reconcileLines` now **draws each part's stock down
as lines claim it** (in `line_no` order, which `runReconcile` now enforces): a line
is `in_stock` only if the REMAINING stock covers its whole need; an uncovered line
goes `to_order` and reserves nothing. Mirrors, within one BOM, the aggregate netting
`v_part_demand` already does across BOMs. **This correctly changes the visible
in-stock / to-order counts** on BOMs with over-committed repeated parts.
`reconcileLine` (the single-line primitive used by unit tests) is unchanged.

**Nothing is deferred now — the whole plan is done.**

---

## Deploy status (all live)

| Item | State |
|---|---|
| Server fixes (full BOM, guardrail, directive, review UI) | **deployed to prod** (`main`) |
| Reconcile sibling-stock netting (P6) | **deployed to prod** (`main`) |
| Prod Supabase leaked-rule cleanup SQL | **run** (digest v5 clean) |
| Desktop app **v0.6.0** (Sonnet) | **released** — installer on R2, `version.ts` bumped, update nag live |

**Commits on `main`** (in order): `cbe75e6` (full BOM + guardrail + Sonnet + SQL +
test) → `caa0173` (coverage banner + Accept-anyway) → `a8a8999` (all-129 review
cards) → `b395ab2` (publish 0.6.0) → `6cfc9d3` (P6 reconcile stock-netting).

## Desktop app / reinstall mechanics (important context)

The desktop sourcing agent is a **compiled Tauri sidecar** (`bun build --compile`
of `desktop/runner/run.ts` → `smarkstock-runner-x86_64-pc-windows-msvc.exe`), bundled
into the installer. So:

- **Model or prompt-template changes in `desktop/runner/**` need a full desktop
  release + reinstall.** The release steps: recompile the sidecar → `cd desktop/app
  && bun run tauri build` → upload the NSIS `…_x64-setup.exe` to R2 via
  `scripts/upload-desktop-installer.ts` (uses `.env.cloud.local`, a **fixed** R2 key)
  → bump `lib/desktop/version.ts` → deploy. **Upload BEFORE the version bump** or the
  update nag serves a stale installer. All 5 version markers must match:
  `desktop/app/package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
  `src-tauri/Cargo.lock`, `lib/desktop/version.ts`.
- **Server-controlled fields reach installed clients with NO reinstall** — the run's
  `config.lines` and the injected `overallPriorities` directive are built server-side
  in `lib/runs/enqueue.ts` (`createDesktopRun`). That's why the full-BOM fix + the
  hardened directive + the coverage guardrail all took effect the moment the server
  deployed, even for a client still on the old binary.
- **Right now:** v0.6.0 is published. Krunal (the desktop user) must accept the
  in-app "update available" nag to reinstall and get **Sonnet**. Until he does, he
  runs v0.5.0 (Haiku) but already gets full-BOM + guardrail + clean rules from the
  server.

## Shared files this session touched (watch for conflicts)

- `lib/runs/enqueue.ts` — full-BOM line selection, hardened directive
- `lib/runs/queries.ts`, `lib/runs/types.ts` — coverage threading, all-129 lanes, `RunCoverage`, `SourcingLane.inStock`
- `lib/desktop/sync.ts` — coverage guardrail
- `lib/desktop/version.ts` — 0.6.0
- `app/(app)/projects/[projectId]/runs/[runId]/review/page.tsx` + `actions.ts` — coverage gate + `acceptRunCoverageAction`
- `components/review/review-view.tsx`, `coverage-banner.tsx` (new), `review-line-card.tsx`
- `lib/bom/reconcile.ts`, `lib/bom/service.ts` — sibling-stock netting (P6) + ordered reconcile fetch
- `desktop/runner/session.ts` — Sonnet + prompt text
- `desktop/app/**` version markers
- `scripts/cloud-sql/02-purge-leaked-rule.sql` (new), `tests/integration/bom-pipeline-enqueue-alias-leak.test.ts`, `tests/unit/review-xlsx.test.ts`
