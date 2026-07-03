"use client";

import { useRef, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useToast } from "@/components/ui/toast";
import { uploadReceiptAction } from "@/lib/orders/actions";

export interface ReceiptUploadProps {
  orderId: string;
  receiptUrl: string | null;
  canWrite: boolean;
}

/**
 * Per-order receipt upload (§3-C, "separate but we will save this") + the
 * disabled "Extract prices" affordance — AI receipt extraction is out of
 * scope for this package (mission brief: leave disabled with a tooltip;
 * lib/ai / WF-3 wires it up against `smark_orders.receipt_extracted`).
 */
export function ReceiptUpload({ orderId, receiptUrl, canWrite }: ReceiptUploadProps) {
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File | undefined) {
    if (!file) return;
    const formData = new FormData();
    formData.set("orderId", orderId);
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadReceiptAction(formData);
      push({ msg: result.ok ? "Receipt uploaded" : result.error });
      if (inputRef.current) inputRef.current.value = "";
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
          <Button size="sm" variant="outline" loading={isPending} onClick={() => inputRef.current?.click()}>
            {receiptUrl ? "Replace" : "Upload"} receipt
          </Button>
        </>
      )}

      <span title="Coming soon — AI receipt price extraction">
        <Button size="sm" variant="ghost" disabled>
          Extract prices
        </Button>
      </span>
    </div>
  );
}
