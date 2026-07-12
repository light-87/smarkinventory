/**
 * lib/bom/service.ts — BOM-pipeline DB writes: upload, in-app create,
 * reconcile, build-qty edit (plan/tab-orders-projects.md §2/§5 R2-03/R2-19/
 * R2-27).
 *
 * Every exported function takes an already-created `SupabaseClient<Database>`
 * (+ a `StoragePort` where a file is involved), mirroring `lib/receive/core.ts`:
 * `app/(app)/projects/[projectId]/boms/actions.ts` ("use server") wraps these
 * with the per-request RLS client, tests can wire a service-role client
 * instead — no `next/headers` import here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BomLineExtra, BomTemplateColumn, Database } from "@/types/db";
import { TABLES } from "@/types/db";
import type { StoragePort } from "@/lib/storage";
import { getEffectiveBomColumns, saveBomTemplate } from "./template";
import { parseUploadedBomBuffer, type UploadedBomLine } from "./parse-upload";
import { getReconcileCatalog } from "./queries";
import { reconcileLines } from "./reconcile";
import { validateBomRows } from "./validate";
import type { CreateBomRowInput } from "./types";

type DB = SupabaseClient<Database>;

/**
 * Postgres unique-violation (`23505`) — fired here by
 * `smark_boms_project_name_unique` (supabase/migrations/0003_projects_boms.sql)
 * when a BOM name is reused within a project. Exported for direct unit
 * testing of the friendly-error mapping (plan/TESTING.md "unit: … unique-
 * name") without needing a live DB round trip.
 */
export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505");
}

export function friendlyNameError(name: string): string {
  return `A BOM named "${name}" already exists in this project.`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Line-row shaping
 * ──────────────────────────────────────────────────────────────────────────── */

interface BomLineInsert {
  line_no: number | null;
  references: string | null;
  qty: number | null;
  value: string | null;
  footprint: string | null;
  dnp: boolean;
  description: string | null;
  mpn: string | null;
  manufacturer: string | null;
  part_link: string | null;
  lcsc_pn: string | null;
  priority_note: string | null;
  extra: BomLineExtra | null;
}

function trimmedOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function isTruthyDnp(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = String(value ?? "").trim().toLowerCase();
  return s === "true" || s === "y" || s === "yes" || s === "1" || s === "dnp";
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Maps one uploaded (already-parsed) BOM line onto an insert row. */
function uploadedLineToInsert(line: UploadedBomLine): BomLineInsert {
  return {
    line_no: line.line_no,
    references: line.references,
    qty: line.qty,
    value: line.value,
    footprint: line.footprint,
    dnp: line.dnp,
    description: line.description,
    mpn: line.mpn,
    manufacturer: line.manufacturer,
    part_link: line.part_link,
    lcsc_pn: line.lcsc_pn,
    priority_note: line.priorityNote,
    extra: line.extra,
  };
}

/** Maps one Create-BOM grid row onto an insert row — standard keys → real columns, the rest → `extra`. */
function gridRowToInsert(row: CreateBomRowInput, columns: readonly BomTemplateColumn[], index: number): BomLineInsert {
  const extra: BomLineExtra = {};
  const insert: BomLineInsert = {
    line_no: index + 1,
    references: null,
    qty: null,
    value: null,
    footprint: null,
    dnp: false,
    description: null,
    mpn: null,
    manufacturer: null,
    part_link: null,
    lcsc_pn: null,
    priority_note: null,
    extra: null,
  };

  for (const column of columns) {
    const raw = row[column.key];
    if (raw === undefined) continue;

    switch (column.key) {
      case "line_no":
        insert.line_no = toNumberOrNull(raw) ?? insert.line_no;
        break;
      case "references":
        insert.references = trimmedOrNull(raw);
        break;
      case "qty":
        insert.qty = toNumberOrNull(raw);
        break;
      case "value":
        insert.value = trimmedOrNull(raw);
        break;
      case "footprint":
        insert.footprint = trimmedOrNull(raw);
        break;
      case "dnp":
        insert.dnp = isTruthyDnp(raw);
        break;
      case "description":
        insert.description = trimmedOrNull(raw);
        break;
      case "mpn":
        insert.mpn = trimmedOrNull(raw);
        break;
      case "manufacturer":
        insert.manufacturer = trimmedOrNull(raw);
        break;
      case "part_link":
        insert.part_link = trimmedOrNull(raw);
        break;
      case "lcsc_pn":
        insert.lcsc_pn = trimmedOrNull(raw);
        break;
      case "priority_note":
        insert.priority_note = trimmedOrNull(raw);
        break;
      default:
        if (raw !== null) extra[column.key] = raw as string | number | boolean | null;
    }
  }

  insert.extra = Object.keys(extra).length > 0 ? extra : null;
  return insert;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Reconcile
 * ──────────────────────────────────────────────────────────────────────────── */

/** Re-runs the matcher ladder for every line of a BOM at its current build_qty, writing the outcome back. */
export async function runReconcile(supabase: DB, bomId: string): Promise<void> {
  const { data: bom, error: bomError } = await supabase.from(TABLES.boms).select("id, build_qty").eq("id", bomId).single();
  if (bomError) throw bomError;

  const { data: lines, error: linesError } = await supabase
    .from(TABLES.bom_lines)
    .select("id, qty, mpn, lcsc_pn, dnp")
    .eq("bom_id", bomId);
  if (linesError) throw linesError;
  if (!lines || lines.length === 0) return;

  const catalog = await getReconcileCatalog(supabase);
  const outcomes = reconcileLines(lines, catalog, bom.build_qty);

  const CHUNK_SIZE = 25;
  for (let i = 0; i < outcomes.length; i += CHUNK_SIZE) {
    const chunk = outcomes.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map((outcome) =>
        supabase
          .from(TABLES.bom_lines)
          .update({
            matched_part_id: outcome.matchedPartId,
            match_state: outcome.matchState,
            match_confidence: outcome.matchConfidence,
          })
          .eq("id", outcome.id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw failed.error;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Upload BOM
 * ──────────────────────────────────────────────────────────────────────────── */

export interface CreateUploadedBomInput {
  projectId: string;
  name: string;
  priorityNotes: string | null;
  fileBuffer: Buffer;
  fileName: string;
  actorId: string;
}

export type CreateBomResult = { ok: true; bomId: string } | { ok: false; error: string };

export async function createUploadedBom(supabase: DB, storage: StoragePort, input: CreateUploadedBomInput): Promise<CreateBomResult> {
  const columns = await getEffectiveBomColumns(supabase);
  const customColumns = columns.filter((column) => column.is_custom);

  let parsed;
  try {
    parsed = parseUploadedBomBuffer(input.fileBuffer, customColumns);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not read that file — is it a valid .xlsx?" };
  }
  if (parsed.lines.length === 0) {
    return { ok: false, error: "No BOM lines found in that file — check it matches the standard template." };
  }

  // Sanitize the filename into the R2 key (matches lib/expenses/actions.ts,
  // lib/orders/receipts.ts, app/api/projects/documents/route.ts). A raw name
  // with spaces/special chars becomes percent-encoded in the object URL and
  // then trips SigV4 signing — the upload fails. Original name isn't needed in
  // the key (the BOM's display name is stored separately).
  const safeFileName = (input.fileName || "bom.xlsx").replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `boms/${input.projectId}/${Date.now()}-${safeFileName}`;
  const stored = await storage.put({
    key,
    body: input.fileBuffer,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const { data: bom, error } = await supabase
    .from(TABLES.boms)
    .insert({
      project_id: input.projectId,
      name: input.name,
      source_file_url: stored.url,
      created_in_app: false,
      line_count: parsed.lines.length,
      priority_notes: input.priorityNotes,
      uploaded_by: input.actorId,
    })
    .select("id")
    .single();
  if (error || !bom) {
    if (isUniqueViolation(error)) return { ok: false, error: friendlyNameError(input.name) };
    throw error ?? new Error("BOM insert returned no row");
  }

  const rows = parsed.lines.map((line) => ({ ...uploadedLineToInsert(line), bom_id: bom.id }));
  const { error: linesError } = await supabase.from(TABLES.bom_lines).insert(rows);
  if (linesError) throw linesError;

  await runReconcile(supabase, bom.id);
  return { ok: true, bomId: bom.id };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Create BOM in-app [R2-19]
 * ──────────────────────────────────────────────────────────────────────────── */

export interface CreateInAppBomInput {
  projectId: string;
  name: string;
  buildQty: number;
  priorityNotes: string | null;
  columns: BomTemplateColumn[];
  rows: CreateBomRowInput[];
  actorId: string;
}

export async function createInAppBom(supabase: DB, input: CreateInAppBomInput): Promise<CreateBomResult> {
  const rowErrors = validateBomRows(input.columns, input.rows);
  if (rowErrors.length > 0) return { ok: false, error: rowErrors[0]! };

  const { data: bom, error } = await supabase
    .from(TABLES.boms)
    .insert({
      project_id: input.projectId,
      name: input.name,
      created_in_app: true,
      line_count: input.rows.length,
      build_qty: input.buildQty,
      priority_notes: input.priorityNotes,
      uploaded_by: input.actorId,
    })
    .select("id")
    .single();
  if (error || !bom) {
    if (isUniqueViolation(error)) return { ok: false, error: friendlyNameError(input.name) };
    throw error ?? new Error("BOM insert returned no row");
  }

  const rows = input.rows.map((row, index) => ({ ...gridRowToInsert(row, input.columns, index), bom_id: bom.id }));
  const { error: linesError } = await supabase.from(TABLES.bom_lines).insert(rows);
  if (linesError) throw linesError;

  // Structure memory: on save, the column set becomes the company template — prefills the
  // next Create-BOM and the downloadable xlsx template alike (R2-19).
  await saveBomTemplate(supabase, input.columns, input.actorId);

  await runReconcile(supabase, bom.id);
  return { ok: true, bomId: bom.id };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Delete BOM
 * ──────────────────────────────────────────────────────────────────────────── */

export type DeleteBomResult = { ok: true } | { ok: false; error: string };

/**
 * Deletes a BOM; its lines go with it (`smark_bom_lines.bom_id` ON DELETE
 * CASCADE, 0003) and any released cross-project demand self-heals on the next
 * cart render (`recomputeShortfallCartItems`). A BOM with AI sourcing runs is
 * NOT deletable by design — `smark_agent_runs.bom_id` is RESTRICT (0004) to
 * protect run/cost history — that FK violation maps to a friendly message.
 */
export async function deleteBom(supabase: DB, bomId: string): Promise<DeleteBomResult> {
  const { data, error } = await supabase.from(TABLES.boms).delete().eq("id", bomId).select("id");
  if (error) {
    if (error.code === "23503") {
      return {
        ok: false,
        error:
          "This BOM has AI sourcing runs recorded against it, so it can't be deleted — run and cost history stay traceable. Archive the BOM instead (hides it, keeps history, reversible).",
      };
    }
    throw error;
  }
  // RLS blocking a delete surfaces as zero affected rows, not an error.
  if (!data || data.length === 0) {
    return { ok: false, error: "Could not delete this BOM — it may already be gone, or you don't have permission." };
  }
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Archive BOM (soft-delete) [0015]
 * ──────────────────────────────────────────────────────────────────────────── */

export type ArchiveBomResult = { ok: true } | { ok: false; error: string };

/**
 * Soft-archives (or un-archives) a BOM by stamping `smark_boms.archived_at`.
 * Unlike {@link deleteBom} this is allowed even when AI runs exist — the row
 * (and its run/cost history) is kept, just hidden. Its cross-project demand is
 * released via `v_part_demand` (which now filters `archived_at is null`) and
 * self-heals on the next cart render (`recomputeShortfallCartItems`), exactly
 * like a delete does. Reversible: pass `archived = false` to restore.
 */
export async function setBomArchived(supabase: DB, bomId: string, archived: boolean): Promise<ArchiveBomResult> {
  const { data, error } = await supabase
    .from(TABLES.boms)
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", bomId)
    .select("id");
  if (error) throw error;
  // RLS blocking the update surfaces as zero affected rows, not an error.
  if (!data || data.length === 0) {
    return { ok: false, error: "Could not update this BOM — it may be gone, or you don't have permission." };
  }
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Build-qty editor (×N banner) [R2-27]
 * ──────────────────────────────────────────────────────────────────────────── */

export async function setBuildQty(supabase: DB, bomId: string, buildQty: number): Promise<void> {
  const { error } = await supabase.from(TABLES.boms).update({ build_qty: buildQty }).eq("id", bomId);
  if (error) throw error;
  // Re-reconciles need at the new ×N immediately — see this package's report re: the missing
  // `run_stale` column for flagging a SAVED run (smark_boms.saved_run_id) as stale (WF-3 concern).
  await runReconcile(supabase, bomId);
}
