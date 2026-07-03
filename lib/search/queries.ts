/**
 * lib/search/queries.ts — global palette query builders (FEATURES.md §5
 * header spec; plan/tab-login-shell.md R2-34: "type anything → palette
 * results across parts (PID/MPN/value), projects, BOM names, PO numbers;
 * scan codes keep resolving as before").
 *
 * `looksLikeScanCode` is pure (no I/O, unit-tested directly) — it mirrors
 * `lib/scan/resolve.ts`'s own shape checks (that module's `classifyScanCode`
 * is imported read-only, not reimplemented) plus the PID pattern already
 * established by `components/shell/actions.ts`'s stub scan field (redefined
 * here rather than imported — that file is auth-shell's private stub, not a
 * shared lib per docs/OWNERSHIP.md). Everything else here talks to Supabase
 * via a caller-supplied `SupabaseClient<Database>` (browser or server — same
 * convention as `lib/scan/resolve.ts` / `lib/movements/service.ts`), so
 * results are always scoped by the CALLER's own RLS session, never a
 * service-role client.
 *
 * Deliberately avoids PostgREST's `.or()` filter string — its value-escaping
 * rules for embedded commas/dots/parens are easy to get subtly wrong for
 * arbitrary user-typed search text. Each searchable column gets its own
 * `.ilike()` call, run in parallel via `Promise.all`, merged + deduped by
 * `id` in application code instead.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLES, type BomRow, type Database, type OrderRow, type PartRow, type ProjectRow } from "@/types/db";
import { classifyScanCode, normalizeScanCode } from "@/lib/scan";

type Client = SupabaseClient<Database>;

/** Rows per section in the palette (FEATURES §5: Parts · Projects · BOMs · Orders). */
const SECTION_LIMIT = 6;

/**
 * Minimum typed length before the multi-section palette search runs any
 * query — keeps a single keystroke from firing four table scans. The
 * scan-code short-circuit check (`looksLikeScanCode` / `resolveScanCode` in
 * ./actions) has no such floor since it's a cheap exact lookup, not a scan.
 */
const MIN_QUERY_LENGTH = 2;

/** SmarkStock internal PIDs are always `SMK-` + digits (FEATURES.md §8). */
const PID_SHAPE = /^SMK-\d+$/i;

/**
 * True when the typed/scanned text LOOKS like a code a printed QR label
 * would encode — an exact PID (`SMK-000482`) or the raw big-box row id
 * (`smark_qr_labels.code_value` for a box, SCHEMA.md §6 — a scanner always
 * emits the uuid; a human never guesses one). This only decides whether to
 * TRY the fast resolve-first path before falling through to the section
 * search — `resolveScanCode` (lib/scan, called from ./actions) is what
 * actually confirms a match exists.
 */
export function looksLikeScanCode(raw: string): boolean {
  const code = normalizeScanCode(raw);
  if (code === "") return false;
  return classifyScanCode(code) === "uuid" || PID_SHAPE.test(code);
}

/** Escapes LIKE's own wildcards so a literal "%"/"_" typed by a user is matched literally. */
function likePattern(query: string): string {
  const escaped = query.replace(/[%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

function dedupeById<T extends { id: string }>(rows: T[], limit: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Deep-link routes — the ONE place the palette (and lib/notifications' fan-out
 * helpers) build hrefs into other packages' surfaces, so a route rename only
 * needs updating here. `/projects/:id` and `/projects/:id/boms/:id` follow
 * docs/OWNERSHIP.md's route ownership (projects-hub / bom-pipeline) directly;
 * `/cart?order=:id` is this package's OWN assumption (cart-orders hasn't
 * built the cart yet — flagged in this package's report for confirmation).
 * ──────────────────────────────────────────────────────────────────────────── */

export function partHref(pid: string): string {
  return `/part/${encodeURIComponent(pid)}`;
}

export function boxHref(boxId: string): string {
  return `/shelves?box=${encodeURIComponent(boxId)}`;
}

export function projectHref(projectId: string): string {
  return `/projects/${projectId}`;
}

export function bomHref(projectId: string, bomId: string): string {
  return `/projects/${projectId}/boms/${bomId}`;
}

export function orderHref(orderId: string): string {
  return `/cart?order=${orderId}`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Parts — PID / MPN / value (FEATURES §5.header)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PalettePartHit {
  id: string;
  internal_pid: string;
  mpn: string | null;
  value: string | null;
  package: string | null;
  description: string | null;
  total_qty: number;
}

function toPartHit(row: PartRow): PalettePartHit {
  return {
    id: row.id,
    internal_pid: row.internal_pid,
    mpn: row.mpn,
    value: row.value,
    package: row.package,
    description: row.description,
    total_qty: row.total_qty,
  };
}

export async function searchParts(client: Client, query: string, limit = SECTION_LIMIT): Promise<PalettePartHit[]> {
  const pattern = likePattern(query);
  const [byPid, byMpn, byValue] = await Promise.all([
    client.from(TABLES.parts).select("*").ilike("internal_pid", pattern).limit(limit),
    client.from(TABLES.parts).select("*").ilike("mpn", pattern).limit(limit),
    client.from(TABLES.parts).select("*").ilike("value", pattern).limit(limit),
  ]);
  for (const result of [byPid, byMpn, byValue]) {
    if (result.error) throw new Error(`part search failed: ${result.error.message}`);
  }
  const merged = [...(byPid.data ?? []), ...(byMpn.data ?? []), ...(byValue.data ?? [])];
  return dedupeById(merged, limit).map(toPartHit);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Projects — name / client (FEATURES §5.header)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PaletteProjectHit {
  id: string;
  name: string;
  client: string | null;
  archived_at: string | null;
}

function toProjectHit(row: ProjectRow): PaletteProjectHit {
  return { id: row.id, name: row.name, client: row.client, archived_at: row.archived_at };
}

export async function searchProjects(client: Client, query: string, limit = SECTION_LIMIT): Promise<PaletteProjectHit[]> {
  const pattern = likePattern(query);
  const [byName, byClient] = await Promise.all([
    client.from(TABLES.projects).select("*").ilike("name", pattern).limit(limit),
    client.from(TABLES.projects).select("*").ilike("client", pattern).limit(limit),
  ]);
  for (const result of [byName, byClient]) {
    if (result.error) throw new Error(`project search failed: ${result.error.message}`);
  }
  const merged = [...(byName.data ?? []), ...(byClient.data ?? [])];
  return dedupeById(merged, limit).map(toProjectHit);
}

/* ────────────────────────────────────────────────────────────────────────────
 * BOMs — name (FEATURES §5.header), carrying the parent project's name for display
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PaletteBomHit {
  id: string;
  name: string;
  project_id: string;
  project_name: string | null;
}

export async function searchBoms(client: Client, query: string, limit = SECTION_LIMIT): Promise<PaletteBomHit[]> {
  const pattern = likePattern(query);
  const { data, error } = await client
    .from(TABLES.boms)
    .select("*, project:smark_projects(name)")
    .ilike("name", pattern)
    .limit(limit);
  if (error) throw new Error(`BOM search failed: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<BomRow & { project: { name: string } | null }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    project_id: row.project_id,
    project_name: row.project?.name ?? null,
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Orders — PO number (FEATURES §5.header), carrying the distributor's name
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PaletteOrderHit {
  id: string;
  po_number: string;
  status: string;
  distributor_id: string;
  distributor_name: string | null;
}

export async function searchOrders(client: Client, query: string, limit = SECTION_LIMIT): Promise<PaletteOrderHit[]> {
  const pattern = likePattern(query);
  const { data, error } = await client
    .from(TABLES.orders)
    .select("*, distributor:smark_distributors(name)")
    .ilike("po_number", pattern)
    .limit(limit);
  if (error) throw new Error(`order search failed: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<OrderRow & { distributor: { name: string } | null }>;
  return rows.map((row) => ({
    id: row.id,
    po_number: row.po_number,
    status: row.status,
    distributor_id: row.distributor_id,
    distributor_name: row.distributor?.name ?? null,
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Merged four-section search
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PaletteResults {
  parts: PalettePartHit[];
  projects: PaletteProjectHit[];
  boms: PaletteBomHit[];
  orders: PaletteOrderHit[];
}

export function isEmptyPaletteResults(results: PaletteResults): boolean {
  return (
    results.parts.length === 0 &&
    results.projects.length === 0 &&
    results.boms.length === 0 &&
    results.orders.length === 0
  );
}

/**
 * Runs all four section searches in parallel. Below `MIN_QUERY_LENGTH`
 * returns all-empty sections without querying anything — the caller
 * (./actions' `runPaletteSearch`) only reaches this after the scan-code
 * short-circuit has already been tried and didn't apply.
 */
export async function searchPalette(client: Client, rawQuery: string, limit = SECTION_LIMIT): Promise<PaletteResults> {
  const query = rawQuery.trim();
  if (query.length < MIN_QUERY_LENGTH) {
    return { parts: [], projects: [], boms: [], orders: [] };
  }
  const [parts, projects, boms, orders] = await Promise.all([
    searchParts(client, query, limit),
    searchProjects(client, query, limit),
    searchBoms(client, query, limit),
    searchOrders(client, query, limit),
  ]);
  return { parts, projects, boms, orders };
}
