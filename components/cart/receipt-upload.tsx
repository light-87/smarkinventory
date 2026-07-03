"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useToast } from "@/components/ui/toast";
import { extractOrderReceiptAction, uploadReceiptAction } from "@/lib/orders/actions";
import type { OrderGroupView } from "@/lib/orders/queries";
import type { ReceiptExtractResult } from "@/lib/ai";
import { ReceiptExtractDialog } from "./receipt-extract-dialog";

type OrderLineViewItem = OrderGroupView["lines"][number];

export interface ReceiptUploadProps {
  orderId: string;
  poNumber: string;
  receiptUrl: string | null;
  canWrite: boolean;
  /** This order's lines — needed to map extracted receipt lines against (lib/orders/receipt-map.ts). */
  lines: readonly OrderLineViewItem[];
}

/**
 * Per-order receipt upload (§3-C, "separate but we will save this") +
 * "Extract prices" (WF-3: lib/ai + lib/orders/receipt-extract.ts). Extraction
 * only ever PROPOSES — nothing is written until the confirm dialog's
 * "Confirm & apply" (FEATURES §12/§20 risk #3).
 */
export function ReceiptUpload({ orderId, poNumber, receiptUrl, canWrite, lines }: ReceiptUploadProps) {
  const { push } = useToast();
  const [isUploading, startUpload] = useTransition();
  const [isExtracting, startExtract] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const [extraction, setExtraction] = useState<ReceiptExtractResult | null>(null);

  function handleFile(file: File | undefined) {
    if (!file) return;
    const formData = new FormData();
    formData.set("orderId", orderId);
    formData.set("file", file);
    startUpload(async () => {
      const result = await uploadReceiptAction(formData);
      push({ msg: result.ok ? "Receipt uploaded" : result.error });
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function extract() {
    startExtract(async () => {
      const result = await extractOrderReceiptAction({ orderId });
      if (result.ok) {
        const count = result.result.lines.length;
        push({ msg: count > 0 ? `Extracted ${count} line${count === 1 ? "" : "s"} — review and confirm.` : "No line items found on this receipt." });
        if (count > 0) setExtraction(result.result);
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {receiptUrl ? (
        <a href={receiptUrl} target="_blank" rel="noreferrer" className="no-underline">
          <Chip tone="success">Receipt attached</Chip>
        </a>
      ) : (
        <Chip tone="default">No receipt yet</Chip>
      )}

      {canWrite && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <Button size="sm" variant="outline" loading={isUploading} onClick={() => inputRef.current?.click()}>
            {receiptUrl ? "Replace" : "Upload"} receipt
          </Button>
        </>
      )}

      <span title={receiptUrl ? undefined : "Upload a receipt first"}>
        <Button
          size="sm"
          variant="ghost"
          disabled={!receiptUrl || !canWrite}
          loading={isExtracting}
          onClick={extract}
        >
          Extract prices
        </Button>
      </span>

      {extraction && (
        <ReceiptExtractDialog
          open
          onClose={() => setExtraction(null)}
          orderId={orderId}
          poNumber={poNumber}
          extraction={extraction}
          lines={lines}
        />
      )}
    </div>
  );
}
