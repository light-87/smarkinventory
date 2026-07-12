# SmarkStock Desktop — companion app (P1: runner core)

The browser-agent sourcing executor (plan: SmarkStock Desktop, F-013 pivot).
Runs on the user's Windows PC: real Brave + the user's OWN Claude Code
session do the sourcing; results land back in the web app's review screens.

## P1 usage (CLI — the P2 Tauri UI wraps this same flow)

### One-time manual setup (per machine — everything else below is automatic)

Only two things a human has to do by hand on a fresh machine:
1. **Sign into the Claude Code CLI** (`claude` → sign in with your own
   subscription/API key). This can't be scripted — it's your own account.
2. **Install/enable a browser MCP plugin in Claude Code** so it has browser
   tools available. Ideally this is `@playwright/mcp` resolving automatically
   via the generated `.mcp.json` (see below) — if `bunx @playwright/mcp`
   fails to auto-download on a given machine (seen on Windows with
   antivirus/OneDrive file-locking — see `docs/TESTING-FINDINGS.md`), install
   it manually in Claude Code as a fallback.

Everything else — Brave launch, session generation, sending the sourcing
instruction, watching for completion, uploading — is automatic once those two
are done.

```powershell
# needs: web app running (pointed at the same Supabase), Brave or Chrome,
# the claude CLI installed & signed in (subscription or API key — user's choice)
$env:DESKTOP_EMAIL = "you@example.com"; $env:DESKTOP_PASSWORD = "…"
bun --env-file=.env.cloud.local run desktop/runner/run.ts --bom <bomId> --lines 5 --web http://localhost:3000
```

What happens:
1. Signs in with your normal web login → creates a desktop run via
   `POST /api/desktop/run-context` (status "running", no job rows — the
   always-on worker never touches desktop runs).
2. Pre-fetches DigiKey/Mouser/element14 via their APIs (free, exact).
3. Launches the dedicated Brave (`~/.smarkstock-browser` profile, CDP :9333).
4. Generates a Claude Code session folder (`~/.smarkstock-sessions/<runId>`):
   CLAUDE.md = ordering rules + BOM lines + API candidates + strict
   results.json contract; .mcp.json = playwright MCP over CDP; pre-approved
   settings.
5. Opens a `claude` terminal there running `--dangerously-skip-permissions`
   with the sourcing instruction already sent — nothing to press. You
   supervise (solve any CAPTCHAs it hits); it browses LCSC/gaps and writes
   results.json line by line. The skip-permissions flag requires an explicit
   `Bash(claude --dangerously-skip-permissions*)` allow rule in
   `.claude/settings.local.json` (gitignored, project-scoped) — add it
   yourself before running; it won't be silently assumed.
6. The runner watches results.json, recomputes the objective rungs in code
   (MPN match, mandatory package match — agent text never decides those),
   and uploads via `POST /api/desktop/results` → run flips to REVIEW on web.

## Files

- `runner/run.ts` — CLI orchestrator
- `runner/brave.ts` — dedicated-browser launch (browserCopilot.ts pattern)
- `runner/prefetch.ts` — distributor REST APIs (live payload shapes, F-013)
- `runner/session.ts` — session folder generation (the agent's contract)
- `runner/transform.ts` — results.json → API payload + objective-rung guard
