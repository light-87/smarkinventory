# worker/start-live-windows.ps1 — run the LIVE worker on this Windows machine (F-008).
#
# Why Node and not Bun: playwright's client is broken under Bun-on-Windows —
# both the CDP websocket and the local pipe transport hang forever (verified
# 2026-07-05). Under Node the same code connects in ~1.5s. On Linux deploys,
# `bun run start` stays the entry point.
#
# Why a LOCAL browser: LCSC sits behind Akamai, which blocks the Hetzner
# datacenter IP outright (Access Denied regardless of user agent), so LCSC
# scraping must run from a residential/office IP for now. Setting
# PLAYWRIGHT_WS_ENDPOINT to ' ' (a single space) forces the local launch —
# PowerShell DELETES a var assigned '', which would let --env-file re-fill
# the remote endpoint; worker/src/env.ts treats whitespace-only as unset.
#
# Also: browserless on the box kills CDP sessions at its session timeout —
# fine for short jobs, wrong for a long-lived scraping worker. Revisit when
# a residential proxy is in place.

$env:BROWSER_DRIVER = 'playwright'
$env:ALLOW_LIVE_BROWSER = '1'
$env:PLAYWRIGHT_WS_ENDPOINT = ' '   # single space = force local Chromium (see header)
$env:BROWSER_MAX_CONCURRENCY = '2'

Set-Location $PSScriptRoot
node --env-file=..\.env.cloud.local --import tsx index.ts
