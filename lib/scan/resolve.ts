/**
 * lib/scan/resolve.ts — code → part/box resolution (FEATURES.md §5.5 · §8 ·
 * plan/tab-scan.md: "resolve PID→part card, box→box card, else toast").
 *
 * Two label shapes reach here (SCHEMA.md §6 `smark_qr_labels.code_value`):
 *   - a PART label encodes the short internal PID, e.g. `SMK-000482`.
 *   - a BIG-BOX label encodes the box's raw row id (uuid) — boxes have no
 *     separate human "code" column (`smark_big_boxes.name` is a free-text
 *     label like "A-03", not guaranteed unique across shelves), so a typed
 *     (non-scanned) box lookup falls back to a case-insensitive exact match
 *     on `name` as a human convenience, same as the top-bar/global-modal
 *     resolver plan/tab-scan.md says this helper is shared with.
 *
 * Pure w.r.t. classification (`classifyScanCode` has no I/O, unit-tested
 * directly); `resolveScanCode` is the only function here that talks to
 * Supabase, and it accepts any `SupabaseClient<Database>` — browser or
 * server — so this module works from a Client Component (this package's
 * scan page) and would work equally from a Server Action.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLES, type BigBoxRow, type Database, type PartRow, type ShelfRow, type StockLocationRow } from "@/types/db";

/* ────────────────────────────────────────────────────────────────────────────
 * Pure classification (unit-tested)
 * ──────────────────────────────────────────────────────────────────────────── */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ScanCodeShape = "empty" | "uuid" | "text";

/** Cheap shape classification used to pick the lookup strategy — no I/O. */
export function classifyScanCode(raw: string): ScanCodeShape {
  const trimmed = raw.trim();
  if (trimmed === "") return "empty";
  if (UUID_PATTERN.test(trimmed)) return "uuid";
  return "text";
}

/** Trims + collapses whitespace a scanner/keyboard might inject mid-code. */
export function normalizeScanCode(raw: string): string {
  return raw.trim();
}

/* ────────────────────────────────────────────────────────────────────────────
 * Resolved shapes
 * ──────────────────────────────────────────────────────────────────────────── */

export interface StockLocationWithBox extends StockLocationRow {
  big_box: (BigBoxRow & { shelf: ShelfRow | null }) | null;
}

export interface ResolvedPart {
  part: PartRow;
  /** Usually one row ("one home per part normally"); two for the documented bulk/reel case. */
  locations: StockLocationWithBox[];
}

export interface BoxContentLine extends StockLocationRow {
  part: PartRow;
}

export interface ResolvedBox {
  box: BigBoxRow;
  shelf: ShelfRow | null;
  contents: BoxContentLine[];
}

export type ScanResolution = { type: "part"; data: ResolvedPart } | { type: "box"; data: ResolvedBox };

type Client = SupabaseClient<Database>;

/* ────────────────────────────────────────────────────────────────────────────
 * Lookups
 * ──────────────────────────────────────────────────────────────────────────── */

async function findPartByPid(client: Client, code: string): Promise<PartRow | null> {
  // ilike with no wildcards = case-insensitive EXACT match (scanners/typing may vary case).
  const { data, error } = await client.from(TABLES.parts).select("*").ilike("internal_pid", code).maybeSingle();
  if (error) throw new Error(`part lookup failed: ${error.message}`);
  return data ?? null;
}

async function findPartLocations(client: Client, partId: string): Promise<StockLocationWithBox[]> {
  const { data, error } = await client
    .from(TABLES.stock_locations)
    .select("*, big_box:smark_big_boxes(*, shelf:smark_shelves(*))")
    .eq("part_id", partId);
  if (error) throw new Error(`location lookup failed: ${error.message}`);
  return (data ?? []) as unknown as StockLocationWithBox[];
}

async function findBoxByCode(client: Client, code: string): Promise<BigBoxRow | null> {
  const shape = classifyScanCode(code);
  if (shape === "uuid") {
    const { data, error } = await client.from(TABLES.big_boxes).select("*").eq("id", code).maybeSingle();
    if (error) throw new Error(`box lookup failed: ${error.message}`);
    return data ?? null;
  }
  // Typed convenience fallback — first case-insensitive exact name match.
  const { data, error } = await client.from(TABLES.big_boxes).select("*").ilike("name", code).limit(1).maybeSingle();
  if (error) throw new Error(`box lookup failed: ${error.message}`);
  return data ?? null;
}

async function findShelf(client: Client, shelfId: string): Promise<ShelfRow | null> {
  const { data, error } = await client.from(TABLES.shelves).select("*").eq("id", shelfId).maybeSingle();
  if (error) throw new Error(`shelf lookup failed: ${error.message}`);
  return data ?? null;
}

async function findBoxContents(client: Client, boxId: string): Promise<BoxContentLine[]> {
  const { data, error } = await client
    .from(TABLES.stock_locations)
    .select("*, part:smark_parts(*)")
    .eq("big_box_id", boxId);
  if (error) throw new Error(`box contents lookup failed: ${error.message}`);
  return (data ?? []) as unknown as BoxContentLine[];
}

/**
 * Resolves one scanned/typed code. PID lookup is tried first — an exact PID
 * hit always wins even if (implausibly) it also looked box-shaped. Returns
 * `null` on no match ("No match" toast per plan/tab-scan.md), never throws
 * for a not-found code (only for an actual I/O failure).
 */
export async function resolveScanCode(client: Client, rawCode: string): Promise<ScanResolution | null> {
  const code = normalizeScanCode(rawCode);
  if (code === "") return null;

  const part = await findPartByPid(client, code);
  if (part) {
    const locations = await findPartLocations(client, part.id);
    return { type: "part", data: { part, locations } };
  }

  const box = await findBoxByCode(client, code);
  if (box) {
    const [shelf, contents] = await Promise.all([findShelf(client, box.shelf_id), findBoxContents(client, box.id)]);
    return { type: "box", data: { box, shelf, contents } };
  }

  return null;
}
