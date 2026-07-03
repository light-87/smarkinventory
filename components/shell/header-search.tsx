"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { resolveScanCode } from "./actions";
import { CloseIcon, ScanIcon } from "./icons";

/**
 * Header scan-or-type field (FEATURES §5 header spec / tab-login-shell.md
 * R2-34's non-palette half): Enter resolves a code to a part or box and
 * routes there; no match toasts instead of silently doing nothing. Desktop
 * shows the field inline; mobile collapses to an icon that expands an
 * overlay row (R2-34: "mobile: magnifier icon in the header").
 *
 * The Ctrl-K palette over parts/projects/BOMs/PO numbers is
 * search-notifications' surface (components/search/**) — out of scope here.
 */
export function HeaderSearch({ className }: { className?: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [value, setValue] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    const code = value.trim();
    if (!code || pending) return;
    startTransition(async () => {
      const result = await resolveScanCode(code);
      if (result.type === "part") {
        setValue("");
        setMobileOpen(false);
        router.push(`/part/${result.pid}`);
      } else if (result.type === "box") {
        setValue("");
        setMobileOpen(false);
        router.push(`/shelves?box=${encodeURIComponent(result.boxId)}`);
      } else {
        push({ msg: `No match for "${code}"` });
      }
    });
  }

  return (
    <>
      <div className={cn("hidden md:block", className)}>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Scan or type a code…"
          mono
          leading={<ScanIcon />}
        />
      </div>

      <button
        type="button"
        aria-label="Search"
        onClick={() => setMobileOpen(true)}
        className="flex min-h-11 min-w-11 flex-none items-center justify-center rounded-full border border-charcoal text-smoke md:hidden"
      >
        <span aria-hidden className="size-4 [&_svg]:size-full">
          <ScanIcon />
        </span>
      </button>

      {mobileOpen && (
        <div className="fixed inset-x-0 top-0 z-40 flex h-[60px] items-center gap-2 bg-obsidian px-4 md:hidden">
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setMobileOpen(false);
            }}
            placeholder="Scan or type a code…"
            mono
            leading={<ScanIcon />}
            className="flex-1"
          />
          <button
            type="button"
            aria-label="Close search"
            onClick={() => setMobileOpen(false)}
            className="flex min-h-11 min-w-11 flex-none items-center justify-center rounded-full border border-charcoal text-smoke"
          >
            <span aria-hidden className="size-4 [&_svg]:size-full">
              <CloseIcon />
            </span>
          </button>
        </div>
      )}
    </>
  );
}
