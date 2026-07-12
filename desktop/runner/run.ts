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

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { WorkerRunConfig } from "../../types/worker";
import { ensureBrowser, CDP_PORT } from "./brave";
import { prefetchAll } from "./prefetch";
import { generateSession } from "./session";
import { AgentResultsFileSchema, transformResults } from "./transform";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const bomId = arg("bom");
if (!bomId) {
  console.error("usage: bun run desktop/runner/run.ts --bom <bomId> [--lines N] [--web http://localhost:3000]");
  process.exit(1);
}
const lineLimit = arg("lines") ? Number(arg("lines")) : undefined;
const webBase = arg("web") ?? "http://localhost:3000";
// Presence-based flag: force sourcing every to-order line, ignoring lines
// already sourced by the BOM's previous run (default is to reuse them).
const resourceAll = process.argv.includes("--resource-all");

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
    sessionClient = createClient(supaUrl, supaAnon, { auth: { persistSession: false, autoRefreshToken: false } });
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
const config = ctx.config;
const reviewPath = ctx.reviewPath ?? "";
console.log(`✓ run ${ctx.runId} created — ${config.lines.length} line(s)`);

// ── 3. REST prefetch (free, exact — the agent browses only the gaps) ────────
console.log("REST prefetch (DigiKey / Mouser / element14)…");
const prefetch = await prefetchAll(config.lines, (done, total) => {
  if (done % 5 === 0 || done === total) console.log(`  ${done}/${total}`);
});
const withApi = prefetch.filter((p) => p.candidates.length > 0).length;
console.log(`✓ prefetch done — ${withApi}/${config.lines.length} lines have API candidates`);

// ── 4. Browser + session folder + the user's own Claude terminal ────────────
const browserName = await ensureBrowser();
console.log(`✓ browser ready (${browserName}, CDP :${CDP_PORT})`);

const session = generateSession(path.join(homedir(), ".smarkstock-sessions"), config, prefetch);
console.log(`✓ session folder: ${session.dir}`);

// --dangerously-skip-permissions + the sourcing instruction as the initial
// prompt: the two remaining manual steps on a fresh machine are signing into
// Claude Code and installing/enabling the browser MCP plugin (desktop/README.md)
// — once those exist, this run needs nothing pressed, just supervision. The
// user has explicitly authorized this via a `Bash(claude --dangerously-skip-
// permissions*)` allow rule in .claude/settings.local.json (project-scoped,
// gitignored) rather than it being silently baked in.
const initialPrompt = "Source the BOM per CLAUDE.md.";
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
// The agent writes results.json as it goes and sets complete:true when done.
// We upload the first time it's complete, then KEEP watching and re-upload on
// every further change — so anything you tell the live Claude window afterward
// ("also check Mouser for line 12") still reaches the app + web. The run stays
// live until you press "Finish & sync" in the app (which stops this process).
type ResultsFile = ReturnType<typeof AgentResultsFileSchema.parse>;

async function uploadCurrent(file: ResultsFile, first: boolean): Promise<boolean> {
  const { payload, warnings } = transformResults(config, file);
  for (const w of warnings) console.warn(`  ⚠ ${w}`);
  // Mint a fresh token each time — a long supervised run easily outlives the
  // ~1h Supabase access token, and the upload must not 401 "Not signed in".
  const uploadToken = await freshAccessToken();
  const upRes = await fetch(`${webBase}/api/desktop/results`, {
    method: "POST",
    headers: { authorization: `Bearer ${uploadToken}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const upRawBody = await upRes.text();
  let up: { ok?: boolean; written?: number; error?: string };
  try {
    up = JSON.parse(upRawBody);
  } catch {
    console.error(`results sync returned non-JSON (HTTP ${upRes.status}) — is ${webBase} reachable?`);
    console.error(upRawBody.slice(0, 300));
    console.error(`results.json is preserved at ${session.resultsFile}.`);
    return false;
  }
  if (!upRes.ok || !up.ok) {
    console.error(`results sync failed (HTTP ${upRes.status}): ${up.error}`);
    return false;
  }
  if (first) {
    console.log(`✓ ${up.written} result(s) synced — run is now in REVIEW.`);
    console.log(`\nReview it on the web: ${webBase}${reviewPath}`);
    console.log("You can keep talking to the Claude window — new results keep syncing. Press “Finish & sync” when done.");
  } else {
    console.log(`✓ re-synced ${up.written} result(s) after a change.`);
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
    const raw = JSON.parse(readFileSync(session.resultsFile, "utf8"));
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

// "Finish & sync" (the app kills this process) or any terminate request →
// flush the very latest results first so nothing the agent just did is lost.
async function finalFlushAndExit(): Promise<void> {
  const file = readResults();
  if (file) await uploadCurrent(file, !firstUploadDone);
  process.exit(0);
}
process.on("SIGTERM", () => void finalFlushAndExit());
process.on("SIGINT", () => void finalFlushAndExit());

for (;;) {
  await new Promise((r) => setTimeout(r, 3000));
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
  // Upload once the agent has completed (first upload), then on every later
  // change. Pre-completion partials show as progress but aren't uploaded, so
  // the run doesn't flip to REVIEW before the agent says it's done.
  if (file.complete || firstUploadDone) {
    const ok = await uploadCurrent(file, !firstUploadDone);
    if (ok) {
      lastHash = hash;
      firstUploadDone = true;
    }
  }
}
