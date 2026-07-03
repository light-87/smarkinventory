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
import { buildAveryPdf } from "./avery";

type DB = SupabaseClient<Database>;

export type PrintQueuedLabelsResult =
  | { ok: true; url: string; count: number; batchId: string }
  | { ok: false; error: string };

/** Renders every queued label onto one Avery PDF, stores it, and flips those rows to `printed`. */
export async function printQueuedLabels(supabase: DB, storage: StoragePort): Promise<PrintQueuedLabelsResult> {
  const { data: queued, error } = await supabase
    .from(TABLES.qr_labels)
    .select("id, code_value, human_text")
    .eq("print_status", "queued")
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!queued || queued.length === 0) return { ok: false, error: "Nothing queued to print." };

  const pdfBytes = await buildAveryPdf(
    queued.map((label) => ({ codeValue: label.code_value, humanText: label.human_text })),
  );

  const batchId = randomUUID();
  const key = `labels/batches/${batchId}.pdf`;
  const putResult = await storage.put({ key, body: pdfBytes, contentType: "application/pdf" });
  const url = await storage.signedUrl(key).catch(() => putResult.url);

  const printedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from(TABLES.qr_labels)
    .update({ print_status: "printed", printed_at: printedAt, batch_id: batchId, label_pdf_url: url })
    .in(
      "id",
      queued.map((label) => label.id),
    );
  if (updateError) throw updateError;

  return { ok: true, url, count: queued.length, batchId };
}
