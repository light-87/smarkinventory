"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { SessionUser } from "@/lib/auth/session";
import { ToastViewport } from "@/components/ui/toast";
import { Rail } from "./rail";
import { Header } from "./header";
import { BottomBar } from "./bottom-bar";
import { MoreSheet } from "./more-sheet";
import { RegisterServiceWorker } from "./register-service-worker";

/**
 * The authed shell: desktop rail + header, mobile bottom bar + More sheet,
 * around every `(app)` route. Client component (needs the live pathname for
 * active-nav-state + local open/close UI state); `user` is resolved
 * server-side once in app/(app)/layout.tsx and passed down.
 */
export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    // `h-dvh overflow-hidden` (not `min-h-dvh`, letting the whole document
    // grow and scroll): a page-level (html/body) scrollbar is a *classic*
    // (space-reserving) one in Chromium, which shrinks
    // `document.documentElement.clientWidth` below `window.innerWidth` —
    // but viewport-anchored `position: fixed` boxes (BottomBar's
    // `inset-x-0`) are sized against the *un-reduced* initial containing
    // block. On any route whose content is taller than one screen, that
    // mismatch made the fixed bottom nav render ~2px wider than the visible
    // viewport and trip the 360px no-h-scroll invariant (FEATURES.md §18;
    // caught by tests/e2e/dashboard-smoke.spec.ts + notifications-bell.spec.ts
    // at the mobile-360 breakpoint). Capping this root at exactly one
    // viewport tall and routing all scrolling through `main`'s own
    // `overflow-y-auto` means the document itself never grows a scrollbar,
    // so `clientWidth` and the fixed elements' containing block agree again
    // — Rail already assumed this shape (`sticky top-0 h-dvh` + its own
    // internal `overflow-y-auto` nav list).
    <div className="flex h-dvh overflow-hidden bg-obsidian">
      <Rail role={user.role} pathname={pathname} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} pathname={pathname} />
        {/* id targeted by the scroll-lock effect every modal/drawer/sheet
            uses (Drawer, MoreSheet, CommandPalette, ConfirmDialog) — `main`,
            not `document.body`, is the element that actually scrolls now,
            so locking `body`'s overflow alone would no longer stop the
            background from scrolling under an open overlay. */}
        <main id="app-scroll-region" className="min-w-0 flex-1 overflow-y-auto pb-[76px] md:pb-0">
          {children}
        </main>
      </div>
      <BottomBar role={user.role} pathname={pathname} onMore={() => setMoreOpen(true)} />
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} role={user.role} />
      <ToastViewport className="!bottom-[76px] md:!bottom-7" />
      <RegisterServiceWorker />
    </div>
  );
}
