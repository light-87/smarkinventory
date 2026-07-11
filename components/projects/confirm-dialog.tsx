"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the destructive (orange) styling — used for Archive. */
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Small centered modal (components/ui has no Dialog primitive yet — this is
 * package-local, not a components/ui addition per docs/OWNERSHIP.md). Used
 * for the Archive warning (R2-32: "give a warning" — I-02 approved) so the
 * consequences are read, not just clicked past.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    // `main` (id="app-scroll-region", components/shell/app-shell.tsx) is the
    // element that actually scrolls, not `document.body`.
    const scrollEl = document.getElementById("app-scroll-region") ?? document.body;
    const previousOverflow = scrollEl.style.overflow;
    scrollEl.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      scrollEl.style.overflow = previousOverflow;
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <>
      <div aria-hidden onClick={onCancel} className="animate-fade-in fixed inset-0 z-[70] bg-[#1d2130]/40" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-x-4 top-1/2 z-[71] mx-auto max-w-[420px] -translate-y-1/2 rounded-2xl border border-charcoal bg-surface p-5 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2"
      >
        <div className="text-[16px] text-snow">{title}</div>
        <div className="mt-2 text-[14px] text-smoke">{description}</div>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "accent-outline" : "primary"}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </>
  );
}
