/**
 * lib/labels/print.ts — "Print sheet" batch job [R2-35].
 *
 * Factored out of app/api/labels/print-sheet/route.ts so it's callable with
 * any `SupabaseClient`/`StoragePort` pair — the Route Handler wires the
 * per-request RLS client + `getStorageAdapter()`, while
 * tests/invariants/print-rule.test.ts wires a service-role client + a
 * scratch `LocalDiskAdapter` to exercise the exact same code path.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";
import type { StoragePort } from "@/lib/storage";
import { chunk } from "@/lib/supabase/select-all";
import { buildAveryPdf } from "./avery";

type DB = SupabaseClient<Database>;

export type PrintQueuedLabelsResult =
  | { ok: true; url: string; count: number; remaining: number; batchId: string }
  | { ok: false; error: string };

/**
 * Most labels one sheet renders in a single request.
 *
 * Each label draws its own QR bitmap, so the work is linear and unbounded: the
 * onboarding queue after the stock-list import is ~1,750 parts, and putting
 * them all away before printing would ask one request to draw ~1,750 QR codes
 * and return a ~220-page PDF. The remainder stays queued and the caller is told
 * how many are left, which is a far better outcome than a request that runs
 * past the function timeout and prints nothing at all.
 */
export const MAX_LABELS_PER_SHEET = 400;

/** Renders the queued labels onto one Avery PDF, stores it, and flips those rows to `printed`. */
export async function printQueuedLabels(supabase: DB, storage: StoragePort): Promise<PrintQueuedLabelsResult> {
  const { count: queuedCount, error: countError } = await supabase
    .from(TABLES.qr_labels)
    .select("id", { count: "exact", head: true })
    .eq("print_status", "queued");
  if (countError) throw countError;

  const { data: queued, error } = await supabase
    .from(TABLES.qr_labels)
    .select("id, code_value, human_text")
    .eq("print_status", "queued")
    .order("created_at", { ascending: true })
    .limit(MAX_LABELS_PER_SHEET);
  if (error) throw error;
  if (!queued || queued.length === 0) return { ok: false, error: "Nothing queued to print." };

  const remaining = Math.max(0, (queuedCount ?? queued.length) - queued.length);

  const pdfBytes = await buildAveryPdf(
    queued.map((label) => ({ codeValue: label.code_value, humanText: label.human_text })),
  );

  const batchId = randomUUID();
  const key = `labels/batches/${batchId}.pdf`;
  const putResult = await storage.put({ key, body: pdfBytes, contentType: "application/pdf" });
  const url = await storage.signedUrl(key).catch(() => putResult.url);

  // Chunked: `.in()` rides in the URL, so flipping a few hundred ids in one
  // call is a query string long enough for PostgREST to reject outright.
  const printedAt = new Date().toISOString();
  for (const idChunk of chunk(queued.map((label) => label.id))) {
    const { error: updateError } = await supabase
      .from(TABLES.qr_labels)
      .update({ print_status: "printed", printed_at: printedAt, batch_id: batchId, label_pdf_url: url })
      .in("id", idChunk);
    if (updateError) throw updateError;
  }

  return { ok: true, url, count: queued.length, remaining, batchId };
}
