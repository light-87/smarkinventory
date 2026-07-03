/**
 * lib/audit/progress.ts — resumable audit progress, persisted client-side.
 *
 * plan/tab-shelves.md R2-25/Q-10 leaves "persist progress in a table or
 * localStorage — your call" to the shelves package. Chose localStorage: a
 * new table needs a migration number from the integrator (OWNERSHIP.md —
 * DB changes are integrator-assigned), and per-step writes already land for
 * real in `smark_stock_locations`/`smark_movements` the moment an ESD is
 * confirmed (see `actions.ts`) — this only remembers WHICH locations this
 * browser has already walked, so a paused audit resumes instead of
 * restarting. Trade-off noted in the package report: progress doesn't
 * follow the user across devices, and clearing browser storage loses the
 * "where was I" marker (never loses counted data — that's already in Postgres).
 *
 * SSR-safe: every function no-ops (or returns null) when `window` doesn't
 * exist, so importing this from a Server Component never throws.
 */

import type { AuditProgress } from "./types";

const STORAGE_PREFIX = "smark.audit.";

function storageKey(boxId: string): string {
  return `${STORAGE_PREFIX}${boxId}`;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Some browsers throw on localStorage access (private mode / disabled storage).
    return null;
  }
}

/** Fresh, empty progress for a box — call once per new audit session. */
export function createAuditProgress(boxId: string): AuditProgress {
  return { boxId, startedAt: new Date().toISOString(), doneLocationIds: [] };
}

/** Loads saved progress for a box, or `null` if there is none (or storage is unavailable). */
export function loadAuditProgress(boxId: string): AuditProgress | null {
  const storage = getLocalStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(storageKey(boxId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuditProgress>;
    if (
      parsed.boxId !== boxId ||
      typeof parsed.startedAt !== "string" ||
      !Array.isArray(parsed.doneLocationIds)
    ) {
      return null;
    }
    return { boxId, startedAt: parsed.startedAt, doneLocationIds: parsed.doneLocationIds };
  } catch {
    return null;
  }
}

/** Persists progress (call after a pause or a step, before the walk completes). */
export function saveAuditProgress(progress: AuditProgress): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey(progress.boxId), JSON.stringify(progress));
  } catch {
    // Storage full/unavailable — the count already landed server-side; only
    // resumability degrades, silently, rather than blocking the audit.
  }
}

/** Clears the resume marker — call once the walk is fully done. */
export function clearAuditProgress(boxId: string): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(boxId));
  } catch {
    // ignore — nothing user-visible depends on the key actually being gone.
  }
}

/** Returns progress with `locationId` marked done (no-op if already marked). */
export function markLocationDone(progress: AuditProgress, locationId: string): AuditProgress {
  if (progress.doneLocationIds.includes(locationId)) return progress;
  return { ...progress, doneLocationIds: [...progress.doneLocationIds, locationId] };
}
