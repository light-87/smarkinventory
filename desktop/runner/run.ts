#!/usr/bin/env bun
/**
 * desktop/runner/run.ts — P1 CLI for the SmarkStock Desktop companion
 * (plan: SmarkStock Desktop; the Tauri UI wraps this same flow in P2).
 *
 *   bun run desktop/runner/run.ts --bom <bomId> [--lines 5] [--web http://localhost:3000]
 *
 * Env (e.g. via `bun --env-file=.env.cloud.local`):
 *   DESKTOP_ACCESS_TOKEN — an already-issued Supabase access token (the P2
 *     Tauri app's own login session). Takes priority over email/password —
 *     used by the desktop app sidecar so it doesn't have to sign in twice.
 *   DESKTOP_EMAIL / DESKTOP_PASSWORD — the user's normal web login, used only
 *     when DESKTOP_ACCESS_TOKEN isn't set (standalone CLI usage).
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — required only
 *     for the email/password sign-in path.
 *   DIGIKEY_* / MOUSER_API_KEY / ELEMENT14_API_KEY (optional — REST prefetch)
 *
 * Flow: sign in → POST /api/desktop/run-context → REST prefetch → launch
 * dedicated Brave (CDP) → generate Claude Code session folder → open the
 * `claude` terminal (THE USER'S OWN subscription/key — they supervise) →
 * watch results.json → validate/transform → POST /api/desktop/results →
 * print the web review link.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { WorkerRunConfig } from "../../types/worker";
import { ensureBrowser, CDP_PORT } from "./brave";
import { hasRestDistributor, prefetchAll } from "./prefetch";
import { generateSession } from "./session";
import { AgentResultsFileSchema, transformResults } from "./transform";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

/**
 * readFileSync + JSON.parse, tolerant of a leading UTF-8 BOM (F-018). The
 * agent rewrites results.json from its Claude Code terminal; when it does so
 * via Windows PowerShell (Set-Content/Out-File default to UTF-8-WITH-BOM), the
 * file gains a BOM prefix that raw JSON.parse rejects with "Unexpected
 * token". readResults() then treated every post-seed snapshot as "unreadable
 * mid-write" and silently synced nothing — the run showed 0/N on the web
 * despite a full results.json. Node's utf8 read does NOT strip the BOM, so we
 * strip it here for every agent-writable file we parse.
 */
function readJsonFile(file: string): unknown {
  const s = readFileSync(file, "utf8"); return JSON.parse(s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);
}

/**
 * Storage adapter over the desktop app's OWN durable auth file (F-020). The app
 * and this runner are two supabase-js clients on ONE session; when the runner
 * rotates the refresh token (freshAccessToken → refreshSession), the app's saved
 * copy would go stale and the app would log out after the run. Pointing the
 * runner's client at the SAME file + storageKey the app uses
 * (%APPDATA%/com.smarkstock.desktop/auth-session.json, a { key: value } map —
 * see desktop/app/src/lib/supabase.ts + src-tauri auth_store_*) makes supabase-js
 * persist every rotated session straight back, so the app picks up the current
 * tokens on next launch. Letting supabase-js own (de)serialisation keeps the
 * format byte-identical on both sides. Best-effort: any fs error just degrades
 * to the old behaviour (a possible re-login), never crashes the run.
 */
const APP_AUTH_STORAGE_KEY = "smarkstock-desktop-auth";
function appAuthStorage() {
  const roaming = process.env.APPDATA;
  if (!roaming) return undefined; // not on Windows / no roaming dir → no write-back
  const file = path.join(roaming, "com.smarkstock.desktop", "auth-session.json");
  const readMap = (): Record<string, string> => {
    try {
      return existsSync(file) ? (readJsonFile(file) as Record<string, string>) : {};
    } catch {
      return {};
    }
  };
  const writeMap = (map: Record<string, string>) => {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(map), "utf8");
    } catch {
      // best-effort — a failed write-back only means the app may need a re-login
    }
  };
  return {
    getItem: (key: string) => readMap()[key] ?? null,
    setItem: (key: string, value: string) => {
      const map = readMap();
      map[key] = value;
      writeMap(map);
    },
    removeItem: (key: string) => {
      const map = readMap();
      delete map[key];
      writeMap(map);
    },
  };
}

// Upload-only mode: skip run-context/prefetch/browser and just re-POST an
// existing run's already-written results.json (the "Sync latest again" button,
// v0.4.0). Needs --run <runId> to locate ~/.smarkstock-sessions/<runId>/.
const uploadOnly = process.argv.includes("--upload-only");
const runArg = arg("run");
const bomId = arg("bom");
// Resume mode (v0.7.0): re-open an existing on-disk session for --resume <runId>
// — reuse its config.json + results.json + CLAUDE.md, relaunch the browser and
// Claude terminal, and keep syncing. No new run is created; the same runId's
// results are updated in place. Powers the desktop "Past runs → Resume" list.
const resumeRunId = arg("resume");
if (!uploadOnly && !resumeRunId && !bomId) {
  console.error("usage: bun run desktop/runner/run.ts --bom <bomId> [--lines N] [--web http://localhost:3000]");
  process.exit(1);
}
const lineLimit = arg("lines") ? Number(arg("lines")) : undefined;
const webBase = arg("web") ?? "http://localhost:3000";
// Presence-based flag: force sourcing every to-order line, ignoring lines
// already sourced by the BOM's previous run (default is to reuse them).
const resourceAll = process.argv.includes("--resource-all");
// The app writes this file to ask for a graceful stop (final flush + exit),
// since a hard kill on Windows skips the SIGTERM handler.
const stopFile = process.env.DESKTOP_STOP_FILE ?? null;

// ── 1. Sign in (or reuse a token the desktop app already has) ───────────────
// A 43-line supervised run easily outlives the ~1h Supabase access-token
// lifetime, and the final results upload was dying with 401 "Not signed in".
// We keep a live Supabase client here and refresh the token right before the
// upload (freshAccessToken() below). The desktop app now hands us the refresh
// token + project URL/key so the DESKTOP_ACCESS_TOKEN path can refresh too.
let token: string;
let sessionClient: ReturnType<typeof createClient> | null = null;
const providedToken = process.env.DESKTOP_ACCESS_TOKEN;
const supaUrl = process.env.DESKTOP_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaAnon = process.env.DESKTOP_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (providedToken) {
  token = providedToken;
  const refreshToken = process.env.DESKTOP_REFRESH_TOKEN;
  if (refreshToken && supaUrl && supaAnon) {
    // persistSession + the app's own storage: refreshSession() write-backs the
    // rotated session so the app stays logged in (F-020). autoRefreshToken stays
    // OFF — we refresh explicitly in freshAccessToken(); a background refresher
    // fighting the app would reintroduce the rotation conflict.
    const storage = appAuthStorage();
    sessionClient = createClient(supaUrl, supaAnon, {
      auth: storage
        ? { persistSession: true, autoRefreshToken: false, storage, storageKey: APP_AUTH_STORAGE_KEY }
        : { persistSession: false, autoRefreshToken: false },
    });
    // Seed the client with the app's session so refreshSession() works later.
    await sessionClient.auth.setSession({ access_token: providedToken, refresh_token: refreshToken });
    console.log("✓ using the desktop app's signed-in session (auto-refresh enabled)");
  } else {
    console.log("✓ using the desktop app's signed-in session");
  }
} else {
  const email = process.env.DESKTOP_EMAIL;
  const password = process.env.DESKTOP_PASSWORD;
  if (!email || !password) {
    console.error("Set DESKTOP_EMAIL and DESKTOP_PASSWORD (your normal SmarkStock web login), or DESKTOP_ACCESS_TOKEN.");
    process.exit(1);
  }
  if (!supaUrl || !supaAnon) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required for the email/password sign-in path.");
    process.exit(1);
  }
  sessionClient = createClient(supaUrl, supaAnon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await sessionClient.auth.signInWithPassword({ email, password });
  if (authError || !auth.session) {
    console.error(`Sign-in failed: ${authError?.message}`);
    process.exit(1);
  }
  token = auth.session.access_token;
  console.log(`✓ signed in as ${email}`);
}

/**
 * A guaranteed-live access token for a request. On a long run the token from
 * startup has expired by upload time, so we mint a fresh one from the refresh
 * token. Falls back to the current token if there's no session client or the
 * refresh fails (then the request may 401, same as before — never worse).
 */
async function freshAccessToken(): Promise<string> {
  if (!sessionClient) return token;
  try {
    const { data, error } = await sessionClient.auth.refreshSession();
    if (!error && data.session) {
      token = data.session.access_token;
    }
  } catch {
    // keep the current token
  }
  return token;
}

type ResultsFile = ReturnType<typeof AgentResultsFileSchema.parse>;

/** Transform + POST one results.json snapshot. Shared by the live loop and upload-only mode. */
async function postResults(cfg: WorkerRunConfig, file: ResultsFile): Promise<{ ok: boolean; written: number }> {
  const { payload, warnings } = transformResults(cfg, file);
  for (const w of warnings) console.warn(`  ⚠ ${w}`);
  const uploadToken = await freshAccessToken();
  const upRes = await fetch(`${webBase}/api/desktop/results`, {
    method: "POST",
    headers: { authorization: `Bearer ${uploadToken}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await upRes.text();
  let up: { ok?: boolean; written?: number; error?: string };
  try {
    up = JSON.parse(raw);
  } catch {
    console.error(`results sync returned non-JSON (HTTP ${upRes.status}) — is ${webBase} reachable?`);
    console.error(raw.slice(0, 300));
    return { ok: false, written: 0 };
  }
  if (!upRes.ok || !up.ok) {
    console.error(`results sync failed (HTTP ${upRes.status}): ${up.error}`);
    return { ok: false, written: 0 };
  }
  return { ok: true, written: up.written ?? 0 };
}

// ── Upload-only: re-sync an existing run's results.json, then exit ──────────
if (uploadOnly) {
  if (!runArg) {
    console.error("--upload-only requires --run <runId>.");
    process.exit(1);
  }
  const dir = path.join(homedir(), ".smarkstock-sessions", runArg);
  const cfgPath = path.join(dir, "config.json");
  const resPath = path.join(dir, "results.json");
  if (!existsSync(cfgPath) || !existsSync(resPath)) {
    console.error(`No saved session for run ${runArg} on this machine — nothing to re-sync.`);
    process.exit(1);
  }
  const cfg = readJsonFile(cfgPath) as WorkerRunConfig;
  const parsed = AgentResultsFileSchema.safeParse(readJsonFile(resPath));
  if (!parsed.success) {
    console.error(`results.json for run ${runArg} isn't valid — ${parsed.error.message}`);
    process.exit(1);
  }
  console.log(`Re-syncing run ${runArg}…`);
  const r = await postResults(cfg, parsed.data);
  if (!r.ok) process.exit(1);
  console.log(`✓ re-synced ${r.written} result(s) — refresh the review on the web.`);
  process.exit(0);
}

// config / reviewPath / session / initialPrompt come from EITHER a fresh
// run-context call (new run) OR an existing on-disk session (--resume). The
// browser launch, Claude terminal, and results.json watch loop below are shared.
let config: WorkerRunConfig;
let reviewPath: string;
let session: { dir: string; resultsFile: string };
let initialPrompt: string;

if (resumeRunId) {
  // ── 2r. Resume: reuse the saved session, no new run / prefetch / seed ──────
  const dir = path.join(homedir(), ".smarkstock-sessions", resumeRunId);
  if (!existsSync(path.join(dir, "config.json"))) {
    console.error(`No saved session for run ${resumeRunId} on this machine — nothing to resume.`);
    process.exit(1);
  }
  config = readJsonFile(path.join(dir, "config.json")) as WorkerRunConfig;
  // The app knows the project and passes it so the review link is exact; without
  // it we still sync, just don't print the link (the app builds its own button).
  const projectId = arg("project");
  reviewPath = projectId ? `/projects/${projectId}/runs/${resumeRunId}/review` : "";
  session = { dir, resultsFile: path.join(dir, "results.json") };
  initialPrompt =
    "Continue sourcing per CLAUDE.md — results.json already holds prior results; pick up any lines still missing or unfinished and keep updating it. Do not restart from scratch.";
  console.log(`✓ resuming run ${resumeRunId} — ${config.lines.length} line(s), reusing the saved session`);
} else {
  if (!bomId) process.exit(1); // guarded above for normal mode; narrows for TS

  // ── 2. Create the desktop run + pull the aliased context ────────────────────
  const ctxRes = await fetch(`${webBase}/api/desktop/run-context`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    // clientRendersColumns: this runner prints LCSC PN / part link / custom
    // columns in CLAUDE.md itself, so the server skips its note fold-in (which
    // exists only for older installs that don't render them).
    // resourceAll: when false (default) the server reuses lines already sourced
    // by the BOM's previous run and only sends the remaining ones.
    body: JSON.stringify({ bomId, lineLimit, clientRendersColumns: true, resourceAll }),
  });
  const ctxRawBody = await ctxRes.text();
  let ctx: { runId?: string; config?: WorkerRunConfig; reviewPath?: string; error?: string };
  try {
    ctx = JSON.parse(ctxRawBody);
  } catch {
    console.error(`run-context returned non-JSON (HTTP ${ctxRes.status}) — is ${webBase} reachable and running?`);
    console.error(ctxRawBody.slice(0, 500));
    process.exit(1);
  }
  if (!ctxRes.ok || !ctx.runId || !ctx.config) {
    console.error(`run-context failed (HTTP ${ctxRes.status}): ${ctx.error}`);
    process.exit(1);
  }
  config = ctx.config;
  reviewPath = ctx.reviewPath ?? "";
  console.log(`✓ run ${ctx.runId} created — ${config.lines.length} line(s)`);

  // ── 3. REST prefetch (free, exact — the agent browses only the gaps) ────────
  // Only the distributors THIS run enabled. A "LCSC only" run (or any browse-only
  // selection) has no REST API to hit, so we skip prefetch entirely instead of
  // pinging DigiKey/Mouser/element14 and reporting a misleading "0 results".
  const enabledNames = config.distributorSequence.filter((d) => d.enabled).map((d) => d.name);
  let prefetch;
  if (hasRestDistributor(enabledNames)) {
    console.log(`REST prefetch (${enabledNames.join(" / ")})…`);
    prefetch = await prefetchAll(config.lines, enabledNames, (done, total) => {
      if (done % 5 === 0 || done === total) console.log(`  ${done}/${total}`);
    });
    const withApi = prefetch.filter((p) => p.candidates.length > 0).length;
    console.log(`✓ prefetch done — ${withApi}/${config.lines.length} lines have API candidates`);
  } else {
    console.log(
      `REST prefetch skipped — no REST-API distributor enabled (this run: ${enabledNames.join(", ") || "none"}). ` +
        "LCSC/Unikey are browse-only; the agent sources them directly in the browser.",
    );
    prefetch = await prefetchAll(config.lines, enabledNames); // returns empty candidates instantly
  }

  session = generateSession(path.join(homedir(), ".smarkstock-sessions"), config, prefetch);
  // --dangerously-skip-permissions + the sourcing instruction as the initial
  // prompt: the two remaining manual steps on a fresh machine are signing into
  // Claude Code and installing/enabling the browser MCP plugin (desktop/README.md)
  // — once those exist, this run needs nothing pressed, just supervision. The
  // user has explicitly authorized this via a `Bash(claude --dangerously-skip-
  // permissions*)` allow rule in .claude/settings.local.json (project-scoped,
  // gitignored) rather than it being silently baked in.
  initialPrompt = "Source the BOM per CLAUDE.md.";
}

// ── 4. Browser + the user's own Claude terminal (shared by new + resume) ─────
const browserName = await ensureBrowser();
console.log(`✓ browser ready (${browserName}, CDP :${CDP_PORT})`);
console.log(`✓ session folder: ${session.dir}`);

const claudeCommand = `claude --dangerously-skip-permissions "${initialPrompt}"`;
Bun.spawn(
  ["cmd", "/c", "start", "SmarkStock Sourcing Agent", "powershell", "-NoExit", "-Command", claudeCommand],
  {
    cwd: session.dir,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  },
).unref();
console.log("✓ Claude Code terminal opened, auto-approved and sourcing started — nothing to press; just supervise (solve any CAPTCHAs it hits).");
console.log("  Watching results.json — leave this window open…");

// ── 5. Watch results.json and keep syncing (LIVE) ────────────────────────────
// We upload on EVERY change — even before the agent marks complete — so the web
// review updates live *during* sourcing, not only at the end. It keeps watching
// after complete too, so anything you tell the live Claude window afterward
// still syncs. The app stops it by writing DESKTOP_STOP_FILE ("Finish & sync");
// we do a guaranteed final flush before exiting (a hard kill on Windows would
// skip the signal handler, which is why the app uses the sentinel file).

async function syncNow(file: ResultsFile, first: boolean): Promise<boolean> {
  const r = await postResults(config, file);
  if (!r.ok) {
    console.error(`results.json is preserved at ${session.resultsFile}.`);
    return false;
  }
  if (first) {
    console.log(`✓ ${r.written} result(s) synced — run is now in REVIEW.`);
    console.log(`\nReview it on the web: ${webBase}${reviewPath}`);
    console.log("Keep talking to the Claude window — new results keep syncing on their own. Press “Finish & sync” when done.");
  } else {
    console.log(`✓ re-synced ${r.written} result(s) after a change.`);
  }
  return true;
}

let lastHash = "";
let firstUploadDone = false;
let announcedComplete = false;
let lastCount = 0;
let consecutiveParseFailures = 0;

function readResults(): ResultsFile | null {
  try {
    const raw = readJsonFile(session.resultsFile);
    const parsed = AgentResultsFileSchema.safeParse(raw);
    if (!parsed.success) {
      consecutiveParseFailures++;
      if (consecutiveParseFailures === 5) {
        console.warn(`  ⚠ results.json isn't matching the expected shape: ${parsed.error.message}`);
      }
      return null;
    }
    consecutiveParseFailures = 0;
    return parsed.data;
  } catch {
    return null; // unreadable mid-write — keep waiting
  }
}

// Final flush + exit — used both by the stop-file path and POSIX signals (CLI).
async function finalFlushAndExit(): Promise<void> {
  const file = readResults();
  if (file) await syncNow(file, !firstUploadDone);
  process.exit(0);
}
process.on("SIGTERM", () => void finalFlushAndExit());
process.on("SIGINT", () => void finalFlushAndExit());

for (;;) {
  await new Promise((r) => setTimeout(r, 3000));

  // "Finish & sync" from the app writes the sentinel — flush the latest and
  // exit cleanly (hard kill on Windows never runs the signal handler above).
  if (stopFile && existsSync(stopFile)) {
    console.log("Finishing — final sync…");
    await finalFlushAndExit();
  }

  const file = readResults();
  if (!file) continue;

  const count = Object.keys(file.lines).length;
  if (count !== lastCount) {
    console.log(`  progress: ${count}/${config.lines.length} line(s) written`);
    lastCount = count;
  }
  if (file.complete && !announcedComplete) {
    console.log("✓ agent marked the run complete");
    announcedComplete = true;
  }

  const hash = JSON.stringify({ lines: file.lines, complete: file.complete });
  if (hash === lastHash) continue;
  const ok = await syncNow(file, !firstUploadDone);
  if (ok) {
    lastHash = hash;
    firstUploadDone = true;
  }
}
