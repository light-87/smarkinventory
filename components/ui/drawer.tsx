"use client";

import { useEffect } from "react";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Panel width in px (prototype: part detail drawer = 480). Always capped at 100vw. */
  width?: number;
  className?: string;
  "aria-label"?: string;
}

/**
 * Right-edge drawer shell (prototype: part detail `#/part/:pid`). Dark
 * overlay + sliding panel; the panel itself is the scroll container so
 * DrawerHeader/DrawerFooter can stick to its top/bottom edge. Unmounts
 * entirely when closed (matches the prototype's `sc-if`) — no exit
 * transition, only the entrance slide.
 */
export function Drawer({
  open,
  onClose,
  children,
  width = 480,
  className,
  "aria-label": ariaLabel,
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="animate-fade-in fixed inset-0 z-[60] bg-black/55"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={{ width }}
        className={cn(
          "animate-slide-in fixed inset-y-0 right-0 z-[61] max-w-[100vw] overflow-y-auto border-l border-charcoal bg-surface",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}

/** Sticky top region: title/meta slot + close control (prototype: pid + status chip). */
export function DrawerHeader({
  className,
  ...props
}: ComponentPropsWithRef<"div">) {
  return (
    <div
      className={cn(
        "sticky top-0 z-[2] flex items-start justify-between gap-3 border-b border-border-divider bg-surface px-6 py-5",
        className,
      )}
      {...props}
    />
  );
}

/** Scrollable content region — bottom padding clears the sticky footer. */
export function DrawerBody({
  className,
  ...props
}: ComponentPropsWithRef<"div">) {
  return (
    <div className={cn("px-6 pt-[22px] pb-[120px]", className)} {...props} />
  );
}

/** Sticky bottom action bar (prototype: "Order more" + "Adjust qty"). */
export function DrawerFooter({
  className,
  ...props
}: ComponentPropsWithRef<"div">) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-[2] flex gap-3 border-t border-border-divider bg-surface px-6 py-3.5",
        className,
      )}
      {...props}
    />
  );
}

export function DrawerCloseButton({
  className,
  ...props
}: ComponentPropsWithRef<"button">) {
  return (
    <button
      type="button"
      aria-label="Close"
      className={cn(
        "flex size-8 flex-none cursor-pointer items-center justify-center rounded-full border border-charcoal bg-transparent text-silver-mist leading-none transition-colors hover:bg-ash",
        className,
      )}
      {...props}
    >
      <span aria-hidden className="text-lg">
        ×
      </span>
    </button>
  );
}
