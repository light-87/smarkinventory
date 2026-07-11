"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { useNotifications } from "@/hooks/use-notifications";
import type { NotificationRow } from "@/types/db";
import { BellIcon, KIND_ICONS } from "./icons";

export interface NotificationBellProps {
  userId: string;
  className?: string;
}

/**
 * components/notifications/notification-bell.tsx — the search-notifications
 * package's canonical bell (docs/OWNERSHIP.md; FEATURES.md §5 header spec /
 * plan/tab-login-shell.md R2-36), rendered directly by
 * `components/shell/header.tsx`'s notification-bell slot.
 *
 * Per-`kind` icons, an unread dot, a loading state, and reads via
 * `hooks/use-notifications.ts` (this package's polling read model).
 */
export function NotificationBell({ userId, className }: NotificationBellProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, loading, markRead, markAllRead } = useNotifications(userId);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function handleSelect(notification: NotificationRow) {
    if (!notification.read_at) await markRead(notification.id);
    setOpen(false);
    if (notification.link) router.push(notification.link);
  }

  return (
    <div className={cn("relative flex-none", className)}>
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((o) => !o)}
        className="relative flex size-9 items-center justify-center rounded-full border border-charcoal bg-surface-raised text-smoke hover:border-slate"
      >
        <span aria-hidden className="size-[18px] [&_svg]:size-full">
          <BellIcon />
        </span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-smark-orange px-1 font-mono text-[10px] font-medium text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div aria-hidden onClick={() => setOpen(false)} className="fixed inset-0 z-[59]" />
          <div
            role="menu"
            aria-label="Notifications"
            className="absolute right-0 top-11 z-[60] max-h-[70vh] w-[340px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-2xl border border-charcoal bg-surface-raised p-2"
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[11px] tracking-[0.06em] text-smoke uppercase">Notifications</span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="cursor-pointer text-[11px] text-smark-orange hover:text-smark-orange-hover"
                >
                  Mark all read
                </button>
              )}
            </div>

            {loading && notifications.length === 0 ? (
              <div className="px-2 py-6 text-center text-[13px] text-smoke">Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="px-2 py-6 text-center text-[13px] text-smoke">Nothing yet</div>
            ) : (
              notifications.map((n) => {
                const Icon = KIND_ICONS[n.kind] ?? BellIcon;
                return (
                  <button
                    key={n.id}
                    type="button"
                    role="menuitem"
                    onClick={() => void handleSelect(n)}
                    className={cn(
                      "flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-ash",
                      !n.read_at && "bg-surface-accent",
                    )}
                  >
                    <span aria-hidden className="mt-0.5 size-4 flex-none text-smoke [&_svg]:size-full">
                      <Icon />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13px] text-snow">{n.title}</span>
                      {n.body && <span className="line-clamp-2 text-[12px] text-smoke">{n.body}</span>}
                      <span className="text-[11px] text-faint">{formatRelativeTime(n.created_at)}</span>
                    </span>
                    {!n.read_at && <span aria-hidden className="mt-1.5 size-1.5 flex-none rounded-full bg-smark-orange" />}
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
