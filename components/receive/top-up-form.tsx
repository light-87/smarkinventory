"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { CameraScanner } from "@/components/scan/camera-scanner";
import { CameraIcon } from "@/components/scan/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { findPartForTopUpAction, topUpExistingPartAction, undoReceiveMovementAction } from "@/lib/receive/actions";
import type { TopUpPreview } from "@/lib/receive/queries";

export interface TopUpFormProps {
  /** Preloaded PID from the duplicate guard's "Top up instead" (R2-31). */
  presetPid?: string | null;
}

/** "Top up existing" card — scan/type PID, add qty, NO reprint (plan/tab-receive.md §2A). */
export function TopUpForm({ presetPid }: TopUpFormProps) {
  const { push } = useToast();
  const [isFinding, startFind] = useTransition();
  const [isAdding, startAdd] = useTransition();
  const [code, setCode] = useState(presetPid ?? "");
  const [found, setFound] = useState<TopUpPreview | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [qty, setQty] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);

  const handleFind = useCallback((nextCode: string) => {
    if (!nextCode.trim()) return;
    startFind(async () => {
      setNotFound(false);
      const result = await findPartForTopUpAction(nextCode);
      setFound(result);
      setNotFound(result === null);
    });
  }, []);

  /** Camera onDetect — fills the PID field and looks it up exactly as typing + Enter would. */
  const handleCameraDetect = useCallback(
    (detectedCode: string) => {
      setCode(detectedCode);
      handleFind(detectedCode);
    },
    [handleFind],
  );

  // `code`/`found` already seed from `presetPid` at mount (see useState above) —
  // ReceiveScreen only ever mounts a FRESH TopUpForm when switching tabs, so this
  // effect just kicks off the lookup once; it never needs to re-sync `code`.
  useEffect(() => {
    if (presetPid) handleFind(presetPid);
  }, [presetPid, handleFind]);

  function handleAdd() {
    const parsedQty = Number.parseInt(qty, 10);
    if (!found || !Number.isFinite(parsedQty) || parsedQty <= 0) {
      push({ msg: "Enter a valid quantity" });
      return;
    }
    startAdd(async () => {
      const result = await topUpExistingPartAction({ code: found.internalPid, qty: parsedQty });
      if (result.ok) {
        const movementId = result.movementId;
        push({
          msg: `Added ${parsedQty} × ${result.internalPid} — now ${result.newQty.toLocaleString("en-IN")} in stock`,
          undo: true,
          onUndo: () => {
            void undoReceiveMovementAction(movementId).then((undoResult) => {
              if (!undoResult.ok) push({ msg: undoResult.error });
            });
          },
        });
        setQty("");
        setFound(null);
        setCode("");
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <Card padding="lg">
      <div className="mb-4 text-[13px] text-smoke">
        Already in the system — scan its ESD label and add the new quantity. Its QR stays, no reprint.
      </div>

      <div className="flex flex-wrap gap-3">
        <Field className="min-w-[220px] flex-1" label="PID">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleFind(code);
            }}
            placeholder="Scan or type a PID — e.g. SMK-000101"
            mono
          />
        </Field>
        <Button size="lg" onClick={() => handleFind(code)} loading={isFinding} className="self-end">
          Find
        </Button>
        <button
          type="button"
          aria-label="Scan with camera"
          onClick={() => setCameraOpen(true)}
          className="flex h-11 w-11 flex-none items-center justify-center self-end rounded-full border border-charcoal text-smoke transition-colors hover:border-slate hover:text-snow"
        >
          <span aria-hidden className="size-4 [&_svg]:size-full">
            <CameraIcon />
          </span>
        </button>
      </div>

      <CameraScanner open={cameraOpen} onClose={() => setCameraOpen(false)} onDetect={handleCameraDetect} title="Scan a PID" />

      {notFound && <div className="mt-3 text-[13px] text-smark-orange-soft">No part found for &ldquo;{code}&rdquo;.</div>}

      {found && (
        <div className="mt-4 rounded-xl border border-charcoal p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-mono text-lg text-snow">{found.internalPid}</div>
              {found.mpn && <div className="mt-0.5 font-mono text-xs text-silver-mist">{found.mpn}</div>}
              <div className="mt-1 text-[13px] text-smoke">
                {[found.value, found.package].filter(Boolean).join(" · ")}
                {found.boxName && ` · Box ${found.boxName}${found.shelfCode ? ` · Shelf ${found.shelfCode}` : ""}`}
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-2xl text-snow">{found.currentQty.toLocaleString("en-IN")}</div>
              <div className="text-[11px] text-smoke">in stock now</div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-[13px] text-smoke">Add quantity</span>
            <Input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="Qty"
              mono
              inputMode="numeric"
              className="w-28"
            />
            <Button size="md" onClick={handleAdd} loading={isAdding}>
              Add to stock
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
