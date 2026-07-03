/**
 * lib/scan/offline-queue.ts — localStorage-backed movement queue (FEATURES.md
 * §5.5: "Offline: movements queue + sync"; plan/tab-scan.md OFFLINE note:
 * "if navigator.onLine or a supabase call fails w/ network error, queue
 * movement in localStorage + banner 'N queued — will sync'; sync on
 * reconnect").
 *
 * Storage is injectable (`OfflineQueueStorage`) so this is unit-testable
 * without a real `window.localStorage` (tests/unit/scan-offline-queue.test.ts
 * uses `createMemoryStorage()`); `hooks/use-scanner.ts` calls the exported
 * functions with their default (real `localStorage` in the browser).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { recordMovement, type MovementInput } from "@/lib/movements";

export interface SyncOfflineMovementsResult {
  synced: QueuedMovement[];
  /** Permanently-failed items removed from the queue (e.g. now-invalid — see below). */
  dropped: QueuedMovement[];
  remaining: number;
}

export type OfflineQueueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** In-memory `Storage`-shaped stand-in for tests / SSR (no real `localStorage`). */
export function createMemoryStorage(): OfflineQueueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function defaultStorage(): OfflineQueueStorage {
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return createMemoryStorage();
}

const STORAGE_KEY = "smarkstock.scan.offlineMovements.v1";

export interface QueuedMovement {
  id: string;
  input: MovementInput;
  queuedAt: string;
  /** Human-readable line for the offline banner / retry list, e.g. "Took out 4 × SMK-000101". */
  summary: string;
}

function readAll(storage: OfflineQueueStorage): QueuedMovement[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedMovement[]) : [];
  } catch {
    return [];
  }
}

function writeAll(storage: OfflineQueueStorage, items: QueuedMovement[]): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(items));
}

/** Queues a movement that couldn't be written (offline / network failure). Returns the queued entry. */
export function enqueueOfflineMovement(
  input: MovementInput,
  summary: string,
  storage: OfflineQueueStorage = defaultStorage(),
): QueuedMovement {
  const items = readAll(storage);
  const queued: QueuedMovement = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    input,
    queuedAt: new Date().toISOString(),
    summary,
  };
  items.push(queued);
  writeAll(storage, items);
  return queued;
}

export function listOfflineMovements(storage: OfflineQueueStorage = defaultStorage()): QueuedMovement[] {
  return readAll(storage);
}

export function removeOfflineMovement(id: string, storage: OfflineQueueStorage = defaultStorage()): void {
  writeAll(
    storage,
    readAll(storage).filter((item) => item.id !== id),
  );
}

export function clearOfflineMovements(storage: OfflineQueueStorage = defaultStorage()): void {
  storage.removeItem(STORAGE_KEY);
}

/**
 * Flushes queued movements through `recordMovement`, in queued order.
 *
 * A movement's failure can be TRANSIENT (still offline / a fresh network
 * blip — `isNetworkError`) or PERMANENT (e.g. `MovementValidationError` —
 * stock has since moved below a queued take-out amount, the location no
 * longer exists, etc.). Only a transient failure stops the loop (keeps that
 * item + everything after it queued, in order, for the next attempt) — a
 * permanent failure is dropped (surfaced to the caller via `dropped`) and
 * the loop CONTINUES, so one now-invalid queued scan can't permanently wedge
 * every later scan behind it.
 */
export async function syncOfflineMovements(
  client: SupabaseClient<Database>,
  storage: OfflineQueueStorage = defaultStorage(),
): Promise<SyncOfflineMovementsResult> {
  const items = readAll(storage);
  const synced: QueuedMovement[] = [];
  const dropped: QueuedMovement[] = [];

  for (const item of items) {
    try {
      await recordMovement(client, item.input);
      synced.push(item);
    } catch (error) {
      if (isNetworkError(error)) break; // transient — keep this + the rest queued, retry next time
      dropped.push(item); // permanent — can't ever succeed as queued, drop it and keep going
    }
  }

  const removedIds = new Set([...synced, ...dropped].map((item) => item.id));
  if (removedIds.size > 0) {
    writeAll(storage, items.filter((item) => !removedIds.has(item.id)));
  }

  return { synced, dropped, remaining: readAll(storage).length };
}

/**
 * Best-effort classification of "this failed because we're offline" vs a
 * real validation/auth error — so the caller only queues genuine network
 * failures instead of silently swallowing e.g. an insufficient-stock error.
 */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (error instanceof TypeError) return true; // fetch's generic "Failed to fetch" / "Load failed"
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes("network") || message.includes("fetch failed") || message.includes("failed to fetch");
}
