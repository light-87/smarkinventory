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
import { chunk, selectByIds } from "@/lib/supabase/select-all";
import { buildAveryPdf } from "./avery";
import { boxLabelLines, partLabelLines } from "./content";

type DB = SupabaseClient<Database>;

interface QueuedLabelRow {
  id: string;
  code_value: string;
  human_text: string | null;
  target_type: string;
  target_id: string;
}

/**
 * Rebuilds every queued label's text from the part or box it points at.
 *
 * `smark_qr_labels.human_text` is a snapshot taken when the label was queued,
 * and the live queue proves how quickly that goes stale: SMK-001751 was queued
 * carrying its neighbour's MPN and still printed it after the part was
 * corrected, SMK-001754 printed the single character "2" because that was its
 * `value` at the time, and a capacitor still printed "0603 (1608 Metric)" after
 * the metric notation had been stripped from the catalogue. None of those are
 * fixable by editing the part, which is exactly what someone would try.
 *
 * So the snapshot is now the fallback, used only when the target row is gone.
 */
async function labelTextByLabelId(supabase: DB, labels: readonly QueuedLabelRow[]): Promise<Map<string, string>> {
  const idsOf = (type: string) => [...new Set(labels.filter((l) => l.target_type === type).map((l) => l.target_id))];

  const parts = await selectByIds(idsOf("part"), (ids) =>
    supabase
      .from(TABLES.parts)
      .select("id, internal_pid, mpn, value, package, voltage, description, category, attributes")
      .in("id", ids),
  );
  const partsById = new Map(parts.map((part) => [part.id, part]));

  const boxes = await selectByIds(idsOf("big_box"), (ids) =>
    supabase.from(TABLES.big_boxes).select("id, name, category, shelf_id").in("id", ids),
  );
  const shelves = await selectByIds([...new Set(boxes.map((box) => box.shelf_id))], (ids) =>
    supabase.from(TABLES.shelves).select("id, code").in("id", ids),
  );
  const shelfCodeById = new Map(shelves.map((shelf) => [shelf.id, shelf.code]));

  const text = new Map<string, string>();
  for (const label of labels) {
    const part = partsById.get(label.target_id);
    if (part) {
      text.set(label.id, partLabelLines(part).join("\n"));
      continue;
    }
    const box = boxes.find((candidate) => candidate.id === label.target_id);
    if (box) {
      const lines = boxLabelLines({ ...box, shelfCode: shelfCodeById.get(box.shelf_id) ?? "?" });
      text.set(label.id, lines.join("\n"));
      continue;
    }
    if (label.human_text) text.set(label.id, label.human_text);
  }
  return text;
}

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

/**
 * Renders the queued labels onto one Avery PDF and stores it.
 *
 * It does NOT clear the queue. It used to: opening the sheet flipped every
 * label to `printed`, so looking at what was waiting was enough to lose it
 * (client, 2026-08-13: "print queue should not be auto cleaned unless cleaned
 * manually — once we open for viewing it just gets lost"). Viewing and
 * clearing are separate acts now; `clearPrintQueue` is the deliberate one.
 *
 * The batch id and PDF URL are still stamped on the rows so a label can be
 * traced to the sheet it was drawn on, whether or not it is later cleared.
 */
export async function printQueuedLabels(supabase: DB, storage: StoragePort): Promise<PrintQueuedLabelsResult> {
  const { count: queuedCount, error: countError } = await supabase
    .from(TABLES.qr_labels)
    .select("id", { count: "exact", head: true })
    .eq("print_status", "queued");
  if (countError) throw countError;

  const { data: queued, error } = await supabase
    .from(TABLES.qr_labels)
    .select("id, code_value, human_text, target_type, target_id")
    .eq("print_status", "queued")
    .order("created_at", { ascending: true })
    .limit(MAX_LABELS_PER_SHEET);
  if (error) throw error;
  if (!queued || queued.length === 0) return { ok: false, error: "Nothing queued to print." };

  const remaining = Math.max(0, (queuedCount ?? queued.length) - queued.length);

  const liveText = await labelTextByLabelId(supabase, queued);
  const pdfBytes = await buildAveryPdf(
    queued.map((label) => ({
      codeValue: label.code_value,
      humanText: liveText.get(label.id) ?? label.human_text,
    })),
  );

  const batchId = randomUUID();
  const key = `labels/batches/${batchId}.pdf`;
  const putResult = await storage.put({ key, body: pdfBytes, contentType: "application/pdf" });
  const url = await storage.signedUrl(key).catch(() => putResult.url);

  // Chunked: `.in()` rides in the URL, so stamping a few hundred ids in one
  // call is a query string long enough for PostgREST to reject outright.
  // `print_status` is deliberately untouched — see this function's doc.
  for (const idChunk of chunk(queued.map((label) => label.id))) {
    const { error: updateError } = await supabase
      .from(TABLES.qr_labels)
      .update({ batch_id: batchId, label_pdf_url: url })
      .in("id", idChunk);
    if (updateError) throw updateError;
  }

  return { ok: true, url, count: queued.length, remaining, batchId };
}

export type ClearPrintQueueResult = { ok: true; cleared: number } | { ok: false; error: string };

/**
 * Marks every queued label printed — the deliberate "I have the paper in my
 * hand" step, separate from rendering the sheet.
 */
export async function clearPrintQueue(supabase: DB): Promise<ClearPrintQueueResult> {
  const { data: queued, error } = await supabase
    .from(TABLES.qr_labels)
    .select("id")
    .eq("print_status", "queued");
  if (error) throw error;
  if (!queued || queued.length === 0) return { ok: false, error: "Nothing queued to clear." };

  const printedAt = new Date().toISOString();
  for (const idChunk of chunk(queued.map((label) => label.id))) {
    const { error: updateError } = await supabase
      .from(TABLES.qr_labels)
      .update({ print_status: "printed", printed_at: printedAt })
      .in("id", idChunk);
    if (updateError) throw updateError;
  }
  return { ok: true, cleared: queued.length };
}
