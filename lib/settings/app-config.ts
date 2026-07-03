/**
 * lib/settings/app-config.ts — the tiny app-wide config seam behind the
 * Label size / Low-stock default / Concurrency default cards
 * (plan/tab-settings.md §2 "Small cards").
 *
 * No `smark_app_settings` table exists in the schema (migrations 0001-0005
 * are frozen, `types/db.ts` is integrator-owned — see this package's
 * handoff notes-for-integrator for the proposed table). Rather than leave
 * these three cards inert, this mirrors `lib/storage`'s port pattern: a
 * real, working LOCAL-DISK implementation under the same `.storage/` root
 * (already gitignored for exactly this "dev/test fallback" purpose) that
 * behaves like the eventual DB row from the UI's point of view — read it,
 * change a value, it sticks for the life of the server process. This is a
 * dev/single-instance-server implementation: Vercel's serverless filesystem
 * is ephemeral, so production still needs the integrator's table before
 * these survive a redeploy. `AppConfig` below is exactly that table's
 * proposed row shape, so swapping in a Supabase-backed reader/writer once
 * it lands is a one-file change — nothing above this module needs to know.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DEFAULT_APP_CONFIG, type AppConfig } from "./types";

const CONFIG_PATH = resolve(process.cwd(), ".storage", "settings", "app-config.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceConfig(raw: unknown): AppConfig {
  if (!isRecord(raw)) return { ...DEFAULT_APP_CONFIG };

  const labelSize = raw.labelSize === "avery_l7651" ? "avery_l7651" : DEFAULT_APP_CONFIG.labelSize;
  const concurrencyDefault =
    raw.concurrencyDefault === "economy" || raw.concurrencyDefault === "balanced" || raw.concurrencyDefault === "thorough"
      ? raw.concurrencyDefault
      : DEFAULT_APP_CONFIG.concurrencyDefault;
  const lowStockDefaultThreshold =
    typeof raw.lowStockDefaultThreshold === "number" && Number.isFinite(raw.lowStockDefaultThreshold)
      ? raw.lowStockDefaultThreshold
      : null;

  return { labelSize, concurrencyDefault, lowStockDefaultThreshold };
}

/** Current config, falling back to defaults if the file doesn't exist yet or fails to parse. */
export async function readAppConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return coerceConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_APP_CONFIG };
  }
}

/** Merges `patch` over the current config and persists it. Throws on a genuine disk-write failure — callers surface it, never swallow it. */
export async function writeAppConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const current = await readAppConfig();
  const next: AppConfig = { ...current, ...patch };
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}
