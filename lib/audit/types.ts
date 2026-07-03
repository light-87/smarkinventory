/**
 * lib/audit/types.ts — shared shapes for the guided box-audit flow
 * (FEATURES.md §5.4 / §9, plan/tab-shelves.md R2-25/Q-10).
 *
 * One ESD plastic (a `smark_stock_locations` row) = one `AuditContentItem`.
 * The same shaped list feeds the box-detail "Live contents" table, the rack
 * card's low-stock chips (via the part-level fields), and the audit drawer —
 * built once in `app/(app)/shelves/queries.ts` and threaded through.
 */

/** One ESD plastic inside a box, shaped for both display and the audit walk. */
export interface AuditContentItem {
  /** `smark_stock_locations.id` — what the audit actually writes against. */
  locationId: string;
  partId: string;
  /** Short QR PID, e.g. `SMK-000482`. */
  pid: string;
  mpn: string | null;
  value: string | null;
  /** `smark_stock_locations.qty` as last known — the "on-screen qty" to confirm or correct. */
  recordedQty: number;
  lastCountedAt: string | null;
  /** Part-level rollup + threshold — drives the shared low/out stock-state color, not per-location. */
  totalQty: number;
  reorderPoint: number | null;
}

/**
 * Resumable progress for one box's guided audit, persisted client-side
 * (localStorage — see `lib/audit/progress.ts`; no schema change for a new
 * table, see the package report). Each confirmed ESD writes to the DB
 * immediately (`confirmAuditCount`); this only tracks WHICH locations have
 * been visited this session so a paused audit can resume where it left off.
 */
export interface AuditProgress {
  boxId: string;
  startedAt: string;
  doneLocationIds: string[];
}
