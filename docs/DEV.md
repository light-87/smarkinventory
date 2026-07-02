# SmarkStock — local development runbook

This is the practical "how do I run this thing" doc. For *what* to build, read
`FEATURES.md` + `plan/`. For the test strategy this runbook operationalizes,
read `plan/TESTING.md`. This file only covers commands and local setup.

Stack reminder (full detail in `~/.claude/CLAUDE.md` + `FEATURES.md` §3):
**Bun only** (never npm/yarn), Next.js App Router + TypeScript, Supabase
(Postgres + Auth + Realtime), Cloudflare R2 for files, Claude API for AI.

---

## 1. Prerequisites

| Tool | Why | Check |
|---|---|---|
| [Bun](https://bun.sh) | package manager + JS runtime + test runner for this whole repo | `bun --version` |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running) | backs local Supabase (`supabase start` boots Postgres/Auth/Realtime/Studio as containers) | Docker Desktop icon shows "running" |
| Git | source control | `git --version` |

You do **not** need a separate Node.js install — Bun is the runtime. You do
**not** need the Supabase CLI installed globally — every command below uses
`bunx supabase …`, which fetches it on demand (Supabase's CLI explicitly
blocks `npm install -g`; `bunx`/`npx` ad-hoc invocation is their supported
path, and CI uses the official `supabase/setup-cli` action instead).

---

## 2. First-time setup

```powershell
# 1. Install dependencies
bun install

# 2. Create your local env file (never commit .env.local)
Copy-Item .env.local.example .env.local

# 3. Start local Supabase (first run pulls several Docker images — a few
#    minutes on a clean machine; fast after that)
bunx supabase start
```

`supabase start` prints an API URL + anon key + service_role key when it
finishes. Copy those into `.env.local` against the matching names from
`.env.local.example`:

| `supabase start` output | `.env.local` variable |
|---|---|
| `API URL` | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon key` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role key` | `SUPABASE_SERVICE_ROLE_KEY` |

Lost the printout? Re-print anytime with `bunx supabase status`.

```powershell
# 4. Apply every migration under supabase/migrations (+ supabase/seed.sql
#    once the fixtures package adds one — plan/TESTING.md §4) against a
#    clean local database
bunx supabase db reset

# 5. Run the app
bun run dev
```

App is now at `http://localhost:3000`. AI (`ANTHROPIC_API_KEY`) and R2
(`CLOUDFLARE_R2_*`) keys are only needed once the features that call them
land — leave them blank for core inventory/UI work.

---

## 3. Everyday commands

| Task | Command |
|---|---|
| Install/update deps | `bun install` |
| Start local Supabase | `bunx supabase start` |
| Stop local Supabase | `bunx supabase stop` |
| **Reset** local DB (reapplies every migration + seed, wipes local data) | `bunx supabase db reset` |
| Re-print local Supabase URL/keys | `bunx supabase status` |
| Open Supabase Studio (local) | http://127.0.0.1:54323 (while `supabase start` is up) |
| Dev server | `bun run dev` |
| Typecheck | `bun run typecheck` |
| Lint | `bun run lint` |
| Unit + invariants + integration (§4) | `bun test` |
| E2E — desktop-1280 + mobile-360 (§4) | `bunx playwright test` |
| E2E, watch it run in a real browser window | `bunx playwright test --headed` |
| Open the last E2E HTML report | `bunx playwright show-report` |
| Install Playwright's browser (once per machine) | `bunx playwright install` (Windows/macOS) — CI uses `--with-deps`, a Linux-only apt flag; don't add it locally on Windows |
| Production build (what Vercel runs) | `bun run build` |

---

## 4. Testing layers (plan/TESTING.md §2)

```
tests/unit          pure logic (matcher, demand math, price stamping…)   } bun test
tests/integration   local-Supabase-backed (migrations, RLS matrix, views) }  — same
tests/invariants    cross-feature invariants (plan/TESTING.md §5)        }  command
tests/e2e           Playwright only — desktop-1280 + mobile-360            bunx playwright test
```

**One command, two moods.** `bun test` always scans `tests/unit`,
`tests/integration` and `tests/invariants` (`bunfig.toml` scopes its `root`
there). DB-backed suites gate themselves through
`tests/helpers/supabase.ts`'s `describeWithDb` — no local Supabase env →
they report `skip`, not `fail`, so plain `bun test` stays green without
Docker running. Run `bunx supabase start` first (env vars land in your shell
automatically only in CI; locally, make sure `.env.local` has the local
URL/keys from step 2 above and that your dev process loads it) to exercise
the RLS matrix and DB constraint suites for real.

**`tests/e2e` never runs under `bun test`.** Bun's default test-file
matching also globs `*.spec.ts`, so without a guard a bare `bun test` would
try to load Playwright specs and crash (`@playwright/test`'s `test()` throws
when called outside `playwright test`'s own runner). Every file under
`tests/e2e` starts with a `process.versions.bun` guard that no-ops under Bun
— see the comment in `tests/e2e/smoke.spec.ts` if you're adding a new one.
Always run E2E via `bunx playwright test`.

**Adding a `test.todo(...)` skeleton:** the installed `@types/bun` requires
the callback argument — `test.todo("description")` alone is a **type
error** here (`tsc` will fail with "Expected 2-3 arguments, but got 1"),
even though Bun's runtime accepts the label-only form. Always write
`test.todo("description", () => {});`. The callback is never invoked under
normal `bun test` (todos are skipped, not run) — it only exists to satisfy
the type signature.

---

## 5. Windows notes

- Both PowerShell and Git Bash work — `package.json` scripts are plain
  cross-platform commands (`next dev`, `tsc --noEmit`, …), not
  shell-specific one-liners.
- Docker Desktop must be **running** before `bunx supabase start`; if it
  exits immediately with a connection error, that's almost always Docker
  Desktop not started yet.
- Port already in use (3000 for the app; 54321–54324 for
  API/DB/Studio/Inbucket): find and stop the stray process —
  `Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess`
  in PowerShell — or just `bunx supabase stop` if it's a leftover stack.
- If `bun install` ever complains about path length on a deeply nested
  package, enable Windows long paths (`git config --system core.longpaths
  true`, plus the Windows 10/11 long-paths policy) — uncommon with Bun's
  install layout, but it's the standard fix.

---

## 6. CI pipeline (`.github/workflows/ci.yml`)

Five jobs, mirroring `plan/TESTING.md` §7 as far as this stage of the build
supports (local Supabase + local dev server — **not yet** a Vercel preview
deploy + seeded Supabase branch DB; that fuller pipeline is a Phase-3/4
upgrade once those cloud projects exist, per `FEATURES.md` §19):

| Job | What | Mirrors locally |
|---|---|---|
| `checks` | typecheck + lint + `bun test` (DB suites self-skip) | §3 typecheck/lint/`bun test` rows |
| `integration` | `supabase start` → `supabase db reset` → `bun test` again (DB suites run for real) | §2 steps 3–4 + `bun test` |
| `build` | `bun run build` | §3 build row |
| `playwright` | install browsers, `bunx playwright test`, uploads `playwright-report/` + `test-results/` **only on failure** | §3 E2E rows |
| `gate` | fans in the four jobs above; fails if any failed/cancelled | — |

Trigger: every push to `main` and every pull request (`workflow_dispatch`
for manual runs). Concurrent runs on the same ref cancel the older one.

### Making this actually deploy-blocking

Per `plan/TESTING.md` §1 ("green build = deployable; red blocks"), a
workflow file alone doesn't stop a bad build from shipping — two things need
enabling on top of it, both one-time:

1. **GitHub branch protection** — repo Settings → Branches → add a rule for
   `main` → "Require status checks to pass before merging" → select the
   **`gate`** job (the fan-in job above; requiring just this one check is
   equivalent to requiring all five, and survives individual job renames).
2. **Vercel** — Vercel's Git integration deploys previews on every push by
   default, independent of GitHub Actions. For `main`→production deploys to
   actually respect this gate, either (a) rely on branch protection to keep
   red code off `main` in the first place (simplest, matches "owner owns all
   accounts, small team" from `~/.claude/CLAUDE.md`), or (b) turn off
   Vercel's automatic production deploys and instead call `vercel deploy
   --prod` as a final CI step gated behind `needs: [gate]` once a Vercel
   project + token exist. Neither is wired yet — no Vercel project is linked
   at this stage of the build (`FEATURES.md` §19 Phase 1).
