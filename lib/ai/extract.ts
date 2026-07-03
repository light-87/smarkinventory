/**
 * lib/ai/extract.ts — small Claude-backed helpers (FEATURES.md §1: "small
 * calls for MPN normalization + receipt extraction"):
 *
 *  - `extractReceipt` — (file text | receipt photo) → `{ lines, total }`,
 *    the shape `smark_orders.receipt_extracted` expects (cart-orders'
 *    `ReceiptUpload` component already has a disabled "Extract prices"
 *    affordance wired to this — see components/cart/receipt-upload.tsx).
 *    Always user-confirmed before any write-back (FEATURES.md §12/§20 risk
 *    #3) — this module only returns a proposal, it never writes
 *    `smark_orders` itself.
 *  - `normalizeMpn` — best-effort MPN cleanup (used by import/receive
 *    matching alongside `lib/matcher`).
 *
 * No business context (client/project names) ever reaches these calls —
 * receipts and MPNs are catalog/vendor data, not aliased (§12 pass-through
 * exceptions already cover MPN; receipts don't carry client/project names
 * at all).
 */

import { z } from "zod";
import { getClaude, type ClaudeContentBlock, type ClaudePort } from "./client";

/* ────────────────────────────────────────────────────────────────────────────
 * Receipt extraction
 * ──────────────────────────────────────────────────────────────────────────── */

const ReceiptLineSchema = z.object({
  desc: z.string(),
  qty: z.number(),
  unit_price: z.number(),
});

const ReceiptExtractResultSchema = z.object({
  lines: z.array(ReceiptLineSchema),
  total: z.number().nullable(),
});

export type ReceiptExtractLine = z.infer<typeof ReceiptLineSchema>;
export type ReceiptExtractResult = z.infer<typeof ReceiptExtractResultSchema>;

export interface ExtractReceiptInput {
  /** Plain text already extracted from a PDF/CSV — mutually exclusive-ish with imageBase64 (either or both is fine). */
  fileText?: string;
  /** A photographed/scanned receipt. */
  imageBase64?: string;
  /** Defaults to "image/jpeg" — ignored if `imageBase64` is absent. */
  mediaType?: string;
}

const EXTRACTION_SYSTEM_PROMPT =
  "You extract line items from a distributor order receipt or invoice. " +
  'Respond with ONLY a JSON object of the exact shape {"lines":[{"desc":string,"qty":number,"unit_price":number}],"total":number|null} — no prose, no markdown fences. ' +
  "One entry per distinct line item; `qty` and `unit_price` are numbers, not strings; omit shipping/tax as separate lines but you may fold them into `total`.";

function buildExtractionContent(input: ExtractReceiptInput): string | ClaudeContentBlock[] {
  const instruction = "Extract the line items and total from this receipt.";
  if (input.imageBase64) {
    const blocks: ClaudeContentBlock[] = [
      { type: "image", source: { type: "base64", media_type: input.mediaType ?? "image/jpeg", data: input.imageBase64 } },
      { type: "text", text: input.fileText ? `${instruction}\n\n${input.fileText}` : instruction },
    ];
    return blocks;
  }
  return `${instruction}\n\n${input.fileText ?? ""}`;
}

/** Pulls the first `{...}` JSON object out of a response that may (against instructions) still wrap it in prose or a code fence. */
function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = /\{[\s\S]*\}/.exec(trimmed);
    if (!match) throw new Error("extractReceipt: no JSON object found in Claude's response.");
    return JSON.parse(match[0]);
  }
}

/**
 * Extracts `{ lines, total }` from a receipt. Throws on a malformed/refused
 * response rather than returning a half-populated result — callers (the
 * `/api/ai/extract-receipt` route, and eventually cart-orders' "Extract
 * prices" button) surface the error and let the user fill prices in by
 * hand, per §20 risk #3 ("always user-confirmed, never silent writes").
 */
export async function extractReceipt(input: ExtractReceiptInput, client: ClaudePort = getClaude()): Promise<ReceiptExtractResult> {
  if (!input.fileText && !input.imageBase64) {
    throw new Error("extractReceipt: provide fileText and/or imageBase64.");
  }

  const response = await client.complete({
    kind: "extract-receipt",
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildExtractionContent(input) }],
  });

  if (response.refused) {
    throw new Error(`extractReceipt: declined by Claude (${response.refusalCategory ?? "no category"}).`);
  }

  const parsed = extractJsonObject(response.text);
  return ReceiptExtractResultSchema.parse(parsed);
}

/* ────────────────────────────────────────────────────────────────────────────
 * MPN normalization
 * ──────────────────────────────────────────────────────────────────────────── */

const NormalizeMpnResultSchema = z.object({
  normalized: z.string(),
  confidence: z.number(),
});

export type NormalizeMpnResult = z.infer<typeof NormalizeMpnResultSchema>;

const NORMALIZE_SYSTEM_PROMPT =
  "You clean up a manufacturer part number (MPN) as typed by a distributor catalog or a human — strip distributor " +
  "catalog suffixes (e.g. Digikey's trailing \"-ND\"), fix stray whitespace/casing, but NEVER change the electrical " +
  'meaning of the part number. Respond with ONLY a JSON object {"normalized":string,"confidence":number} (confidence 0-1) — no prose.';

/**
 * Best-effort MPN cleanup — a lightweight wrapper over a "small call"
 * (§1), NOT a replacement for `lib/matcher`'s exact/fuzzy ladder. Used
 * where raw, messily-typed MPN text needs a canonical form before matching
 * (e.g. Stock List import rows).
 */
export async function normalizeMpn(rawMpn: string, client: ClaudePort = getClaude()): Promise<NormalizeMpnResult> {
  const trimmed = rawMpn.trim();
  if (!trimmed) return { normalized: "", confidence: 1 };

  const response = await client.complete({
    kind: "normalize-mpn",
    system: NORMALIZE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: `normalize: ${trimmed}` }],
  });

  if (response.refused) {
    // Non-fatal — fall back to the raw input rather than blocking an import row over a declined "small call".
    return { normalized: trimmed, confidence: 0 };
  }

  const parsed = extractJsonObject(response.text);
  return NormalizeMpnResultSchema.parse(parsed);
}
