"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { printBigBoxLabel, renameBigBox } from "@/app/(app)/shelves/actions";

export interface BoxDetailCardProps {
  boxId: string;
  boxCode: string;
  shelfCode: string;
  qrDataUrl: string;
  labelText: string;
  lastAuditedAt: string | null;
  /** Owner/employee only (FEATURES.md §2 — accountant is read-only on Shelves). */
  canPrint: boolean;
}

/**
 * Left card on box detail (prototype): box code + shelf, real-encoded
 * Big-Box QR, label text, "Print Big-Box label" → queue.
 */
export function BoxDetailCard({
  boxId,
  boxCode,
  shelfCode,
  qrDataUrl,
  labelText,
  lastAuditedAt,
  canPrint,
}: BoxDetailCardProps) {
  const { push } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(boxCode);
  const [draftShelf, setDraftShelf] = useState(shelfCode);
  const [isSaving, startSaving] = useTransition();

  function handleRename() {
    startSaving(async () => {
      const result = await renameBigBox({ boxId, name: draftName, shelfCode: draftShelf });
      if (result.ok) {
        setEditing(false);
        push({ msg: "Box updated" });
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  function handlePrint() {
    startTransition(async () => {
      try {
        const result = await printBigBoxLabel(boxId);
        push({
          msg:
            result.status === "requeued"
              ? "Big-Box label re-queued for printing"
              : "Big-Box label queued for printing",
        });
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Could not queue the label." });
      }
    });
  }

  return (
    <div className="w-full flex-none rounded-2xl border border-charcoal p-5 sm:w-80">
      <div className="font-mono text-xl text-snow">Box {boxCode}</div>
      <div className="mt-1 text-[15px] text-smoke">Shelf {shelfCode}</div>
      <div className="mt-1 text-caption text-smoke">
        {lastAuditedAt ? `Last audited ${formatDate(lastAuditedAt)}` : "Not yet audited"}
      </div>

      {canPrint &&
        (editing ? (
          // Boxes get named in a hurry during put-away, so the first name is
          // often provisional; until now there was no way back to it.
          <div className="mt-4 flex flex-col gap-2.5 rounded-xl border border-border-divider p-3">
            <Field label="Box name">
              <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} mono uiSize="sm" />
            </Field>
            <Field label="Shelf" hint="A shelf that doesn't exist yet is created">
              <Input
                value={draftShelf}
                onChange={(e) => setDraftShelf(e.target.value.toUpperCase())}
                mono
                uiSize="sm"
              />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleRename} loading={isSaving}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraftName(boxCode);
                  setDraftShelf(shelfCode);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-2 cursor-pointer text-caption text-smark-orange hover:underline"
          >
            Rename or move box
          </button>
        ))}

      <div className="mt-4 inline-block rounded-[10px] bg-snow p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, no next/image loader needed */}
        <img src={qrDataUrl} alt={`Box ${boxCode} QR code`} width={160} height={160} className="block" />
      </div>

      <div className="mt-3.5 font-mono text-caption leading-relaxed break-words whitespace-pre-line text-silver-mist">{labelText}</div>

      {canPrint && (
        <Button variant="outline" fullWidth className="mt-4" loading={isPending} onClick={handlePrint}>
          Print Big-Box label
        </Button>
      )}
    </div>
  );
}
