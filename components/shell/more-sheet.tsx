"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { Role } from "@/lib/auth/roles";
import { visibleMoreSheetItems } from "@/lib/nav";
import { NAV_ICONS } from "./icons";
import { NavLinkPending } from "./nav-link-pending";

/**
 * Mobile "More" bottom sheet (R2-22) — every role-visible surface NOT in the
 * bottom bar's 4 primary slots: icon + label grid, 44px+ targets. Deep links
 * unchanged; the matrix (lib/auth/roles) decides what SHOWS, this component
 * only lays it out.
 */
export function MoreSheet({
  open,
  onClose,
  role,
}: {
  open: boolean;
  onClose: () => void;
  role: Role;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    // `main` (id="app-scroll-region", ./app-shell.tsx) is the element that
    // actually scrolls, not `document.body`.
    const scrollEl = document.getElementById("app-scroll-region") ?? document.body;
    const previousOverflow = scrollEl.style.overflow;
    scrollEl.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      scrollEl.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const items = visibleMoreSheetItems(role);

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="animate-fade-in fixed inset-0 z-[70] bg-black/55 md:hidden"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More"
        className="animate-fade-in fixed inset-x-0 bottom-0 z-[71] rounded-t-2xl border-t border-charcoal bg-surface p-5 md:hidden"
        style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-charcoal" />
        <div className="grid grid-cols-3 gap-3">
          {items.map((item) => {
            const Icon = NAV_ICONS[item.id];
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={onClose}
                className="flex min-h-11 flex-col items-center justify-center gap-2 rounded-2xl border border-charcoal bg-surface-panel px-2 py-3 text-center text-[12px] text-silver-mist transition-colors active:bg-ash"
              >
                <span aria-hidden className="size-5 [&_svg]:size-full">
                  {Icon ? <Icon /> : null}
                </span>
                {item.label}
                <NavLinkPending />
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
