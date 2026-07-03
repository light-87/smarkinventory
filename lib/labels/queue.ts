/**
 * lib/labels/queue.ts — label print QUEUE writes (FEATURES.md §8 · R2-35).
 *
 * Every label creation path (new part, put-away of a new part, onboarding
 * assign, new big box) goes through `queueLabelForPart` / `queueLabelForBigBox`
 * — never prints immediately. The DB carries the actual invariant
 * (`smark_qr_labels_one_per_target unique(target_type, target_id)` —
 * migration 0002): both helpers treat a unique-violation as "already
 * labeled, nothing to do" rather than an error, so callers can call them
 * unconditionally on every save without special-casing "is this a repeat?".
 *
 * Cross-package read import: shelves + part-detail read labels via this
 * module's query helper (OWNERSHIP.md "lib/labels (receive) ← shelves/part-detail").
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";

type DB = SupabaseClient<Database>;

/** Postgres unique-violation SQLSTATE — used to make label creation idempotent. */
export function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505",
  );
}

export interface LabelPartInput {
  id: string;
  internal_pid: string;
  mpn?: string | null;
  value?: string | null;
  package?: string | null;
}

/** ESD-plastic label body — PID on its own line so it reads first when scanned/printed small. */
export function buildPartHumanText(part: LabelPartInput): string {
  const specs = [part.value, part.package].filter(Boolean).join(" · ");
  return [part.internal_pid, part.mpn ?? undefined, specs || undefined].filter(Boolean).join("\n");
}

export interface LabelBoxInput {
  id: string;
  name: string;
  category?: string | null;
  shelfCode: string;
}

/** Big-Box label body (FEATURES §8: "encodes box id → live contents"). */
export function buildBigBoxHumanText(box: LabelBoxInput): string {
  return [`BOX ${box.name}`, box.category ?? undefined, `Shelf ${box.shelfCode}`].filter(Boolean).join(" · ");
}

/**
 * Queues exactly one ESD-plastic label for a part. Returns `null` (no-op) if
 * this part already has one — the print-rule invariant ("new part → exactly
 * one label, existing part never reprints") lives at the DB unique index;
 * this function just makes calling it unconditionally safe.
 */
export async function queueLabelForPart(supabase: DB, part: LabelPartInput) {
  const { data, error } = await supabase
    .from(TABLES.qr_labels)
    .insert({
      target_type: "part",
      target_id: part.id,
      code_value: part.internal_pid,
      human_text: buildPartHumanText(part),
      print_status: "queued",
    })
    .select()
    .single();

  if (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
  return data;
}

/**
 * Queues exactly one label for a Big Box and links it back via
 * `smark_big_boxes.qr_label_id`. `code_value` is the box's human short code
 * (`name`, e.g. `A-03`) — matching the part label's use of `internal_pid`
 * rather than the row's uuid, since both are what a scanner/print sheet
 * shows a human.
 */
export async function queueLabelForBigBox(supabase: DB, box: LabelBoxInput) {
  const { data, error } = await supabase
    .from(TABLES.qr_labels)
    .insert({
      target_type: "big_box",
      target_id: box.id,
      code_value: box.name,
      human_text: buildBigBoxHumanText(box),
      print_status: "queued",
    })
    .select()
    .single();

  if (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }

  await supabase.from(TABLES.big_boxes).update({ qr_label_id: data.id }).eq("id", box.id);
  return data;
}

/** Count for the Receive "Print queue" strip. */
export async function getQueuedLabelCount(supabase: DB): Promise<number> {
  const { count, error } = await supabase
    .from(TABLES.qr_labels)
    .select("id", { count: "exact", head: true })
    .eq("print_status", "queued");
  if (error) throw error;
  return count ?? 0;
}
