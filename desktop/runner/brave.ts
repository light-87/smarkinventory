/**
 * desktop/runner/brave.ts — launch a DEDICATED Brave (or Chrome) instance
 * with the DevTools remote-debugging port on, using its own persistent
 * profile (`~/.smarkstock-browser`). Pattern proven in
 * claude-session-control/server/browserCopilot.ts and in the F-013
 * experiment: a REAL browser + residential IP passed every distributor bot
 * wall (LCSC, DigiKey, Mouser, element14, Unikey) with zero blocks; the
 * persistent profile accumulates cookies/trust so any first-visit challenge
 * is solved once by the user and remembered.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const CDP_PORT = Number(process.env.SMARKSTOCK_CDP_PORT ?? 9333); // NOT 9222 — don't collide with the user's other tooling
export const PROFILE_DIR = path.join(homedir(), ".smarkstock-browser");

export function findBrowserExe(): { exe: string; name: "Brave" | "Chrome" } | null {
  const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const local = process.env["LOCALAPPDATA"] ?? path.join(homedir(), "AppData", "Local");
  const candidates: Array<{ exe: string; name: "Brave" | "Chrome" }> = [
    { exe: path.join(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"), name: "Brave" },
    { exe: path.join(pf86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"), name: "Brave" },
    { exe: path.join(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"), name: "Brave" },
    { exe: path.join(pf, "Google", "Chrome", "Application", "chrome.exe"), name: "Chrome" },
    { exe: path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"), name: "Chrome" },
  ];
  return candidates.find((c) => existsSync(c.exe)) ?? null;
}

export async function cdpAlive(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Spawn the dedicated debuggable browser. Two changes fix the "Brave already
 * open → CDP never came up" papercut:
 *  - NO positional URL (was `about:blank`): with a URL on the command line an
 *    already-running Brave can treat the launch as "open this URL" and hand it
 *    to the existing instance, so the new process exits without binding the
 *    debug port. Dropping it lets Brave open its own default window.
 *  - NO `--restore-last-session` + `--disable-session-crashed-bubble`: the
 *    dedicated Brave is hard-killed when a run ends, so the next launch would
 *    otherwise pop a "restore pages?" crash bubble that blocks a clean start.
 * A distinct --user-data-dir keeps this a separate instance from the user's
 * normal browser (its own tabs/logins stay untouched).
 */
function spawnBrowser(exe: string): void {
  Bun.spawn(
    [
      exe,
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
      "--disable-features=TranslateUI,ChromeWhatsNewUI",
    ],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
  ).unref();
}

/** Poll the CDP port until it answers or the budget runs out. */
async function waitForCdp(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive()) return true;
  }
  return false;
}

/**
 * Ensure a debuggable browser is up, reusing one already on the CDP port.
 * Works even when the user's normal Brave is open. Tolerant of a slow cold
 * start (AV / CPU contention) with a generous wait and one retry before giving
 * an actionable error rather than a raw stack trace.
 */
export async function ensureBrowser(): Promise<string> {
  if (await cdpAlive()) return "already running";
  const found = findBrowserExe();
  if (!found) {
    throw new Error(
      "No Brave or Chrome installation found. Install Brave (https://brave.com) — the sourcing agent drives a real browser.",
    );
  }

  spawnBrowser(found.exe);
  if (await waitForCdp(30_000)) return found.name;

  // One retry: the first invocation may have initialised the dedicated profile
  // without binding the port (e.g. handed off to a running instance); a second
  // launch against the now-prepared profile usually catches.
  spawnBrowser(found.exe);
  if (await waitForCdp(20_000)) return found.name;

  throw new Error(
    `${found.name}'s debugging port :${CDP_PORT} never came up. If ${found.name} is already open, close it ` +
      `completely (check the system tray) and start the run again — a running ${found.name} can absorb the launch. ` +
      `The sourcing agent uses its own separate profile, so your normal tabs and logins are untouched.`,
  );
}
