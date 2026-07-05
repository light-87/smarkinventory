#!/usr/bin/env bun
/**
 * desktop/runner/run.ts — P1 CLI for the SmarkStock Desktop companion
 * (plan: SmarkStock Desktop; the Tauri UI wraps this same flow in P2).
 *
 *   bun run desktop/runner/run.ts --bom <bomId> [--lines 5] [--web http://localhost:3000]
 *
 * Env (e.g. via `bun --env-file=.env.cloud.local`):
 *   DESKTOP_EMAIL / DESKTOP_PASSWORD  — the user's normal web login
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
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

// ── 1. Sign in (same Supabase email/password auth as the web app) ───────────
const email = process.env.DESKTOP_EMAIL;
const password = process.env.DESKTOP_PASSWORD;
if (!email || !password) {
  console.error("Set DESKTOP_EMAIL and DESKTOP_PASSWORD (your normal SmarkStock web login).");
  process.exit(1);
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: auth, error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError || !auth.session) {
  console.error(`Sign-in failed: ${authError?.message}`);
  process.exit(1);
}
const token = auth.session.access_token;
console.log(`✓ signed in as ${email}`);

// ── 2. Create the desktop run + pull the aliased context ────────────────────
const ctxRes = await fetch(`${webBase}/api/desktop/run-context`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ bomId, lineLimit }),
});
const ctx = (await ctxRes.json()) as { runId?: string; config?: WorkerRunConfig; reviewPath?: string; error?: string };
if (!ctxRes.ok || !ctx.runId || !ctx.config) {
  console.error(`run-context failed (HTTP ${ctxRes.status}): ${ctx.error}`);
  process.exit(1);
}
console.log(`✓ run ${ctx.runId} created — ${ctx.config.lines.length} line(s)`);

// ── 3. REST prefetch (free, exact — the agent browses only the gaps) ────────
console.log("REST prefetch (DigiKey / Mouser / element14)…");
const prefetch = await prefetchAll(ctx.config.lines, (done, total) => {
  if (done % 5 === 0 || done === total) console.log(`  ${done}/${total}`);
});
const withApi = prefetch.filter((p) => p.candidates.length > 0).length;
console.log(`✓ prefetch done — ${withApi}/${ctx.config.lines.length} lines have API candidates`);

// ── 4. Browser + session folder + the user's own Claude terminal ────────────
const browserName = await ensureBrowser();
console.log(`✓ browser ready (${browserName}, CDP :${CDP_PORT})`);

const session = generateSession(path.join(homedir(), ".smarkstock-sessions"), ctx.config, prefetch);
console.log(`✓ session folder: ${session.dir}`);

Bun.spawn(["cmd", "/c", "start", "SmarkStock Sourcing Agent", "powershell", "-NoExit", "-Command", "claude"], {
  cwd: session.dir,
  stdin: "ignore",
  stdout: "ignore",
  stderr: "ignore",
}).unref();
console.log("✓ Claude Code terminal opened — tell it to start (e.g. “source the BOM per CLAUDE.md”) and supervise.");
console.log("  Watching results.json — leave this window open…");

// ── 5. Watch results.json until complete ─────────────────────────────────────
let lastCount = 0;
let file: ReturnType<typeof AgentResultsFileSchema.parse> | null = null;
for (;;) {
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const parsed = AgentResultsFileSchema.safeParse(JSON.parse(readFileSync(session.resultsFile, "utf8")));
    if (!parsed.success) continue; // mid-write or partial — keep waiting
    file = parsed.data;
    const count = Object.keys(file.lines).length;
    if (count !== lastCount) {
      console.log(`  progress: ${count}/${ctx.config.lines.length} line(s) written`);
      lastCount = count;
    }
    if (file.complete) break;
  } catch {
    // unreadable mid-write — keep waiting
  }
}
console.log("✓ agent marked the run complete");

// ── 6. Transform (objective rungs recomputed in code) + upload ──────────────
const { payload, warnings } = transformResults(ctx.config, file!);
for (const w of warnings) console.warn(`  ⚠ ${w}`);
console.log(`uploading ${payload.results.length} candidate(s)…`);

const upRes = await fetch(`${webBase}/api/desktop/results`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(payload),
});
const up = (await upRes.json()) as { ok?: boolean; written?: number; error?: string };
if (!upRes.ok || !up.ok) {
  console.error(`results upload failed (HTTP ${upRes.status}): ${up.error}`);
  console.error(`results.json is preserved at ${session.resultsFile} — fix and re-run the upload.`);
  process.exit(1);
}
console.log(`✓ ${up.written} result(s) uploaded — run is in REVIEW.`);
console.log(`\nReview it on the web: ${webBase}${ctx.reviewPath ?? ""}`);
