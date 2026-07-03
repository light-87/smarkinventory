/**
 * lib/orders/receipt-extract.ts — "Extract prices" (plan/tab-on-order.md §3-C
 * · FEATURES.md §5.12): reads a placed order's stored receipt back, calls
 * `lib/ai`'s `extractReceipt` (MockAdapter's seeded fixture when no
 * `ANTHROPIC_API_KEY` — CLAUDE.md "NO LIVE KEYS EXIST"), and — ONLY once the
 * user confirms the mapping in the dialog — writes the corrected/filled
 * `unit_price` back onto `smark_order_lines` + the originating
 * `smark_cart_items` row, then stamps `smark_orders.receipt_extracted`.
 *
 * Two entry points, matching the two-step UI flow:
 *  - `extractOrderReceipt` — read-only. Fetches the receipt, calls Claude,
 *    returns the proposal. NEVER writes `smark_order_lines`/`smark_cart_items`
 *    (FEATURES §12/§20 risk #3: "always user-confirmed, never silent
 *    writes") — the one write it does make is the "extraction is ready to
 *    review" notification, not a price.
 *  - `applyReceiptExtraction` — the confirm step. Takes the (possibly
 *    user-edited) mapping straight from the dialog and writes it.
 *
 * ── reading the receipt back bypasses `StoragePort.get()` (schema gap) ──
 * `uploadReceipt` (lib/orders/receipts.ts) only persists `receipt_url` on
 * the order — there is no `receipt_key` column to hand back to
 * `StoragePort.get(key)` (migrations 0001–0005 are frozen for this package,
 * docs/OWNERSHIP.md — only the portal package owns 0006). `receipt_url` is
 * itself a fetchable-URL contract though (`StoragePutResult.url` — a
 * `file://` URL for `LocalDiskAdapter` today, a real HTTP(S)/presigned URL
 * once `R2Adapter` is implemented), so this reads bytes straight off that
 * URL instead of through the port: `node:fs` for `file://`, `fetch` for
 * anything else. Flagged notes-for-integrator — a `receipt_key` column would
 * retire this in favor of a clean `StoragePort.get()` call.
 *
 * ── no PDF text extraction ──
 * Non-image receipts (a real distributor invoice is usually a PDF) are
 * decoded as UTF-8 "text" with no OCR/PDF-parsing step — no PDF-text library
 * is installed (`pdf-lib`, already in the stack, only creates/edits PDFs; it
 * has no text-extraction API). That's fine for the plaintext/CSV receipts
 * this exercises today and for `MockAdapter` (no live key exists yet), but a
 * REAL Claude call against a real scanned PDF invoice would see garbled
 * bytes-as-text. Flagged notes-for-integrator: wire a PDF-to-text step (or a
 * real Claude "document" content block, once `ClaudeContentBlock` grows one)
 * before `ANTHROPIC_API_KEY` goes live.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";
import { extractReceipt, type ReceiptExtractResult } from "@/lib/ai";
import { notify } from "@/lib/notifications";
import { orderHref } from "@/lib/search/queries";

type DB = SupabaseClient<Database>;

/* ────────────────────────────────────────────────────────────────────────────
 * Reading the stored receipt back (see module doc)
 * ──────────────────────────────────────────────────────────────────────────── */

const EXTENSION_CONTENT_TYPE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** `LocalDiskAdapter`'s meta sidecar isn't reachable from a bare URL — best-effort guess from the filename extension for the `file://` path. */
function guessContentTypeFromUrl(url: string): string | null {
  const withoutQuery = url.split(/[?#]/)[0] ?? "";
  const match = /\.[a-z0-9]+$/i.exec(withoutQuery);
  return match ? (EXTENSION_CONTENT_TYPE[match[0].toLowerCase()] ?? null) : null;
}

async function fetchReceiptBytes(url: string): Promise<{ body: Uint8Array; contentType: string | null }> {
  if (url.startsWith("file://")) {
    const body = await readFile(fileURLToPath(url));
    return { body: new Uint8Array(body), contentType: guessContentTypeFromUrl(url) };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch the stored receipt (HTTP ${res.status}).`);
  return { body: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") };
}

function isImageContentType(contentType: string | null): boolean {
  return Boolean(contentType && contentType.startsWith("image/"));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Extract — read-only, returns a proposal
 * ──────────────────────────────────────────────────────────────────────────── */

export type ExtractOrderReceiptResult =
  | { ok: true; result: ReceiptExtractResult }
  | { ok: false; error: string };

export async function extractOrderReceipt(supabase: DB, orderId: string): Promise<ExtractOrderReceiptResult> {
  const { data: order, error } = await supabase
    .from(TABLES.orders)
    .select("id, po_number, receipt_url, placed_by")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order) return { ok: false, error: "Order not found." };
  if (!order.receipt_url) return { ok: false, error: "Upload a receipt before extracting prices." };

  let bytes: { body: Uint8Array; contentType: string | null };
  try {
    bytes = await fetchReceiptBytes(order.receipt_url);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not read the stored receipt." };
  }

  const input = isImageContentType(bytes.contentType)
    ? { imageBase64: Buffer.from(bytes.body).toString("base64"), mediaType: bytes.contentType ?? "image/jpeg" }
    : { fileText: Buffer.from(bytes.body).toString("utf8") };

  let result: ReceiptExtractResult;
  try {
    result = await extractReceipt(input);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Receipt extraction failed — try again or fill prices in by hand." };
  }

  if (order.placed_by) {
    // No dedicated NotificationKind exists for "an AI task finished, come
    // review it" (types/db.ts's enum is integrator-frozen — see
    // docs/OWNERSHIP.md) — `run_done` ("agent run finished") is the closest
    // existing semantic fit, reused here with its own title/body/link
    // (`notify()` only constrains `kind`, not the copy). Flagged
    // notes-for-integrator: a `receipt_extracted` kind would be cleaner.
    await notify(supabase, {
      userIds: [order.placed_by],
      kind: "run_done",
      title: `Receipt extracted for PO ${order.po_number}`,
      body: `${result.lines.length} line${result.lines.length === 1 ? "" : "s"} parsed — review and confirm in Cart.`,
      link: orderHref(order.id),
    });
  }

  return { ok: true, result };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Apply — the confirm step, the only place this writes a price
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ApplyReceiptExtractionLine {
  /** Every `smark_order_lines.id` in the matched group (lib/orders/receipt-map.ts `OrderLineGroup.orderLineIds`) — a checkout split fans one cart line across several order_lines, and every one of them gets the same corrected price. */
  orderLineIds: string[];
  /** The originating cart line, if still resolvable — its `unit_price` gets the same correction ("cart-source records", plan/tab-on-order.md §3-C). Null for a line whose cart item no longer exists. */
  cartItemId: string | null;
  unitPrice: number;
}

export type ApplyReceiptExtractionResult =
  | { ok: true; updatedOrderLines: number; updatedCartItems: number }
  | { ok: false; error: string };

/**
 * Writes the user-confirmed mapping: every listed order line gets its
 * `unit_price` set to the confirmed value, its originating cart item (when
 * still resolvable) gets the same correction, and the order's
 * `receipt_extracted` is stamped with the raw AI output + what was actually
 * applied (an audit trail of "what we now believe this receipt says", not
 * just the unreviewed AI guess).
 */
export async function applyReceiptExtraction(
  supabase: DB,
  orderId: string,
  raw: ReceiptExtractResult,
  lines: readonly ApplyReceiptExtractionLine[],
): Promise<ApplyReceiptExtractionResult> {
  const { data: order, error } = await supabase.from(TABLES.orders).select("id").eq("id", orderId).maybeSingle();
  if (error) throw error;
  if (!order) return { ok: false, error: "Order not found." };

  const toApply = lines.filter((line) => line.orderLineIds.length > 0 && Number.isFinite(line.unitPrice) && line.unitPrice >= 0);
  if (toApply.length === 0) {
    return { ok: false, error: "Map at least one line to a part before confirming." };
  }

  let updatedOrderLines = 0;
  let updatedCartItems = 0;

  for (const line of toApply) {
    const { data: updatedRows, error: lineError } = await supabase
      .from(TABLES.order_lines)
      .update({ unit_price: line.unitPrice })
      .eq("order_id", orderId)
      .in("id", line.orderLineIds)
      .select("id");
    if (lineError) throw lineError;
    updatedOrderLines += updatedRows?.length ?? 0;

    if (line.cartItemId) {
      const { data: updatedCartRows, error: cartError } = await supabase
        .from(TABLES.cart_items)
        .update({ unit_price: line.unitPrice })
        .eq("id", line.cartItemId)
        .select("id");
      if (cartError) throw cartError;
      updatedCartItems += updatedCartRows?.length ?? 0;
    }
  }

  const { error: stampError } = await supabase
    .from(TABLES.orders)
    .update({
      receipt_extracted: {
        raw,
        appliedAt: new Date().toISOString(),
        lines: toApply,
      },
    })
    .eq("id", orderId);
  if (stampError) throw stampError;

  return { ok: true, updatedOrderLines, updatedCartItems };
}
