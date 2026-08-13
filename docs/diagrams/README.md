# SmarkStock architecture diagrams

Reproducible VibeView board diagrams of the SmarkStock system. Each diagram is
saved as a PNG (the picture) plus `*.draw.json` / `*.place.json` (the board
elements) so it can be re-rendered onto the VibeView board anytime.

| Diagram | Files | What it shows |
|---|---|---|
| **System architecture** | `smarkstock-system.*` | Every component + who uses what: web app surfaces, Supabase, R2, Claude API, the desktop Claude-Code sourcing engine, client portal, legacy worker. |
| **AI ordering pipeline** | `smarkstock-ordering-pipeline.*` | The 11-step live sourcing path: BOM → run-context → REST prefetch → Claude Code (Haiku) + Brave → results → review → cart → PO → receipt → arrival. |
| **Notifications & client comms** | `smarkstock-notifications.*` | In-app bell notifications, daily client-reminder emails (Resend via Vercel Cron), portal comments looping back to the owner. |

> Architecture note: the **live** AI part-sourcing path is the **SmarkStock Desktop
> app** (Tauri, on the owner's PC) spawning the owner's own **Claude Code CLI
> (Haiku)** driving a real **Brave** browser via Playwright MCP. The always-on
> Opus/Sonnet cloud worker (`worker/`) exists but is **mock-only / superseded**.

## View them

Open any `*.png` in an image viewer.

## Re-render onto the VibeView board

VibeView must be running. From this folder:

```bash
node redraw.mjs smarkstock-system            # or ...-ordering-pipeline / ...-notifications
node redraw.mjs smarkstock-system dev         # target the dev instance instead of prod
```

`redraw.mjs` reads the running app's token from `~/.vibeview/runtime.json`
(`runtime-dev.json` for dev), then opens a board, clears it, and posts the saved
`draw` + `place` payloads.

> Placed icons auto-scale (VibeView ≥ the build with icon auto-scaling). On older
> builds they render at native size — rebuild/reinstall VibeView first.
