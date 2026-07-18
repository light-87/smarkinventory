"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/input";
import { resolveAdHocLinesAction } from "@/lib/takeout/actions";
import { parsePastedTakeoutText, parseUploadedTakeoutFile } from "@/lib/takeout/parse";
import type { LoadedTakeoutSession } from "@/lib/takeout/types";

export interface UploadPasteCardProps {
  onResolved: (session: LoadedTakeoutSession) => void;
  onError: (message: string) => void;
  loading: boolean;
  onLoadingChange: (loading: boolean) => void;
}

/**
 * Empty-state panel #1 — "upload/paste zone" (plan/tab-bulk-pick.md §1).
 * The ×N multiplier is deliberately NOT here: it lives in the shared
 * MultiplierBanner shown once a session is loaded (default 1, "optional" per
 * FEATURES.md §5.6) so ad-hoc and project-BOM sources share one control
 * instead of duplicating the input in two places.
 */
export function UploadPasteCard({ onResolved, onError, loading, onLoadingChange }: UploadPasteCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasteText, setPasteText] = useState("");

  async function resolveLines(raw: ReturnType<typeof parsePastedTakeoutText>, sourceKind: "upload" | "paste", sourceLabel: string) {
    if (raw.length === 0) {
      onError("No pickable lines found — check the header row has Reference/Qty/Value columns (DNP and zero-qty lines are skipped).");
      return;
    }
    onLoadingChange(true);
    try {
      const session = await resolveAdHocLinesAction({ lines: raw, multiplier: 1, sourceKind, sourceLabel });
      onResolved(session);
      if (sourceKind === "paste") setPasteText("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not resolve those lines.");
    } finally {
      onLoadingChange(false);
    }
  }

  async function handleFile(file: File) {
    try {
      const bytes = await file.arrayBuffer();
      const raw = parseUploadedTakeoutFile(bytes);
      await resolveLines(raw, "upload", file.name);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not read that file — is it a .xlsx BOM export?");
    }
  }

  function handlePasteResolve() {
    const raw = parsePastedTakeoutText(pasteText);
    void resolveLines(raw, "paste", "Pasted BOM");
  }

  return (
    <Card padding="lg" className="flex flex-1 flex-col">
      <div className="text-[17px] text-snow">Upload or paste a BOM</div>
      <div className="mt-1 text-caption text-smoke">
        Any sheet with Reference / Qty / Value (+ MPN or LCSC Part #) columns — the same shape a project BOM uses.
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <Button className="mt-4 self-start" variant="outline" onClick={() => fileInputRef.current?.click()} loading={loading}>
        Upload .xlsx
      </Button>

      <Field className="mt-5" label="…or paste rows copied from a spreadsheet">
        <textarea
          aria-label="…or paste rows copied from a spreadsheet"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={5}
          placeholder={"Reference\tQty\tValue\tMPN\nC3,C69\t2\t0.1µF\tCL10B104MB8NNNC"}
          className="w-full rounded-lg border border-charcoal bg-surface-well p-3 font-mono text-xs text-snow outline-none placeholder:text-smoke focus:border-smark-orange"
        />
      </Field>
      <Button
        className="mt-3 self-start"
        variant="accent-outline"
        onClick={handlePasteResolve}
        loading={loading}
        disabled={!pasteText.trim()}
      >
        Resolve pasted lines
      </Button>
    </Card>
  );
}
