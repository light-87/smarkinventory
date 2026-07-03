/**
 * lib/orders/receipts.ts — receipt upload for a placed order (plan/tab-on-order.md
 * §3-C: "Upload order details / receipt (per order, optional) → R2").
 *
 * Goes through `StoragePort` (lib/storage), never Supabase Storage or a raw
 * disk/S3 call (CLAUDE.md / FEATURES.md §3). AI extraction ("Extract prices")
 * is explicitly out of scope for this package (mission brief: "leave
 * disabled with tooltip" — WF-3/lib/ai lands that later) — this module only
 * stores the file and stamps `receipt_url`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";
import type { StoragePort } from "@/lib/storage";

type DB = SupabaseClient<Database>;

export interface ReceiptUploadInput {
  orderId: string;
  fileName: string;
  contentType: string | null;
  body: Uint8Array;
}

export type UploadReceiptResult = { ok: true; url: string } | { ok: false; error: string };

/** Strips path-unsafe characters so the filename is a safe storage-key segment. */
function sanitizeFileName(name: string): string {
  const base = name.trim().replace(/[/\\]/g, "_").replace(/\.\./g, "_");
  return base || "receipt";
}

export async function uploadReceipt(supabase: DB, storage: StoragePort, input: ReceiptUploadInput): Promise<UploadReceiptResult> {
  const { data: order, error } = await supabase.from(TABLES.orders).select("id, po_number").eq("id", input.orderId).maybeSingle();
  if (error) throw error;
  if (!order) return { ok: false, error: "Order not found." };

  const key = `receipts/${order.po_number}/${Date.now()}-${sanitizeFileName(input.fileName)}`;
  const put = await storage.put({ key, body: input.body, contentType: input.contentType ?? undefined });

  const { error: updateError } = await supabase.from(TABLES.orders).update({ receipt_url: put.url }).eq("id", input.orderId);
  if (updateError) throw updateError;

  return { ok: true, url: put.url };
}
