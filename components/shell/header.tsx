"use client";

import type { SessionUser } from "@/lib/auth/session";
import { titleForPath } from "@/lib/nav";
import { CommandPalette } from "@/components/search";
import { NotificationBell } from "@/components/notifications";
import { AvatarMenu } from "./avatar-menu";
import { HeaderCameraScan } from "./header-search";

/**
 * Sticky top chrome (every screen, FEATURES §5 header spec): screen title ·
 * scan-or-type field · notifications bell · avatar menu.
 *
 * Header seam (integrator): the search field + bell slots host
 * search-notifications' real components (components/search + components/
 * notifications) — CommandPalette carries the Ctrl-K palette + scan-code
 * resolve-first behaviour, NotificationBell the polling read model.
 * `HeaderCameraScan` (components/shell/header-search.tsx) is auth-shell's own
 * sibling addition — a camera-scan entry point next to CommandPalette, not an
 * edit inside search-notifications' own files (see that file's header for why).
 */
export function Header({ user, pathname }: { user: SessionUser; pathname: string }) {
  return (
    <header className="sticky top-0 z-30 flex h-[60px] flex-none items-center gap-4 border-b border-charcoal bg-canvas/85 px-4 backdrop-blur-md md:px-6">
      <div className="flex-none truncate text-[18px] font-medium text-snow">
        {titleForPath(pathname, user.role)}
      </div>
      <div className="relative flex min-w-0 flex-1 items-center justify-center gap-2">
        <CommandPalette className="w-full max-w-[420px]" />
        <HeaderCameraScan />
      </div>
      <div className="flex flex-none items-center gap-2.5">
        <NotificationBell userId={user.id} />
        <AvatarMenu user={user} />
      </div>
    </header>
  );
}
