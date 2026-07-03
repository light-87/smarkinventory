/**
 * worker/src/distributors/record-replay.ts — the RECORD/REPLAY layer every
 * REST distributor client wraps its live call in (FEATURES.md §0/§4:
 * "each with a RECORD/REPLAY layer").
 *
 * REPLAY (no key, or explicit `DISTRIBUTOR_REPLAY=1`): serves a checked-in
 * fixture under `worker/tests/fixtures/<distributor>/<key>.json`. Never
 * makes a network call — this is what CI/E2E and `bun test` exercise.
 * RECORD (a real key is present AND replay isn't forced): calls the live
 * function, then WRITES the fixture for next time. Nothing in this repo
 * currently has live distributor keys (build brief: "NO LIVE KEYS EXIST"),
 * so the record path is code-complete but has never actually executed —
 * exactly the spike's "API-first, browser gated" posture (docs/
 * spike-browser-worker.md), applied to the REST distributors too.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";

export type RecordReplayMode = "record" | "replay";

export interface RecordReplayOptions {
  distributorName: string;
  /** Defaults to `worker/tests/fixtures/<distributorName>` relative to this file. */
  fixturesDir?: string;
  mode: RecordReplayMode;
}

/** Deterministic, dependency-free key→filename slug (FNV-1a, so no `node:crypto` import needed). */
export function fixtureSlug(key: string): string {
  const cleaned = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `${cleaned || "query"}-${hex}`;
}

function defaultFixturesDir(distributorName: string): string {
  return path.join(import.meta.dir, "..", "..", "tests", "fixtures", distributorName.toLowerCase());
}

export async function withRecordReplay<T>(
  key: string,
  options: RecordReplayOptions,
  liveFn: () => Promise<T>,
): Promise<T> {
  const dir = options.fixturesDir ?? defaultFixturesDir(options.distributorName);
  const filePath = path.join(dir, `${fixtureSlug(key)}.json`);

  if (options.mode === "replay") {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      throw new Error(
        `record-replay: no fixture for "${options.distributorName}" key "${key}" at ${filePath} ` +
          `(replay mode — no live key present, and none was ever recorded for this query).`,
      );
    }
    return (await file.json()) as T;
  }

  const result = await liveFn();
  await mkdir(dir, { recursive: true });
  await Bun.write(filePath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
