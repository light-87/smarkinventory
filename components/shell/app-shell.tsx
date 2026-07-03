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
    <div className="flex min-h-dvh bg-obsidian">
      <Rail role={user.role} pathname={pathname} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} pathname={pathname} />
        <main className="min-w-0 flex-1 pb-[76px] md:pb-0">{children}</main>
      </div>
      <BottomBar role={user.role} pathname={pathname} onMore={() => setMoreOpen(true)} />
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} role={user.role} />
      <ToastViewport className="!bottom-[76px] md:!bottom-7" />
      <RegisterServiceWorker />
    </div>
  );
}
