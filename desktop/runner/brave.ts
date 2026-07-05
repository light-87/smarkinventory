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

/** Launches the dedicated browser if its CDP port isn't already up. Returns the browser name in use. */
export async function ensureBrowser(): Promise<string> {
  if (await cdpAlive()) return "already running";
  const found = findBrowserExe();
  if (!found) {
    throw new Error(
      "No Brave or Chrome installation found. Install Brave (https://brave.com) — the sourcing agent drives a real browser.",
    );
  }
  Bun.spawn(
    [
      found.exe,
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--restore-last-session",
      "about:blank",
    ],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
  ).unref();

  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive()) return found.name;
  }
  throw new Error(`${found.name} started but its debugging port :${CDP_PORT} never came up.`);
}
